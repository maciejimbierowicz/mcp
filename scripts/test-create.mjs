import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const bearer = 'local-create-test-token-1234567890';
const token = 'a'.repeat(64);
const html = '<p>Cały tekst — <strong>ąęść</strong>.</p>\n<p>Drugi akapit.</p>';
const fields = {
  title: 'Lokalny Wall of Love',
  field_wol_content: [
    { bundle: 'par_text', fields: { field_par_text: html } },
    { bundle: 'wol_opinion', fields: { field_opinion_reference: { target_id: 123 } } },
  ],
};
const content = {
  content_type: 'wall_of_love', title: fields.title, status: false,
  langcode: 'pl', uid: 2, promote: false, sticky: false,
  field_wol_content: [
    { bundle: 'par_text', fields: { field_par_text: { value: html, format: 'full_html' } } },
    fields.field_wol_content[1],
  ],
  field_metatags: [], alias: '/lokalny-wall-of-love',
};
const preview = {
  operation: 'single_content_create', content_type: 'wall_of_love',
  nid: null, current_revision_id: null, content,
  changes: Object.entries(content).map(([field, after]) => ({ field, before: null, after })),
  requires_confirmation: true, preview_token: token,
  expires_at: new Date(Date.now() + 600000).toISOString(),
};
const committed = {
  operation: 'single_content_create', content_type: 'wall_of_love',
  nid: 9001, revision_id: 9010, audit_id: 90, status: false,
  alias: content.alias, url: `http://127.0.0.1${content.alias}`, content,
};
const calls = [];
let consumed = false;
let blocked = false;
let conflict = false;
let malformed = false;
const expectedAuth = (scope) => `Basic ${Buffer.from(`${scope}-test:${scope}-password`).toString('base64')}`;
const drupal = createServer(async (request, response) => {
  let raw = '';
  for await (const chunk of request) raw += chunk;
  const body = raw ? JSON.parse(raw) : null;
  calls.push({ path: request.url, body, authorization: request.headers.authorization });
  const send = (status, value, headers = {}) => {
    response.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    response.end(JSON.stringify(value));
  };
  if (request.url.startsWith('/api/v1/content/9001/write-audit?')) {
    assert.equal(request.headers.authorization, expectedAuth('read'));
    send(200, { data: {
      nid: 9001, items: [{
        audit_id: 90, technical_uid: 2, nid: 9001, operation: 'create',
        old_revision_id: null, new_revision_id: 9010, timestamp: 1,
        changed_fields: ['title'], changes: preview.changes,
      }], has_more: false, next_after_audit_id: null,
    } });
    return;
  }
  assert.equal(request.headers.authorization, expectedAuth('write'));
  if (request.url === '/api/v1/content/create/preview') {
    send(200, { data: preview });
  }
  else if (request.url === '/api/v1/content/create/commit') {
    if (blocked) send(429, { error: { code: 'rate_limited', message: 'Wait before CREATE.' } }, { 'Retry-After': '17' });
    else if (conflict) send(409, { error: { code: 'create_conflict', message: 'Alias is already reserved.' } });
    else if (malformed) send(201, { data: { ...committed, status: true } });
    else if (consumed) send(409, { error: { code: 'create_conflict', message: 'Token already used.' } });
    else {
      consumed = true;
      send(201, { data: committed });
    }
  }
  else send(404, { error: { code: 'not_found', message: 'Unexpected test path.' } });
});
await new Promise((resolve) => drupal.listen(0, '127.0.0.1', resolve));
const drupalUrl = `http://127.0.0.1:${drupal.address().port}`;
const processes = [];
const clients = [];

async function startMcp(writeEnabled) {
  const reservation = createServer();
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(process.execPath, ['src/server.mjs'], {
    cwd: root,
    env: {
      ...process.env,
      MCP_PORT: String(port), MCP_AUTH_TOKEN: bearer,
      DRUPAL_BASE_URL: drupalUrl, DRUPAL_USERNAME: 'read-test', DRUPAL_PASSWORD: 'read-password',
      DRUPAL_WRITE_USERNAME: 'write-test', DRUPAL_WRITE_PASSWORD: 'write-password',
      MCP_WRITE_ENABLED: String(writeEnabled), GTM_ENABLED: 'false',
      MCP_RATE_LIMIT_PER_MIN: '600', MCP_RATE_BURST: '100',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  processes.push(child);
  let diagnostics = '';
  child.stderr.on('data', (chunk) => { diagnostics += chunk.toString(); });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Local MCP exited: ${diagnostics}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) { ready = true; break; }
    }
    catch { /* Server is still starting. */ }
    await delay(50);
  }
  assert.ok(ready, `Local MCP did not start: ${diagnostics}`);
  const client = new Client({ name: 'local-create-test', version: '1' });
  clients.push(client);
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
  }));
  return client;
}

try {
  const client = await startMcp(true);
  const tools = (await client.listTools()).tools;
  for (const name of ['preview_content_create', 'commit_content_create']) {
    const tool = tools.find((entry) => entry.name === name);
    assert.ok(tool, `${name} must be listed when WRITE is enabled.`);
    assert.equal(tool.annotations.readOnlyHint, false);
    assert.equal(tool.annotations.destructiveHint, false);
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
  const call = (name, input) => client.callTool({ name, arguments: input });
  const reject = async (name, input) => {
    const before = calls.length;
    const result = await call(name, input);
    assert.equal(result.isError, true, 'Invalid tool input must be rejected.');
    assert.equal(calls.length, before, 'Rejected input must never reach Drupal.');
  };
  for (const input of [
    { content_type: 'opinia', fields },
    { content_type: 'wall_of_love', fields: { ...fields, status: true } },
    { content_type: 'wall_of_love', fields: { ...fields, meta_title: 'Extra' } },
    { content_type: 'wall_of_love', fields, confirmed: true },
    { content_type: 'wall_of_love', fields: { title: fields.title, field_wol_content: [{ ...fields.field_wol_content[0], target_id: 12 }] } },
    { content_type: 'wall_of_love', fields: { title: fields.title, field_wol_content: [{ bundle: 'par_image', fields: {} }] } },
    { content_type: 'wall_of_love', fields: { title: fields.title, field_wol_content: [{ bundle: 'wol_opinion', fields: { field_opinion_reference: { target_id: '123' } } }] } },
  ]) await reject('preview_content_create', input);

  const shown = await call('preview_content_create', { content_type: 'wall_of_love', fields });
  assert.deepEqual(shown.structuredContent, preview);
  assert.deepEqual(JSON.parse(shown.content[0].text), preview);
  assert.deepEqual(calls.at(-1).body, { content_type: 'wall_of_love', fields });
  assert.equal(calls.filter((entry) => entry.path.endsWith('/commit')).length, 0, 'Preview cannot invoke commit.');
  await reject('commit_content_create', { preview_token: token, confirmed: false });
  await reject('commit_content_create', { preview_token: token, confirmed: 'true' });
  await reject('commit_content_create', { preview_token: 'bad', confirmed: true });
  await reject('commit_content_create', { preview_token: token, confirmed: true, fields });

  blocked = true;
  const limited = await call('commit_content_create', { preview_token: token, confirmed: true });
  assert.equal(limited.structuredContent.status, 'blocked');
  assert.equal(limited.structuredContent.result, null);
  assert.equal(limited.structuredContent.error.retry_after, 17, 'Retry-After HTTP header must survive MCP.');
  blocked = false;
  conflict = true;
  const collision = await call('commit_content_create', { preview_token: token, confirmed: true });
  assert.equal(collision.isError, true);
  assert.match(collision.content[0].text, /create_conflict/);
  conflict = false;
  malformed = true;
  assert.equal((await call('commit_content_create', { preview_token: token, confirmed: true })).isError, true, 'Published CREATE output must not be reported as committed.');
  malformed = false;

  const saved = await call('commit_content_create', { preview_token: token, confirmed: true });
  assert.deepEqual(saved.structuredContent, { status: 'committed', result: committed, error: null });
  assert.deepEqual(calls.at(-1).body, { preview_token: token, confirmed: true });
  assert.equal((await call('commit_content_create', { preview_token: token, confirmed: true })).isError, true);
  const audit = await call('get_content_write_audit', { nid: 9001 });
  assert.equal(audit.structuredContent.items[0].old_revision_id, null);
  assert.equal(audit.structuredContent.items[0].operation, 'create');

  const reader = await startMcp(false);
  const readTools = (await reader.listTools()).tools;
  assert.equal(readTools.some((entry) => ['preview_content_create', 'commit_content_create'].includes(entry.name)), false);
  const noWriteCalls = calls.length;
  assert.equal((await reader.callTool({ name: 'commit_content_create', arguments: { preview_token: token, confirmed: true } })).isError, true);
  assert.equal(calls.length, noWriteCalls);
  console.log('PASS: local MCP CREATE protocol, strict schemas, full preview, WRITE credentials, explicit confirmation, rate limit, conflicts, replay, CREATE audit and READ-only gating.');
}
finally {
  await Promise.allSettled(clients.map((client) => client.close()));
  await Promise.all(processes.map(async (child) => {
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
  }));
  await new Promise((resolve) => drupal.close(resolve));
}

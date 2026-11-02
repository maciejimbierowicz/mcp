import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerCreateTools } from '../src/create-tools.mjs';

const tools = {};
const calls = [];
let response;
let fail;
const client = { async post(path, body) {
  calls.push({ path, body });
  if (fail) throw fail;
  return response;
} };
const error = (err) => ({ isError: true, content: [{ type: 'text', text: err.message }] });
registerCreateTools({ registerTool(name, options, handler) {
  tools[name] = { options, handler };
} }, client, error, error);
const preview = tools.preview_content_create;
const commit = tools.commit_content_create;
const reference = { target_id: 123 };
const fields = {
  title: 'Opinia testowa',
  body: { value: '<p>Treść opinii.</p>' },
  field_zajawka: '<p>Zajawka.</p>',
  field_kat_szkolenie: reference,
  field_kategoria: [reference],
  field_tagi: [reference],
  field_trener: reference,
};
const base = {
  title: fields.title, status: false, langcode: 'pl', uid: 123,
  promote: false, sticky: false, field_metatags: [], alias: '/opinie/opinia-testowa',
};
const opinion = {
  ...base, ...fields, content_type: 'opinia',
  body: { ...fields.body, summary: null, format: 'full_html' },
  field_zajawka: { value: fields.field_zajawka, format: 'full_html' },
  field_ocena_wartosci_opinii: reference,
  field_name: null, field_surname: null, field_survey: null,
  field_linkedin_link: null, field_goldenline_link: null,
  field_additional_info: [], field_promotions: false,
};
const wol = { ...base, content_type: 'wall_of_love', field_wol_content: [], alias: '/opinia-testowa' };
const token = 'a'.repeat(64);
for (const content of [opinion, wol]) {
  const input = { content_type: content.content_type, fields: content === opinion ? fields : { title: base.title } };
  response = {
    operation: 'single_content_create', content_type: content.content_type,
    nid: null, current_revision_id: null, content,
    changes: Object.entries(content).map(([field, after]) => ({ field, before: null, after })),
    requires_confirmation: true, preview_token: token, expires_at: '2026-11-02T12:00:00Z',
  };
  assert.deepEqual((await preview.handler(input)).structuredContent, response);
  assert.deepEqual(calls.at(-1), { path: '/api/v1/content/create/preview', body: input });
  response = {
    operation: 'single_content_create', content_type: content.content_type,
    nid: 456, revision_id: 789, audit_id: 111, status: false,
    alias: content.alias, url: `https://4grow.pl${content.alias}`, content,
  };
  assert.deepEqual((await commit.handler({ preview_token: token, confirmed: true })).structuredContent,
    { status: 'committed', result: response, error: null });
}

for (const input of [
  { content_type: 'npxtraining', fields },
  { content_type: 'wall_of_love', fields },
  { content_type: 'opinia', fields: { title: base.title } },
  ...['status', 'uid', 'field_bonus_email', 'field_image', 'field_wol_content'].map((field) => ({
    content_type: 'opinia', fields: { ...fields, [field]: true },
  })),
  ...['body', 'field_zajawka', 'field_trener', 'field_kategoria', 'field_tagi'].map((field) => ({
    content_type: 'opinia', fields: { ...fields, [field]: null },
  })),
  { content_type: 'opinia', fields: { ...fields, field_tagi: [] } },
  { content_type: 'opinia', fields: { ...fields, field_trener: { target_id: -1 } } },
  { content_type: 'opinia', fields: { ...fields, body: { value: 'Text', format: 'full_html' } } },
  { content_type: 'opinia', fields: { ...fields, field_promotions: 'true' } },
  { content_type: 'opinia', fields: { ...fields, field_additional_info: ['inferred'] } },
]) {
  const before = calls.length;
  assert.equal((await preview.handler(input)).isError, true, JSON.stringify(input));
  assert.equal(calls.length, before, 'Invalid input must not reach Drupal');
}
for (const input of [
  { preview_token: token, confirmed: false },
  { preview_token: token, confirmed: true, status: true },
  { preview_token: 'bad', confirmed: true },
]) {
  const before = calls.length;
  assert.equal((await commit.handler(input)).isError, true);
  assert.equal(calls.length, before);
}
response = { ...response, status: true };
assert.equal((await commit.handler({ preview_token: token, confirmed: true })).isError, true,
  'A published CREATE response must be rejected');
fail = new Error('create_conflict');
const before = calls.length;
assert.equal((await commit.handler({ preview_token: token, confirmed: true })).isError, true);
assert.equal(calls.length, before + 1, 'Conflicts must not be retried');

// Exercise SDK registration and schema serialization, not only direct handlers.
const server = new McpServer({ name: 'create-test', version: '1.0.0' });
registerCreateTools(server, client, error, error);
const mcp = new Client({ name: 'create-test-client', version: '1.0.0' });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);
try {
  const listed = await mcp.listTools();
  assert.equal(listed.tools.length, 2);
  const schema = listed.tools.find((tool) => tool.name === 'preview_content_create').inputSchema;
  assert.equal(schema.type, 'object');
  assert.deepEqual(schema.properties.content_type.enum, ['wall_of_love', 'opinia']);
  fail = null;
  response = {
    operation: 'single_content_create', content_type: 'opinia',
    nid: null, current_revision_id: null, content: opinion,
    changes: Object.entries(opinion).map(([field, after]) => ({ field, before: null, after })),
    requires_confirmation: true, preview_token: token, expires_at: '2026-11-02T12:00:00Z',
  };
  const called = await mcp.callTool({ name: 'preview_content_create', arguments: { content_type: 'opinia', fields } });
  assert.notEqual(called.isError, true);
  assert.deepEqual(called.structuredContent, response);
} finally {
  await mcp.close();
  await server.close();
}
console.log('PASS: opinion and Wall of Love CREATE contracts, validation, confirmation, errors and SDK schemas');

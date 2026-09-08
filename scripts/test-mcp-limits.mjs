import { bearerMatches, requireBearerToken } from '../src/auth.mjs';
import { createSemaphore, createTokenBucket, logMcpEvent, mcpToolName } from '../src/limits.mjs';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const token = 'a'.repeat(32);
assert(bearerMatches(`Bearer ${token}`, token) === true, 'Matching Bearer must pass.');
assert(bearerMatches('Bearer short', token) === false, 'Different length must fail.');
assert(bearerMatches('Basic nope', token) === false, 'Non-Bearer must fail.');
assert(bearerMatches(undefined, token) === false, 'Missing header must fail.');

let nextCalled = false;
const unauthorized = {
  headers: {},
  statusCode: 0,
  body: null,
  set(name, value) {
    this.headers[name] = value;
    return this;
  },
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
};
requireBearerToken(token)({ headers: {} }, unauthorized, () => {
  nextCalled = true;
});
assert(unauthorized.statusCode === 401, 'Missing token must be 401.');
assert(unauthorized.body?.error?.message === 'Unauthorized.', 'Unauthorized body must stay generic.');
assert(nextCalled === false, 'Missing token must not continue.');

const bucket = createTokenBucket({ capacity: 2, refillPerMs: 0 });
assert(bucket.take() === true && bucket.take() === true, 'Burst capacity must allow two takes.');
assert(bucket.take() === false, 'An empty bucket must reject.');

const semaphore = createSemaphore(1);
const first = await semaphore.acquire(50);
const started = Date.now();
let timedOut = false;
try {
  await semaphore.acquire(80);
}
catch {
  timedOut = true;
}
first();
assert(timedOut === true, 'A full semaphore must time out instead of starting a third Drupal read.');
assert(Date.now() - started >= 70, 'The waiter must actually wait for the cap.');
const after = await semaphore.acquire(50);
after();

assert(mcpToolName({ method: 'tools/call', params: { name: 'search_content' } }) === 'search_content', 'tools/call must log the tool name.');
assert(mcpToolName({ method: 'initialize' }) === 'initialize', 'Lifecycle methods must keep their name.');
assert(mcpToolName(null) === 'unknown', 'Missing bodies must not throw.');

const logged = [];
const originalWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk) => {
  logged.push(String(chunk));
  return true;
};
logMcpEvent({
  requestId: 'req-1',
  tool: 'list_content_types',
  durationMs: 12,
  result: 'ok',
});
process.stderr.write = originalWrite;
assert(logged.length === 1, 'MCP events must write one JSON line.');
const event = JSON.parse(logged[0]);
assert(event.request_id === 'req-1' && event.tool === 'list_content_types' && event.result === 'ok', 'Log line must keep request metadata.');
assert(!JSON.stringify(event).toLowerCase().includes('bearer'), 'Log line must not mention Bearer.');

console.log(JSON.stringify({
  bearer: 'ok',
  rate_limit_burst: 2,
  semaphore_timeout: true,
  log_keys: Object.keys(event),
}, null, 2));

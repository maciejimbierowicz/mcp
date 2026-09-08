import { DrupalApiError, DrupalClient } from '../src/drupal-client.mjs';

const client = new DrupalClient({
  baseUrl: process.env.DRUPAL_BASE_URL,
  username: process.env.DRUPAL_USERNAME,
  password: process.env.DRUPAL_PASSWORD,
});

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function expectError(operation, status, code) {
  try {
    await operation();
  }
  catch (error) {
    assert(
      error instanceof DrupalApiError && error.status === status && error.code === code,
      `Expected HTTP ${status} ${code}, got ${error.status} ${error.code} ${error.message}.`,
    );
    return;
  }
  throw new Error(`Expected ${code} (${status}).`);
}

const types = await client.get('/api/v1/content/types');
assert(types.length === 3, 'READ allowlist must stay at three types.');

const quiz = await client.get('/api/v1/content/1138?fields=title,field_questions&expand=field_questions');
assert(quiz.nid === 1138, 'Quiz expand fixture must still load.');
assert(
  Buffer.byteLength(JSON.stringify(quiz), 'utf8') < 2097152,
  'Quiz 1138 expand must stay under the 2 MB response cap.',
);

await expectError(
  () => client.get('/api/v1/content/types/page/schema'),
  404,
  'unsupported_type',
);
await expectError(
  () => client.get('/api/v1/content/1137?fields=title'),
  403,
  'access_denied',
);

const searchGet = await fetch(new URL('/api/v1/content/search', `${process.env.DRUPAL_BASE_URL}/`), {
  method: 'GET',
  redirect: 'manual',
  headers: {
    Accept: 'application/json',
    Authorization: `Basic ${Buffer.from(`${process.env.DRUPAL_USERNAME}:${process.env.DRUPAL_PASSWORD}`).toString('base64')}`,
  },
});
assert(searchGet.status === 405, `Search GET must be 405, got ${searchGet.status}.`);

const unauthorized = await fetch(new URL('/api/v1/content/types', `${process.env.DRUPAL_BASE_URL}/`), {
  headers: { Accept: 'application/json' },
});
assert(unauthorized.status === 401, `Missing Drupal Basic auth must be 401, got ${unauthorized.status}.`);

console.log(JSON.stringify({
  types: types.map((item) => item.machine_name),
  quiz_1138_bytes: Buffer.byteLength(JSON.stringify(quiz), 'utf8'),
  search_get: searchGet.status,
  missing_basic_auth: unauthorized.status,
}, null, 2));

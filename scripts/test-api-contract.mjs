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

async function expectError(operation, status, code, fragment) {
  try {
    await operation();
  }
  catch (error) {
    assert(
      error instanceof DrupalApiError
        && error.status === status
        && error.code === code
        && error.message.includes(fragment),
      `Expected HTTP ${status} code ${code} mentioning "${fragment}", got ${error.status} ${error.code} ${error.message}.`,
    );
    return error;
  }
  throw new Error(`Expected ${code} (${status}) mentioning "${fragment}".`);
}

const types = await client.get('/api/v1/content/types');
assert(Array.isArray(types) && types.length === 3, 'Allowlist must expose exactly three types.');
assert(
  types.map((item) => item.machine_name).join(',') === 'npxtraining,landing_page,npxquiz',
  'Allowlist order must stay npxtraining, landing_page, npxquiz.',
);

const schema = await client.get('/api/v1/content/types/npxquiz/schema');
assert(schema.machine_name === 'npxquiz', 'Quiz schema must keep its machine name.');
assert(Array.isArray(schema.fields) && schema.fields.length > 0, 'Schema must list fields.');
assert(
  schema.fields.every((field) => typeof field.machine_name === 'string'),
  'Every schema field must have a machine_name.',
);

const emptyQuiz = await client.get(
  '/api/v1/content/1138?fields=title,meta_description,field_questions',
);
assert(emptyQuiz.nid === 1138, 'Expected quiz nid 1138.');
assert(
  emptyQuiz.fields.meta_description === null,
  'Stored empty meta description must be null, not omitted.',
);
assert(
  Object.hasOwn(emptyQuiz.fields, 'meta_description'),
  'Empty meta description must remain a present key.',
);
assert(
  Array.isArray(emptyQuiz.fields.field_questions)
    && emptyQuiz.fields.field_questions.every((item) => item.target_id && !item.fields),
  'Unexpanded references must stay as target_id without nested fields.',
);

const emptyLanding = await client.get('/api/v1/content/7167?fields=title,meta_description');
assert(emptyLanding.nid === 7167, 'Expected landing nid 7167.');
assert(
  emptyLanding.fields.meta_description === null,
  'Landing 7167 must keep a stored null meta description.',
);

await expectError(
  () => client.get('/api/v1/content/4?fields=definitely_not_a_field'),
  400,
  'unknown_field',
  'does not exist',
);
await expectError(
  () => client.get('/api/v1/content/types/page/schema'),
  404,
  'unsupported_type',
  'not available through the Content API',
);
await expectError(
  () => client.get('/api/v1/content/types/npxtest/schema'),
  404,
  'unsupported_type',
  'not available through the Content API',
);
await expectError(
  () => client.get('/api/v1/content/1137?fields=title'),
  403,
  'access_denied',
  'cannot view this content',
);
await expectError(
  () => client.get('/api/v1/content/999999999?fields=title'),
  404,
  'not_found',
  'not available',
);
await expectError(
  () => client.get('/api/v1/content/4?fields[]=title'),
  400,
  'invalid_request',
  'comma-separated string',
);
await expectError(
  () => client.get(`/api/v1/content/4?fields=${Array.from({ length: 51 }, () => 'title').join(',')}`),
  400,
  'invalid_request',
  'at most 50 fields',
);

await expectError(
  () => client.post('/api/v1/content/search', {
    content_type: 'npxquiz',
    conditions: [],
    fields: ['nid', 'no_such_field'],
    limit: 1,
  }),
  400,
  'unknown_field',
  'unavailable field',
);
await expectError(
  () => client.post('/api/v1/content/search', {
    content_type: 'page',
    conditions: [],
    fields: ['nid'],
    limit: 1,
  }),
  404,
  'unsupported_type',
  'not available',
);
await expectError(
  () => client.post('/api/v1/content/search', {
    content_type: 'npxquiz',
    conditions: [],
    fields: ['nid'],
    limit: [20],
  }),
  400,
  'invalid_request',
  'must be an integer',
);
await expectError(
  () => client.post('/api/v1/content/search', {
    content_type: 'npxquiz',
    conditions: Array.from({ length: 11 }, () => ({ field: 'title', operator: 'not_empty' })),
    fields: ['nid'],
    limit: 1,
  }),
  400,
  'invalid_request',
  'at most 10 conditions',
);
await expectError(
  () => client.post('/api/v1/content/search', {
    content_type: 'npxquiz',
    conditions: [],
    fields: Array.from({ length: 51 }, () => 'nid'),
    limit: 1,
  }),
  400,
  'invalid_request',
  'at most 50 fields',
);
await expectError(
  () => client.post('/api/v1/content/search', {
    content_type: 'npxquiz',
    conditions: [
      { field: 'nid', operator: 'in', value: Array.from({ length: 51 }, (_, index) => index + 1) },
    ],
    fields: ['nid'],
    limit: 1,
  }),
  400,
  'invalid_request',
  'at most 50 values',
);
await expectError(
  () => client.post('/api/v1/content/search', {
    content_type: 'npxquiz',
    conditions: [
      { field: 'title', operator: 'contains', value: 'x'.repeat(501) },
    ],
    fields: ['nid'],
    limit: 1,
  }),
  400,
  'invalid_request',
  'longer than 500 characters',
);

const emptyMetaQuizzes = await client.post('/api/v1/content/search', {
  content_type: 'npxquiz',
  conditions: [{ field: 'meta_description', operator: 'empty' }],
  fields: ['nid', 'title', 'meta_description'],
  limit: 20,
});
assert(
  emptyMetaQuizzes.items.some((item) => item.nid === 1138),
  'Empty-meta search must still find quiz 1138 as a real null.',
);
assert(
  emptyMetaQuizzes.items.every((item) => Object.hasOwn(item, 'meta_description') && item.meta_description === null),
  'Empty-meta quiz hits must keep meta_description as a present null.',
);
assert(
  Number.isInteger(emptyMetaQuizzes.inaccessible) && emptyMetaQuizzes.inaccessible >= 0,
  'Search must report inaccessible.',
);

const emptyMetaLandings = await client.post('/api/v1/content/search', {
  content_type: 'landing_page',
  conditions: [{ field: 'meta_description', operator: 'empty' }],
  fields: ['nid', 'title', 'meta_description'],
  limit: 20,
});
assert(
  emptyMetaLandings.items.some((item) => item.nid === 7167),
  'Empty-meta search must still find landing 7167 as a real null.',
);

const timeoutError = new DrupalApiError('Drupal did not respond within 30000 ms.', null, 'timeout');
assert(timeoutError.code === 'timeout', 'Timeout errors must use code timeout.');
assert(timeoutError.status === null, 'Timeout errors have no HTTP status.');

console.log(JSON.stringify({
  types: types.map((item) => item.machine_name),
  quiz_schema_fields: schema.fields.length,
  empty_meta_null: {
    quiz_1138: emptyQuiz.fields.meta_description,
    landing_7167: emptyLanding.fields.meta_description,
  },
  empty_meta_search: {
    quiz_1138: emptyMetaQuizzes.items.some((item) => item.nid === 1138),
    landing_7167: emptyMetaLandings.items.some((item) => item.nid === 7167),
  },
}, null, 2));

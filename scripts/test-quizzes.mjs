import { DrupalApiError, DrupalClient } from '../src/drupal-client.mjs';

const LOGICAL_FIELDS = [
  'meta_title',
  'meta_description',
  'canonical',
  'url_alias',
  'revision_author',
  'revision_timestamp',
  'revision_log',
];

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

async function expectStatus(path, status, fragment) {
  try {
    await client.get(path);
  }
  catch (error) {
    assert(
      error instanceof DrupalApiError
        && error.status === status
        && error.message.includes(fragment),
      `Expected HTTP ${status} mentioning "${fragment}" for ${path}, got ${error.status} ${error.message}.`,
    );
    return;
  }
  throw new Error(`Expected ${path} to fail.`);
}

const types = await client.get('/api/v1/content/types');
const machineNames = types.map((item) => item.machine_name);
assert(machineNames.includes('npxtraining'), 'Allowlist must keep npxtraining.');
assert(machineNames.includes('landing_page'), 'Allowlist must keep landing_page.');
assert(machineNames.includes('npxquiz'), 'Allowlist must expose npxquiz.');
assert(!machineNames.includes('page'), 'Ordinary pages must stay off the allowlist.');

const quizType = types.find((item) => item.machine_name === 'npxquiz');
assert(quizType.label === 'Quiz', 'Quiz must keep its Drupal label.');
assert(quizType.revisions_enabled === true, 'Quizzes keep revisions.');

const schema = await client.get('/api/v1/content/types/npxquiz/schema');
const schemaFields = schema.fields.map((field) => field.machine_name);
for (const field of LOGICAL_FIELDS) {
  assert(schemaFields.includes(field), `Quiz schema is missing ${field}.`);
}
assert(schemaFields.includes('field_questions'), 'Quiz schema must expose field_questions.');
assert(!schemaFields.includes('field_metatags'), 'Schema must hide field_metatags.');
assert(!schemaFields.includes('path'), 'Schema must hide path.');

const withSeo = await client.get(
  '/api/v1/content/1375?fields=title,meta_title,meta_description,canonical,url_alias,revision_id,revision_log,revision_author,revision_timestamp,status',
);
assert(withSeo.nid === 1375, 'Expected quiz nid 1375.');
assert(withSeo.content_type === 'npxquiz', 'nid 1375 must be a quiz.');
assert(
  typeof withSeo.fields.meta_description === 'string'
    && withSeo.fields.meta_description.length > 0,
  'nid 1375 must return a stored meta description.',
);
assert(
  typeof withSeo.fields.url_alias === 'string'
    && withSeo.fields.url_alias.startsWith('/'),
  'nid 1375 must return a URL alias.',
);

const missingMeta = await client.get(
  '/api/v1/content/1138?fields=title,meta_description,url_alias,field_questions',
);
assert(missingMeta.nid === 1138, 'Expected quiz nid 1138.');
assert(
  missingMeta.fields.meta_description === null,
  'nid 1138 must have a null stored meta description.',
);
assert(
  Array.isArray(missingMeta.fields.field_questions),
  'Without expand, quiz questions must stay as raw references.',
);
assert(
  missingMeta.fields.field_questions.every((item) => item.target_id && !item.fields),
  '5A must not expand quiz questions automatically.',
);

const full = await client.get('/api/v1/content/1375');
assert(full.content_type === 'npxquiz', 'nid 1375 must be a quiz.');
assert(Object.keys(full.fields).length > 10, 'A full quiz read must return more than metadata.');
assert(!Object.hasOwn(full.fields, 'field_metatags'), 'A full read must still hide field_metatags.');

await expectStatus(
  '/api/v1/content/1137?fields=title',
  403,
  'cannot view this content',
);
await expectStatus(
  '/api/v1/content/types/page/schema',
  404,
  'not available through the Content API',
);

const revisions = await client.get('/api/v1/content/2750/revisions?limit=5');
assert(revisions.nid === 2750, 'Revision listing must stay on the requested node.');
assert(revisions.items.length > 0, 'Quiz history must return at least one revision.');
assert(Number.isInteger(revisions.current_revision_id), 'Revision listing must expose the current revision.');

const firstRevision = revisions.items[0];
const revision = await client.get(
  `/api/v1/content/2750/revisions/${firstRevision.revision_id}?fields=title,meta_description,revision_log`,
);
assert(revision.content_type === 'npxquiz', 'A quiz revision must keep its bundle.');
assert(Object.hasOwn(revision.fields, 'title'), 'A quiz revision must return selected fields.');

const searchTitle = await client.post('/api/v1/content/search', {
  content_type: 'npxquiz',
  conditions: [
    { field: 'title', operator: 'contains', value: 'asertywnych' },
  ],
  fields: ['nid', 'title'],
  limit: 20,
});
assert(
  searchTitle.items.some((item) => item.nid === 1138),
  'Title search must find nid 1138.',
);
assert(
  !searchTitle.items.some((item) => item.nid === 1137 || item.nid === 1139),
  'Search must not return unpublished quizzes.',
);

const emptyMeta = await client.post('/api/v1/content/search', {
  content_type: 'npxquiz',
  conditions: [
    { field: 'meta_description', operator: 'empty' },
  ],
  fields: ['nid', 'title', 'meta_description'],
  limit: 20,
});
assert(
  emptyMeta.items.some((item) => item.nid === 1138),
  'Empty-meta search must include nid 1138.',
);
assert(
  !emptyMeta.items.some((item) => item.nid === 1375),
  'Empty-meta search must not include nid 1375.',
);
assert(
  emptyMeta.items.every((item) => item.meta_description === null),
  'Every empty-meta quiz hit must have meta_description null.',
);

const training = await client.get('/api/v1/content/52?fields=title');
assert(training.content_type === 'npxtraining', 'Training reads must still work.');
const landing = await client.get('/api/v1/content/6920?fields=title');
assert(landing.content_type === 'landing_page', 'Landing page reads must still work.');

console.log(JSON.stringify({
  content_types: machineNames,
  quiz_1375: {
    nid: withSeo.nid,
    title: withSeo.fields.title,
    meta_description: withSeo.fields.meta_description,
    url_alias: withSeo.fields.url_alias,
    revision_id: withSeo.revision_id,
  },
  quiz_1138: {
    nid: missingMeta.nid,
    title: missingMeta.fields.title,
    meta_description: missingMeta.fields.meta_description,
    url_alias: missingMeta.fields.url_alias,
    question_refs: missingMeta.fields.field_questions.length,
  },
  quiz_2750: {
    revisions: revisions.count,
    current_revision_id: revisions.current_revision_id,
  },
  empty_meta_search: {
    count: emptyMeta.count,
    nids: emptyMeta.items.map((item) => item.nid),
  },
}, null, 2));

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
assert(machineNames.includes('landing_page'), 'Allowlist must expose landing_page.');
assert(!machineNames.includes('npxquiz'), 'Quiz must stay off the allowlist.');
assert(!machineNames.includes('page'), 'Ordinary pages must stay off the allowlist.');

const landing = types.find((item) => item.machine_name === 'landing_page');
assert(landing.label.includes('Landing page'), 'Landing page must keep its Drupal label.');
assert(landing.revisions_enabled === true, 'Landing pages keep revisions.');

const schema = await client.get('/api/v1/content/types/landing_page/schema');
const schemaFields = schema.fields.map((field) => field.machine_name);
for (const field of LOGICAL_FIELDS) {
  assert(schemaFields.includes(field), `Landing page schema is missing ${field}.`);
}
assert(!schemaFields.includes('field_metatags'), 'Schema must hide field_metatags.');
assert(!schemaFields.includes('path'), 'Schema must hide path.');

const withSeo = await client.get(
  '/api/v1/content/6920?fields=title,meta_title,meta_description,canonical,url_alias,revision_id,revision_log,revision_author,revision_timestamp',
);
assert(withSeo.nid === 6920, 'Expected landing page nid 6920.');
assert(withSeo.content_type === 'landing_page', 'nid 6920 must be a landing page.');
assert(
  typeof withSeo.fields.meta_description === 'string'
    && withSeo.fields.meta_description.length > 0,
  'nid 6920 must return a stored meta description.',
);
assert(
  typeof withSeo.fields.url_alias === 'string'
    && withSeo.fields.url_alias.startsWith('/'),
  'nid 6920 must return a URL alias.',
);

const missingMeta = await client.get(
  '/api/v1/content/7167?fields=title,meta_description,url_alias',
);
assert(missingMeta.nid === 7167, 'Expected landing page nid 7167.');
assert(
  missingMeta.fields.meta_description === null,
  'nid 7167 must have a null stored meta description.',
);

const full = await client.get('/api/v1/content/7154');
assert(full.content_type === 'landing_page', 'nid 7154 must be a landing page.');
assert(Object.keys(full.fields).length > 20, 'A full landing page read must return more than metadata.');
assert(!Object.hasOwn(full.fields, 'field_metatags'), 'A full read must still hide field_metatags.');

await expectStatus(
  '/api/v1/content/8491?fields=title',
  403,
  'cannot view this content',
);
await expectStatus(
  '/api/v1/content/types/page/schema',
  404,
  'not available through the Content API',
);
await expectStatus(
  '/api/v1/content/types/npxquiz/schema',
  404,
  'not available through the Content API',
);

const revisions = await client.get('/api/v1/content/7167/revisions?limit=5');
assert(revisions.nid === 7167, 'Revision listing must stay on the requested node.');
assert(revisions.items.length > 0, 'Landing page history must return at least one revision.');
assert(Number.isInteger(revisions.current_revision_id), 'Revision listing must expose the current revision.');

const firstRevision = revisions.items[0];
const revision = await client.get(
  `/api/v1/content/7167/revisions/${firstRevision.revision_id}?fields=title,meta_description,revision_log`,
);
assert(revision.content_type === 'landing_page', 'A landing page revision must keep its bundle.');
assert(Object.hasOwn(revision.fields, 'title'), 'A landing page revision must return selected fields.');

const searchTitle = await client.post('/api/v1/content/search', {
  content_type: 'landing_page',
  conditions: [
    { field: 'title', operator: 'contains', value: 'Akademia' },
  ],
  fields: ['nid', 'title'],
  limit: 10,
});
assert(
  searchTitle.items.some((item) => item.nid === 7154),
  'Title search must find nid 7154.',
);

const emptyMeta = await client.post('/api/v1/content/search', {
  content_type: 'landing_page',
  conditions: [
    { field: 'meta_description', operator: 'empty' },
  ],
  fields: ['nid', 'title', 'meta_description'],
  limit: 20,
});
assert(
  emptyMeta.items.some((item) => item.nid === 7167),
  'Empty-meta search must include nid 7167.',
);
assert(
  !emptyMeta.items.some((item) => item.nid === 6920),
  'Empty-meta search must not include nid 6920.',
);
assert(
  emptyMeta.items.every((item) => item.meta_description === null),
  'Every empty-meta landing page hit must have meta_description null.',
);

const training = await client.get('/api/v1/content/52?fields=title');
assert(training.content_type === 'npxtraining', 'Training reads must still work.');

console.log(JSON.stringify({
  content_types: machineNames,
  landing_6920: {
    nid: withSeo.nid,
    title: withSeo.fields.title,
    meta_description: withSeo.fields.meta_description,
    url_alias: withSeo.fields.url_alias,
    revision_id: withSeo.revision_id,
  },
  landing_7167: {
    nid: missingMeta.nid,
    title: missingMeta.fields.title,
    meta_description: missingMeta.fields.meta_description,
    url_alias: missingMeta.fields.url_alias,
    revisions: revisions.count,
  },
  empty_meta_search: {
    count: emptyMeta.count,
    nids: emptyMeta.items.map((item) => item.nid),
  },
}, null, 2));

import { DrupalClient } from '../src/drupal-client.mjs';

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

const types = await client.get('/api/v1/content/types');
assert(
  types.some((item) => item.machine_name === 'npxtraining'),
  'Allowlist must expose npxtraining.',
);

const schema = await client.get('/api/v1/content/types/npxtraining/schema');
const schemaFields = schema.fields.map((field) => field.machine_name);
for (const field of LOGICAL_FIELDS) {
  assert(schemaFields.includes(field), `Schema is missing ${field}.`);
}
assert(!schemaFields.includes('field_metatags'), 'Schema must hide field_metatags.');
assert(!schemaFields.includes('path'), 'Schema must hide path.');

const withDescription = await client.get(
  '/api/v1/content/52?fields=title,meta_title,meta_description,canonical,url_alias,revision_id,revision_log,revision_author,revision_timestamp',
);
assert(withDescription.nid === 52, 'Expected training nid 52.');
assert(withDescription.content_type === 'npxtraining', 'nid 52 must be a training.');
assert(
  typeof withDescription.fields.meta_description === 'string'
    && withDescription.fields.meta_description.length > 0,
  'nid 52 must return a stored meta description.',
);
assert(
  typeof withDescription.fields.url_alias === 'string'
    && withDescription.fields.url_alias.startsWith('/'),
  'nid 52 must return a URL alias.',
);
assert(
  withDescription.fields.revision_author === null
    || (
      Number.isInteger(withDescription.fields.revision_author?.uid)
      && typeof withDescription.fields.revision_author?.name === 'string'
    ),
  'revision_author must be null or {uid,name}.',
);

const missingDescription = await client.get(
  '/api/v1/content/2800?fields=title,meta_description,url_alias',
);
assert(missingDescription.nid === 2800, 'Expected training nid 2800.');
assert(
  missingDescription.fields.meta_description === null,
  'nid 2800 must have a null meta description.',
);

const missingMeta = await client.post('/api/v1/content/search', {
  content_type: 'npxtraining',
  conditions: [
    { field: 'meta_description', operator: 'empty' },
  ],
  fields: ['nid', 'title', 'revision_id', 'meta_description'],
  limit: 100,
});

assert(Array.isArray(missingMeta.items), 'Search must return items.');
assert(missingMeta.items.length > 0, 'Search must find trainings without meta description.');
assert(
  missingMeta.items.every((item) => item.meta_description === null),
  'Every empty-meta search hit must have meta_description null.',
);
assert(
  missingMeta.items.some((item) => item.nid === 2800),
  'Empty-meta search must include nid 2800.',
);
assert(
  !missingMeta.items.some((item) => item.nid === 52),
  'Empty-meta search must not include nid 52.',
);

console.log(JSON.stringify({
  content_types: types.map((item) => item.machine_name),
  logical_fields: LOGICAL_FIELDS,
  training_52: {
    nid: withDescription.nid,
    title: withDescription.fields.title,
    meta_description: withDescription.fields.meta_description,
    canonical: withDescription.fields.canonical,
    url_alias: withDescription.fields.url_alias,
    revision_id: withDescription.revision_id,
    revision_log: withDescription.fields.revision_log,
    revision_author: withDescription.fields.revision_author,
  },
  training_2800: {
    nid: missingDescription.nid,
    title: missingDescription.fields.title,
    meta_description: missingDescription.fields.meta_description,
    url_alias: missingDescription.fields.url_alias,
  },
  empty_meta_search: {
    count: missingMeta.count,
    has_more: missingMeta.has_more,
    nids: missingMeta.items.map((item) => item.nid),
  },
}, null, 2));

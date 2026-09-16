import { DrupalApiError, DrupalClient } from '../src/drupal-client.mjs';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error('Missing required environment variable: ' + name);
  return value;
}

function numericList(name, expectedLength) {
  const values = required(name).split(',').map((value) => Number.parseInt(value.trim(), 10));
  if (values.length !== expectedLength || values.some((value) => !Number.isInteger(value) || value <= 0)) {
    throw new Error(name + ' must contain ' + expectedLength + ' positive comma-separated NIDs.');
  }
  return values;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectApiError(operation, status, code) {
  try {
    await operation();
  }
  catch (error) {
    assert(
      error instanceof DrupalApiError && error.status === status && error.code === code,
      'Expected HTTP ' + status + ' ' + code + ', got ' + error?.status + ' ' + error?.code + ': ' + error?.message,
    );
    return;
  }
  throw new Error('Expected HTTP ' + status + ' ' + code + ', but the request succeeded.');
}

if (process.env.TEST_WRITE_CONFIRM !== 'true') {
  throw new Error('Set TEST_WRITE_CONFIRM=true to run the destructive test against disposable content copies.');
}

const baseUrl = required('DRUPAL_BASE_URL');
const reader = new DrupalClient({
  baseUrl,
  username: required('DRUPAL_USERNAME'),
  password: required('DRUPAL_PASSWORD'),
});
const writerUsername = required('DRUPAL_WRITE_USERNAME');
const writerPassword = required('DRUPAL_WRITE_PASSWORD');
const writer = new DrupalClient({
  baseUrl,
  username: writerUsername,
  password: writerPassword,
});
const contentNids = numericList('TEST_WRITE_CONTENT_NIDS', 3);
const bulkNids = numericList('TEST_WRITE_BULK_NIDS', 2);
const expectedTypes = ['npxtraining', 'landing_page', 'npxquiz'];
const runId = Date.now().toString(36);

async function getContent(nid) {
  return reader.get('/api/v1/content/' + nid + '?fields=title,meta_title,meta_description');
}

async function singleRoundTrip(nid, expectedType) {
  const before = await getContent(nid);
  assert(before.content_type === expectedType, 'NID ' + nid + ' must be ' + expectedType + '.');
  const marker = '[MCP WRITE TEST ' + runId + '] ' + expectedType;
  const preview = await writer.post('/api/v1/content/' + nid + '/preview', {
    nid,
    expected_revision_id: before.revision_id,
    updates: { meta_title: marker },
  });
  assert(preview.content_type === expectedType, 'Preview type mismatch for NID ' + nid + '.');
  assert((await getContent(nid)).revision_id === before.revision_id, 'Preview created a revision.');

  const committed = await writer.post('/api/v1/content/commit', {
    preview_token: preview.preview_token,
    confirmed: true,
  });
  assert(committed.revision_id !== before.revision_id, 'NID ' + nid + ' did not get a new revision.');
  assert(committed.fields.meta_title === marker, 'NID ' + nid + ' did not store the marker.');
  await expectApiError(
    () => writer.post('/api/v1/content/commit', {
      preview_token: preview.preview_token,
      confirmed: true,
    }),
    409,
    'write_conflict',
  );

  const audit = await reader.get('/api/v1/content/' + nid + '/write-audit?limit=1');
  assert(audit.items[0]?.audit_id === committed.audit_id, 'Audit mismatch for NID ' + nid + '.');
  assert(audit.items[0]?.changed_fields?.includes('meta_title'), 'Audit field missing for NID ' + nid + '.');

}
const staleBefore = await getContent(contentNids[0]);
const stalePreview = await writer.post('/api/v1/content/' + staleBefore.nid + '/preview', {
  nid: staleBefore.nid,
  expected_revision_id: staleBefore.revision_id,
  updates: { meta_title: '[MCP STALE TEST ' + runId + ']' },
});


for (let index = 0; index < contentNids.length; index++) {
  await singleRoundTrip(contentNids[index], expectedTypes[index]);
}

await expectApiError(
  () => writer.post('/api/v1/content/commit', {
    preview_token: stalePreview.preview_token,
    confirmed: true,
  }),
  409,
  'write_conflict',
);


await expectApiError(
  async () => writer.post('/api/v1/content/bulk/preview', {
    items: (await Promise.all([contentNids[0], contentNids[1]].map(getContent))).map((item) => ({
      nid: item.nid,
      expected_revision_id: item.revision_id,
      updates: { meta_title: '[MCP MIXED TEST ' + runId + ']' },
    })),
  }),
  400,
  'invalid_request',
);

const bulkBefore = await Promise.all(bulkNids.map(getContent));
assert(
  bulkBefore.every((item) => item.content_type === bulkBefore[0].content_type),
  'TEST_WRITE_BULK_NIDS must use one content type.',
);
const bulkPreview = await writer.post('/api/v1/content/bulk/preview', {
  items: bulkBefore.map((item, index) => ({
    nid: bulkNids[index],
    expected_revision_id: item.revision_id,
    updates: { meta_description: '[MCP BULK TEST ' + runId + '] ' + (index + 1) },
  })),
});
assert(bulkPreview.item_count === 2, 'Bulk preview must contain two items.');
const bulkCommit = await writer.post('/api/v1/content/bulk/commit', {
  preview_token: bulkPreview.preview_token,
  confirmed: true,
});
assert(bulkCommit.item_count === 2, 'Bulk commit must contain two items.');
await expectApiError(
  () => writer.post('/api/v1/content/bulk/commit', {
    preview_token: bulkPreview.preview_token,
    confirmed: true,
  }),
  409,
  'write_conflict',
);

const rateBefore = await getContent(bulkNids[0]);
const ratePreview = await writer.post('/api/v1/content/' + rateBefore.nid + '/preview', {
  nid: rateBefore.nid,
  expected_revision_id: rateBefore.revision_id,
  updates: { meta_description: '[MCP RATE TEST ' + runId + ']' },
});
await expectApiError(
  () => writer.post('/api/v1/content/commit', {
    preview_token: ratePreview.preview_token,
    confirmed: true,
  }),
  429,
  'rate_limited',
);


const training = await getContent(contentNids[0]);
await expectApiError(
  () => writer.post('/api/v1/content/' + training.nid + '/preview', {
    nid: training.nid,
    expected_revision_id: training.revision_id,
    updates: { price: '999' },
  }),
  400,
  'invalid_request',
);

const authorization = 'Basic ' + Buffer.from(writerUsername + ':' + writerPassword).toString('base64');
const trainingTitle = Array.isArray(training.fields.title)
  ? training.fields.title[0]?.value
  : training.fields.title;
const jsonApiResponse = await fetch(
  baseUrl + '/jsonapi/node/npxtraining/' + training.uuid,
  {
    method: 'PATCH',
    headers: {
      Authorization: authorization,
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
    },
    body: JSON.stringify({
      data: {
        type: 'node--npxtraining',
        id: training.uuid,
        attributes: { title: trainingTitle },
      },
    }),
    signal: AbortSignal.timeout(30000),
  },
);
assert(jsonApiResponse.status === 403, 'Writer JSON:API PATCH must return 403, got ' + jsonApiResponse.status + '.');

console.log(JSON.stringify({
  single_types: expectedTypes,
  bulk_items: bulkNids.length,
  token_replay_blocked: true,
  stale_revision_blocked: true,
  mixed_type_bulk_blocked: true,
  write_rate_limit_blocked: true,
  disallowed_field_blocked: true,
  jsonapi_patch_blocked: true,
  disposable_values_changed: true,
}, null, 2));

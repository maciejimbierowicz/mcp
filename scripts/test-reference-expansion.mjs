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

async function expectStatus(path, status, fragment) {
  try {
    await client.get(path);
  }
  catch (error) {
    assert(
      error instanceof DrupalApiError
        && error.status === status
        && error.message.includes(fragment),
      `Expected HTTP ${status} mentioning "${fragment}" for ${path}.`,
    );
    return;
  }
  throw new Error(`Expected ${path} to fail.`);
}

const current = await client.get(
  '/api/v1/content/6920?fields=title,field_top_tytul,field_faq&expand=field_top_tytul,field_faq',
);
const currentTop = current.fields.field_top_tytul.items[0];
assert(currentTop.entity_type === 'paragraph', 'Top title must expand to a Paragraph.');
assert(
  currentTop.revision_id === currentTop.target_revision_id,
  'Entity Reference Revisions must load the exact target revision.',
);
assert(
  current.fields.field_faq.items.every(
    (item) => item.bundle === 'faq_question_answer' && item.fields.field_question,
  ),
  'FAQ Paragraphs must expose their accessible question fields.',
);

const history = await client.get('/api/v1/content/6920/revisions?limit=10');
let historical = null;
for (const item of [...history.items].reverse()) {
  const revision = await client.get(
    `/api/v1/content/6920/revisions/${item.revision_id}?fields=field_top_tytul&expand=field_top_tytul`,
  );
  const top = revision.fields.field_top_tytul.items[0];
  if (top && top.target_revision_id !== currentTop.target_revision_id) {
    historical = { node_revision_id: revision.revision_id, top };
    break;
  }
}
assert(historical !== null, 'Fixture must contain an older Top title Paragraph revision.');
assert(
  historical.top.revision_id === historical.top.target_revision_id,
  'An old node revision must load its historical Paragraph revision.',
);

const tiles = await client.get(
  '/api/v1/content/6920?fields=field_tiles_paragraphs&expand=field_tiles_paragraphs,field_tiles_paragraphs.field_training_reference',
);
assert(tiles.fields.field_tiles_paragraphs.items.length > 0, 'Tiles must expand.');
assert(
  tiles.fields.field_tiles_paragraphs.items.some(
    (item) => item.fields?.field_training_reference?.items,
  ),
  'A matching tile bundle must support a second explicit expansion level.',
);

await expectStatus(
  '/api/v1/content/6920?fields=title&expand=title',
  400,
  'is not an entity reference',
);
await expectStatus(
  '/api/v1/content/6920?fields=title&expand=field_top_tytul',
  400,
  'must also be included in fields',
);

console.log(JSON.stringify({
  current_node_revision_id: current.revision_id,
  current_paragraph_revision_id: currentTop.revision_id,
  historical_node_revision_id: historical.node_revision_id,
  historical_paragraph_revision_id: historical.top.revision_id,
  faq_count: current.fields.field_faq.items.length,
  tile_count: tiles.fields.field_tiles_paragraphs.items.length,
}, null, 2));

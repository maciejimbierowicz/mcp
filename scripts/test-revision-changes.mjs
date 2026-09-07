import { DrupalClient } from '../src/drupal-client.mjs';

const NID = Number(process.env.TEST_REVISIONS_NID ?? 7941);
const FIELD = process.env.TEST_REVISIONS_FIELD ?? 'field_npxtraining_price';

const EXPECTED = {
  reference: { desc: 36841, asc: 36634 },
  boundaries: ['36727 <- 36657', '36655 <- 36654', '36654 <- 36651'],
};

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

async function collect(order, limit) {
  const changes = [];
  let cursor = 0;
  let pages = 0;
  let reference = null;

  for (;;) {
    const query = new URLSearchParams({
      order,
      limit: String(limit),
      fields: FIELD,
      changes_only: '1',
    });
    if (cursor) {
      query.set('after_revision_id', String(cursor));
    }

    const page = await client.get(`/api/v1/content/${NID}/revisions?${query}`);
    pages += 1;
    reference ??= page.reference;

    assert(page.changes_only === true, 'changes_only must be echoed back.');
    assert(page.reference !== null, 'A change listing must expose its reference state.');
    assert(Number.isInteger(page.inaccessible), 'A change listing must report inaccessible.');

    for (const item of page.items) {
      assert(
        Number.isInteger(item.compared_to_revision_id),
        'Every change must name the revision holding the previous value.',
      );
      assert(
        Object.hasOwn(item.fields, FIELD),
        'Every change must carry the compared field.',
      );
      changes.push([item.revision_id, item.compared_to_revision_id, JSON.stringify(item.fields)]);
    }

    if (!page.has_more) {
      break;
    }
    assert(pages < 200, 'Paging must terminate.');
    cursor = page.next_after_revision_id;
  }

  return { reference, changes, pages };
}

async function expectRejection(query, fragment) {
  try {
    await client.get(`/api/v1/content/${NID}/revisions?${query}`);
  }
  catch (error) {
    assert(
      error.status === 400 && error.message.includes(fragment),
      `Expected a 400 mentioning "${fragment}", got ${error.status} ${error.message}.`,
    );
    return;
  }
  throw new Error(`Expected the request to be rejected: ${query}`);
}

const descWide = await collect('desc', 100);
const descNarrow = await collect('desc', 1);
const ascWide = await collect('asc', 100);

const boundaries = ({ changes }) => new Set(changes.map(([vid, cmp]) => `${vid}:${cmp}`));

assert(
  JSON.stringify(descWide.changes) === JSON.stringify(descNarrow.changes),
  'Paging one change at a time must return exactly the same changes as one wide call.',
);
assert(
  descNarrow.changes.length === new Set(descNarrow.changes.map(String)).size,
  'Paging must not repeat a change.',
);
assert(
  JSON.stringify([...boundaries(ascWide)].sort())
    === JSON.stringify([...boundaries(descWide)].sort()),
  'Both orders must report the same change boundaries.',
);
assert(
  descWide.reference.revision_id >= Math.max(...descWide.changes.map(([vid]) => vid), 0),
  'The newest-first reference cannot be older than a reported change.',
);
assert(
  ascWide.reference.revision_id <= Math.min(...ascWide.changes.map(([vid]) => vid), Infinity),
  'The oldest-first reference cannot be newer than a reported change.',
);

const isDefaultFixture = NID === 7941 && FIELD === 'field_npxtraining_price';
if (isDefaultFixture) {
  assert(
    descWide.reference.revision_id === EXPECTED.reference.desc
      && ascWide.reference.revision_id === EXPECTED.reference.asc,
    'The reference must be the newest revision read in each order.',
  );
  assert(
    JSON.stringify(descWide.changes.map(([vid, cmp]) => `${vid} <- ${cmp}`))
      === JSON.stringify(EXPECTED.boundaries),
    'The price changes of nid 7941 must be attributed to the revisions that introduced them.',
  );
}

await expectRejection(
  new URLSearchParams({ changes_only: '1' }).toString(),
  'at least one field',
);
await expectRejection(
  new URLSearchParams({
    fields: Array.from({ length: 21 }, (_, index) => `field_${index}`).join(','),
  }).toString(),
  'at most 20 fields',
);
await expectRejection(
  new URLSearchParams({ fields: 'url_alias' }).toString(),
  'not available for this resource',
);

console.log(JSON.stringify({
  nid: NID,
  field: FIELD,
  changes: descWide.changes.length,
  pages: { desc_wide: descWide.pages, desc_narrow: descNarrow.pages, asc_wide: ascWide.pages },
  reference: {
    desc: descWide.reference.revision_id,
    asc: ascWide.reference.revision_id,
  },
  boundaries: descWide.changes.map(([vid, cmp]) => `${vid} <- ${cmp}`),
}, null, 2));

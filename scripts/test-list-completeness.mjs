import { DrupalClient } from '../src/drupal-client.mjs';

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

function assertPageShape(page, { afterNid = 0 } = {}) {
  assert(Array.isArray(page.items), 'Search must return items.');
  assert(page.count === page.items.length, 'count must match items.length.');
  assert(page.count <= page.limit, 'A page cannot exceed its limit.');
  assert(typeof page.has_more === 'boolean', 'has_more is required.');
  assert(typeof page.scan_limit_reached === 'boolean', 'scan_limit_reached is required.');
  assert(Number.isInteger(page.inaccessible) && page.inaccessible >= 0, 'inaccessible is required.');
  if (page.has_more) {
    assert(
      Number.isInteger(page.next_after_nid) && page.next_after_nid > afterNid,
      `has_more requires a next_after_nid cursor after ${afterNid}.`,
    );
  }
  else {
    assert(page.next_after_nid === null, 'A complete page must not return a cursor.');
    assert(
      page.scan_limit_reached === false,
      'A complete page cannot have stopped at the scan cap.',
    );
  }
  if (page.scan_limit_reached) {
    assert(page.has_more === true, 'Hitting the 5000-candidate cap requires another page.');
  }
}

async function collectSearch(contentType, { conditions = [], fields = ['nid'], limit }) {
  const pages = [];
  const nids = [];
  let afterNid = 0;

  for (let step = 0; step < 40; step++) {
    const page = await client.post('/api/v1/content/search', {
      content_type: contentType,
      conditions,
      fields,
      limit,
      after_nid: afterNid,
    });
    assertPageShape(page, { afterNid });
    pages.push(page);

    for (const item of page.items) {
      assert(Number.isInteger(item.nid), 'Every hit must include nid.');
      assert(!nids.includes(item.nid), `Search repeated nid ${item.nid}.`);
      if (nids.length > 0) {
        assert(item.nid > nids.at(-1), 'Search pages must stay in nid order.');
      }
      nids.push(item.nid);
    }

    if (page.has_more && page.items.length === page.limit && !page.scan_limit_reached) {
      assert(
        page.next_after_nid === page.items.at(-1).nid,
        'A full page continues from its last returned nid.',
      );
    }

    if (!page.has_more) {
      return { pages, nids };
    }
    afterNid = page.next_after_nid;
  }

  throw new Error(`Search of ${contentType} did not finish within 40 pages.`);
}

const types = await client.get('/api/v1/content/types');
assert(types.length === 3, 'The allowlist list is complete and has three types.');

const landings = await collectSearch('landing_page', { limit: 2 });
assert(landings.nids.length === 8, `Expected 8 landing pages, got ${landings.nids.length}.`);
assert(landings.pages.length === 4, 'Eight landings at limit 2 must take four pages.');
assert(
  landings.pages.slice(0, 3).every((page) => page.count === 2 && page.has_more === true),
  'The first three landing pages must be full and incomplete.',
);
const lastLandingPage = landings.pages.at(-1);
assert(lastLandingPage.count === 2, 'The last landing page is also full.');
assert(lastLandingPage.has_more === false, 'A full last page must still report the scan ended.');
assert(lastLandingPage.scan_limit_reached === false, 'Eight landings cannot hit the 5000 cap.');

const wideLandings = await client.post('/api/v1/content/search', {
  content_type: 'landing_page',
  conditions: [],
  fields: ['nid'],
  limit: 100,
});
assertPageShape(wideLandings);
assert(wideLandings.has_more === false, 'All eight landings fit in one wide page.');
assert(
  wideLandings.items.map((item) => item.nid).join(',') === landings.nids.join(','),
  'Paged landing nids must match a single wide search.',
);

const trainings = await collectSearch('npxtraining', { limit: 50 });
assert(trainings.pages[0].count === 50, 'Trainings at limit 50 must fill the first page.');
assert(trainings.pages[0].has_more === true, 'A full training page is not the whole list.');
assert(trainings.pages.length === 2, '64 trainings at limit 50 must take two pages.');
assert(trainings.pages[1].count === 14, 'The second training page holds the remainder.');
assert(trainings.pages[1].has_more === false, 'The remainder page must end the scan.');
assert(trainings.nids.length === 64, `Expected 64 trainings, got ${trainings.nids.length}.`);

const quizzes = await collectSearch('npxquiz', { limit: 20 });
assert(quizzes.pages[0].count === 20 && quizzes.pages[0].has_more === true, 'Quizzes overflow limit 20.');
assert(quizzes.nids.length > 100, 'Paging must continue past the first 100 quizzes.');
assert(quizzes.pages.at(-1).has_more === false, 'Quiz paging must finish.');
assert(
  quizzes.pages.every((page) => page.scan_limit_reached === false),
  'Local quiz counts stay under the 5000-candidate cap.',
);

const oneQuiz = await client.post('/api/v1/content/search', {
  content_type: 'npxquiz',
  conditions: [{ field: 'nid', operator: 'equals', value: 1138 }],
  fields: ['nid', 'title'],
  limit: 1,
});
assertPageShape(oneQuiz);
assert(oneQuiz.count === 1 && oneQuiz.items[0].nid === 1138, 'Unique nid search must find nid 1138.');
assert(oneQuiz.has_more === false, 'A unique match at limit 1 is complete, not a full-page cliff.');

const pastEnd = await client.post('/api/v1/content/search', {
  content_type: 'landing_page',
  conditions: [],
  fields: ['nid'],
  limit: 2,
  after_nid: landings.nids.at(-1),
});
assertPageShape(pastEnd, { afterNid: landings.nids.at(-1) });
assert(pastEnd.count === 0 && pastEnd.has_more === false, 'Paging past the last nid must be empty and complete.');

const revisions = await client.get('/api/v1/content/4/revisions?limit=2');
assert(revisions.has_more === true, 'Training 4 has more than two revisions.');
assert(
  Number.isInteger(revisions.next_after_revision_id),
  'An incomplete revision page must say how to continue.',
);
const nextRevisions = await client.get(
  `/api/v1/content/4/revisions?limit=2&after_revision_id=${revisions.next_after_revision_id}`,
);
assert(
  nextRevisions.items.every((item) => item.revision_id !== revisions.items[0].revision_id),
  'Revision continuation must not repeat the previous page.',
);

console.log(JSON.stringify({
  landings: {
    pages: landings.pages.length,
    count: landings.nids.length,
    last_page_full: lastLandingPage.count === lastLandingPage.limit,
    last_page_complete: lastLandingPage.has_more === false,
  },
  trainings: {
    pages: trainings.pages.length,
    count: trainings.nids.length,
    first_page_partial: trainings.pages[0].has_more,
  },
  quizzes: {
    pages: quizzes.pages.length,
    count: quizzes.nids.length,
  },
  unique_quiz_complete: oneQuiz.has_more === false,
  revision_has_more: revisions.has_more,
}, null, 2));

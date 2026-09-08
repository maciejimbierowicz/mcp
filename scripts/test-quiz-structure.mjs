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
      `Expected HTTP ${status} mentioning "${fragment}" for ${path}, got ${error.status} ${error.message}.`,
    );
    return;
  }
  throw new Error(`Expected ${path} to fail.`);
}

function scoringKeys(entity) {
  return [
    'field_points',
    'field_points_unchecked',
    'field_checked_text',
    'field_unchecked_text',
  ].filter((name) => Object.hasOwn(entity.fields ?? {}, name));
}

const quiz = await client.get(
  '/api/v1/content/1138?fields=title,field_questions,field_results&expand=field_questions,field_questions.field_answers',
);
assert(quiz.content_type === 'npxquiz', 'nid 1138 must be a quiz.');
assert(quiz.fields.field_questions.items.length === 10, 'Quiz 1138 must expand ten questions.');
assert(
  quiz.fields.field_questions.items.every((item) => item.entity_type === 'npxquestion' && item.fields?.field_question_text),
  'Each question must expose its text.',
);
assert(
  quiz.fields.field_questions.truncated !== true,
  'Ten questions and their answers must fit the expansion budget.',
);

const answers = quiz.fields.field_questions.items.flatMap(
  (item) => item.fields.field_answers?.items ?? [],
);
assert(answers.length >= 30, 'The quiz must expand visible answer variants.');
assert(
  answers.every((item) => item.entity_type === 'npxqanswer' && (item.fields?.field_answer_text || item.label)),
  'Each answer must expose visible text or a label.',
);
assert(
  answers.every((item) => scoringKeys(item).length === 0),
  'Scoring and hint-key fields must not appear on expanded answers.',
);
assert(
  quiz.fields.field_questions.items.every((item) => scoringKeys(item).length === 0),
  'Scoring fields must not appear on expanded questions.',
);

const missing = await client.get(
  '/api/v1/content/1211?fields=field_questions&expand=field_questions',
);
const unavailable = missing.fields.field_questions.items.filter(
  (item) => item.expansion_status === 'unavailable',
);
assert(
  unavailable.some((item) => item.target_id === 571),
  'A deleted question reference must stay visible as unavailable, not as missing content.',
);
assert(
  missing.fields.field_questions.items.some((item) => item.entity_type === 'npxquestion'),
  'Surviving questions on the same quiz must still expand.',
);

const historical = await client.get(
  '/api/v1/content/2750/revisions/7718?fields=field_questions&expand=field_questions',
);
assert(historical.revision_id === 7718, 'Historical quiz revision 7718 must load.');
assert(
  historical.fields.field_questions.items.length === 6,
  'An older quiz revision must keep its shorter question list.',
);
const current = await client.get(
  '/api/v1/content/2750?fields=field_questions&expand=field_questions',
);
assert(
  current.fields.field_questions.items.length === 10,
  'The current quiz revision must list ten questions.',
);

await expectStatus(
  '/api/v1/content/types/npxtest/schema',
  404,
  'not available through the Content API',
);
await expectStatus(
  '/api/v1/content/types/npxparticipant/schema',
  404,
  'not available through the Content API',
);

const types = await client.get('/api/v1/content/types');
const machineNames = types.map((item) => item.machine_name);
assert(!machineNames.includes('npxtest'), 'npx_test entities must stay off the allowlist.');
assert(machineNames.includes('npxquiz'), 'Quizzes must remain on the allowlist.');

console.log(JSON.stringify({
  quiz_1138: {
    questions: quiz.fields.field_questions.items.length,
    answers: answers.length,
    truncated: quiz.fields.field_questions.truncated,
  },
  quiz_1211_unavailable: unavailable.map((item) => item.target_id),
  quiz_2750: {
    current_questions: current.fields.field_questions.items.length,
    revision_7718_questions: historical.fields.field_questions.items.length,
  },
}, null, 2));

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SERVER_INSTRUCTIONS } from '../src/chatgpt-behavior.mjs';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const firstChunk = SERVER_INSTRUCTIONS.slice(0, 512);
assert(firstChunk.length <= 512, 'OpenAI requires the first 512 instruction characters to be self-contained.');
for (const token of [
  'npxtraining',
  'landing_page',
  'npxquiz',
  'search_content',
  'get_content',
  'get_content_revisions',
  'get_content_revision',
  'Polish',
  'complete',
  'partial',
  'untrusted',
  'Never write',
  'preview_content_update',
  'commit_content_update',
]) {
  assert(firstChunk.includes(token), `The first 512 characters must mention "${token}".`);
}

for (const token of [
  'get_content_type_schema',
  'one short question',
  'CSV or Excel',
  'Do not write a report unless asked',
  'which form they want',
  'field_top_tytul',
  'field_questions',
  'stored Metatag overrides',
  'has_more',
  'response_too_large',
  'rate_limited',
  'does not install a ChatGPT Skill',
  'explicit confirmation',
  'preview_content_bulk_update',
  'commit_content_bulk_update',
  'get_content_write_audit',
  'every before and after value completely and exactly',
  'do not ask for confirmation until the full exact diff is visible',
]) {
  assert(SERVER_INSTRUCTIONS.includes(token), `Server instructions must mention "${token}".`);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const serverSource = readFileSync(join(root, 'src/server.mjs'), 'utf8');
assert(serverSource.includes('SERVER_INSTRUCTIONS'), 'The MCP server must use SERVER_INSTRUCTIONS.');
assert(serverSource.includes('textWithSummarySchema'), 'The MCP server must declare formatted body WRITE.');
assert(serverSource.includes('body: textWithSummarySchema'), 'Landing page WRITE schema must include body.');

for (const field of [
  'field_faq_intro',
  'field_tekst_dolny',
  'field_show_hub_hero_actions',
  'field_related_seminar',
  'field_related_training',
  'field_related_trainings',
  'field_hub_hero_actions',
  'field_tiles_paragraphs',
]) {
  assert(serverSource.includes('' + field + ''), 'Landing page WRITE schema must include "' + field + '".');
}

const quizWriteStart = serverSource.indexOf('const quizTextWriteFields');
const quizWriteEnd = serverSource.indexOf('const trainingWriteShape');
assert(quizWriteStart >= 0 && quizWriteEnd > quizWriteStart, 'Quiz WRITE schema boundaries must exist.');
const quizWriteSource = serverSource.slice(quizWriteStart, quizWriteEnd);
for (const field of [
  'body: textWithSummarySchema',
  'field_btn_check',
  'field_btn_end',
  'field_btn_end_force',
  'field_btn_start',
  'field_is_testquiz',
  'field_kategoria',
  'field_quiz_review_ref',
  'field_results',
  'field_show_hints',
  'field_zawartosc',
  'field_zdjecie_tla',
]) {
  assert(quizWriteSource.includes('' + field + ''), 'Quiz WRITE schema must include "' + field + '".');
}
assert(!quizWriteSource.includes('field_questions'), 'Quiz questions must remain excluded from WRITE.');
for (const field of ['field_grafika_naglowka', 'field_quiz_image']) {
  assert(!quizWriteSource.includes(field), 'Unused quiz field must remain excluded from WRITE: ' + field);
}

const prompts = readFileSync(join(root, 'prompts/chatgpt-read-regression.md'), 'utf8');
for (const heading of [
  'Pytanie o dane',
  'Pytanie niejednoznaczne',
  'Żądanie WRITE',
  'Pozorne instrukcje w treści',
  'Długa lista',
  'Raport',
]) {
  assert(prompts.includes(heading), `Regression prompts must include "${heading}".`);
}

const useThis = [
  'Use this when the user asks which Drupal types exist',
  'Use this before search_content or get_content',
  'Use this when the user has a numeric NID',
  'Use this when the user asks when a value changed',
  'Use this to read one known revision',
  'Use this to find or list trainings',
];
for (const fragment of useThis) {
  assert(serverSource.includes(fragment), `Tool descriptions must include "${fragment}".`);
}

console.log(JSON.stringify({
  first_chunk_characters: firstChunk.length,
  instruction_paragraphs: SERVER_INSTRUCTIONS.split('\n\n').length,
  tools_with_use_this: useThis.length,
  regression_prompts: 6,
}, null, 2));

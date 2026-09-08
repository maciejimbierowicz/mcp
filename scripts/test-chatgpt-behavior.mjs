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
  'does not install a ChatGPT Skill',
]) {
  assert(SERVER_INSTRUCTIONS.includes(token), `Server instructions must mention "${token}".`);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const serverSource = readFileSync(join(root, 'src/server.mjs'), 'utf8');
assert(serverSource.includes('SERVER_INSTRUCTIONS'), 'The MCP server must use SERVER_INSTRUCTIONS.');

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

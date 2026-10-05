import assert from 'node:assert/strict';
import * as z from 'zod/v4';
import { readFileSync } from 'node:fs';
import { registerTermTools } from '../src/term-tools.mjs';

// Fixture produced by the real Drupal service on the local production copy.
const fixturePath = process.env.TERM_READ_FIXTURE;
assert.ok(fixturePath, 'Set TERM_READ_FIXTURE to the local Drupal READ result.');
const sample = JSON.parse(readFileSync(fixturePath, 'utf8'));
let tool;
let path;
let calls = 0;
let malformed = false;
registerTermTools({ registerTool(name, options, handler) {
  assert.equal(name, 'get_term_availability');
  tool = { options, handler };
} }, { async get(url) {
  path = url;
  calls++;
  return malformed ? { ...sample, registered_people: '13' } : sample;
} }, () => ({ isError: true, content: [{ type: 'text', text: 'Rejected' }] }), async (fn) => fn());

assert.equal(tool.options.annotations.readOnlyHint, true);
assert.equal(tool.options.annotations.destructiveHint, false);
const result = await tool.handler({ date_id: 8566 });
assert.equal(path, '/api/v1/training-dates/8566/availability');
assert.deepEqual(result.structuredContent, sample);
assert.deepEqual(z.object(tool.options.outputSchema).parse(sample), sample);
assert.equal(sample.registered_people > sample.capacity, true);
assert.equal(sample.remaining_places, 0);
assert.equal(sample.ui.helper_remaining_places, 1);
await tool.handler({ date_id: 8566, training_id: 48 });
assert.equal(path, '/api/v1/training-dates/8566/availability?training_id=48');
const before = calls;
assert.equal((await tool.handler({ date_id: -1 })).isError, true);
assert.equal((await tool.handler({ date_id: 8566, training_id: '48' })).isError, true);
assert.equal(calls, before);
malformed = true;
assert.equal((await tool.handler({ date_id: 8566 })).isError, true);
console.log(JSON.stringify({ tool: 'get_term_availability', read_only: true, real_drupal_fixture: true, transport_and_validation: 'passed' }));

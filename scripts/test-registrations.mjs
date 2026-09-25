import assert from 'node:assert/strict';
import * as z from 'zod/v4';
import { registerRegistrationTools } from '../src/registration-tools.mjs';

let tool;
const server = {
  registerTool(name, options, handler) {
    assert.equal(name, 'search_registrations');
    tool = { options, handler };
  },
};
const sample = {
  items: [{
    registration_key: '42:0', submission_id: 42, participant_id: 7,
    first_name: 'Jan', last_name: 'Testowy', email: 'fixture@example.invalid',
    position: null, company: 'Firma', training_id: 2, training_name: 'Szkolenie',
    date_id: 3, date_start: '2026-09-25', date_starts: ['2026-09-25'], date_end: null,
    submission_trainer: null, date_trainers: [], participant_count_declared: 2,
    participant_count_linked: 2,
    pricing: {
      currency: 'PLN', base_unit_net: 500, submission_total_net: 1000,
      submission_total_discounted_net: 900,
    },
  }],
  has_more: false,
  next_after: null,
  pricing_note: 'Submission total; count once per submission.',
};
let posted;
registerRegistrationTools(server, {
  async post(path, input) {
    posted = { path, input };
    return sample;
  },
}, (error) => { throw error; }, async (fn) => fn());
assert.equal(tool.options.annotations.readOnlyHint, true);
assert.equal(z.object(tool.options.inputSchema).parse({}).limit, 50);
const input = { email: 'fixture@example.invalid', limit: 1, after: '41:0' };
const result = await tool.handler(input);
assert.deepEqual(posted, { path: '/api/v1/registrations/search', input });
assert.deepEqual(z.object(tool.options.outputSchema).parse(result.structuredContent), sample);
assert.equal(result.isError, undefined);
console.log(JSON.stringify({ tool: 'search_registrations', read_only: true, transport: 'ok' }));

import assert from 'node:assert/strict';
import { registerRegistrationTools } from '../src/registration-tools.mjs';
let handler, reads = 0, posts = 0, fail = false;
const certificate = {submission_id:42,read_only:true,execution_available:false,scope:'whole_submission',checkbox_enabled:false,training:null,date:null,trainer:null,certificate_title:'',signature_available:false,data_complete:false,issues:['no_participants'],warnings:[],participants:[]};
registerRegistrationTools({registerTool(name, options, fn) {
  assert.equal(name, 'search_registrations');
  assert.equal(options.annotations.readOnlyHint, true);
  handler = fn;
}}, {
  async get(path) { reads++; assert.equal(path, '/api/v1/registrations/42/certificates/preview'); if (fail) throw Error('Unavailable'); return certificate; },
  async post(path, input) { posts++; assert.equal(path, '/api/v1/registrations/search'); assert.equal(input.submission_id, 42); assert.equal(input.include_certificates, undefined); return {items:[],has_more:false,next_after:null,pricing_note:''}; },
}, error => ({isError:true}), fn => fn());
assert.deepEqual((await handler({submission_id:42, include_certificates:true})).structuredContent.certificates, certificate);
assert.equal((await handler({submission_id:42})).structuredContent.certificates, undefined);
assert.equal((await handler({submission_id:42,include_certificates:false})).structuredContent.certificates, undefined);
assert.equal(reads, 1);
for (const input of [{include_certificates:true},{submission_id:0},{submission_id:1.5},{submission_id:42,include_certificates:'yes'},{submission_id:42,include_certificates:true,training_id:7},{submission_id:42,unknown:true}]) {
  assert.equal((await handler(input)).isError, true);
}
assert.equal(reads, 1);
assert.equal(posts, 3);
fail = true;
assert.equal((await handler({submission_id:42,include_certificates:true})).isError, true);
assert.equal(posts, 3); // No partial success when preview fails.
fail = false;
certificate.read_only = false;
assert.equal((await handler({submission_id:42,include_certificates:true})).isError, true);
assert.equal(posts, 3); // Invalid backend response is rejected.
console.log('PASS: optional preview, existing tool, validation, filters, backend failure and response validation');

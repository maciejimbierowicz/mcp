import assert from 'node:assert/strict';
import * as z from 'zod/v4';
import {previewUpdate, commitUpdate} from '../src/certificate-write.mjs';
const token = 'a'.repeat(64);
const calls = [];
let output;
const client = {async post(path, body) {calls.push({path,body}); return output;}};
const updates = z.object({title:z.string()});
output = {operation:'generate_certificates',submission_id:42,changes:[],details:{},side_effects:[],action:'generate',preview_token:token,expires_at:'2026-11-14',requires_confirmation:true};
assert.equal((await previewUpdate(client,{operation:'generate_certificates',submission_id:42},updates)).submission_id,42);
assert.equal(calls.at(-1).path,'/api/v1/registrations/certificates/preview');
for (const bad of [{operation:'generate_certificates',submission_id:42,nid:42},{operation:'generate_certificates'},{submission_id:42},{nid:42,updates:{title:'Test'}}]) {
  await assert.rejects(()=>previewUpdate(client,bad,updates));
}
assert.equal(calls.length,1);
output = {nid:42};
assert.deepEqual(await previewUpdate(client,{nid:42,expected_revision_id:5,updates:{title:'Test'}},updates),output);
assert.equal(calls.at(-1).path,'/api/v1/content/42/preview');
output = {operation:'generate_certificates',submission_id:42,status:'generated',operation_id:'b'.repeat(64),replayed:false,files:[{participant_id:7,file_id:8,sha256:'c'.repeat(64),valid_pdf:true}]};
assert.equal((await commitUpdate(client,{operation:'generate_certificates',preview_token:token,confirmed:true})).files.length,1);
assert.equal(calls.at(-1).path,'/api/v1/registrations/certificates/commit');
await assert.rejects(()=>commitUpdate(client,{operation:'generate_certificates',preview_token:token,confirmed:false}));
output = {nid:42,revision_id:9};
assert.deepEqual(await commitUpdate(client,{preview_token:token,confirmed:true}),output);
assert.equal(calls.at(-1).path,'/api/v1/content/commit');
output = {status:'generated',files:[]};
await assert.rejects(()=>commitUpdate(client,{operation:'generate_certificates',preview_token:token,confirmed:true}));
console.log('PASS: existing content paths preserved; certificate routing, mixed-ID rejection, confirmation and output validation');

import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as z from 'zod/v4';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {certificateResult, previewUpdate, commitUpdate} from '../src/certificate-write.mjs';
const source=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
const server=new McpServer({name:'certificate-test',version:'1'});
const token='a'.repeat(64);
const backend={async post(path,body){
 if(path.endsWith('/preview')) return {operation:'generate_certificates',submission_id:42,changes:[{field:'field_npxsubmission_gen_certs',before:false,after:true}],details:{},side_effects:[],action:'generate',preview_token:token,expires_at:'2026-11-14',requires_confirmation:true};
 return {operation:'generate_certificates',submission_id:42,status:'generated',operation_id:'b'.repeat(64),replayed:false,files:[{participant_id:7,file_id:8,sha256:'c'.repeat(64),valid_pdf:true}]};
}};
for(const name of ['preview_content_update','commit_content_update']){
 const start=source.lastIndexOf('    server.registerTool(',source.indexOf(`      '${name}',`));
 const end=source.indexOf('\n    );',start)+7;
 const block=source.slice(start,end);
 new Function('server','z','drupalWriteClient','contentUpdatesSchema','writableContentTypeSchema','certificateResult','previewUpdate','commitUpdate','toolError','controlledWriteError','audit',block)(server,z,backend,z.object({title:z.string()}),z.enum(['npxtraining']),certificateResult,previewUpdate,commitUpdate,e=>{throw e},e=>{throw e},null);
}
const [a,b]=InMemoryTransport.createLinkedPair();
const client=new Client({name:'test-client',version:'1'});
await Promise.all([server.connect(a),client.connect(b)]);
try {
 const tools=await client.listTools(); assert.equal(tools.tools.length,2);
 assert(tools.tools.every(tool=>tool.outputSchema.type==='object'));
 const preview=await client.callTool({name:'preview_content_update',arguments:{operation:'generate_certificates',submission_id:42}});
 assert.equal(preview.isError,undefined);assert.equal(preview.structuredContent.submission_id,42);
 const commit=await client.callTool({name:'commit_content_update',arguments:{operation:'generate_certificates',preview_token:token,confirmed:true}});
 assert.equal(commit.isError,undefined);assert.equal(commit.structuredContent.result.status,'generated');
 console.log('PASS: real MCP SDK listTools/callTool validates existing tool registrations and certificate outputs');
} finally {await client.close();await server.close();}

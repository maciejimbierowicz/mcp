import assert from 'node:assert/strict';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {registerCreateTools} from '../src/create-tools.mjs';
const server=new McpServer({name:'date-test',version:'1'});
let requests=0;
const date={content_type:'npxtraining_date',fields:{training_id:42,title:'Termin testowy',field_npxtraining_date_start:['2090-01-01'],field_npxtraining_date_end:['2090-01-02'],field_npxtraining_date_form:['online'],field_npxtraining_date_trainer:{target_id:7},field_npxtraining_date_cal_title:'Test'}};
const result={operation:'training_date_create_preview',content_type:'npxtraining_date',nid:null,current_revision_id:null,content:{status:false},changes:[],references:{},training:{id:42,label:'Test',revision_id:9},related_changes:[],duplicate_check:'passed',execution_available:true,requires_confirmation:true,preview_token:'b'.repeat(64),expires_at:'2090-01-01'};
const wol={operation:'single_content_create',content_type:'wall_of_love',nid:null,current_revision_id:null,content:{content_type:'wall_of_love',title:'Test',status:false,langcode:'pl',uid:1,promote:false,sticky:false,field_wol_content:[],field_metatags:[],alias:'/test'},changes:[],requires_confirmation:true,preview_token:'a'.repeat(64),expires_at:'2090-01-01'};
registerCreateTools(server,{async post(path,input){requests++;if (path === '/api/v1/content/create/commit') return {operation:'single_content_create',content_type:'npxtraining_date',nid:100,revision_id:101,audit_id:1,training_id:42,training_revision_id:102,training_audit_id:2,status:false,url:'https://example.invalid/node/100',content:result.content,related_changes:[]}; assert.equal(path,'/api/v1/content/create/preview');return input.content_type==='npxtraining_date'?result:wol;}},e=>({isError:true,content:[{type:'text',text:e.message}]}),e=>({isError:true,content:[{type:'text',text:e.message}]}));
const [a,b]=InMemoryTransport.createLinkedPair();const client=new Client({name:'test',version:'1'});
await Promise.all([server.connect(a),client.connect(b)]);
try{
 assert.equal((await client.listTools()).tools.length,2);
 assert.deepEqual((await client.callTool({name:'preview_content_create',arguments:date})).structuredContent,result);
 assert.equal((await client.callTool({name:'preview_content_create',arguments:{content_type:'wall_of_love',fields:{title:'Test'}}})).structuredContent.preview_token,'a'.repeat(64));
 assert.equal((await client.callTool({name:'preview_content_create',arguments:{...date,fields:{...date.fields,status:'yes'}}})).isError,true);
 assert.equal((await client.callTool({name:'preview_content_create',arguments:{...date,fields:{...date.fields,unknown:'value'}}})).isError,true);
 assert.equal((await client.callTool({name:'preview_content_create',arguments:{content_type:'wall_of_love',fields:date.fields}})).isError,true);
 assert.equal(requests,2);
 const committed=await client.callTool({name:'commit_content_create',arguments:{preview_token:'b'.repeat(64),confirmed:true}});
 assert.equal(committed.structuredContent.result.training_audit_id,2);
 assert.equal(committed.structuredContent.status,'committed');
 assert.equal((await client.callTool({name:'commit_content_create',arguments:{preview_token:'b'.repeat(64),confirmed:false}})).isError,true);
 assert.equal(requests,3);
 console.log('PASS: real SDK list/call, date preview, no added tools, Wall of Love regression and invalid/mixed input rejected');
}finally{await client.close();await server.close();}

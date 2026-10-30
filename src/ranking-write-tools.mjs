import * as z from 'zod/v4';
import { DrupalApiError } from './drupal-client.mjs';
const id=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const token=z.string().regex(/^[a-f0-9]{64}$/);
const changes=z.array(z.object({field:z.string(),before:z.unknown(),after:z.unknown()}));
const base='/api/v1/ranking';
const contentType=z.enum(['company_profile','npx_training']);
const paragraphShape={
  bundle:z.string(),fields:z.array(z.string()),preserved_fields:z.array(z.string()),
  field_types:z.record(z.string(),z.object({label:z.string(),type:z.string(),cardinality:z.number().int(),required:z.boolean(),allowed_formats:z.array(z.string())})),
};
const paragraphDescriptor=z.object({...paragraphShape,children:z.record(z.string(),z.object({...paragraphShape,children:z.record(z.string(),z.unknown())}))});
export function registerRankingWriteTools(server,client,onError,run){
  function tool(name,description,inputSchema,outputSchema,readOnly,request){
    server.registerTool(name,{title:name,description,inputSchema,outputSchema,
      annotations:{readOnlyHint:readOnly,destructiveHint:!readOnly,idempotentHint:readOnly,openWorldHint:false}},
      async(input)=>run(async()=>{
        let args;
        try{args=z.object(inputSchema).strict().parse(input);}
        catch{return onError(new DrupalApiError('Invalid Ranking WRITE arguments.',400,'invalid_request'));}
        try{
          const result=await request(args);
          if(!z.object(outputSchema).safeParse(result).success)throw new DrupalApiError('Invalid Ranking WRITE response.',502,'invalid_response');
          return{structuredContent:result,content:[{type:'text',text:JSON.stringify(result)}]};
        }catch(error){return onError(error);}
      }));
  }
  tool('ranking_get_content_write_schema',
    'Discover Ranking WRITE fields for content_type: company_profile (default) or npx_training. Company supports three Paragraph types; training supports 45 fields: 36 simple fields and nine Paragraph fields (heading/subtitle, learning outcomes, audience text, description, requirements, nested program, trainers, benefits and booking rules). Read paragraph field_types/children/preserved_fields. Node title is internal; visible heading/subtitle are field_section_01/title_subtile. Trainers reference existing trener nodes; benefits reference existing szkolenia_benefity taxonomy terms. Both program representations are writable regardless of owner role. Only existing nodes; no publish, author or uploads. Read rules about restricted VAT/price saves and actual selection-handler choices.',
    {content_type:contentType.default('company_profile')},{content_type:contentType,fields:z.array(z.object({name:z.string(),label:z.string(),type:z.string(),reference_target_type:z.string().nullable(),reference_options:z.array(z.object({target_id:id,label:z.string()})),reference_options_truncated:z.boolean(),cardinality:z.number().int(),required:z.boolean(),allowed_values:z.unknown(),reference_target_bundles:z.array(z.string()),paragraph:paragraphDescriptor.nullable()})),preview_ttl_seconds:z.number().int(),rules:z.array(z.string())},true,
    ({content_type})=>client.get(`${base}/content/types/${content_type}/write-schema`));
  tool('ranking_preview_content_update',
    'Preview an existing Ranking company_profile or npx_training update without saving content. Read current content/revision and WRITE schema first. Native scalar values, text string or {value,summary?}, link {uri,title?}, address components, references {target_id}. Training supports all simple fields and nine non-image Paragraph fields; use WRITE schema for exact names, bundles and cardinality. field_section_05 uses one Paragraph object, field_section_07 and nested field_element use lists. field_video and field_media_icon are preserved and cannot be written. New audience blocks may have text without icons. field_section_11/image is not writable. At most two levels, 50 items per list and 250 items total. No cascade into company VAT/prices or automatic Paragraph cleanup; set intended net/gross/hourly values explicitly. For all supported Paragraphs, preserve every existing item at every level; list order controls display order; edit with exact IDs/bundle/fields or add allowed bundle/fields. Display ALL returned BEFORE/AFTER values exactly and completely, including every Paragraph field, and ask for explicit confirmation. Do not call commit until that confirmation. Preview revision IDs identify the current basis, not predicted saved revisions; read the tree after commit for new IDs. Preview expires in 10 minutes; no bulk updates.',
    {id,expected_revision_id:id,updates:z.record(z.string(),z.unknown()).refine(v=>Object.keys(v).length>0&&Object.keys(v).length<=45,'Select allowed fields from this content type’s WRITE schema (at most 45).')},
    {nid:id,content_type:contentType,current_revision_id:id,preview_token:token,expires_at:z.string(),changes},false,
    ({id,...body})=>client.post(`${base}/content/${id}/preview`,body));
  tool('ranking_commit_content_update',
    'Save one Ranking company/training preview ONLY after the full exact BEFORE/AFTER was displayed and the user explicitly confirmed this preview. Pass its token and confirmed=true. Creates a revision and audit; token is one-time and user-bound. On conflict, read again and create/show a new preview; never silently retry. Rate-limit/batch/validation errors save nothing. Never use 4GROW WRITE tools for Ranking.',
    {preview_token:token,confirmed:z.literal(true)},
    {nid:id,revision_id:id,audit_id:id,changed_fields:z.array(z.string())},false,
    body=>client.post(`${base}/content/commit`,body));
  tool('ranking_get_content_write_audit',
    'Read exact before/after audit of Ranking company/training MCP writes. Requires WRITE account and current node/field permissions. Continue after_audit_id from next_after_audit_id while has_more. Returns metadata/changes, never tokens. Use after a successful commit.',
    {id,limit:z.number().int().min(1).max(100).default(50),after_audit_id:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0)},
    {nid:id,items:z.array(z.object({audit_id:id,technical_uid:id,nid:id,old_revision_id:id,new_revision_id:id,timestamp:z.number().int(),changes})),has_more:z.boolean(),next_after_audit_id:id.nullable()},true,
    ({id,limit,after_audit_id})=>client.get(`${base}/content/${id}/write-audit?limit=${limit}&after_audit_id=${after_audit_id}`));
}

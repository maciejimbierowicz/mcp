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
const writeFields=z.array(z.object({name:z.string(),label:z.string(),type:z.string(),reference_target_type:z.string().nullable(),reference_options:z.array(z.object({target_id:id,label:z.string()})),reference_options_truncated:z.boolean(),cardinality:z.number().int(),required:z.boolean(),allowed_values:z.unknown(),reference_target_bundles:z.array(z.string()),paragraph:paragraphDescriptor.nullable()}));
const productType=z.enum(['default','closed','to_order']);
const relatedChanges=z.array(z.object({entity_type:z.literal('node'),id,changes}));
const relatedRevisions=z.array(z.object({nid:id,revision_id:id}));
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
    {content_type:contentType.default('company_profile')},{content_type:contentType,fields:writeFields,preview_ttl_seconds:z.number().int(),rules:z.array(z.string())},true,
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
  tool('ranking_get_product_write_schema',
    'Discover 18 writable training date product fields for default/closed/to_order, including all-day schedule, city, status, limits, durations, room, criteria, trainers and benefits. No product revisions or price/SKU/stock/variation/publish/link edits. Read complete rules. Dates use YYYY-MM-DD ranges, not hours. Existing target IDs only. Uses the same Ranking WRITE credentials, with separate Drupal date permission.',
    {content_type:productType.default('default')},
    {content_type:productType,revisionable:z.literal(false),fields:writeFields,preview_ttl_seconds:z.number().int(),rules:z.array(z.string())},true,
    ({content_type})=>client.get(`${base}/products/types/${content_type}/write-schema`));
  tool('ranking_preview_product_update',
    'Preview ONE existing Commerce training date. First use ranking_get_content resource=products, then pass its write_version as expected_version. Discover ranking_get_product_write_schema. Dates are npx_event_date:[{value:"YYYY-MM-DD",end_value:"YYYY-MM-DD"}], entire ordered nonoverlapping schedule; [] clears dates. No time-of-day values. Scalar integers/text/list status, existing references, trainer/benefit Paragraphs follow schema. field_benefits_prices is a JSON list string of {entity_id,value} for existing benefit terms; never replace it with free text. Preserve all current Paragraphs. Preview includes generated title and related_changes for linked training future-dates flag; display EVERY exact BEFORE/AFTER in both arrays and wait for explicit confirmation. No entity saves at preview, no prices/SKU/stock or hourly-price recalculation. Products use fingerprints, not revision IDs. Token expires in 10 minutes.',
    {id,expected_version:token,updates:z.record(z.string(),z.unknown()).refine(v=>Object.keys(v).length>0&&Object.keys(v).length<=18,'Use 1-18 fields from product WRITE schema.')},
    {product_id:id,content_type:productType,training_id:id,current_version:token,preview_token:token,expires_at:z.string(),changes,related_changes:relatedChanges},false,
    ({id,...body})=>client.post(`${base}/products/${id}/preview`,body));
  tool('ranking_commit_product_update',
    'Commit one training date preview ONLY after displaying all exact product changes AND related training changes and receiving explicit user confirmation. Pass only this product token and confirmed=true. No product revisions; response contains version, audit ID and any new linked training revision. Locks/fingerprints detect changes to product, Paragraphs, linked training, siblings and variants. On conflict read again and request a new preview/confirmation. Never silently retry or substitute node WRITE tokens. Verify product READ and product audit after commit.',
    {preview_token:token,confirmed:z.literal(true)},
    {product_id:id,training_id:id,version:token,audit_id:id,changed_fields:z.array(z.string()),related_revisions:relatedRevisions},false,
    body=>client.post(`${base}/products/commit`,body));
  tool('ranking_get_product_write_audit',
    'Read exact confirmed training date audit, including related training flag changes, linked revisions and before/after fingerprints. Products have no revisions; use audit for history. Requires current date WRITE access and field access. Paginate while has_more; never confuse product IDs or product audit IDs with node IDs/audit IDs.',
    {id,limit:z.number().int().min(1).max(100).default(50),after_audit_id:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0)},
    {product_id:id,items:z.array(z.object({audit_id:id,technical_uid:id,product_id:id,training_id:id,timestamp:z.number().int(),before_version:token,after_version:token,changes,related_changes:relatedChanges,related_revisions:relatedRevisions})),has_more:z.boolean(),next_after_audit_id:id.nullable()},true,
    ({id,limit,after_audit_id})=>client.get(`${base}/products/${id}/write-audit?limit=${limit}&after_audit_id=${after_audit_id}`));

}

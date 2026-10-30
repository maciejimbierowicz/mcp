import * as z from 'zod/v4';
import { DrupalApiError } from './drupal-client.mjs';

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const cursor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const resource = z.enum(['content', 'products', 'product-variations']).default('content')
  .describe('Ranking content = training/company nodes; products = training dates; product-variations = Commerce variants.');
const field = z.string().regex(/^[a-z0-9_]+$/).max(128);
const fields = z.array(field).min(1).max(50);
const expand = z.array(z.string().regex(/^[a-z0-9_]+(?:\.[a-z0-9_]+)?$/)).max(10);
const fieldMap = z.record(z.string(), z.unknown());
const integer = z.number().int();
const typeMetadata = {
  machine_name: z.string(), label: z.string(), entity_type: z.string(),
  id_field: z.string(), revisionable: z.boolean(), revisions_enabled: z.boolean(), translatable: z.boolean(),
};
const schemaField = z.object({
  machine_name: z.string(), label: z.string(), type: z.string(), required: z.boolean(),
  cardinality: integer, default_value: z.unknown(), allowed_values: z.unknown(),
  reference_target_type: z.string().nullable(), reference_target_bundles: z.array(z.string()),
  translatable: z.boolean(), computed: z.boolean(), read_only: z.boolean(), base_field: z.boolean(),
});
const content = {
  id, entity_type: z.string(), uuid: z.string(), content_type: z.string(),
  revision_id: id.nullable(), language: z.string(), fields: fieldMap,
  nid: id.optional(), product_id: id.optional(), variation_id: id.optional(),
  active_program_field: z.string().optional(),
  write_version: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
};
const revisionMetadata = {
  revision_id: id, current: z.boolean(), timestamp: integer.nullable(),
  author: integer.nullable(), log: z.string().nullable(),
};
const revisionItem = z.object({
  ...revisionMetadata, fields: fieldMap.optional(), compared_to_revision_id: id.optional(),
});
const scalar = z.union([z.string().max(500), z.number().finite(), z.boolean()]);
const selector = z.string().regex(/^[a-z0-9_]+(?:\.[a-z0-9_]+)?$/).max(256);
const condition = z.union([
  z.object({ field: selector, operator: z.enum(['empty', 'not_empty']) }).strict(),
  z.object({ field: selector, operator: z.literal('in'), value: z.array(scalar).min(1).max(50) }).strict(),
  z.object({ field: selector, operator: z.enum(['equals', 'not_equals', 'contains', 'before', 'after', 'gte', 'lte']), value: scalar }).strict(),
]);
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const base = '/api/v1/ranking';
function query(path, values) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) params.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  return params.size ? `${path}?${params}` : path;
}

export function registerRankingTools(server, client, onError, runRead) {
  function register(name, description, inputSchema, outputSchema, read) {
    server.registerTool(name, { title: name, description, inputSchema, outputSchema, annotations },
      async (input) => runRead(async () => {
        let args;
        try { args = z.object(inputSchema).strict().parse(input); }
        catch { return onError(new DrupalApiError('Invalid Ranking tool arguments.', 400, 'invalid_request')); }
        try {
          const result = await read(args);
          if (!z.object(outputSchema).safeParse(result).success) {
            throw new DrupalApiError('Ranking API returned an invalid response.', 502, 'invalid_response');
          }
          return { structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] };
        }
        catch (error) { return onError(error); }
      }));
  }
  register('ranking_list_content_types',
    'List allowed Ranking Szkoleń bundles and revision flags. Start here to discover real types. Separate source from all 4GROW tools.',
    { resource }, { content_types: z.array(z.object(typeMetadata)) },
    async ({ resource }) => ({ content_types: await client.get(`${base}/${resource}/types`) }));
  register('ranking_get_content_type_schema',
    'Read all physical Ranking field definitions for an exact bundle from discovery. read_only describes storage, not permission to write. No logical aliases from 4GROW.',
    { resource, content_type: field }, { ...typeMetadata, fields: z.array(schemaField) },
    ({ resource, content_type }) => client.get(`${base}/${resource}/types/${content_type}/schema`));
  register('ranking_get_content',
    'Read a Ranking training/company, date product or variant by resource and ID. Omit fields for all accessible fields. Expand reference paths explicitly, at most two levels; inspect truncated/fields_truncated/expansion_status for gaps. Products link to training via npx_training. Product write_version is the opaque stored-state fingerprint needed for date WRITE preview; a null value means the current graph is not writable. Never use 4GROW field names or tools for Ranking.',
    { resource, id, fields: fields.optional(), expand: expand.optional() }, content,
    ({ resource, id, fields, expand }) => client.get(query(`${base}/${resource}/${id}`, { fields, expand })));
  register('ranking_search_content',
    'Search Ranking only. All conditions are AND; selectors are physical field or field.property from schema. Dates use npx_event_date.value/end_value; variants contain price.number/currency_code. Results are complete only when has_more=false. Keep filters/fields unchanged and follow next_after_id even after an empty partial page. Multivalue conditions may match different items. No expansion in search.',
    { resource, content_type: field, fields, conditions: z.array(condition).max(10).default([]), limit: integer.min(1).max(100).default(50), after_id: cursor.default(0) },
    { items: z.array(fieldMap), count: integer.nonnegative(), limit: integer.positive(), has_more: z.boolean(), next_after_id: cursor.nullable(), scan_limit_reached: z.boolean(), time_limit_reached: z.boolean(), examined: integer.nonnegative(), inaccessible: integer.nonnegative() },
    ({ resource, ...body }) => client.post(`${base}/${resource}/search`, body));
  register('ranking_get_content_revisions',
    'List accessible Ranking node revisions (training/company only). Omit fields for metadata. changes_only requires 1–20 content fields: first state is reference, then newer differing revisions with compared_to_revision_id. Comparisons use raw reference IDs, not expanded text; nonrevisionable fields expose current data. Follow next_after_revision_id while has_more, including empty partial pages. Dates/variants have no revisions.',
    { id, limit: integer.min(1).max(100).default(50), after_revision_id: cursor.default(0), order: z.enum(['asc', 'desc']).default('desc'), fields: z.array(field).min(1).max(20).optional(), changes_only: z.boolean().default(false) },
    { nid: id, current_revision_id: id, items: z.array(revisionItem), count: integer.nonnegative(), limit: integer.positive(), order: z.enum(['asc', 'desc']), changes_only: z.boolean(), examined: integer.nonnegative(), inaccessible: integer.nonnegative(), scan_limit_reached: z.boolean(), has_more: z.boolean(), next_after_revision_id: cursor.nullable(), reference: z.object({ ...revisionMetadata, fields: fieldMap }).nullable().optional() },
    ({ id, fields, changes_only, ...params }) => {
      if (changes_only && !fields) throw new DrupalApiError('changes_only requires fields.', 400, 'invalid_request');
      return client.get(query(`${base}/content/${id}/revisions`, { ...params, fields, changes_only: changes_only ? '1' : '0' }));
    });
  register('ranking_get_content_revision',
    'Read one exact Ranking node revision belonging to this node. Omit fields for all accessible fields, use explicit bounded expand for Paragraphs. Historical revision references never fall back to latest. Nonrevisionable fields and unrevisioned references represent current data. Training/company only.',
    { id, revision_id: id, fields: fields.optional(), expand: expand.optional() },
    { ...content, revision_id: id, current_revision: z.boolean(), revision_author: integer.nullable(), revision_timestamp: integer.nullable(), revision_log: z.string().nullable() },
    ({ id, revision_id, fields, expand }) => client.get(query(`${base}/content/${id}/revisions/${revision_id}`, { fields, expand })));
}

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as z from 'zod/v4';

import { randomUUID } from 'node:crypto';

import { requireBearerToken } from './auth.mjs';
import { config } from './config.mjs';
import { SERVER_INSTRUCTIONS } from './chatgpt-behavior.mjs';
import { DrupalApiError, DrupalClient } from './drupal-client.mjs';
import {
  createSemaphore,
  createTokenBucket,
  logMcpEvent,
  mcpToolName,
} from './limits.mjs';

const drupalClient = new DrupalClient({
  baseUrl: config.drupalBaseUrl,
  username: config.drupalUsername,
  password: config.drupalPassword,
  timeoutMs: config.drupalTimeoutMs,
  maxResponseBytes: config.maxResponseBytes,
});
const drupalWriteClient = config.writeEnabled
  ? new DrupalClient({
    baseUrl: config.drupalBaseUrl,
    username: config.drupalWriteUsername,
    password: config.drupalWritePassword,
    timeoutMs: config.drupalTimeoutMs,
    maxResponseBytes: config.maxResponseBytes,
  })
  : null;

const mcpRateLimiter = createTokenBucket({
  capacity: config.rateBurst,
  refillPerMs: config.rateLimitPerMin / 60000,
});
const authFailureLimiter = createTokenBucket({
  capacity: config.rateBurst,
  refillPerMs: config.rateLimitPerMin / 60000,
});
const heavyConcurrency = createSemaphore(config.heavyConcurrency);

const fieldMap = z.record(z.string(), z.any());

const contentOutputSchema = {
  nid: z.number().int(),
  uuid: z.string(),
  content_type: z.string(),
  revision_id: z.number().int(),
  language: z.string(),
  fields: fieldMap,
};

const schemaFieldOutput = z.object({
  machine_name: z.string(),
  label: z.string(),
  type: z.string(),
  required: z.boolean(),
  cardinality: z.number().int(),
  default_value: z.any(),
  allowed_values: z.any(),
  reference_target_type: z.union([z.string(), z.null()]),
  reference_target_bundles: z.array(z.string()),
  translatable: z.boolean(),
  computed: z.boolean(),
  read_only: z.boolean(),
});

const trainingTextWriteFields = [
  'field_blog_after_text',
  'field_blog_section_title',
  'field_blog_tekst_nad_artykulami',
  'field_extra_tekst_g3',
  'field_extra_tekst_oni_juz_byli',
  'field_extra_tekst_za_co_nas_',
  'field_field_tytul_sekcji_g3',
  'field_link_sekcji_',
  'field_link_sekcji_argumenty',
  'field_link_sekcji_dla_kogo',
  'field_link_sekcji_efekty',
  'field_link_sekcji_faq',
  'field_link_sekcji_kontakt',
  'field_link_sekcji_metodyka',
  'field_link_sekcji_nasza_jakosc_t',
  'field_link_sekcji_oni_juz_byli_n',
  'field_link_sekcji_program_szkole',
  'field_link_sekcji_szkolenia_onli',
  'field_link_sekcji_wideo',
  'field_link_sekcji_wideo_opinie',
  'field_link_sekcji_wyznaczamy_now',
  'field_link_sekcji_zapisz_sie',
  'field_link_sekcji_za_co_nas_uwie',
  'field_methodology__section_title',
  'field_nasza_jakosc_twoj_komfort',
  'field_npxtraining_block_info',
  'field_npxtraining_cert_title',
  'field_npxtraining_cetxt',
  'field_npxtraining_dla_kogo',
  'field_npxtraining_efekty',
  'field_npxtraining_knowledge',
  'field_npxtraining_metodologia',
  'field_npxtraining_pdftxt',
  'field_npxtraining_place_txt',
  'field_npxtraining_program',
  'field_npxtraining_program_lp',
  'field_npxtraining_promotion',
  'field_npxtraining_seo',
  'field_npxtraining_tytul_formalny',
  'field_npxtraining_tytul_w_opinii',
  'field_npxtraining_you_learn',
  'field_npx_more_rel_tr_txt',
  'field_npx_sections_hide',
  'field_npx_sections_order',
  'field_obszar_tematyczny',
  'field_opis_sekcji_galeria',
  'field_opis_sekcji_galeria_dolny',
  'field_opis_sekcji_program',
  'field_podtytul',
  'field_polityka_rabatowa',
  'field_program_szkolenia_wstep',
  'field_referencje_naglowek',
  'field_szkolenia_online_opis',
  'field_term_table_title',
  'field_text_after_terms',
  'field_text_before_terms',
  'field_tytul_sekcji_faq',
  'field_tytul_sekcji_g15',
  'field_tytul_sekcji_g16',
  'field_tytul_sekcji_g19',
  'field_tytul_sekcji_g2',
  'field_tytul_sekcji_g20',
  'field_tytul_sekcji_g4',
  'field_tytul_sekcji_g6',
  'field_tytul_sekcji_g7',
  'field_tytul_sekcji_g8',
  'field_tytul_sekcji_g9',
  'field_tytul_sekcji_galeria',
  'field_tytul_sekcji_wideo_opinie',
  'field_video_text',
  'field_zajawka',
  'field_zajawka_termin',
];
const trainingBooleanWriteFields = [
  'field_npxtraining_closed',
  'field_npxtraining_laptop_info',
  'field_npxtraining_online',
  'field_npxtraining_pair_only',
  'field_npxtraining_stationary',
  'field_npxtraining_webinar',
  'field_npxt_show_top_quick_info',
  'field_online_live',
  'field_seminarium',
];
const trainingIntegerWriteFields = [
  'field_duration_days_count',
  'field_duration_total_hours',
  'field_npxtraining_liczba_dni_lp',
];
const trainingNumberWriteFields = [
  'field_npxtraining_discount_fxd',
  'field_npxtraining_discount_per',
  'field_npxtraining_price',
];
const trainingMultiTextWriteFields = [
  'field_duration_daily_schedule',
  'field_npxtraining_references',
  'field_npxtraining_reviews',
];
const entityReferenceSchema = z.object({
  target_id: z.number().int().positive(),
}).strict();
const uploadTokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
const imageMetadataShape = {
  alt: z.string().max(512),
  title: z.string().max(1024).nullable().optional(),
};
const imageReferenceSchema = z.union([
  z.object({ target_id: z.number().int().positive(), ...imageMetadataShape }).strict(),
  z.object({ upload_token: uploadTokenSchema, ...imageMetadataShape }).strict(),
]);
const fileReferenceSchema = z.union([
  z.object({
    target_id: z.number().int().positive(),
    description: z.string().max(1024).nullable().optional(),
    display: z.boolean().optional(),
  }).strict(),
  z.object({
    upload_token: uploadTokenSchema,
    description: z.string().max(1024).nullable().optional(),
    display: z.boolean().optional(),
  }).strict(),
]);
const paragraphFieldRecordSchema = z.record(
  z.string().regex(/^field_[a-z0-9_]+$/),
  z.unknown(),
).refine((value) => Object.keys(value).length <= 50, 'Paragraph fields cannot exceed 50 entries.');
const paragraphFieldsSchema = paragraphFieldRecordSchema.refine(
  (value) => Object.keys(value).length > 0,
  'Paragraph fields cannot be empty.',
);
const existingParagraphWriteItemSchema = z.object({
  target_id: z.number().int().positive(),
  target_revision_id: z.number().int().positive(),
  bundle: z.string().min(1).max(128).optional()
    .describe('Required together with fields when editing this existing Paragraph.'),
  fields: paragraphFieldsSchema.optional()
    .describe('Nested field changes for this existing Paragraph; requires bundle. Omit both bundle and fields to preserve it unchanged.'),
}).strict().refine(
  (value) => (value.bundle === undefined) === (value.fields === undefined),
  { message: 'Existing Paragraph edits require bundle and fields together.' },
);
const paragraphWriteItemSchema = z.union([
  existingParagraphWriteItemSchema,
  z.object({
    bundle: z.string().min(1).max(128),
    fields: paragraphFieldRecordSchema,
  }).strict(),
]);
const trainingSingleReferenceWriteFields = [
  'field_kategoria_followup',
  'field_npxtrainer_block_ref_',
  'field_npxtrainer_block_ref_8_cec',
  'field_npxtrainer_block_ref_rev_r',
  'field_npxtraining_category',
  'field_npxtraining_methods',
];
const trainingMultiReferenceWriteFields = [
  'field_blog_posts',
  'field_kategoria',
  'field_npxtraining_dates',
  'field_npx_more_related_training',
  'field_npx_related_training',
  'field_oni_juz_byli',
  'field_opinie_wideo_ref',
  'field_referencje_i_opinie',
  'field_tagi',
  'field_training_languages',
];
const trainingImageWriteFields = [
  'field_miniaturka',
  'field_seo_image',
  'field_npxtraining_block_img',
  'field_zaslepka',
];
const trainingSingleParagraphReferenceWriteFields = [
  'field_arguments_par',
];
const trainingMultiParagraphReferenceWriteFields = [
  'field_faq_paragrafy',
  'field_newsletter_paragrafy',
  'field_npx_logotypes',
  'field_program_szkolenia_paragraf',
  'field_szkolenia_online_paragrafy',
];
const trainingSingleParagraphRevisionWriteFields = [
  'field_blog_promo',
  'field_contact_section',
  'field_galeria',
  'field_top_tytul',
];
const trainingMultiParagraphRevisionWriteFields = [
  'field_blog_posts_par',
  'field_cechy',
  'field_faq',
  'field_npxtraining_paragraf_trene',
];
const landingTextWriteFields = [
  'field_faq_intro',
  'field_tekst_dolny',
];
const landingBooleanWriteFields = [
  'field_show_hub_hero_actions',
];
const landingSingleReferenceWriteFields = [
  'field_related_seminar',
  'field_related_training',
];
const landingMultiReferenceWriteFields = [
  'field_related_trainings',
];
const landingSingleParagraphRevisionWriteFields = [
  'field_hub_hero_actions',
];
const landingMultiParagraphRevisionWriteFields = [
  'field_tiles_paragraphs',
];
const landingWriteShape = {
  ...Object.fromEntries(landingTextWriteFields.map((field) => [field, z.string().nullable().optional()])),
  ...Object.fromEntries(landingBooleanWriteFields.map((field) => [field, z.boolean().nullable().optional()])),
  ...Object.fromEntries(landingSingleReferenceWriteFields.map((field) => [
    field,
    entityReferenceSchema.nullable().optional(),
  ])),
  ...Object.fromEntries(landingMultiReferenceWriteFields.map((field) => [
    field,
    z.array(entityReferenceSchema).nullable().optional(),
  ])),
  ...Object.fromEntries(landingSingleParagraphRevisionWriteFields.map((field) => [
    field,
    paragraphWriteItemSchema.nullable().optional(),
  ])),
  ...Object.fromEntries(landingMultiParagraphRevisionWriteFields.map((field) => [
    field,
    z.array(paragraphWriteItemSchema).max(50).nullable().optional(),
  ])),
};

const trainingWriteShape = {
  ...Object.fromEntries(trainingTextWriteFields.map((field) => [field, z.string().nullable().optional()])),
  ...Object.fromEntries(trainingBooleanWriteFields.map((field) => [field, z.boolean().nullable().optional()])),
  ...Object.fromEntries(trainingIntegerWriteFields.map((field) => [field, z.number().int().nullable().optional()])),
  ...Object.fromEntries(trainingNumberWriteFields.map((field) => [field, z.number().finite().nullable().optional()])),
  ...Object.fromEntries(trainingMultiTextWriteFields.map((field) => [
    field,
    z.array(z.string()).nullable().optional(),
  ])),
  ...Object.fromEntries(trainingSingleReferenceWriteFields.map((field) => [
    field,
    entityReferenceSchema.nullable().optional(),
  ])),
  ...Object.fromEntries(trainingMultiReferenceWriteFields.map((field) => [
    field,
    z.array(entityReferenceSchema).nullable().optional(),
  ])),
  ...Object.fromEntries(trainingImageWriteFields.map((field) => [
    field,
    imageReferenceSchema.nullable().optional(),
  ])),
  field_program_szkolenia: z.array(fileReferenceSchema).max(2).nullable().optional(),
  ...Object.fromEntries(trainingSingleParagraphReferenceWriteFields.map((field) => [
    field,
    entityReferenceSchema.nullable().optional(),
  ])),
  ...Object.fromEntries(trainingMultiParagraphReferenceWriteFields.map((field) => [
    field,
    z.array(entityReferenceSchema).nullable().optional(),
  ])),
  ...Object.fromEntries(trainingSingleParagraphRevisionWriteFields.map((field) => [
    field,
    paragraphWriteItemSchema.nullable().optional(),
  ])),
  ...Object.fromEntries(trainingMultiParagraphRevisionWriteFields.map((field) => [
    field,
    z.array(paragraphWriteItemSchema).max(50).nullable().optional(),
  ])),
  field_hide_benefits: z.array(z.enum(['1', '2', '3', '4', '5'])).nullable().optional(),
  field_npxtraining_min_guaranted: z.enum(['0', '1', '2', '3', '4', '5', '6', '7', '8']).nullable().optional(),
};
const contentUpdatesSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  meta_title: z.string().max(255).nullable().optional(),
  meta_description: z.string().max(320).nullable().optional(),
  ...trainingWriteShape,
  ...landingWriteShape,
}).strict().refine(
  (value) => Object.keys(value).length > 0,
  'At least one update is required.',
);

function toolError(summary, error, audit) {
  const parts = [summary];
  let code = 'internal';
  if (error instanceof DrupalApiError) {
    if (error.code) {
      parts.push(`code ${error.code}.`);
      code = error.code;
    }
    else if (error.status) {
      code = `http_${error.status}`;
    }
    if (Number.isInteger(error.retryAfter)) {
      parts.push(`Retry after ${error.retryAfter} seconds.`);
    }
    if (error.status) {
      parts.push(`HTTP ${error.status}.`);
    }
    parts.push(error.message);
  }
  if (audit) {
    audit.code = code;
  }

  return {
    isError: true,
    content: [{ type: 'text', text: parts.join(' ') }],
  };
}

function controlledWriteError(summary, error, audit) {
  if (!(error instanceof DrupalApiError) || error.code !== 'rate_limited') {
    return toolError(summary, error, audit);
  }

  if (audit) {
    audit.code = 'rate_limited';
  }
  const result = {
    status: 'blocked',
    result: null,
    error: {
      code: 'rate_limited',
      message: error.message,
      retry_after: Number.isInteger(error.retryAfter) ? error.retryAfter : null,
    },
  };
  return {
    structuredContent: result,
    content: [{ type: 'text', text: JSON.stringify(result) }],
  };
}

async function runHeavyTool(summary, audit, fn) {
  let release;
  try {
    release = await heavyConcurrency.acquire(config.heavyWaitMs);
  }
  catch {
    if (audit) {
      audit.code = 'busy';
    }
    return {
      isError: true,
      content: [{ type: 'text', text: `${summary} code busy. Too many concurrent Drupal reads.` }],
    };
  }
  try {
    return await fn();
  }
  finally {
    release();
  }
}

function createServer(audit = null) {
  const server = new McpServer(
    {
      name: '4grow-marketing-data',
      version: '0.1.0',
    },
    {
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  server.registerTool(
    'list_content_types',
    {
      title: 'List Drupal content types',
      description:
        'Use this when the user asks which Drupal types exist or whether trainings, landing pages or quizzes are available. Lists the complete allowlist and revision/translation flags. Do not use it to list nodes.',
      inputSchema: {},
      outputSchema: {
        content_types: z.array(
          z.object({
            machine_name: z.string(),
            label: z.string(),
            revisions_enabled: z.boolean(),
            translatable: z.boolean(),
          }),
        ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const contentTypes = await drupalClient.get('/api/v1/content/types');
        const structuredContent = { content_types: contentTypes };

        return {
          structuredContent,
          content: [
            {
              type: 'text',
              text: JSON.stringify(structuredContent),
            },
          ],
        };
      }
      catch (error) {
        return toolError('Could not read Drupal content types.', error, audit);
      }
    },
  );

  server.registerTool(
    'get_content_type_schema',
    {
      title: 'Get Drupal content type schema',
      description:
        'Use this before search_content or get_content when a field machine name is unknown. Returns the dynamic field schema for npxtraining, landing_page or npxquiz. Do not guess field names.',
      inputSchema: {
        content_type: z.string().min(1).max(64).describe('Drupal content type machine name.'),
      },
      outputSchema: {
        machine_name: z.string(),
        label: z.string(),
        revisions_enabled: z.boolean(),
        translatable: z.boolean(),
        fields: z.array(schemaFieldOutput),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ content_type: contentType }) => {
      try {
        const schema = await drupalClient.get(
          `/api/v1/content/types/${encodeURIComponent(contentType)}/schema`,
        );

        return {
          structuredContent: schema,
          content: [
            {
              type: 'text',
              text: JSON.stringify(schema),
            },
          ],
        };
      }
      catch (error) {
        return toolError('Could not read Drupal content type schema.', error, audit);
      }
    },
  );

  server.registerTool(
    'get_content',
    {
      title: 'Get Drupal content',
      description:
        'Use this when the user has a numeric NID and wants the current fields of one training, landing page or quiz. Optionally request selected field machine names. For a landing page H1 expand field_top_tytul, not title. For quiz questions expand field_questions and field_questions.field_answers. Do not use this for history or to create or edit content. Scoring fields and participant or npx_test entities are never returned.',
      inputSchema: {
        nid: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
          .describe('Numeric Drupal node ID.'),
        fields: z.array(z.string().min(1).max(128)).max(200).optional()
          .describe('Optional Drupal or logical field names to return; omit this argument for every accessible field.'),
        expand: z.array(z.string().min(1).max(128)).max(10).optional()
          .describe(
            'Explicit entity-reference field paths to expand. For a landing page H1 use field_top_tytul. '
            + 'For quiz structure use field_questions and field_questions.field_answers. '
            + 'Scoring fields and participant or npx_test entities are never returned.',
          ),
      },
      outputSchema: contentOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ nid, fields, expand }) => {
      try {
        const query = new URLSearchParams();
        if (fields !== undefined) {
          query.set('fields', fields.join(','));
        }
        if (expand !== undefined) {
          query.set('expand', expand.join(','));
        }
        const suffix = query.size > 0 ? `?${query.toString()}` : '';
        const content = await drupalClient.get(`/api/v1/content/${nid}${suffix}`);

        return {
          structuredContent: content,
          content: [
            {
              type: 'text',
              text: JSON.stringify(content),
            },
          ],
        };
      }
      catch (error) {
        return toolError('Could not read Drupal content.', error, audit);
      }
    },
  );

  if (drupalWriteClient) {
    server.registerTool(
      'create_content_upload',
      {
        title: 'Create secure content upload',
        description:
          'Creates a 10-minute browser upload link bound to one exact content revision and image/file destination. Give upload_url to the user, then use get_content_upload_status before previewing a content update with upload_token.',
        inputSchema: {
          nid: z.number().int().positive(),
          expected_revision_id: z.number().int().positive(),
          destination: z.union([
            z.object({
              scope: z.literal('content'),
              field: z.string().regex(/^field_[a-z0-9_]+$/),
            }).strict(),
            z.object({
              scope: z.literal('paragraph'),
              bundle: z.string().min(1).max(128),
              field: z.string().regex(/^field_[a-z0-9_]+$/),
            }).strict(),
          ]),
        },
        outputSchema: {
          upload_token: uploadTokenSchema,
          status: z.literal('pending'),
          destination: z.record(z.string(), z.string()),
          allowed_extensions: z.array(z.string()),
          max_bytes: z.number().int().positive(),
          expires_at: z.string(),
          upload_url: z.string().url(),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      async ({ nid, expected_revision_id: expectedRevisionId, destination }) => {
        try {
          const result = await drupalWriteClient.post(`/api/v1/content/${nid}/uploads`, {
            nid,
            expected_revision_id: expectedRevisionId,
            destination,
          });
          return { structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] };
        }
        catch (error) {
          return toolError('Could not create content upload.', error, audit);
        }
      },
    );

    server.registerTool(
      'get_content_upload_status',
      {
        title: 'Get secure content upload status',
        description:
          'Checks whether the user completed a previously created browser upload. Do not preview the content change until status is uploaded.',
        inputSchema: {
          upload_token: uploadTokenSchema,
        },
        outputSchema: {
          upload_token: uploadTokenSchema,
          status: z.enum(['pending', 'uploaded']),
          destination: z.record(z.string(), z.string()),
          file: z.object({
            target_id: z.number().int().positive(),
            filename: z.string(),
            mime_type: z.string(),
            size: z.number().int().positive(),
          }).nullable(),
        },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      async ({ upload_token: uploadToken }) => {
        try {
          const result = await drupalWriteClient.get(
            `/api/v1/content/uploads/${uploadToken}/status`,
          );
          return { structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] };
        }
        catch (error) {
          return toolError('Could not read content upload status.', error, audit);
        }
      },
    );

    server.registerTool(
      'preview_content_update',
      {
        title: 'Preview content update',
        description:
          'Creates a non-persistent preview for an allowed content update. Training and landing page content support their declared editorial fields; quizzes support title, meta_title and meta_description. Always show every returned before/after change and ask for explicit confirmation before calling commit_content_update.',
        inputSchema: {
          nid: z.number().int().positive(),
          expected_revision_id: z.number().int().positive(),
          updates: contentUpdatesSchema,
        },
        outputSchema: {
          nid: z.number().int(),
          content_type: z.enum(['npxtraining', 'landing_page', 'npxquiz']),
          current_revision_id: z.number().int(),
          changes: z.array(z.record(z.string(), z.any())),
          unchanged: z.array(z.string()),
          preview_token: z.string(),
          expires_at: z.string(),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      async (input) => {
        try {
          const result = await drupalWriteClient.post(`/api/v1/content/${input.nid}/preview`, {
            nid: input.nid,
            expected_revision_id: input.expected_revision_id,
            updates: input.updates,
          });
          return { structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] };
        }
        catch (error) {
          return toolError('Could not preview content update.', error, audit);
        }
      },
    );

    server.registerTool(
      'preview_content_bulk_update',
      {
        title: 'Preview bulk content update',
        description:
          'Creates one non-persistent preview for 1-10 updates of the same allowed content type after search_content. Training and landing page content support their declared editorial fields; quizzes support title, meta_title and meta_description. Use every current revision ID, show the complete batch and ask once for explicit confirmation before calling commit_content_bulk_update.',
        inputSchema: {
          items: z.array(z.object({
            nid: z.number().int().positive(),
            expected_revision_id: z.number().int().positive(),
            updates: contentUpdatesSchema,
          })).min(1).max(10).refine(
            (items) => new Set(items.map((item) => item.nid)).size === items.length,
            'Every nid must be unique.',
          ),
        },
        outputSchema: {
          content_type: z.enum(['npxtraining', 'landing_page', 'npxquiz']),
          item_count: z.number().int().min(1).max(10),
          items: z.array(z.object({
            nid: z.number().int(),
            content_type: z.enum(['npxtraining', 'landing_page', 'npxquiz']),
            current_revision_id: z.number().int(),
            changes: z.array(z.record(z.string(), z.any())),
            unchanged: z.array(z.string()),
          })),
          preview_token: z.string(),
          expires_at: z.string(),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      async ({ items }) => {
        try {
          const result = await drupalWriteClient.post('/api/v1/content/bulk/preview', { items });
          return { structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] };
        }
        catch (error) {
          return toolError('Could not preview bulk content update.', error, audit);
        }
      },
    );

    server.registerTool(
      'commit_content_bulk_update',
      {
        title: 'Commit confirmed bulk content update',
        description:
          'Atomically commits exactly the complete same-type batch represented by one bulk preview token. Call only after the user explicitly confirms the displayed batch. Never accept or invent update values here.',
        inputSchema: {
          preview_token: z.string().regex(/^[a-f0-9]{64}$/),
          confirmed: z.literal(true),
        },
        outputSchema: {
          status: z.enum(['committed', 'blocked']),
          result: z.object({
            item_count: z.number().int().min(1).max(10),
            items: z.array(z.object({
              nid: z.number().int(),
              revision_id: z.number().int(),
              audit_id: z.number().int(),
              updated_fields: z.array(z.string()),
              fields: z.record(z.string(), z.any()),
            })),
          }).nullable(),
          error: z.object({
            code: z.literal('rate_limited'),
            message: z.string(),
            retry_after: z.number().int().positive().nullable(),
          }).nullable(),
        },
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      },
      async ({ preview_token: previewToken, confirmed }) => {
        try {
          const result = await drupalWriteClient.post('/api/v1/content/bulk/commit', {
            preview_token: previewToken,
            confirmed,
          });
          const output = { status: 'committed', result, error: null };
          return {
            structuredContent: output,
            content: [{ type: 'text', text: JSON.stringify(output) }],
          };
        }
        catch (error) {
          return controlledWriteError('Could not commit bulk content update.', error, audit);
        }
      },
    );

    server.registerTool(
      'commit_content_update',
      {
        title: 'Commit confirmed content update',
        description:
          'Commits exactly the changes from a content preview token. Call only after the user explicitly confirms the displayed preview. Never accept or invent update values here.',
        inputSchema: {
          preview_token: z.string().regex(/^[a-f0-9]{64}$/),
          confirmed: z.literal(true),
        },
        outputSchema: {
          status: z.enum(['committed', 'blocked']),
          result: z.object({
            nid: z.number().int(),
            revision_id: z.number().int(),
            audit_id: z.number().int(),
            updated_fields: z.array(z.string()),
            fields: z.record(z.string(), z.any()),
          }).nullable(),
          error: z.object({
            code: z.literal('rate_limited'),
            message: z.string(),
            retry_after: z.number().int().positive().nullable(),
          }).nullable(),
        },
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      },
      async ({ preview_token: previewToken, confirmed }) => {
        try {
          const result = await drupalWriteClient.post('/api/v1/content/commit', {
            preview_token: previewToken,
            confirmed,
          });
          const output = { status: 'committed', result, error: null };
          return {
            structuredContent: output,
            content: [{ type: 'text', text: JSON.stringify(output) }],
          };
        }
        catch (error) {
          return controlledWriteError('Could not commit content update.', error, audit);
        }
      },
    );
  }

  server.registerTool(
    'get_content_write_audit',
    {
      title: 'Get Content API write audit',
      description:
        'Use this after a Content API write or when the user asks who changed allowed fields through MCP. Returns the immutable, paginated API audit for one accessible NID. This is separate from the complete Drupal revision history.',
      inputSchema: {
        nid: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        limit: z.number().int().min(1).max(100).default(50),
        after_audit_id: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
      },
      outputSchema: {
        nid: z.number().int(),
        items: z.array(z.object({
          audit_id: z.number().int(),
          technical_uid: z.number().int(),
          nid: z.number().int(),
          old_revision_id: z.number().int(),
          new_revision_id: z.number().int(),
          timestamp: z.number().int(),
          changed_fields: z.array(z.string()),
          changes: z.array(z.record(z.string(), z.any())),
        })),
        has_more: z.boolean(),
        next_after_audit_id: z.union([z.number().int(), z.null()]),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ nid, limit, after_audit_id: afterAuditId }) => {
      try {
        const query = new URLSearchParams({ limit: String(limit) });
        if (afterAuditId !== undefined) {
          query.set('after_audit_id', String(afterAuditId));
        }
        const path = '/api/v1/content/' + nid + '/write-audit?' + query.toString();
        const result = await drupalClient.get(path);
        return { structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] };
      }
      catch (error) {
        return toolError('Could not read Content API write audit.', error, audit);
      }
    },
  );

  server.registerTool(
    'get_content_revisions',
    {
      title: 'List Drupal content revisions',
      description:
        'Use this when the user asks when a value changed, who edited it, or wants revision history of one NID. '
        + 'Returns paginated revision history for one accessible Drupal node, newest revision first by default. '
        + 'Without "fields" it returns revision metadata only. Pass "fields" to also read what those fields '
        + 'held in each revision, and add "changes_only" to keep just the revisions where they changed — that '
        + 'is how to answer when a price, title or meta description was last edited. '
        + 'With "changes_only" every returned item is the revision that introduced the value it carries, so '
        + 'its author and timestamp are the author and date of that change, in both orders. '
        + '"compared_to_revision_id" names the revision holding the previous value, so the boundary is '
        + 'unambiguous. The separate "reference" is the state the comparisons started from: it is the newest '
        + 'revision read, not a change, because nothing older had been compared to it yet. '
        + 'One call examines a bounded number of revisions and reports "examined"; when "has_more" is true, '
        + 'continue with "after_revision_id" set to "next_after_revision_id". "scan_limit_reached" tells the '
        + 'two endings apart: true means the call stopped at its work limit and older revisions remain, false '
        + 'together with a false "has_more" means the whole history was read. A page may legitimately contain '
        + 'no changes while older ones still do, so keep paging until "has_more" is false before concluding '
        + 'that a value never changed. A non-zero "inaccessible" means some revisions could not be read, so a '
        + 'reported change may in truth have happened in one of the hidden revisions between the two named. '
        + 'A full page is not a complete history. Do not say the history is complete until "has_more" is false; '
        + 'until then the result is partial.',
      inputSchema: {
        nid: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
          .describe('Numeric Drupal node ID.'),
        limit: z.number().int().min(1).max(100).default(50),
        after_revision_id: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional()
          .describe('Cursor. Continues after this revision in the selected order.'),
        order: z.enum(['desc', 'asc']).default('desc')
          .describe('Revision order. "desc" returns the newest revisions first.'),
        fields: z.array(z.string().min(1).max(128)).min(1).max(20).optional()
          .describe(
            'Field names to read for every revision. Keep the list short, because each revision is loaded '
            + 'separately and wide selections are slow.',
          ),
        changes_only: z.boolean().default(false)
          .describe(
            'Return only the revisions that introduced a new value for the selected fields, plus the '
            + '"reference" state the comparison started from. Requires "fields".',
          ),
      },
      outputSchema: {
        nid: z.number().int(),
        current_revision_id: z.number().int(),
        items: z.array(z.record(z.string(), z.any())),
        count: z.number().int(),
        limit: z.number().int(),
        order: z.enum(['desc', 'asc']),
        changes_only: z.boolean(),
        examined: z.number().int(),
        inaccessible: z.number().int(),
        scan_limit_reached: z.boolean(),
        has_more: z.boolean(),
        next_after_revision_id: z.union([z.number().int(), z.null()]),
        reference: z.record(z.string(), z.any()).optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({
      nid,
      limit,
      after_revision_id: afterRevisionId,
      order,
      fields,
      changes_only: changesOnly,
    }) => runHeavyTool('Could not read Drupal revisions.', audit, async () => {
      try {
        const query = new URLSearchParams({ limit: String(limit), order });
        if (afterRevisionId !== undefined) {
          query.set('after_revision_id', String(afterRevisionId));
        }
        if (fields !== undefined) {
          query.set('fields', fields.join(','));
        }
        if (changesOnly) {
          query.set('changes_only', '1');
        }
        const result = await drupalClient.get(
          `/api/v1/content/${nid}/revisions?${query.toString()}`,
        );
        return {
          structuredContent: result,
          content: [{ type: 'text', text: JSON.stringify(result) }],
        };
      }
      catch (error) {
        return toolError('Could not read Drupal revisions.', error, audit);
      }
    }),
  );

  server.registerTool(
    'get_content_revision',
    {
      title: 'Get Drupal content revision',
      description:
        'Use this to read one known revision by nid and revision_id. Do not walk history with this tool; list revisions first. '
        + 'Returns one accessible Drupal revision with optional selected fields.',
      inputSchema: {
        nid: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
          .describe('Numeric Drupal node ID.'),
        revision_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
          .describe('Drupal revision ID.'),
        fields: z.array(z.string().min(1).max(128)).max(50).optional(),
        expand: z.array(z.string().min(1).max(128)).max(10).optional()
          .describe(
            'Explicit entity-reference field paths to expand. Scoring and npx_test entities are never returned.',
          ),
      },
      outputSchema: {
        nid: z.number().int(),
        uuid: z.string(),
        content_type: z.string(),
        revision_id: z.number().int(),
        current_revision: z.boolean(),
        language: z.string(),
        revision_author: z.any().nullable(),
        revision_timestamp: z.number().int(),
        revision_log: z.union([z.string(), z.null()]),
        fields: fieldMap,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ nid, revision_id: revisionId, fields, expand }) => {
      try {
        const query = new URLSearchParams();
        if (fields !== undefined) {
          query.set('fields', fields.join(','));
        }
        if (expand !== undefined) {
          query.set('expand', expand.join(','));
        }
        const suffix = query.size > 0 ? `?${query.toString()}` : '';
        const result = await drupalClient.get(
          `/api/v1/content/${nid}/revisions/${revisionId}${suffix}`,
        );
        return {
          structuredContent: result,
          content: [{ type: 'text', text: JSON.stringify(result) }],
        };
      }
      catch (error) {
        return toolError('Could not read Drupal revision.', error, audit);
      }
    },
  );


  server.registerTool(
    'search_content',
    {
      title: 'Search Drupal content',
      description:
        'Use this to find or list trainings, landing pages or quizzes with structured filters. '
        + 'Call get_content_type_schema first if the field name is unknown. If a required filter is missing, ask one short question instead of guessing. '
        + 'Never accepts SQL or raw query expressions. '
        + 'One call returns at most "limit" matches and scans at most 5000 candidate nodes. '
        + 'A full page is not a complete list: if "has_more" is true, continue with "after_nid" set to "next_after_nid". '
        + '"scan_limit_reached" tells the two endings apart: true means this call stopped at the 5000-candidate '
        + 'work limit and later nodes were not scanned, so keep paging even if this page is short or empty. '
        + 'False together with a false "has_more" means the scan really ended. '
        + 'Do not say every match was found until "has_more" is false. Until then the result is partial. '
        + 'A non-zero "inaccessible" means candidate nodes were skipped because a filtered field could not be '
        + 'read, so an absent node is not proof that it fails the filter.',
      inputSchema: {
        content_type: z.string().min(1).max(64),
        conditions: z.array(
          z.object({
            field: z.string().min(1).max(128),
            operator: z.enum([
              'equals',
              'not_equals',
              'empty',
              'not_empty',
              'contains',
              'in',
              'before',
              'after',
            ]),
            value: z.union([
              z.string().max(500),
              z.number(),
              z.boolean(),
              z.array(z.union([z.string().max(500), z.number(), z.boolean()])).min(1).max(50),
            ]).optional(),
          }),
        ).max(10).default([]),
        fields: z.array(z.string().min(1).max(128)).min(1).max(50),
        limit: z.number().int().min(1).max(100).default(50),
        after_nid: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional()
          .describe('Cursor. Continues after this nid. Use next_after_nid from the previous page.'),
      },
      outputSchema: {
        items: z.array(z.record(z.string(), z.any())),
        count: z.number().int(),
        limit: z.number().int(),
        has_more: z.boolean(),
        next_after_nid: z.union([z.number().int(), z.null()]),
        scan_limit_reached: z.boolean(),
        inaccessible: z.number().int(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (input) => runHeavyTool('Could not search Drupal content.', audit, async () => {
      try {
        const result = await drupalClient.post('/api/v1/content/search', input);
        return {
          structuredContent: result,
          content: [{ type: 'text', text: JSON.stringify(result) }],
        };
      }
      catch (error) {
        return toolError('Could not search Drupal content.', error, audit);
      }
    }),
  );

  return server;
}

const app = createMcpExpressApp({
  host: '127.0.0.1',
  allowedHosts: config.allowedHosts,
});

app.get('/health', (_request, response) => {
  response.json({ status: 'ok' });
});

app.use('/mcp', requireBearerToken(config.mcpAuthToken, {
  failureLimiter: authFailureLimiter,
  onFailure: (request, code) => logMcpEvent({
    requestId: randomUUID(),
    tool: mcpToolName(request.body),
    durationMs: 0,
    result: 'error',
    code,
  }),
}));

app.use('/mcp', (request, response, next) => {
  if (request.method !== 'POST') {
    next();
    return;
  }
  if (!mcpRateLimiter.take()) {
    const requestId = randomUUID();
    logMcpEvent({
      requestId,
      tool: mcpToolName(request.body),
      durationMs: 0,
      result: 'error',
      code: 'rate_limited',
    });
    response.status(429).json({
      jsonrpc: '2.0',
      error: { code: -32002, message: 'Rate limit exceeded.' },
      id: request.body?.id ?? null,
    });
    return;
  }
  next();
});

app.post('/mcp', async (request, response) => {
  const requestId = randomUUID();
  const tool = mcpToolName(request.body);
  const started = Date.now();
  const audit = { code: null };
  const server = createServer(audit);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  let released = false;
  const releaseTransport = () => {
    if (released) {
      return;
    }
    released = true;
    transport.close();
    server.close();
  };
  response.on('close', releaseTransport);

  try {
    await server.connect(transport);
    await transport.handleRequest(request, response, request.body);
    logMcpEvent({
      requestId,
      tool,
      durationMs: Date.now() - started,
      result: audit.code === null ? 'ok' : 'error',
      code: audit.code,
    });
  }
  catch (error) {
    logMcpEvent({
      requestId,
      tool,
      durationMs: Date.now() - started,
      result: 'error',
      code: 'internal',
    });
    if (!response.headersSent) {
      response.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal MCP server error.' },
        id: null,
      });
    }
  }
  finally {
    if (response.closed || response.destroyed) {
      releaseTransport();
    }
  }
});

app.get('/mcp', (_request, response) => {
  response.status(405).set('Allow', 'POST').json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed.' },
    id: null,
  });
});

app.delete('/mcp', (_request, response) => {
  response.status(405).set('Allow', 'POST').json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed.' },
    id: null,
  });
});

const httpServer = app.listen(config.port, '127.0.0.1', (error) => {
  if (error) {
    console.error('Could not start MCP server:', error.message);
    process.exit(1);
  }
  console.log(`4GROW Marketing Data MCP listening on http://127.0.0.1:${config.port}/mcp`);
});

function shutdown() {
  httpServer.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

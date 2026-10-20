import * as z from 'zod/v4';

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const token = z.string().regex(/^[a-f0-9]{64}$/);
const reference = z.object({ target_id: id }).strict();
const textParagraph = z.object({
  bundle: z.literal('par_text'),
  fields: z.object({ field_par_text: z.string().min(1) }).strict(),
}).strict();
const opinionParagraph = z.object({
  bundle: z.literal('wol_opinion'),
  fields: z.object({ field_opinion_reference: reference }).strict(),
}).strict();
const paragraphOutput = z.discriminatedUnion('bundle', [
  z.object({
    bundle: z.literal('par_text'),
    fields: z.object({
      field_par_text: z.object({ value: z.string(), format: z.literal('full_html') }),
    }),
  }),
  opinionParagraph,
]);
const content = z.object({
  content_type: z.literal('wall_of_love'),
  title: z.string(),
  status: z.literal(false),
  langcode: z.string(),
  uid: id,
  promote: z.literal(false),
  sticky: z.literal(false),
  field_wol_content: z.array(paragraphOutput).max(50),
  field_metatags: z.union([z.record(z.string(), z.unknown()), z.array(z.never())]),
  alias: z.string().startsWith('/'),
});
const previewInput = z.object({
  content_type: z.literal('wall_of_love'),
  fields: z.object({
    title: z.string().min(1).max(255),
    field_wol_content: z.array(z.discriminatedUnion('bundle', [
      textParagraph, opinionParagraph,
    ])).max(50).optional(),
  }).strict(),
}).strict();
const previewOutput = z.object({
  operation: z.literal('single_content_create'),
  content_type: z.literal('wall_of_love'),
  nid: z.null(),
  current_revision_id: z.null(),
  content,
  changes: z.array(z.object({ field: z.string(), before: z.null(), after: z.unknown() })),
  requires_confirmation: z.literal(true),
  preview_token: token,
  expires_at: z.string(),
});
const commitInput = z.object({ preview_token: token, confirmed: z.literal(true) }).strict();
const commitResult = z.object({
  operation: z.literal('single_content_create'),
  content_type: z.literal('wall_of_love'),
  nid: id,
  revision_id: id,
  audit_id: id,
  status: z.literal(false),
  alias: z.string().startsWith('/'),
  url: z.string().url(),
  content,
});
const commitOutput = z.object({
  status: z.enum(['committed', 'blocked']),
  result: commitResult.nullable(),
  error: z.object({
    code: z.literal('rate_limited'),
    message: z.string(),
    retry_after: z.number().int().positive().nullable(),
  }).nullable(),
});

const resultMessage = (value) => ({
  structuredContent: value,
  content: [{ type: 'text', text: JSON.stringify(value) }],
});

/** Register only when WRITE is enabled; Drupal separately requires CREATE permission. */
export function registerCreateTools(server, client, onPreviewError, onCommitError) {
  server.registerTool('preview_content_create', {
    title: 'Preview new unpublished Wall of Love',
    description: 'Use this to create a new Wall of Love without manually creating an empty node first. Only wall_of_love is supported: title and optional field_wol_content containing new par_text paragraphs (safe HTML string) and wol_opinion paragraphs referencing existing real opinion NIDs. No existing Paragraph IDs, uploads, new opinions, other fields or publication. The preview saves no content. Show the entire returned content and every before/after value, including HTML, text format, unpublished status and alias, then request explicit confirmation before commit_content_create. The 10-minute preview token is bound to the technical Drupal user. Do not use UPDATE commit for this token.',
    inputSchema: previewInput,
    outputSchema: previewOutput,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async (input) => {
    try {
      const values = previewInput.parse(input);
      const result = await client.post('/api/v1/content/create/preview', values);
      previewOutput.parse(result);
      return resultMessage(result);
    }
    catch (error) {
      return onPreviewError(error);
    }
  });

  server.registerTool('commit_content_create', {
    title: 'Create confirmed unpublished Wall of Love',
    description: 'Creates exactly the complete Wall of Love plan returned by preview_content_create, only after the user explicitly confirms that displayed plan. Accept only its token and confirmed=true; never add content values here. Drupal revalidates permissions, token owner/expiry, fields, references and alias, then atomically saves one unpublished node, new Paragraphs, alias, initial revision and audit. A token is single-use. Return the real NID, URL, revision and audit IDs. If the alias is taken, request a new preview and confirmation; never silently change the title or URL. On a timeout the outcome is unknown: inspect READ/audit before another creation. Never automatically retry or create another preview after a blocked commit.',
    inputSchema: commitInput,
    outputSchema: commitOutput,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async (input) => {
    try {
      const values = commitInput.parse(input);
      const result = await client.post('/api/v1/content/create/commit', values);
      commitResult.parse(result);
      return resultMessage({ status: 'committed', result, error: null });
    }
    catch (error) {
      return onCommitError(error);
    }
  });
}

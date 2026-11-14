import * as z from 'zod/v4';

const text = z.string().nullable();
const id = z.number().int().positive();
const money = z.number().int().nullable();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const registrationInput = {
  submission_id: id.max(2147483647).optional(),
  include_certificates: z.boolean().optional().describe("Read-only certificate diagnostic for the whole submission; requires submission_id and no other filters."),
  first_name: z.string().trim().min(1).max(255).optional(),
  last_name: z.string().trim().min(1).max(255).optional(),
  email: z.string().trim().min(1).max(255).optional(),
  company: z.string().trim().min(1).max(255).optional(),
  training: z.string().trim().min(1).max(255).optional(),
  training_id: id.optional(),
  date_id: id.optional(),
  date_from: date.optional(),
  date_to: date.optional(),
  limit: z.number().int().min(1).max(100).default(50),
  after: z.string().regex(/^[1-9][0-9]{0,9}:[0-9]{1,9}$/).optional(),
};
const identity = z.object({ id, label: z.string() }).nullable();
const certificatePreview = z.object({
  submission_id: id, read_only: z.literal(true), execution_available: z.literal(false),
  scope: z.literal('whole_submission'), checkbox_enabled: z.boolean(),
  training: identity, date: identity, trainer: identity, certificate_title: z.string(),
  signature_available: z.boolean(), data_complete: z.boolean(),
  issues: z.array(z.string()), warnings: z.array(z.string()),
  participants: z.array(z.object({ id, first_name: z.string(), last_name: z.string(),
    certificate_file_id: id.nullable(), certificate_file_readable: z.boolean() })),
});
export const registrationOutput = {
  certificates: certificatePreview.optional(),
  items: z.array(z.object({
    registration_key: z.string(),
    submission_id: id,
    participant_id: id,
    first_name: text,
    last_name: text,
    email: text,
    position: text,
    company: text,
    training_id: id.nullable(),
    training_name: text,
    date_id: id.nullable(),
    date_start: text,
    date_starts: z.array(z.string()),
    date_end: text,
    submission_trainer: text,
    date_trainers: z.array(z.object({ id, name: z.string() })),
    participant_count_declared: z.number().int().nullable(),
    participant_count_linked: z.number().int().nonnegative(),
    notifications: z.object({
      enabled: z.boolean().nullable(),
      records: z.object({
        total: z.number().int().nonnegative(),
        marked_sent: z.number().int().nonnegative(),
        not_marked_sent: z.number().int().nonnegative(),
        unknown: z.number().int().nonnegative(),
      }).nullable(),
    }).optional(),
    pricing: z.object({
      currency: z.literal('PLN'),
      base_unit_net: money,
      submission_total_net: money,
      submission_total_discounted_net: money,
    }),
  })),
  has_more: z.boolean(),
  next_after: text,
  pricing_note: z.string(),
  notification_note: z.string().optional(),
};

export function registerRegistrationTools(server, client, onError, runRead) {
  server.registerTool('search_registrations', {
    title: 'Search training registrations and participants',
    description: 'To inspect notifications for a submission, pass submission_id, read notifications.enabled and follow pagination for all participants. enabled=true means already enabled; do not request re-enabling. This READ never enables notifications. Empty items does not prove a submission is missing or notifications are disabled; rows require matching participant/training records. Enabling in Drupal also sends confirmation to the applying person. For a certificate preview use submission_id and include_certificates=true without other filters. certificates describes the entire submission, independently of participant pagination; it never generates PDFs or proves successful generation. Use this to find registered training participants or prepare registration reports. READ ONLY; requires the Drupal registrations reader role. Email matches exactly; names, company and training title use substring matching. Filters combine with AND. Dates are inclusive YYYY-MM-DD and match any date in date_starts. One row represents a participant within a submission. Keep all filters while following next_after until has_more=false. Monetary totals belong to the whole submission: count them once per submission_id, even across pages. base_unit_net is a base price, not a participant-specific final price or proof of payment. notifications, when available, also belongs to the submission: enabled is the notification switch, never confirmed participation. records contains stored npxmail flags, not proof of successful sending or delivery to a participant. Zero records does not prove no mail was sent; disabling notifications deletes records. Missing notifications or records=null means unavailable, not false. Payment, participation confirmation, conditional participation and transfers remain unknown. Never infer readiness to guarantee a group from counts or notification flags. Participant records and registration data remain unavailable through general content tools.',
    inputSchema: registrationInput,
    outputSchema: registrationOutput,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async (input) => runRead(async () => {
    try {
      const { include_certificates, ...filters } = z.object(registrationInput).strict().parse(input);
      if (include_certificates && (!filters.submission_id || Object.keys(filters).some(key => !['submission_id', 'limit', 'after'].includes(key)))) {
        throw new Error('Certificate preview requires submission_id and no other filters.');
      }
      const certificates = include_certificates
        ? certificatePreview.parse(await client.get(`/api/v1/registrations/${filters.submission_id}/certificates/preview`))
        : undefined;
      const result = await client.post('/api/v1/registrations/search', filters);
      if (certificates) result.certificates = certificates;
      z.object(registrationOutput).parse(result);
      return { structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
    catch (error) {
      return onError(error);
    }
  }));
}

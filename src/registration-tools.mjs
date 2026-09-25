import * as z from 'zod/v4';

const text = z.string().nullable();
const id = z.number().int().positive();
const money = z.number().int().nullable();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const registrationInput = {
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
export const registrationOutput = {
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
};

export function registerRegistrationTools(server, client, onError, runRead) {
  server.registerTool('search_registrations', {
    title: 'Search training registrations and participants',
    description: 'Use this to find registered training participants or prepare registration reports. READ ONLY; requires the Drupal registrations reader role. Email matches exactly; names, company and training title use substring matching. Filters combine with AND. Dates are inclusive YYYY-MM-DD and match any date in date_starts. One row represents a participant within a submission. Keep all filters while following next_after until has_more=false. Monetary totals belong to the whole submission: count them once per submission_id, even across pages. base_unit_net is a base price, not a participant-specific final price or proof of payment. There is no registration status field. Participant records and registration data remain unavailable through general content tools.',
    inputSchema: registrationInput,
    outputSchema: registrationOutput,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async (input) => runRead(async () => {
    try {
      const result = await client.post('/api/v1/registrations/search', input);
      z.object(registrationOutput).parse(result);
      return { structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
    catch (error) {
      return onError(error);
    }
  }));
}

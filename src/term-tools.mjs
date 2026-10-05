import * as z from 'zod/v4';

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const count = z.number().int().nonnegative();
export const termAvailabilityInput = {
  date_id: id.describe('Training date node ID, not the training ID.'),
  training_id: id.optional().describe('Required when a date has multiple linked trainings; must be a real link.'),
};
export const termAvailabilityOutput = {
  date_id: id,
  training_id: id,
  revision_id: id,
  evaluated_at: z.string(),
  published: z.boolean(),
  dates: z.object({ start: z.array(z.string()), end: z.array(z.string()) }),
  capacity: count,
  capacity_source: z.string(),
  registered_people: count,
  count_source: z.string(),
  remaining_signed: z.number().int(),
  remaining_places: count,
  over_baseline_limit: z.boolean(),
  limit_active: z.boolean(),
  limit_scope: z.string(),
  aggregate_limit_enforced: z.boolean(),
  count_scope: z.string(),
  stored: z.object({
    availability: z.string(), limit_disabled: z.boolean(),
    guaranteed: z.boolean(), guarantee_from: count.nullable(),
  }),
  guarantee_from_effective: count.nullable(),
  guarantee_from_source: z.string(),
  ui: z.object({
    helper_remaining_places: z.number().int(),
    numeric_count_visible: z.boolean(),
    regular_calculator_places: count.nullable(),
    regular_calculator_message: z.string().nullable(),
    discount_places: count,
    discount_type: z.enum(['firstminute', 'lastminute']).nullable(),
    context: z.string(),
  }),
  rules: z.array(z.string()),
  cache: z.object({ api_cached: z.boolean(), count_helper_cached: z.boolean(), ui_evidence: z.string() }),
  warnings: z.array(z.string()),
};

export function registerTermTools(server, client, onError, runRead) {
  server.registerTool('get_term_availability', {
    title: 'Read and explain training date availability',
    description: 'READ ONLY diagnostic for one training date. Use get_content_type_schema for npxtraining_date and existing content/revision tools for raw fields and history. Returns the actual linked-participant count, code baseline 10, remaining_signed/remaining_places, stored flags, inherited guarantee threshold and the current regular calculator message with its rules. The UI can report 1 even after the baseline is exceeded. Disabling the limit controls the per-submission spinner, not aggregate capacity enforcement. Counts are separate for training_id + date_id, with no payment/confirmation filter. Never treat registered_people as confirmed people or capacity as verified room capacity. This computes the current message for one person with no coupon/URL overrides; it does not fetch browser HTML, cache or historic messages. Requires content and registrations READ permissions.',
    inputSchema: termAvailabilityInput,
    outputSchema: termAvailabilityOutput,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async (input) => runRead(async () => {
    try {
      const { date_id: dateId, training_id: trainingId } = z.object(termAvailabilityInput).parse(input);
      const query = trainingId === undefined ? '' : `?training_id=${trainingId}`;
      const result = await client.get(`/api/v1/training-dates/${dateId}/availability${query}`);
      z.object(termAvailabilityOutput).parse(result);
      return { structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
    catch (error) {
      return onError(error);
    }
  }));
}

import * as z from 'zod/v4';

export const certificateResult = z.object({
  operation: z.literal('generate_certificates'), submission_id: z.number().int().positive(),
  status: z.enum(['generated', 'already_generated']), operation_id: z.string(), replayed: z.boolean(),
  files: z.array(z.object({participant_id: z.number().int().positive(), file_id: z.number().int().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/), valid_pdf: z.literal(true)})).min(1),
});
export const notificationResult = z.object({
  operation:z.literal('enable_notifications'), submission_id:z.number().int().positive(),
  status:z.enum(['enabled','already_enabled']), operation_id:z.string(), replayed:z.boolean(),
  enabled:z.literal(true), records_created:z.number().int().nonnegative(), schedule_verified:z.boolean(), delivery_verified:z.literal(false),
  records:z.array(z.object({id:z.number().int().positive(),message_id:z.number().int().positive(),date_to_send:z.string()})),
});
export const certificatePreviewOutput = {
  operation: z.literal('generate_certificates'), submission_id: z.number().int().positive(),
  changes: z.array(z.record(z.string(), z.any())), details: z.record(z.string(), z.any()),
  side_effects: z.array(z.string()),
  action: z.enum(['generate', 'already_generated']), preview_token: z.string(),
  expires_at: z.string(), requires_confirmation: z.literal(true),
};
export const checkboxResetResult = z.object({
  operation: z.enum(['disable_notifications', 'unset_certificates']), submission_id: z.number().int().positive(),
  status: z.enum(['disabled', 'already_disabled']), enabled: z.literal(false), operation_id: z.string(),
  files_preserved: z.literal(true), records_deleted: z.number().int().nonnegative(),
  delivery_recalled: z.literal(false), replayed: z.boolean(),
});
const operations = ['generate_certificates', 'enable_notifications', 'disable_notifications', 'unset_certificates'];
export async function previewUpdate(client, input, contentUpdatesSchema) {
  if (operations.includes(input.operation)) {
    const parsed = z.object({operation: z.enum(operations), submission_id: z.number().int().positive().max(2147483647)}).strict().parse(input);
    const reset = ['disable_notifications','unset_certificates'].includes(parsed.operation);
    const notification = ['enable_notifications','disable_notifications'].includes(parsed.operation);
    const result = await client.post(`/api/v1/registrations/${notification ? 'notifications' : 'certificates'}/preview`, {submission_id: parsed.submission_id, ...(reset ? {operation:parsed.operation} : {})});
    const shape = {...certificatePreviewOutput, operation:z.literal(parsed.operation), action:reset ? z.enum(['disable','already_disabled']) : notification ? z.enum(['enable','already_enabled']) : z.enum(['generate','already_generated'])};
    return z.object(shape).parse(result);
  }
  const parsed = z.object({operation: z.literal('content_update').optional(), nid: z.number().int().positive(), expected_revision_id: z.number().int().positive(), updates: contentUpdatesSchema}).strict().parse(input);
  return client.post(`/api/v1/content/${parsed.nid}/preview`, {nid: parsed.nid, expected_revision_id: parsed.expected_revision_id, updates: parsed.updates});
}
export async function commitUpdate(client, input) {
  const parsed = z.object({operation: z.enum(['content_update', ...operations]).optional(), preview_token: z.string().regex(/^[a-f0-9]{64}$/), confirmed: z.literal(true)}).strict().parse(input);
  const reset = ['disable_notifications','unset_certificates'].includes(parsed.operation);
  const certificate = ['generate_certificates','unset_certificates'].includes(parsed.operation);
  const notification = ['enable_notifications','disable_notifications'].includes(parsed.operation);
  const result = await client.post(notification ? '/api/v1/registrations/notifications/commit' : certificate ? '/api/v1/registrations/certificates/commit' : '/api/v1/content/commit', {preview_token: parsed.preview_token, confirmed: true, ...(reset ? {operation:parsed.operation} : {})});
  return reset ? checkboxResetResult.parse(result) : notification ? notificationResult.parse(result) : certificate ? certificateResult.parse(result) : result;
}

import * as z from 'zod/v4';
const id = z.number().int().positive().max(2147483647);
const ref = z.object({target_id: id}).strict();
const refs = z.union([ref, z.array(ref).max(50)]);
const text = z.string().min(1).max(255);
const values = z.union([text, z.array(text).min(1).max(50)]);
export const trainingDateFields = z.object({
  training_id: id, title: text, status: z.boolean().optional(),
  field_npxtraining_date_start: values, field_npxtraining_date_end: values,
  field_npxtraining_date_form: values,
  field_npxtraining_date_city: refs.optional(), field_npxtraining_date_room: refs.optional(),
  field_npxtraining_date_trainer: refs, field_npxtraining_date_cal_title: text,
  field_npxtraining_date_available: text.optional(),
  field_npxtraining_date_trcost: text.optional(), field_npxtraining_date_constcost: text.optional(),
  field_npxtraining_date_addcost: text.optional(), field_npxtraining_date_price: text.optional(),
  field_npxtraining_date_guarant: z.boolean().optional(), field_npxtraining_date_lim_dis: z.boolean().optional(),
  field_npxtraining_min_guaranted: text.optional(),
  field_npxtraining_hours: z.number().int().nonnegative().optional(),
  body: z.string().max(20000).describe('Plain text description; line breaks allowed, HTML not accepted.').optional(),
  field_addcost_info: z.string().max(20000).optional(),
  field_npxtraining_date_hours: text.optional(),
  field_npx_calendar_hide: z.boolean().optional(),
  field_zoom_link: text.describe('HTTP(S) meeting URL without credentials.').optional(),
  field_zoom_message: z.string().max(20000).describe('Plain text with links and line breaks; HTML not accepted.').optional(),
  field_npxtraining_date_dis_fxd: text.describe('Non-negative amount, at most two decimal places.').optional(),
  field_npxtraining_date_dis_per: z.number().int().min(0).max(100).optional(),
  field_npxtraining_date_dis_ref: refs.optional(),
  field_npxtraining_date_ldis_ref: refs.optional(),
  field_npxtraining_date_min: z.number().int().nonnegative().max(2147483647).optional(),
}).strict();
export const trainingDatePreview = z.object({
  operation: z.literal('training_date_create_preview'), content_type: z.literal('npxtraining_date'),
  nid: z.null(), current_revision_id: z.null(), content: z.record(z.string(), z.unknown()),
  changes: z.array(z.object({field:z.string(), before:z.null(), after:z.unknown()})),
  references: z.union([z.record(z.string(),z.unknown()),z.array(z.never())]),
  training: z.object({id, label:z.string(), revision_id:id}),
  related_changes:z.array(z.record(z.string(),z.unknown())), duplicate_check:z.literal('passed'),
  execution_available:z.literal(true), requires_confirmation:z.literal(true),
  preview_token:z.string().regex(/^[a-f0-9]{64}$/), expires_at:z.string(),
});

export const trainingDateCommit = z.object({
  operation:z.literal('single_content_create'), content_type:z.literal('npxtraining_date'),
  nid:id, revision_id:id, audit_id:id, training_id:id, training_revision_id:id, training_audit_id:id,
  status:z.boolean(), url:z.string().url(), content:z.record(z.string(),z.unknown()),
  related_changes:z.array(z.record(z.string(),z.unknown())),
});

import { z } from 'zod';
import { ISO_DATE } from '../../shared/time/clinic-time';
import { CONDITIONS, isToothCode, NOTE_FIELDS, RECALL_REASONS, SURFACES } from './clinical-rules';

const Uuid = z.string().uuid();
const Text = (max: number) => z.string().trim().max(max).transform((v) => v || null);
const Tooth = z.number().int().refine(isToothCode, 'FDI tooth code: 11–48 or 51–85');
const Surfaces = z.array(z.enum(SURFACES)).max(8);
const Money = z.number().int().min(0).max(100_000_000);
const Reason = z.string().trim().min(3).max(500);

/** Open a visit: on a checked-in appointment, or a walk-in started by the doctor (VISIT-001). */
export const OpenVisit = z.union([
  z.object({ appointmentId: Uuid }).strict(),
  z.object({ patientId: Uuid, branchId: Uuid, doctorId: Uuid.optional() }).strict(),
]);
export const VisitNotes = z.object({
  chiefComplaint: Text(2000).nullable(), diagnosis: Text(2000).nullable(),
  clinicalNotes: Text(10000).nullable(), nextVisitNote: Text(2000).nullable(),
}).partial().strict();
export const Amendment = z.object({ field: z.enum(NOTE_FIELDS), text: z.string().trim().min(1).max(10000), reason: Reason }).strict();

export const NewProcedure = z.object({
  serviceId: Uuid.optional(), planItemId: Uuid.optional(), toothCode: Tooth.nullable().optional(), surfaces: Surfaces.optional(),
  priceMinor: Money.optional(), notes: Text(1000).nullable().optional(),
}).strict().refine((b) => b.serviceId || b.planItemId, 'serviceId or planItemId');

const RxLine = z.object({
  drugName: z.string().trim().min(1).max(200), dose: Text(100).nullable().optional(), frequency: Text(100).nullable().optional(),
  duration: Text(100).nullable().optional(), instructions: Text(500).nullable().optional(),
}).strict();
export const NewPrescription = z.object({
  items: z.array(RxLine).min(1).max(20), notes: Text(1000).nullable().optional(), replacesId: Uuid.optional(),
}).strict();

export const ChartEntries = z.object({
  visitId: Uuid.optional(),
  entries: z.array(z.object({
    toothCode: Tooth, surfaces: Surfaces.default([]), condition: z.enum(CONDITIONS), notes: Text(1000).nullable().optional(),
  }).strict()).min(1).max(52),
}).strict();

export const NewPlan = z.object({ title: z.string().trim().min(1).max(200), notes: Text(2000).nullable().optional(), doctorId: Uuid.optional() }).strict();
export const EditPlan = z.object({ title: z.string().trim().min(1).max(200), notes: Text(2000).nullable() }).partial().strict();
export const PlanStatus = z.object({ to: z.enum(['proposed', 'accepted', 'cancelled']) }).strict();
export const NewPlanItem = z.object({
  serviceId: Uuid, toothCode: Tooth.nullable().optional(), surfaces: Surfaces.optional(), priceMinor: Money.optional(), discountMinor: Money.optional(),
}).strict();
export const EditPlanItem = z.object({
  toothCode: Tooth.nullable(), surfaces: Surfaces, priceMinor: Money, discountMinor: Money, sortOrder: z.number().int().min(0).max(1000),
}).partial().strict();
export const LinkAppointment = z.object({ appointmentId: Uuid }).strict();

export const NewRecall = z.object({
  reason: z.enum(RECALL_REASONS), dueDate: z.string().regex(ISO_DATE, 'YYYY-MM-DD'), notes: Text(1000).nullable().optional(),
  doctorId: Uuid.optional(), sourceVisitId: Uuid.optional(),
}).strict();
export const RecallContact = z.object({ note: z.string().trim().min(1).max(500) }).strict();
export const RecallDismiss = z.object({ reason: Text(300).nullable().optional() }).strict();
export const RecallsQuery = z.object({
  view: z.enum(['due', 'upcoming', 'closed']).default('due'),
  limit: z.coerce.number().int().min(1).max(200).default(100),
}).strict();

/** The clinic's visits list (redesign R5): today's, the drafts not yet finalized, or all; the doctor's own by default. */
export const VisitsQuery = z.object({
  view: z.enum(['today', 'drafts', 'all']).default('today'),
  /** auto = the doctor's own visits when the member is a doctor (owners see everyone's) */
  mine: z.enum(['auto', '1', '0']).default('auto'),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  /** "load more": the visits listed after this one (the last of the previous page) */
  after: Uuid.optional(),
}).strict();

export type VisitsQueryInput = z.infer<typeof VisitsQuery>;

/** Redesign R8: the drugs the clinic has prescribed, to suggest while writing a prescription. */
export const DrugsQuery = z.object({
  q: z.string().trim().max(100).optional().transform((v) => v || undefined),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type DrugsQueryInput = z.infer<typeof DrugsQuery>;
export type OpenVisitInput = z.infer<typeof OpenVisit>;
export type VisitNotesInput = z.infer<typeof VisitNotes>;
export type AmendmentInput = z.infer<typeof Amendment>;
export type NewProcedureInput = z.infer<typeof NewProcedure>;
export type NewPrescriptionInput = z.infer<typeof NewPrescription>;
export type ChartEntriesInput = z.infer<typeof ChartEntries>;
export type NewPlanInput = z.infer<typeof NewPlan>;
export type EditPlanInput = z.infer<typeof EditPlan>;
export type NewPlanItemInput = z.infer<typeof NewPlanItem>;
export type EditPlanItemInput = z.infer<typeof EditPlanItem>;
export type NewRecallInput = z.infer<typeof NewRecall>;

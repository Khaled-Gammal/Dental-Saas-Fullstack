import { z } from 'zod';
import { E164Phone } from '../../shared/validation/common';
import { ISO_DATE } from '../../shared/time/clinic-time';
import { IMPORT_FIELDS, type ImportField } from './import-rules';

/** Rows per import request (the dashboard sends 500, and fewer when they are long, to stay under the 1 MB body limit). */
export const IMPORT_BATCH = 1000;

const Name = z.string().trim().min(2).max(120);
const Text = (max: number) => z.string().trim().max(max).transform((v) => v || null);
const Uuid = z.string().uuid();
const Dob = z.string().regex(ISO_DATE, 'YYYY-MM-DD').refine((d) => d <= new Date().toISOString().slice(0, 10) && d >= '1900-01-01', 'Date of birth must be in the past');
const Email = z.string().trim().toLowerCase().email().max(254);
export const RELATIONS = ['father', 'mother', 'sibling', 'spouse', 'legal_guardian', 'other'] as const;

const fields = {
  fullName: Name,
  gender: z.enum(['male', 'female']).nullable(),
  dateOfBirth: Dob.nullable(),
  phone: E164Phone,
  phoneAlt: E164Phone.nullable(),
  email: Email.nullable(),
  address: Text(300).nullable(),
  city: Text(80).nullable(),
  occupation: Text(80).nullable(),
  referralSource: Text(60).nullable(),
  preferredBranchId: Uuid.nullable(),
  preferredLocale: z.enum(['ar', 'en']),
  notes: Text(2000).nullable(),
  tags: z.array(z.string().trim().max(30)).max(10),
  guardianName: Name.nullable(),
  guardianPhone: E164Phone.nullable(),
  guardianRelation: z.enum(RELATIONS).nullable(),
  guardianPatientId: Uuid.nullable(),
  marketingOptIn: z.boolean(),
};
/** Only members with `patients:block` (reception, owners) change this, after repeated no-shows or fake bookings. */
const IsBlocked = z.boolean();

export const CreatePatient = z.object(fields).partial().required({ fullName: true, phone: true }).strict();
export const UpdatePatient = z.object({ ...fields, needsReview: z.literal(false), isBlocked: IsBlocked }).partial().strict();
export type CreatePatientInput = z.infer<typeof CreatePatient>;
export type UpdatePatientInput = z.infer<typeof UpdatePatient>;

const Items = z.array(z.string()).max(30);
export const MedicalHistoryBody = z.object({
  allergies: Items, conditions: Items, medications: Items,
  isPregnant: z.boolean().nullable(), isSmoker: z.boolean().nullable(), notes: Text(2000).nullable(),
}).strict();
export type MedicalHistoryInput = z.infer<typeof MedicalHistoryBody>;

export const ListQuery = z.object({
  q: z.string().max(120).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
}).strict();

/** Merge another record into this one (SRS PATIENT-003). */
export const MergeBody = z.object({ mergedId: Uuid }).strict();
export const MergePreviewQuery = z.object({ other: Uuid }).strict();

/**
 * Phase 2A (SRS ONB-03): a batch of rows from the clinic's Excel/CSV file, as typed there, mapped to our fields by the
 * dashboard. `row` is the line in the file (for the report). `dryRun`: check only, write nothing.
 */
const Cell = z.string().max(2100).nullable().optional();
export const ImportBody = z.object({
  dryRun: z.boolean(),
  rows: z.array(z.object({
    row: z.number().int().min(1).max(1_000_000),
    ...Object.fromEntries(IMPORT_FIELDS.map((f) => [f, Cell])) as Record<ImportField, typeof Cell>,
  }).strict()).min(1).max(IMPORT_BATCH),
}).strict();
export type ImportBodyInput = z.infer<typeof ImportBody>;

/** "Is this person already registered?" — any of phone, name and birth date, as typed in the new-patient form. */
export const DuplicatesQuery = z.object({
  phone: z.string().trim().max(30).optional(),
  fullName: z.string().trim().max(120).optional(),
  dateOfBirth: z.string().regex(ISO_DATE, 'YYYY-MM-DD').optional(),
}).strict();

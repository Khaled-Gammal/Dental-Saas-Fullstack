import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { Tx } from '@dental/db';
import { hasPermission } from '../../auth/permissions';
import { AuditLog } from '../../shared/audit/audit-log';
import type { RequestContext } from '../../shared/context/request-context';
import { TenantDb } from '../../shared/database/tenant-db.service';
import { Err } from '../../shared/errors/app-error';
import { normalizePhone } from '../../shared/phone';
import { PlanLimits } from '../../shared/plans/plan-limits.service';
import { auditChanges, classifySearch, cleanList, cleanTags, decodeCursor, encodeCursor, NEEDS_REVIEW } from './patient-rules';
import { PatientsRepository, type PatientFields } from './patients.repository';
import type { CreatePatientInput, MedicalHistoryInput, UpdatePatientInput } from './patients.schemas';

const notFound = () => Err.notFound('patient_not_found', 'Patient not found');

/** camelCase API fields -> stored columns; only keys that were sent. */
const COLUMN: Record<Exclude<keyof UpdatePatientInput, 'needsReview' | 'tags' | 'marketingOptIn'>, keyof PatientFields> = {
  isBlocked: 'is_blocked',
  fullName: 'full_name', gender: 'gender', dateOfBirth: 'date_of_birth', phone: 'phone', phoneAlt: 'phone_alt', email: 'email', address: 'address',
  city: 'city', occupation: 'occupation', referralSource: 'referral_source', preferredBranchId: 'preferred_branch_id', preferredLocale: 'preferred_locale',
  notes: 'notes', guardianName: 'guardian_name', guardianPhone: 'guardian_phone', guardianRelation: 'guardian_relation', guardianPatientId: 'guardian_patient_id',
};
function toColumns(input: Partial<UpdatePatientInput>): PatientFields {
  const out: Record<string, unknown> = {};
  for (const [k, col] of Object.entries(COLUMN)) if (k in input) out[col] = input[k as keyof typeof COLUMN];
  if (input.tags !== undefined) out.tags = cleanTags(input.tags);
  if (input.marketingOptIn !== undefined) out.marketing_opt_in = input.marketingOptIn;
  return out as PatientFields;
}

/**
 * Patients (SRS DSH-03, standard module). One use case per method, one `TenantDb.run` each. Medical history is
 * clinical data: read with `clinical:read` (or `clinical:write`), written with `clinical:write`. Every view and
 * change of a record is written to `audit_log` in the same transaction (NFR-03, DSH-15).
 */
@Injectable()
export class PatientsService {
  constructor(
    private readonly db: TenantDb,
    private readonly repo: PatientsRepository,
    private readonly audit: AuditLog,
    private readonly plan: PlanLimits,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  private can(p: string) { return hasPermission(this.cls.get('permissions'), p); }
  private canReadClinical() { return this.can('clinical:read') || this.can('clinical:write'); }

  /** Search (name, phone, file number) or the newest-first page. */
  list(q: { q?: string; cursor?: string; limit: number }) {
    return this.db.run(async (tx, tenantId) => {
      const search = classifySearch(q.q);
      if (search.kind !== 'all') return { items: await this.repo.search(tx, tenantId, search, q.limit), nextCursor: null };
      const rows = await this.repo.page(tx, tenantId, decodeCursor(q.cursor), q.limit + 1);
      const items = rows.slice(0, q.limit);
      const last = items[items.length - 1];
      return { items, nextCursor: rows.length > q.limit && last ? encodeCursor(last.created_at, last.id) : null };
    });
  }

  get(id: string) {
    return this.db.run(async (tx, tenantId) => {
      const patient = await this.repo.get(tx, tenantId, id);
      if (!patient) throw notFound();
      await this.audit.recordView(tx, tenantId, 'patient', id);
      const [appointments, medicalHistory] = await Promise.all([
        this.repo.appointments(tx, id),
        this.canReadClinical() ? this.repo.medicalHistory(tx, id) : Promise.resolve(null), // hidden, not empty: the UI says why
      ]);
      return { ...patient, needs_review: patient.tags.includes(NEEDS_REVIEW), medicalHistory, appointments };
    });
  }

  create(input: CreatePatientInput) {
    return this.db.run(async (tx, tenantId) => {
      await this.plan.assertCanAdd(tx, tenantId, 'patients', () => this.repo.countActive(tx, tenantId));
      const f = toColumns(input) as PatientFields & { full_name: string; phone: string };
      await this.assertRefs(tx, tenantId, f, null);
      const { id } = await this.repo.create(tx, tenantId, f, this.cls.get('memberId') ?? null);
      await this.audit.record(tx, tenantId, { action: 'patient.create', entityType: 'patient', entityId: id });
      return (await this.repo.get(tx, tenantId, id))!;
    });
  }

  update(id: string, input: UpdatePatientInput) {
    // blocking someone from online booking is reception's and the owner's call, not every writer's (SRS B.1)
    if (input.isBlocked !== undefined && !this.can('patients:block')) throw Err.forbidden('missing_permission', 'Missing permission: patients:block');
    return this.db.run(async (tx, tenantId) => {
      const before = await this.repo.lock(tx, tenantId, id);
      if (!before) throw notFound();
      const f = toColumns(input);
      // the review tag is the API's own: kept unless reception marks the record reviewed
      if (f.tags !== undefined && before.tags.includes(NEEDS_REVIEW) && input.needsReview !== false) f.tags = [NEEDS_REVIEW, ...f.tags];
      await this.assertRefs(tx, tenantId, f, id);
      const changes = auditChanges(before as unknown as Record<string, unknown>, f as Record<string, unknown>);
      const marketingAt = 'marketing_opt_in' in changes ? { marketing_opt_in_at: new Date() } : {}; // PDPL: when consent was given or withdrawn
      await this.repo.update(tx, id, { ...f, ...marketingAt });
      if (input.needsReview === false && before.tags.includes(NEEDS_REVIEW)) {
        await this.repo.removeTag(tx, id, NEEDS_REVIEW);
        changes.reviewed = true;
      }
      if (Object.keys(changes).length) await this.audit.record(tx, tenantId, { action: 'patient.update', entityType: 'patient', entityId: id, changes });
      return (await this.repo.get(tx, tenantId, id))!;
    });
  }

  saveMedicalHistory(id: string, input: MedicalHistoryInput) {
    return this.db.run(async (tx, tenantId) => {
      if (!(await this.repo.exists(tx, tenantId, id))) throw notFound();
      const before = await this.repo.medicalHistory(tx, id);
      const next = {
        allergies: cleanList(input.allergies), conditions: cleanList(input.conditions), medications: cleanList(input.medications),
        is_pregnant: input.isPregnant, is_smoker: input.isSmoker, notes: input.notes,
      };
      const changes = auditChanges(before as unknown as Record<string, unknown>, next);
      await this.repo.saveMedicalHistory(tx, tenantId, id, next, this.cls.get('memberId') ?? null);
      if (Object.keys(changes).length) await this.audit.record(tx, tenantId, { action: 'patient.medical_history.update', entityType: 'patient', entityId: id, changes });
      return this.repo.medicalHistory(tx, id);
    });
  }

  /** Possible duplicates of a record about to be created (SRS PATIENT-002): a warning, never a block. */
  duplicates(q: { phone?: string; fullName?: string; dateOfBirth?: string }) {
    const phone = q.phone ? normalizePhone(q.phone) : null;
    const fullName = q.fullName?.trim() || null;
    return this.db.run((tx, tenantId) => this.repo.possibleDuplicates(tx, tenantId, { phone, fullName, dateOfBirth: q.dateOfBirth ?? null }));
  }

  /** Earlier versions of the medical history (SRS PATIENT-005); clinical data, so `clinical:read`. */
  historyVersions(id: string) {
    if (!this.canReadClinical()) throw Err.forbidden('missing_permission', 'Missing permission: clinical:read');
    return this.db.run(async (tx, tenantId) => {
      if (!(await this.repo.exists(tx, tenantId, id))) throw notFound();
      await this.audit.recordView(tx, tenantId, 'patient_medical_history', id);
      return this.repo.historyVersions(tx, id);
    });
  }

  activity(id: string) {
    return this.db.run(async (tx, tenantId) => {
      if (!(await this.repo.exists(tx, tenantId, id))) throw notFound();
      return this.repo.activity(tx, tenantId, id, 100);
    });
  }

  /** References must be in this clinic (RLS hides others, so "not found" is the answer for both). */
  private async assertRefs(tx: Tx, tenantId: string, f: PatientFields, selfId: string | null) {
    if (f.preferred_branch_id && !(await this.repo.branchExists(tx, f.preferred_branch_id))) throw Err.badRequest('branch_not_found', 'Branch not found');
    if (f.guardian_patient_id) {
      if (f.guardian_patient_id === selfId) throw Err.badRequest('guardian_is_self', 'A patient cannot be their own guardian');
      if (!(await this.repo.exists(tx, tenantId, f.guardian_patient_id))) throw Err.badRequest('guardian_not_found', 'The guardian patient was not found');
    }
  }
}

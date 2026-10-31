import { Injectable } from '@nestjs/common';
import type { Tx } from '@dental/db';
import { AuditLog } from '../../shared/audit/audit-log';
import { AppError, Err } from '../../shared/errors/app-error';
import { PlanLimits } from '../../shared/plans/plan-limits.service';
import { NEEDS_REVIEW } from './patient-rules';
import { PatientsRepository } from './patients.repository';

/** What a visitor sees when the clinic cannot take their booking online; the reason (blocked, plan) stays internal. */
const refused = () => Err.forbidden('booking_refused', 'Online booking is not available; please call the clinic to book');

/**
 * The patients module's public API for other modules (SRS 8.2: a module touches only its own tables). Scheduling
 * calls this inside its own transaction instead of reading or writing `patients` itself.
 */
@Injectable()
export class PatientDirectory {
  constructor(
    private readonly repo: PatientsRepository,
    private readonly plan: PlanLimits,
    private readonly audit: AuditLog,
  ) {}

  /**
   * SRS BOOK-11: phone + name links an existing patient; otherwise a new record tagged for reception to review.
   * A blocked patient is refused (never given a fresh record). Phone + name is not proof of identity, so a different
   * email on a matched record is never written over the one on file (review R11: anyone knowing a patient's name and
   * phone could otherwise redirect their reminders). The record is flagged for reception instead, and the address the
   * visitor used is kept in the audit trail; this booking's own confirmation still goes to the verified address.
   * A new record counts against the plan's patient limit like one made at the desk.
   */
  async matchOrCreateForBooking(tx: Tx, tenantId: string, p: { fullName: string; phone: string; email: string | null; preferredBranchId: string }): Promise<{ id: string; created: boolean }> {
    const found = await this.repo.findByPhoneAndName(tx, tenantId, p.phone, p.fullName);
    if (found?.is_blocked) throw refused();
    if (found) {
      if (p.email && p.email !== found.email) {
        await this.repo.addTag(tx, found.id, NEEDS_REVIEW);
        await this.audit.record(tx, tenantId, { action: 'patient.booking_contact_differs', entityType: 'patient', entityId: found.id, actorType: 'patient', changes: { email: [found.email, p.email], via: 'website_booking' } });
      }
      return { id: found.id, created: false };
    }
    try {
      await this.plan.assertCanAdd(tx, tenantId, 'patients', () => this.repo.countActive(tx, tenantId));
    } catch (e) {
      if (e instanceof AppError && (e.code === 'plan_limit_reached' || e.code === 'subscription_inactive')) throw refused();
      throw e;
    }
    const { id } = await this.repo.createFromBooking(tx, tenantId, p);
    await this.audit.record(tx, tenantId, { action: 'patient.create', entityType: 'patient', entityId: id, actorType: 'patient', changes: { via: 'website_booking' } });
    return { id, created: true };
  }

  /**
   * The patient as the clinical screens show them (visit header, prescription), with the medical history for the
   * alerts (PATIENT-005). The caller has already checked clinical:read. Null when there is no such (live) record.
   */
  async clinicalSummary(tx: Tx, tenantId: string, id: string) {
    const p = await this.repo.get(tx, tenantId, id);
    if (!p) return null;
    const medicalHistory = await this.repo.medicalHistory(tx, id);
    return { id: p.id, file_no: p.file_no, full_name: p.full_name, phone: p.phone, gender: p.gender, date_of_birth: p.date_of_birth, medicalHistory };
  }

  exists(tx: Tx, tenantId: string, id: string): Promise<boolean> {
    return this.repo.exists(tx, tenantId, id);
  }

  /** A staff booking needs a live, unblocked record of this clinic. */
  async assertBookable(tx: Tx, tenantId: string, id: string): Promise<void> {
    const p = await this.repo.bookable(tx, tenantId, id);
    if (!p) throw Err.notFound('patient_not_found', 'Patient not found');
    if (p.is_blocked) throw Err.conflict('patient_blocked', 'This patient is blocked from booking');
  }
}

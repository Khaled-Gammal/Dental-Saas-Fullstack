import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { Tx } from '@dental/db';
import { hasPermission } from '../../auth/permissions';
import type { RequestContext } from '../../shared/context/request-context';
import { Err } from '../../shared/errors/app-error';

/** Who is acting, as the clinical rules need it: their permissions and, when they are a doctor, which one. */
export interface ClinicalActor {
  memberId: string;
  /** owners ('*') may act on every doctor's visits and plans (SRS VISIT-001, TPLAN-001) */
  isOwner: boolean;
  doctorId: string | null;
  can: (p: string) => boolean;
}

/**
 * The clinical permission rules (SRS B.1): reading needs clinical:read (or clinical:write); writing a visit needs
 * clinical:write and the visit to be the actor's own (or the actor an owner); procedures and plans need
 * treatments:write:own on the actor's own visits and plans (owners: all).
 */
@Injectable()
export class ClinicalAccess {
  constructor(private readonly cls: ClsService<RequestContext>) {}

  can(p: string): boolean { return hasPermission(this.cls.get('permissions'), p); }

  assertRead(): void {
    if (!this.can('clinical:read') && !this.can('clinical:write')) throw Err.forbidden('missing_permission', 'Missing permission: clinical:read');
  }

  async actor(tx: Tx): Promise<ClinicalActor> {
    const memberId = this.cls.get('memberId');
    if (!memberId) throw Err.forbidden('no_clinic', 'No clinic selected for this request');
    const d = await tx.selectFrom('doctors').select('id').where('member_id', '=', memberId).executeTakeFirst();
    return { memberId, isOwner: this.can('*'), doctorId: d?.id ?? null, can: (p) => this.can(p) };
  }

  /** May this actor write the notes of a visit by `doctorId`? */
  static writesVisit(a: ClinicalActor, doctorId: string): boolean {
    return a.can('clinical:write') && (a.isOwner || a.doctorId === doctorId);
  }

  /** May this actor record procedures, or edit a plan, of `doctorId`? */
  static writesTreatment(a: ClinicalActor, doctorId: string): boolean {
    return a.isOwner || (a.can('treatments:write:own') && a.doctorId === doctorId);
  }

  static assertVisitWriter(a: ClinicalActor, doctorId: string): void {
    if (!a.can('clinical:write')) throw Err.forbidden('missing_permission', 'Missing permission: clinical:write');
    if (!ClinicalAccess.writesVisit(a, doctorId)) throw Err.forbidden('not_your_visit', 'Only the visit doctor or the owner can change this visit');
  }

  static assertTreatmentWriter(a: ClinicalActor, doctorId: string): void {
    if (!a.isOwner && !a.can('treatments:write:own')) throw Err.forbidden('missing_permission', 'Missing permission: treatments:write:own');
    if (!ClinicalAccess.writesTreatment(a, doctorId)) throw Err.forbidden('not_your_patient', 'Only the treating doctor or the owner can change this');
  }
}

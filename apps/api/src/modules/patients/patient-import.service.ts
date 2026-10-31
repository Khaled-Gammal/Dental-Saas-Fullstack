import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { AuditLog } from '../../shared/audit/audit-log';
import type { RequestContext } from '../../shared/context/request-context';
import { TenantDb } from '../../shared/database/tenant-db.service';
import { PlanLimits } from '../../shared/plans/plan-limits.service';
import { dateInZone } from '../../shared/time/clinic-time';
import { parseImportRow, type FieldError, type ImportPatient } from './import-rules';
import { PatientsRepository } from './patients.repository';
import type { ImportBodyInput } from './patients.schemas';

/** One row of the report. `key` (new rows) lets the dashboard spot the same person again in a later batch of the file. */
export type ImportRowResult =
  | { row: number; status: 'new'; key: string }
  | { row: number; status: 'duplicate'; fileNo: number | null; sameAsRow: number | null }
  | { row: number; status: 'invalid'; errors: FieldError[] };

export interface ImportReport {
  dryRun: boolean;
  counts: { new: number; duplicate: number; invalid: number };
  /** created by this request (0 on a dry run) */
  created: number;
  /** how many more patients the plan allows before this batch (null = no limit) */
  room: number | null;
  rows: ImportRowResult[];
}

/**
 * Phase 2A (SRS ONB-03): patients from the clinic's Excel/CSV file. A duplicate is the same phone AND the same name
 * (normalised as the database does it, like an online booking matches a patient, BOOK-11) as a live record or as an
 * earlier row of the batch: families share one phone, so the phone alone is not a duplicate. Duplicates and invalid
 * rows are skipped, never merged or overwritten. The new ones are created in one transaction, after the plan's
 * patient limit is checked for all of them at once; each gets its audit row, plus one for the import.
 */
@Injectable()
export class PatientImportService {
  constructor(
    private readonly db: TenantDb,
    private readonly repo: PatientsRepository,
    private readonly plan: PlanLimits,
    private readonly audit: AuditLog,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  run(input: ImportBodyInput): Promise<ImportReport> {
    return this.db.run(async (tx, tenantId) => {
      const timezone = (await tx.selectFrom('tenants').select('timezone').executeTakeFirst())?.timezone ?? 'Africa/Cairo';
      const today = dateInZone(Date.now(), timezone);
      // a real import takes the clinic's plan lock first: a second import of the same rows (a retry after a timeout,
      // another tab) waits here, then finds them already created instead of creating them twice
      if (!input.dryRun) await this.plan.lock(tx, tenantId);
      const parsed = input.rows.map((r) => ({ row: r.row, ...parseImportRow(r, today) }));
      const valid = parsed.flatMap((p, at) => (p.patient ? [{ at, row: p.row, patient: p.patient }] : []));
      const matches = await this.repo.importMatches(tx, tenantId, valid.map((v) => ({ phone: v.patient.phone, name: v.patient.full_name })));

      // by position in the batch (two lines may claim the same row number)
      const rows: ImportRowResult[] = parsed.map((p) => (p.patient ? (null as unknown as ImportRowResult) : { row: p.row, status: 'invalid', errors: p.errors }));
      const fresh: { row: number; patient: ImportPatient }[] = [];
      const seen = new Map<string, number>(); // phone|normalised name -> its first row
      valid.forEach((v, i) => {
        const key = `${v.patient.phone}|${matches[i].norm}`;
        const first = seen.get(key);
        if (matches[i].fileNo !== null) rows[v.at] = { row: v.row, status: 'duplicate', fileNo: matches[i].fileNo, sameAsRow: null };
        else if (first !== undefined) rows[v.at] = { row: v.row, status: 'duplicate', fileNo: null, sameAsRow: first };
        else { seen.set(key, v.row); rows[v.at] = { row: v.row, status: 'new', key }; fresh.push(v); }
      });

      const limit = await this.plan.limit(tx, 'patients');
      const room = limit === null ? null : Math.max(0, limit - (await this.repo.countActive(tx, tenantId)));
      let created = 0;
      if (!input.dryRun && fresh.length) {
        await this.plan.assertCanAddMany(tx, tenantId, 'patients', fresh.length, () => this.repo.countActive(tx, tenantId));
        // one statement for the records and one for their audit rows: the lock is held for milliseconds, not seconds
        const ids = await this.repo.createMany(tx, tenantId, fresh.map((f) => f.patient), this.cls.get('memberId') ?? null);
        await this.audit.recordMany(tx, tenantId, ids.map((id) => ({ action: 'patient.create', entityType: 'patient', entityId: id, changes: { via: 'import' } })));
        created = ids.length;
      }
      const count = (st: ImportRowResult['status']) => rows.filter((r) => r.status === st).length;
      const counts = { new: count('new'), duplicate: count('duplicate'), invalid: count('invalid') };
      // one entry for the batch, on the clinic (rows skipped included), beside each new record's own
      if (created) await this.audit.record(tx, tenantId, { action: 'patient.import', entityType: 'clinic', entityId: tenantId, changes: { ...counts, created } });
      return { dryRun: input.dryRun, counts, created, room, rows };
    });
  }
}

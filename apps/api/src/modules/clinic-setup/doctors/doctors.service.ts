import { Injectable } from '@nestjs/common';
import type { Tx } from '@dental/db';
import { TenantDb } from '../../../shared/database/tenant-db.service';
import { Err } from '../../../shared/errors/app-error';
import { PlanLimits } from '../../../shared/plans/plan-limits.service';
import { MediaService, type StoredImage } from '../../media';
import { LiveSiteWrite } from '../../website/live-site';
import { DoctorsRepository, type DoctorInput } from './doctors.repository';
import { toScheduleRows, type DoctorScheduleInput } from './schedule';

const notFound = () => Err.notFound('doctor_not_found', 'Doctor not found');

@Injectable()
export class DoctorsService {
  constructor(
    private readonly db: TenantDb,
    private readonly repo: DoctorsRepository,
    private readonly site: LiveSiteWrite,
    private readonly plan: PlanLimits,
    private readonly media: MediaService,
  ) {}

  /** The photo goes out with short-lived signed links (it may not be public yet). */
  private present<T extends { photo: StoredImage | null }>(d: T) {
    return { ...d, photo: this.media.present(d.photo) };
  }

  async list() {
    return (await this.db.run((tx) => this.repo.list(tx))).map((d) => this.present(d));
  }

  async get(id: string) {
    const d = await this.db.run((tx) => this.repo.get(tx, id));
    if (!d) throw notFound();
    return this.present(d);
  }

  create(input: DoctorInput & { branchIds?: string[] }) {
    const { branchIds = [], ...doctor } = input;
    return this.site.run(async (tx, tenantId) => {
      await this.plan.assertCanAdd(tx, tenantId, 'doctors', () => this.repo.countActive(tx));
      await this.assertBranches(tx, branchIds);
      await this.media.replace(tx, 'image', doctor.photoFileId, null);
      const { id } = await this.repo.create(tx, tenantId, doctor);
      if (branchIds.length) await this.repo.replaceBranches(tx, tenantId, id, branchIds);
      return this.present((await this.repo.get(tx, id))!);
    });
  }

  async update(id: string, input: DoctorInput & { branchIds?: string[] }) {
    const { branchIds, ...doctor } = input;
    let released: string | null = null;
    const result = await this.site.run(async (tx, tenantId) => {
      const current = await this.repo.lock(tx, id);
      if (!current) throw notFound();
      released = await this.media.replace(tx, 'image', doctor.photoFileId, current.photo_file_id);
      // reactivating takes a seat again: checked against the plan like a create
      if (doctor.isActive === true && !current.is_active) await this.plan.assertCanAdd(tx, tenantId, 'doctors', () => this.repo.countActive(tx));
      if (!(await this.repo.update(tx, id, doctor))) throw notFound();
      if (branchIds) {
        await this.assertBranches(tx, branchIds);
        await this.repo.replaceBranches(tx, tenantId, id, branchIds);
      }
      return { tenantId, doctor: (await this.repo.get(tx, id))! };
    });
    if (released) await this.media.deleteIfUnused(result.tenantId, released); // the previous photo, after the commit
    return this.present(result.doctor);
  }

  /** The schedule may only use branches the doctor is assigned to. */
  replaceSchedule(id: string, week: DoctorScheduleInput) {
    return this.site.run(async (tx, tenantId) => {
      if (!(await this.repo.lock(tx, id))) throw notFound();
      const doctor = await this.repo.get(tx, id);
      const allowed = new Set(doctor?.branch_ids ?? []);
      const rows = toScheduleRows(week);
      const bad = rows.find((r) => !allowed.has(r.branch_id));
      if (bad) throw Err.badRequest('branch_not_assigned', 'The doctor does not work at one of these branches; assign the branch first');
      await this.repo.replaceSchedule(tx, tenantId, id, rows);
      return this.present((await this.repo.get(tx, id))!);
    });
  }

  private async assertBranches(tx: Tx, ids: string[]) {
    const found = await this.repo.existingBranchIds(tx, ids);
    if (ids.some((b) => !found.has(b))) throw Err.badRequest('branch_not_found', 'One of the branches does not exist');
  }
}

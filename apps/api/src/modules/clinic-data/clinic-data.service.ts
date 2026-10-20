import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { ClsService } from 'nestjs-cls';
import { DATA_POLICY } from '../../config';
import { AuditLog } from '../../shared/audit/audit-log';
import type { RequestContext } from '../../shared/context/request-context';
import { TenantDb } from '../../shared/database/tenant-db.service';
import { Err } from '../../shared/errors/app-error';
import { maskEmail } from '../../shared/mask';
import { EMAIL_SENDER, type EmailSender } from '../../shared/notifications/ports';
import { OBJECT_STORAGE, type ObjectStorage } from '../../shared/storage/ports';
import { Accounts } from '../identity/accounts.service';
import { ClinicDataRepository, type ExportView } from './clinic-data.repository';
import { EXPORT_FILE_SIGNER, type ExportFileSigner } from './export-files';

const ownerOnly = () => Err.forbidden('owner_only', 'Only the clinic owner can do this');
const linkExpired = () => Err.forbidden('link_expired', 'This link expired or is not valid');

/** The typed name matches the clinic's Arabic or English name or its address, ignoring case and extra spaces. */
export function confirmsClinic(typed: string, clinic: { name_ar: string | null; name_en: string | null; slug: string }): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  const t = norm(typed);
  return t.length > 0 && [clinic.name_ar, clinic.name_en, clinic.slug].some((n) => !!n && norm(n) === t);
}

/**
 * The clinic's data (H8, NFR-08; owner 2026-10-20), for the clinic owner only: export everything (a ZIP the worker
 * builds; downloaded through a 5-minute signed link) and delete the clinic (closed at once, erased after 90 days unless
 * the platform restores it). Both ask for the owner's password again.
 */
@Injectable()
export class ClinicDataService {
  private readonly logger = new Logger(ClinicDataService.name);

  constructor(
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(EXPORT_FILE_SIGNER) private readonly signer: ExportFileSigner,
    private readonly db: TenantDb,
    private readonly repo: ClinicDataRepository,
    private readonly accounts: Accounts,
    private readonly audit: AuditLog,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  private async asOwner<T>(fn: (tx: Parameters<Parameters<TenantDb['run']>[0]>[0], tenantId: string) => Promise<T>): Promise<T> {
    return this.db.run(async (tx, tenantId) => {
      if ((await this.repo.roleOf(tx, this.cls.get('memberId')!)) !== 'owner') throw ownerOnly();
      return fn(tx, tenantId);
    });
  }

  /** The password again: an export carries every patient record, a deletion closes the clinic. */
  private async recheckPassword(password: string): Promise<{ userId: string; email: string }> {
    const userId = this.cls.get('userId')!;
    const email = await this.repo.userEmail(userId);
    if (!email) throw Err.unauthorized('invalid_credentials', 'Email or password is not correct');
    const { id } = await this.accounts.checkPassword(email, password);
    if (id !== userId) throw Err.unauthorized('invalid_credentials', 'Email or password is not correct');
    return { userId, email };
  }

  exports(): Promise<ExportView[]> {
    return this.asOwner((tx) => this.repo.exports(tx));
  }

  async requestExport(password: string): Promise<ExportView[]> {
    await this.asOwner(async () => undefined); // owner first: a non-owner never reaches the password check
    const { userId } = await this.recheckPassword(password);
    return this.asOwner(async (tx, tenantId) => {
      if ((await this.repo.exportsSince(tx, 24)) >= DATA_POLICY.exportsPerDay) {
        throw Err.tooMany('export_limit', `At most ${DATA_POLICY.exportsPerDay} exports a day`);
      }
      await this.repo.addExport(tx, tenantId, userId); // a second one while one is being prepared: export_in_progress
      await this.audit.record(tx, tenantId, { action: 'clinic.data_export.requested', entityType: 'clinic', entityId: tenantId });
      return this.repo.exports(tx);
    });
  }

  async exportLink(id: string): Promise<{ url: string }> {
    return this.asOwner(async (tx, tenantId) => {
      if (!(await this.repo.readyExport(tx, id))) throw Err.notFound('export_not_ready', 'This export is not ready or has expired');
      return { url: this.signer.url(tenantId, id, this.cls.get('userId')!, DATA_POLICY.linkSeconds) };
    });
  }

  /** The signed link (no session): the export as a ZIP download; the download is audited. */
  async openExport(tenantId: string, id: string, userId: string, exp: number, sig: string): Promise<{ body: Readable; length: number; name: string }> {
    if (!this.signer.verify(tenantId, id, userId, exp, sig)) throw linkExpired();
    const { row, clinic } = await this.db.runAs(tenantId, async (tx) => {
      const r = await this.repo.readyExport(tx, id);
      if (r) await this.audit.record(tx, tenantId, { action: 'clinic.data_export.downloaded', entityType: 'clinic', entityId: tenantId });
      return { row: r, clinic: r ? await this.repo.clinic(tx, tenantId) : null };
    }, { userId, actorType: 'member' });
    if (!row?.object_key || !clinic) throw Err.notFound('export_not_ready', 'This export is not ready or has expired');
    const obj = await this.storage.get(row.object_key);
    if (!obj) throw Err.notFound('export_not_ready', 'This export is not ready or has expired');
    return { body: obj.body, length: obj.length, name: `clinic-data-${clinic.slug}-${row.created_at.toISOString().slice(0, 10)}.zip` };
  }

  /**
   * The owner deletes the clinic: password and the clinic's name typed again. Closed at once for everyone (sessions end
   * at their next request, the website goes offline); erased after 90 days unless the platform restores it.
   */
  async deleteClinic(password: string, confirmName: string): Promise<{ deleteAfter: Date }> {
    const clinic = await this.asOwner((tx, tenantId) => this.repo.clinic(tx, tenantId));
    if (!confirmsClinic(confirmName, clinic)) throw Err.badRequest('confirm_name_mismatch', 'Type the clinic name exactly as it is');
    const { userId, email } = await this.recheckPassword(password);
    const deleteAfter = await this.repo.requestDeletion(userId, this.cls.get('tenantId')!);
    const until = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { dateStyle: 'long', timeZone: 'Africa/Cairo' }).format(deleteAfter);
    const name = clinic.name_ar ?? clinic.name_en ?? clinic.slug;
    try {
      await this.email.send(email, DATA_POLICY.deletionSubject,
        `أُغلقت عيادة «${name}» بناءً على طلبك: لا يستطيع أحد من فريقها الدخول، وموقعها الإلكتروني متوقف.\n\n`
        + `ستُمحى كل بياناتها وملفاتها نهائيًا في ${until}. حتى ذلك اليوم يمكن استعادتها كما هي: تواصل مع إدارة المنصة.\n\n`
        + 'إذا لم تطلب ذلك فتواصل مع إدارة المنصة فورًا.');
    } catch (err) {
      this.logger.error(`Deletion email to ${maskEmail(email)} failed: ${(err as Error).message}`);
    }
    return { deleteAfter };
  }
}

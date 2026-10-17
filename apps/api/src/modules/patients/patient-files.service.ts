import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { createHash, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { hasPermission } from '../../auth/permissions';
import { APP_CONFIG, CLINICAL_FILE_POLICY, type AppConfig, type ClinicalFileKind } from '../../config';
import { AuditLog } from '../../shared/audit/audit-log';
import type { RequestContext } from '../../shared/context/request-context';
import { TenantDb } from '../../shared/database/tenant-db.service';
import { Err } from '../../shared/errors/app-error';
import { PlanLimits } from '../../shared/plans/plan-limits.service';
import { OBJECT_STORAGE, type ObjectStorage } from '../../shared/storage/ports';
import { CLINICAL_FILE_SIGNER, ClinicalFileSigner, clinicalKey, sniff } from './clinical-files';
import { PatientFilesRepository, type PatientFileRow } from './patient-files.repository';
import { PatientsRepository } from './patients.repository';

export interface PatientFileView extends PatientFileRow { url: string }

const notFound = () => Err.notFound('file_not_found', 'File not found');
const linkExpired = () => Err.forbidden('link_expired', 'This link expired or is not valid');

/**
 * A patient's X-rays, clinical photos and documents (SRS PATIENT-004, NFR-03). Bytes are checked (PDF, JPEG, PNG, WebP
 * only), stored as uploaded, private. Members with clinical:read get 5-minute links bound to them; every opening is
 * audited as theirs. Files are never deleted: archived with a reason.
 */
@Injectable()
export class PatientFilesService {
  private readonly logger = new Logger('PatientFiles');

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(CLINICAL_FILE_SIGNER) private readonly signer: ClinicalFileSigner,
    private readonly db: TenantDb,
    private readonly repo: PatientFilesRepository,
    private readonly patients: PatientsRepository,
    private readonly audit: AuditLog,
    private readonly plan: PlanLimits,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  private assertClinicalRead() {
    const perms = this.cls.get('permissions');
    if (!hasPermission(perms, 'clinical:read') && !hasPermission(perms, 'clinical:write')) throw Err.forbidden('missing_permission', 'Missing permission: clinical:read');
  }

  private view(tenantId: string, r: PatientFileRow): PatientFileView {
    return { ...r, url: this.signer.url(tenantId, r.file_id, this.cls.get('userId')!, CLINICAL_FILE_POLICY.linkSeconds) };
  }

  async upload(patientId: string, buf: Buffer, meta: { kind: ClinicalFileKind; caption: string | null; takenAt: string | null }): Promise<PatientFileView> {
    if (!buf.length) throw Err.badRequest('file_required', 'Choose a file to upload');
    const type = sniff(buf);
    if (!type) throw Err.badRequest('unsupported_file_type', 'Upload a PDF, JPEG, PNG or WebP file');
    const tenantId = this.cls.get('tenantId');
    if (!tenantId) throw Err.forbidden('no_clinic', 'No clinic selected for this request');
    const id = randomUUID();
    const key = clinicalKey(tenantId, id);
    await this.storage.put(key, buf, type.mime); // object first, row second: a row never points at a missing object
    try {
      return await this.db.run(async (tx) => {
        if (!(await this.patients.exists(tx, tenantId, patientId))) throw Err.notFound('patient_not_found', 'Patient not found');
        await this.plan.assertStorage(tx, tenantId, buf.length, () => this.repo.usedBytes(tx));
        await this.repo.insert(tx, {
          id, tenantId, patientId, bucket: this.cfg.STORAGE_DRIVER === 's3' ? this.cfg.S3_BUCKET : 'local', objectKey: key, mime: type.mime, size: buf.length,
          kind: meta.kind, sha256: createHash('sha256').update(buf).digest('hex'), uploadedBy: this.cls.get('memberId') ?? null,
          caption: meta.caption, takenAt: meta.takenAt,
        });
        await this.audit.record(tx, tenantId, { action: 'patient_file.create', entityType: 'patient', entityId: patientId, changes: { file_id: id, kind: meta.kind } });
        const row = (await this.repo.list(tx, patientId, false)).find((r) => r.file_id === id)!;
        return this.view(tenantId, row);
      });
    } catch (e) {
      await this.storage.deleteMany([key]).catch((err) => this.logger.error(`orphaned object ${key}: ${(err as Error).message}`));
      throw e;
    }
  }

  list(patientId: string, archived: boolean): Promise<PatientFileView[]> {
    this.assertClinicalRead();
    return this.db.run(async (tx, tenantId) => {
      if (!(await this.patients.exists(tx, tenantId, patientId))) throw Err.notFound('patient_not_found', 'Patient not found');
      return (await this.repo.list(tx, patientId, archived)).map((r) => this.view(tenantId, r));
    });
  }

  archive(patientId: string, fileId: string, reason: string): Promise<void> {
    return this.db.run(async (tx, tenantId) => {
      if (!(await this.repo.archive(tx, patientId, fileId, reason, this.cls.get('memberId') ?? null))) throw notFound();
      await this.audit.record(tx, tenantId, { action: 'patient_file.archive', entityType: 'patient', entityId: patientId, changes: { file_id: fileId, reason: true } });
    });
  }

  /** The signed link: no session, the signature is the permission; the opening is audited as the signing user's. */
  async open(tenantId: string, fileId: string, userId: string, exp: number, sig: string, ip: string | null): Promise<{ body: Readable; length: number; mime: string; name: string }> {
    if (!this.signer.verify(tenantId, fileId, userId, exp, sig)) throw linkExpired();
    const f = await this.db.runAs(tenantId, async (tx) => {
      const row = await this.repo.find(tx, fileId);
      if (row) await this.repo.recordView(tx, tenantId, userId, row.patient_id, fileId, ip);
      return row;
    }, { userId, actorType: 'member' });
    if (!f) throw notFound();
    const obj = await this.storage.get(f.object_key);
    if (!obj) throw notFound();
    const ext = f.mime_type === 'application/pdf' ? 'pdf' : f.mime_type.split('/')[1];
    return { body: obj.body, length: obj.length, mime: f.mime_type, name: `${f.kind}-${f.id.slice(0, 8)}.${ext}` };
  }
}

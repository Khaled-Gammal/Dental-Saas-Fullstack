import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { ClsService } from 'nestjs-cls';
import { hasPermission } from '../../auth/permissions';
import { APP_CONFIG, CONSENT_POLICY, type AppConfig } from '../../config';
import { AuditLog } from '../../shared/audit/audit-log';
import type { RequestContext } from '../../shared/context/request-context';
import { TenantDb } from '../../shared/database/tenant-db.service';
import { Err } from '../../shared/errors/app-error';
import { PlanLimits } from '../../shared/plans/plan-limits.service';
import { sniff } from '../../shared/storage/private-files';
import { OBJECT_STORAGE, type ObjectStorage } from '../../shared/storage/ports';
import { PatientDirectory } from '../patients';
import { CONSENT_FILE_SIGNER, ConsentFileSigner, consentKey, newConsentKey, signaturePng } from './consent-files';
import { ConsentsRepository, type ConsentRow } from './consents.repository';

export interface SignInput { templateKey: string; signerName: string; signerRelation: string; visitId?: string | null }

const templateNotFound = () => Err.notFound('consent_not_found', 'No such consent text');
const consentNotFound = () => Err.notFound('consent_record_not_found', 'Consent not found');
const linkExpired = () => Err.forbidden('link_expired', 'This link expired or is not valid');
/** Signing is done at reception or in the treatment room: patients:write, or recording treatment. */
const SIGNERS = ['patients:write', 'clinical:write', 'treatments:write:own'];

/**
 * Patient consents (H9, DSH-16; owner 2026-10-20). The clinic's texts (settings:write manages them; every save is a new
 * reviewed version; starter drafts are signed only once reviewed), and the consents signed by a patient or guardian:
 * drawn on screen or recorded on paper with a scan. The database copies the text signed; a consent is never changed or
 * deleted, only withdrawn with a reason.
 */
@Injectable()
export class ConsentsService {
  private readonly logger = new Logger('Consents');

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(CONSENT_FILE_SIGNER) private readonly signer: ConsentFileSigner,
    private readonly db: TenantDb,
    private readonly repo: ConsentsRepository,
    private readonly patients: PatientDirectory,
    private readonly audit: AuditLog,
    private readonly plan: PlanLimits,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  private assertSigner() {
    const perms = this.cls.get('permissions');
    if (!SIGNERS.some((p) => hasPermission(perms, p))) throw Err.forbidden('missing_permission', 'Missing permission: patients:write');
  }

  private withUrl<T extends { file_id: string }>(tenantId: string, r: T) {
    return { ...r, file_url: this.signer.url(tenantId, r.file_id, this.cls.get('userId')!, CONSENT_POLICY.linkSeconds) };
  }

  // ---------- texts ----------
  templates() {
    return this.db.run((tx) => this.repo.current(tx));
  }

  async template(key: string) {
    const versions = await this.db.run((tx) => this.repo.versions(tx, key));
    if (!versions.length) throw templateNotFound();
    return { key, current: versions[0], versions };
  }

  /** A new text, or a new version of one: saved as reviewed by this member (the editor asks them to confirm it). */
  async saveTemplate(key: string | null, titleAr: string, bodyAr: string) {
    const saved = await this.db.run(async (tx, tenantId) => {
      const k = key ?? newConsentKey();
      const latest = await this.repo.latestForUpdate(tx, k);
      if (key && !latest) throw templateNotFound();
      if (latest && !latest.is_active) throw Err.conflict('consent_archived', 'This consent text is archived; restore it first');
      await this.repo.addVersion(tx, tenantId, { key: k, version: (latest?.version ?? 0) + 1, titleAr, bodyAr, memberId: this.cls.get('memberId')! });
      return k;
    });
    return this.template(saved);
  }

  async setActive(key: string, active: boolean) {
    await this.db.run(async (tx) => { if (!(await this.repo.setActive(tx, key, active))) throw templateNotFound(); });
    return this.template(key);
  }

  // ---------- signed consents ----------
  list(patientId: string) {
    return this.db.run(async (tx, tenantId) => {
      if (!(await this.patients.exists(tx, tenantId, patientId))) throw Err.notFound('patient_not_found', 'Patient not found');
      return (await this.repo.list(tx, patientId)).map((r: ConsentRow) => this.withUrl(tenantId, r));
    });
  }

  /** One consent with the exact text signed (the opening is audited, as a patient record view). */
  get(patientId: string, id: string) {
    return this.db.run(async (tx, tenantId) => {
      const c = await this.repo.get(tx, patientId, id);
      if (!c) throw consentNotFound();
      await this.audit.recordView(tx, tenantId, 'patient_consent', id);
      return this.withUrl(tenantId, c);
    });
  }

  /** Drawn on screen: the signature is a PNG from the dashboard's signature pad. */
  signOnScreen(patientId: string, input: SignInput & { signature: string }, ip: string | null) {
    this.assertSigner();
    const png = signaturePng(input.signature);
    if (!png) throw Err.badRequest('signature_required', 'Sign in the box first');
    if (png.length > CONSENT_POLICY.maxSignatureBytes) throw Err.badRequest('file_too_large', 'The signature image is too large');
    return this.record(patientId, input, 'screen', png, 'image/png', ip);
  }

  /** On paper: a photo or scan of the signed form (PDF, JPEG, PNG or WebP). */
  signOnPaper(patientId: string, input: SignInput, buf: Buffer, ip: string | null) {
    this.assertSigner();
    if (!buf.length) throw Err.badRequest('file_required', 'Attach a photo or scan of the signed form');
    const type = sniff(buf);
    if (!type) throw Err.badRequest('unsupported_file_type', 'Upload a PDF, JPEG, PNG or WebP file');
    return this.record(patientId, input, 'paper', buf, type.mime, ip);
  }

  private async record(patientId: string, input: SignInput, method: 'screen' | 'paper', buf: Buffer, mime: string, ip: string | null) {
    const tenantId = this.cls.get('tenantId');
    if (!tenantId) throw Err.forbidden('no_clinic', 'No clinic selected for this request');
    const fileId = randomUUID();
    const key = consentKey(tenantId, fileId);
    await this.storage.put(key, buf, mime); // object first, row second: a row never points at a missing object
    try {
      return await this.db.run(async (tx) => {
        if (!(await this.patients.exists(tx, tenantId, patientId))) throw Err.notFound('patient_not_found', 'Patient not found');
        const template = await this.repo.latestForUpdate(tx, input.templateKey);
        if (!template) throw templateNotFound();
        await this.plan.assertStorage(tx, tenantId, buf.length, () => this.repo.usedBytes(tx));
        await this.repo.insertFile(tx, {
          id: fileId, tenantId, bucket: this.cfg.STORAGE_DRIVER === 's3' ? this.cfg.S3_BUCKET : 'local', objectKey: key, mime, size: buf.length,
          sha256: createHash('sha256').update(buf).digest('hex'), uploadedBy: this.cls.get('memberId') ?? null,
        });
        // drafts, archived or outdated texts are refused by the database (patient_consents_guard)
        const id = await this.repo.insertConsent(tx, {
          tenantId, patientId, templateId: template.id, visitId: input.visitId ?? null, signerName: input.signerName.trim(),
          signerRelation: input.signerRelation, method, fileId, recordedBy: this.cls.get('memberId') ?? null, ip,
        });
        await this.audit.record(tx, tenantId, { action: 'patient_consent.sign', entityType: 'patient', entityId: patientId,
          changes: { consent_id: id, key: input.templateKey, method } });
        return this.withUrl(tenantId, (await this.repo.get(tx, patientId, id))!);
      });
    } catch (e) {
      await this.storage.deleteMany([key]).catch((err) => this.logger.error(`orphaned object ${key}: ${(err as Error).message}`));
      throw e;
    }
  }

  revoke(patientId: string, id: string, reason: string) {
    this.assertSigner();
    return this.db.run(async (tx, tenantId) => {
      if (!(await this.repo.revoke(tx, patientId, id, this.cls.get('memberId')!, reason.trim()))) {
        if (await this.repo.get(tx, patientId, id)) throw Err.conflict('consent_revoked', 'This consent is already withdrawn');
        throw consentNotFound();
      }
      await this.audit.record(tx, tenantId, { action: 'patient_consent.revoke', entityType: 'patient', entityId: patientId, changes: { consent_id: id, reason: true } });
      return this.withUrl(tenantId, (await this.repo.get(tx, patientId, id))!);
    });
  }

  /** The signed link (no session): the signature or scan of one consent; the opening is audited as the user's view. */
  async openFile(tenantId: string, fileId: string, userId: string, exp: number, sig: string): Promise<{ body: Readable; length: number; mime: string; name: string }> {
    if (!this.signer.verify(tenantId, fileId, userId, exp, sig)) throw linkExpired();
    const f = await this.db.runAs(tenantId, async (tx) => {
      const row = await this.repo.fileOfConsent(tx, fileId);
      if (row) await this.audit.recordView(tx, tenantId, 'patient_consent', row.consent_id);
      return row;
    }, { userId, actorType: 'member' });
    if (!f) throw Err.notFound('file_not_found', 'File not found');
    const obj = await this.storage.get(f.object_key);
    if (!obj) throw Err.notFound('file_not_found', 'File not found');
    const ext = f.mime_type === 'application/pdf' ? 'pdf' : f.mime_type.split('/')[1];
    return { body: obj.body, length: obj.length, mime: f.mime_type, name: `consent-${f.consent_id.slice(0, 8)}.${ext}` };
  }
}

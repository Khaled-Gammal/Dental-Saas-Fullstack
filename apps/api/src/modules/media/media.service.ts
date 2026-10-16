import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { Tx } from '@dental/db';
import { APP_CONFIG, MEDIA_POLICY, type AppConfig, type MediaKind, type MediaPurpose } from '../../config';
import type { RequestContext } from '../../shared/context/request-context';
import { TenantDb } from '../../shared/database/tenant-db.service';
import { Err } from '../../shared/errors/app-error';
import { PlanLimits } from '../../shared/plans/plan-limits.service';
import { OBJECT_STORAGE, type ObjectStorage } from '../../shared/storage/ports';
import { processImage } from './image-pipeline';
import { MediaRepository, type FileRow } from './media.repository';
import { MEDIA_SIGNER, MediaSigner, renditionKey } from './media-urls';
import type { StoredImage } from './stored-image';

/** What the dashboard gets for an image: its shape, the widths that exist, and short-lived links to two of them. */
export interface MediaView { id: string; width: number; height: number; widths: number[]; thumbUrl: string; fullUrl: string }

const notFound = () => Err.notFound('file_not_found', 'Image not found');

/**
 * Uploads and delivery of images (SRS 6.3 `files`, NFR-03). The image is processed before anything is stored;
 * objects are written before the database row, and removed again if the row cannot be written, so a row never
 * points at a missing object. Deleting goes the other way: the row first, the objects after the commit.
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger('Media');

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(MEDIA_SIGNER) private readonly signer: MediaSigner,
    private readonly db: TenantDb,
    private readonly repo: MediaRepository,
    private readonly plan: PlanLimits,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  view(tenantId: string, f: Pick<FileRow, 'id' | 'width' | 'height' | 'variant_widths'>): MediaView {
    const widths = f.variant_widths;
    const ttl = MEDIA_POLICY.signedUrlSeconds;
    return {
      id: f.id, width: f.width ?? 0, height: f.height ?? 0, widths,
      thumbUrl: this.signer.url(tenantId, f.id, widths[0], ttl),
      fullUrl: this.signer.url(tenantId, f.id, widths[widths.length - 1], ttl),
    };
  }

  /** An image embedded in another module's row (`imageJson`), with signed links for the dashboard. */
  present(img: StoredImage | null | undefined): MediaView | null {
    const tenantId = this.cls.get('tenantId');
    if (!img || !tenantId || !img.widths?.length) return null;
    return this.view(tenantId, { id: img.id, width: img.width, height: img.height, variant_widths: img.widths });
  }

  async upload(input: Buffer, purpose: MediaPurpose = 'gallery'): Promise<MediaView> {
    const rules = MEDIA_POLICY.purposes[purpose];
    const img = await processImage(input, rules); // throws invalid_image / unsupported_image_type / image_too_small
    const tenantId = this.cls.get('tenantId');
    if (!tenantId) throw Err.forbidden('no_clinic', 'No clinic selected for this request');
    const id = randomUUID();
    const size = img.renditions.reduce((n, r) => n + r.body.length, 0);
    const keys = img.renditions.map((r) => renditionKey(tenantId, id, r.width));
    await Promise.all(img.renditions.map((r, i) => this.storage.put(keys[i], r.body, 'image/webp')));
    try {
      return await this.db.run(async (tx) => {
        await this.plan.assertStorage(tx, tenantId, size, () => this.repo.usedBytes(tx, tenantId));
        const widths = img.renditions.map((r) => r.width);
        await this.repo.insert(tx, {
          id, tenantId, kind: rules.kind, bucket: this.cfg.STORAGE_DRIVER === 's3' ? this.cfg.S3_BUCKET : 'local', objectKey: `t/${tenantId}/${id}`,
          sizeBytes: size, width: img.width, height: img.height, widths, uploadedBy: this.cls.get('memberId') ?? null,
        });
        return this.view(tenantId, { id, width: img.width, height: img.height, variant_widths: widths });
      });
    } catch (e) {
      await this.storage.deleteMany(keys).catch((err) => this.logger.error(`orphaned objects for ${id}: ${(err as Error).message}`));
      throw e;
    }
  }

  /**
   * An uploaded image of this clinic, of the kind the content needs (a gallery photo, a logo, a doctor/service/branch
   * photo), that may be attached. Another clinic's file looks missing (RLS).
   */
  async assertAttachable(tx: Tx, fileId: string, kind: MediaKind = 'gallery'): Promise<FileRow> {
    const f = await this.repo.get(tx, fileId);
    if (!f || !f.variant_widths.length) throw Err.badRequest('file_not_found', 'Upload the image first');
    if (f.kind !== kind) throw Err.badRequest('wrong_image_kind', 'This image was uploaded for something else; upload it again here', { expected: kind });
    return f;
  }

  /**
   * Validates a change of a record's single image inside the caller's transaction. Returns the image that was let go
   * of (to pass to `deleteIfUnused` after the commit), or null.
   */
  async replace(tx: Tx, kind: MediaKind, next: string | null | undefined, current: string | null): Promise<string | null> {
    if (next === undefined || next === current) return null;
    if (next) await this.assertAttachable(tx, next, kind);
    return current;
  }

  refreshVisibility(tx: Tx, ids: string[]) {
    return this.repo.refreshVisibility(tx, ids);
  }

  /** After content let go of a file: remove it if nothing else uses it. Best effort; never fails the caller. */
  async deleteIfUnused(tenantId: string, fileId: string): Promise<void> {
    try {
      const gone = await this.db.runAs(tenantId, (tx) => this.repo.deleteUnreferenced(tx, fileId));
      if (gone) await this.storage.deleteMany(gone.variant_widths.map((w) => renditionKey(tenantId, fileId, w)));
    } catch (e) {
      this.logger.warn(`file ${fileId} kept: ${(e as Error).message}`); // e.g. still referenced elsewhere (foreign key)
    }
  }

  /** A rendition for a signed dashboard link: the signature is the authorisation, the row must still exist. */
  async openSigned(tenantId: string, fileId: string, width: number, exp: number, sig: string): Promise<{ body: Readable; length: number }> {
    if (!this.signer.verify(tenantId, fileId, width, exp, sig)) throw Err.forbidden('link_expired', 'This image link expired or is not valid');
    const f = await this.db.runAs(tenantId, (tx) => this.repo.get(tx, fileId));
    return this.open(tenantId, f, width);
  }

  /** A rendition of a published image for a clinic website (resolved from the hostname). */
  async openPublic(host: string, fileId: string, width: number): Promise<{ body: Readable; length: number }> {
    const r = await this.db.runForHost(host, async (tx, tenantId) => {
      const f = await this.repo.get(tx, fileId);
      return { tenantId, f: f && (await this.repo.isPublic(tx, fileId)) ? f : undefined };
    });
    if (!r || !r.f) throw notFound();
    return this.open(r.tenantId, r.f, width);
  }

  private async open(tenantId: string, f: FileRow | undefined, width: number) {
    if (!f || !f.variant_widths.includes(width)) throw notFound();
    const obj = await this.storage.get(renditionKey(tenantId, f.id, width));
    if (!obj) throw notFound();
    return { body: obj.body, length: obj.length };
  }
}

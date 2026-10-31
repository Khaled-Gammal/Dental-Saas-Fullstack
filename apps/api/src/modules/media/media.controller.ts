import { Controller, Get, Injectable, Param, Post, Query, Res, StreamableFile, UploadedFile, UseGuards, UseInterceptors, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { ClsService } from 'nestjs-cls';
import { Public } from '../../auth/decorators';
import { hasPermission } from '../../auth/permissions';
import { MEDIA_POLICY, type MediaPurpose } from '../../config';
import type { RequestContext } from '../../shared/context/request-context';
import { Err } from '../../shared/errors/app-error';
import { ZodBody } from '../../shared/validation/zod-body.pipe';
import { isUuid } from './media-urls';
import { MediaService } from './media.service';

const Rendition = z.string().regex(/^\d{2,4}\.webp$/).transform((s) => Number(s.slice(0, -5)));
const SignedQuery = z.object({ exp: z.coerce.number().int(), sig: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/) }).strict();
const UploadQuery = z.object({ purpose: z.enum(['gallery', 'photo', 'logo', 'case', 'share']).default('gallery') }).strict();
/** Gallery photos are website content; logos and doctor/service/branch photos belong to the clinic's setup. */
const UPLOAD_PERMISSION: Record<MediaPurpose, string> = { gallery: 'website:write', photo: 'settings:write', logo: 'settings:write', case: 'website:write', share: 'website:write' };
/** Runs before the upload interceptor reads the body: a member without the permission never uploads anything. */
@Injectable()
class UploadPermissionGuard implements CanActivate {
  constructor(private readonly cls: ClsService<RequestContext>) {}

  canActivate(ctx: ExecutionContext): boolean {
    const raw = ctx.switchToHttp().getRequest<{ query: Record<string, unknown> }>().query.purpose;
    const purpose: MediaPurpose = raw === 'photo' || raw === 'logo' || raw === 'case' || raw === 'share' ? raw : 'gallery'; // anything else fails validation later
    const needed = UPLOAD_PERMISSION[purpose];
    if (!hasPermission(this.cls.get('permissions'), needed)) throw Err.forbidden('missing_permission', `Missing permission: ${needed}`);
    return true;
  }
}

const HostQuery = z.object({ host: z.string().trim().toLowerCase().min(1).max(253).transform((h) => h.split(':')[0].replace(/\.$/, '')) }).strict();

function uuid(v: string) {
  if (!isUuid(v)) throw Err.notFound('file_not_found', 'Image not found');
  return v;
}
function stream(res: Response, file: { body: NodeJS.ReadableStream; length: number }, cacheControl: string) {
  res.set({ 'Content-Type': 'image/webp', 'Content-Length': String(file.length), 'Cache-Control': cacheControl, 'X-Content-Type-Options': 'nosniff' });
  return new StreamableFile(file.body as never);
}

/** Image upload (dashboard) and delivery (dashboard previews by signed link; published images for the websites). */
@ApiTags('media')
@Controller()
export class MediaController {
  constructor(private readonly media: MediaService) {}

  /**
   * One image per request (multipart field `file`), `?purpose=gallery|photo|logo` (default gallery). Size is capped
   * while reading; the content is decoded and checked by the server whatever the file name or declared type says.
   * The permission depends on the purpose (UploadPermissionGuard).
   */
  @Post('media')
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @UseGuards(UploadPermissionGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MEDIA_POLICY.maxUploadBytes, files: 1, fields: 0 } }))
  upload(@Query(new ZodBody(UploadQuery)) q: z.infer<typeof UploadQuery>, @UploadedFile() file: { buffer?: Buffer } | undefined) { // multer's File: only the in-memory bytes are used
    if (!file?.buffer?.length) throw Err.badRequest('file_required', 'Choose an image to upload');
    return this.media.upload(file.buffer, q.purpose);
  }

  /** Signed, short-lived link (dashboard previews of drafts). No session needed: the signature is the permission. */
  @Public()
  @Get('media/:tenantId/:fileId/:rendition')
  async signed(@Param('tenantId') t: string, @Param('fileId') f: string, @Param('rendition', new ZodBody(Rendition)) w: number,
    @Query(new ZodBody(SignedQuery)) q: z.infer<typeof SignedQuery>, @Res({ passthrough: true }) res: Response) {
    const file = await this.media.openSigned(uuid(t), uuid(f), w, q.exp, q.sig);
    return stream(res, file, 'private, max-age=300');
  }

  /**
   * Published images of a clinic website. Cached for an hour in browsers and a day at the edge: an image that is
   * unpublished disappears from the site at once and from caches within that time.
   */
  @Public()
  @Get('public/media/:fileId/:rendition')
  async published(@Param('fileId') f: string, @Param('rendition', new ZodBody(Rendition)) w: number,
    @Query(new ZodBody(HostQuery)) q: z.infer<typeof HostQuery>, @Res({ passthrough: true }) res: Response) {
    const file = await this.media.openPublic(q.host, uuid(f), w);
    return stream(res, file, 'public, max-age=3600, s-maxage=86400');
  }

  /**
   * Phase 2C-3: the image shown when the clinic's site is shared (1200×630 JPEG). The site links it with a version
   * (`?v=`) that changes with the image, so it may be cached long.
   */
  @Public()
  @Get('public/share-image')
  async share(@Query(new ZodBody(HostQuery.extend({ v: z.string().max(80).optional() }).strict())) q: { host: string }, @Res({ passthrough: true }) res: Response) {
    const body = await this.media.shareImageFor(q.host);
    res.set({ 'Content-Type': 'image/jpeg', 'Content-Length': String(body.length), 'Cache-Control': 'public, max-age=3600, s-maxage=86400', 'X-Content-Type-Options': 'nosniff' });
    return new StreamableFile(body);
  }

  /**
   * Phase 2C-2: a published before/after case's images (patient images, published with consent). Never cached: when
   * the consent is withdrawn or the case removed, the next request is refused. Case images are served only here.
   */
  @Public()
  @Get('public/case-media/:fileId/:rendition')
  async caseImage(@Param('fileId') f: string, @Param('rendition', new ZodBody(Rendition)) w: number,
    @Query(new ZodBody(HostQuery)) q: z.infer<typeof HostQuery>, @Res({ passthrough: true }) res: Response) {
    const file = await this.media.openPublic(q.host, uuid(f), w, 'case');
    return stream(res, file, 'no-store');
  }
}

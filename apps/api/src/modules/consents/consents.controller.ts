import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Public, RequirePermission } from '../../auth/decorators';
import { CONSENT_POLICY } from '../../config';
import { ZodBody } from '../../shared/validation/zod-body.pipe';
import { ConsentsService } from './consents.service';

const id = new ParseUUIDPipe();
const Key = z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,39}$/);
const keyPipe = new ZodBody(Key);
const Text = z.object({ titleAr: z.string().trim().min(2).max(150), bodyAr: z.string().trim().min(20).max(20_000) }).strict();
const Active = z.object({ active: z.boolean() }).strict();
const Signer = {
  templateKey: Key,
  signerName: z.string().trim().min(2).max(120),
  signerRelation: z.enum(['self', 'father', 'mother', 'sibling', 'spouse', 'legal_guardian', 'other']),
  visitId: z.string().uuid().nullable().optional(),
};
const OnScreen = z.object({ ...Signer, signature: z.string().max(600_000) }).strict();
// multipart fields arrive as strings: an empty visit is no visit
const OnPaper = z.object({ ...Signer, visitId: z.string().uuid().or(z.literal('').transform(() => null)).optional() }).strict();
const Revoke = z.object({ reason: z.string().trim().min(3).max(300) }).strict();
const SignedQuery = z.object({ u: z.string().uuid(), exp: z.coerce.number().int(), sig: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/) }).strict();

/** The clinic's consent texts (H9): everyone who signs consents reads them; settings:write writes them. */
@ApiTags('consents')
@ApiBearerAuth()
@Controller('consents/templates')
export class ConsentTemplatesController {
  constructor(private readonly consents: ConsentsService) {}

  @Get()
  @RequirePermission('patients:read')
  list() { return this.consents.templates(); }

  @Get(':key')
  @RequirePermission('patients:read')
  get(@Param('key', keyPipe) key: string) { return this.consents.template(key); }

  @Post()
  @RequirePermission('settings:write')
  create(@Body(new ZodBody(Text)) b: z.infer<typeof Text>) { return this.consents.saveTemplate(null, b.titleAr, b.bodyAr); }

  /** A new version (old ones stay: signed consents point at them). */
  @Put(':key')
  @RequirePermission('settings:write')
  save(@Param('key', keyPipe) key: string, @Body(new ZodBody(Text)) b: z.infer<typeof Text>) { return this.consents.saveTemplate(key, b.titleAr, b.bodyAr); }

  @Post(':key/active') @HttpCode(200)
  @RequirePermission('settings:write')
  setActive(@Param('key', keyPipe) key: string, @Body(new ZodBody(Active)) b: z.infer<typeof Active>) { return this.consents.setActive(key, b.active); }
}

/** A patient's signed consents (H9, DSH-16). Reading needs patients:read; signing patients:write or treatment rights. */
@ApiTags('consents')
@ApiBearerAuth()
@Controller('patients/:id/consents')
export class PatientConsentsController {
  constructor(private readonly consents: ConsentsService) {}

  @Get()
  @RequirePermission('patients:read')
  list(@Param('id', id) patientId: string) { return this.consents.list(patientId); }

  @Get(':consentId')
  @RequirePermission('patients:read')
  get(@Param('id', id) patientId: string, @Param('consentId', id) consentId: string) { return this.consents.get(patientId, consentId); }

  /** Signed on the clinic's tablet or phone: `signature` is the pad's PNG as a data URL. */
  @Post()
  @RequirePermission('patients:read')
  sign(@Param('id', id) patientId: string, @Body(new ZodBody(OnScreen)) b: z.infer<typeof OnScreen>, @Req() req: Request) {
    return this.consents.signOnScreen(patientId, b, req.ip ?? null);
  }

  /** Signed on paper: multipart field `file` (photo or scan of the form) plus the signer fields. */
  @Post('paper')
  @RequirePermission('patients:read')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: CONSENT_POLICY.maxPaperBytes, files: 1, fields: 4 } }))
  signOnPaper(@Param('id', id) patientId: string, @Body(new ZodBody(OnPaper)) b: z.infer<typeof OnPaper>, @UploadedFile() file: { buffer?: Buffer } | undefined,
    @Req() req: Request) {
    return this.consents.signOnPaper(patientId, b, file?.buffer ?? Buffer.alloc(0), req.ip ?? null);
  }

  @Post(':consentId/revoke') @HttpCode(200)
  @RequirePermission('patients:read')
  revoke(@Param('id', id) patientId: string, @Param('consentId', id) consentId: string, @Body(new ZodBody(Revoke)) b: z.infer<typeof Revoke>) {
    return this.consents.revoke(patientId, consentId, b.reason);
  }
}

/** A consent's signature or scan through its 5-minute signed link (no session; audited as the member's view). */
@ApiTags('consents')
@Controller('consent-files')
export class ConsentFileLinkController {
  constructor(private readonly consents: ConsentsService) {}

  @Public()
  @Get(':tenantId/:fileId')
  async open(@Param('tenantId', id) tenantId: string, @Param('fileId', id) fileId: string, @Query(new ZodBody(SignedQuery)) q: z.infer<typeof SignedQuery>,
    @Res({ passthrough: true }) res: Response) {
    const f = await this.consents.openFile(tenantId, fileId, q.u, q.exp, q.sig);
    res.set({
      'Content-Type': f.mime, 'Content-Length': String(f.length), 'Content-Disposition': `inline; filename="${f.name}"`,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    });
    return new StreamableFile(f.body as never);
  }
}

import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Public, RequirePermission } from '../../auth/decorators';
import { CLINICAL_FILE_POLICY } from '../../config';
import { ISO_DATE } from '../../shared/time/clinic-time';
import { ZodBody } from '../../shared/validation/zod-body.pipe';
import { PatientFilesService } from './patient-files.service';

const id = new ParseUUIDPipe();
const UploadFields = z.object({
  kind: z.enum(CLINICAL_FILE_POLICY.kinds),
  caption: z.string().trim().max(200).transform((v) => v || null).optional(),
  takenAt: z.string().regex(ISO_DATE, 'YYYY-MM-DD').optional(),
}).strict();
const ListQuery = z.object({ archived: z.enum(['true', 'false']).transform((v) => v === 'true').optional() }).strict();
const ArchiveBody = z.object({ reason: z.string().trim().min(3).max(200) }).strict();
const SignedQuery = z.object({ u: z.string().uuid(), exp: z.coerce.number().int(), sig: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/) }).strict();

/** A patient's X-rays, clinical photos and documents (SRS PATIENT-004). Writing needs clinical:write; reading clinical:read. */
@ApiTags('patients')
@ApiBearerAuth()
@Controller('patients/:id/files')
export class PatientFilesController {
  constructor(private readonly files: PatientFilesService) {}

  /** One file per request (multipart field `file`, plus `kind`, optional `caption` and `takenAt`). The permission is checked before the body is read. */
  @Post()
  @RequirePermission('clinical:write')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: CLINICAL_FILE_POLICY.maxUploadBytes, files: 1, fields: 3 } }))
  upload(@Param('id', id) patientId: string, @Body(new ZodBody(UploadFields)) b: z.infer<typeof UploadFields>, @UploadedFile() file: { buffer?: Buffer } | undefined) {
    return this.files.upload(patientId, file?.buffer ?? Buffer.alloc(0), { kind: b.kind, caption: b.caption ?? null, takenAt: b.takenAt ?? null });
  }

  @Get()
  @RequirePermission('patients:read')
  list(@Param('id', id) patientId: string, @Query(new ZodBody(ListQuery)) q: z.infer<typeof ListQuery>) {
    return this.files.list(patientId, q.archived ?? false);
  }

  @Post(':fileId/archive') @HttpCode(204)
  @RequirePermission('clinical:write')
  archive(@Param('id', id) patientId: string, @Param('fileId', id) fileId: string, @Body(new ZodBody(ArchiveBody)) b: z.infer<typeof ArchiveBody>) {
    return this.files.archive(patientId, fileId, b.reason);
  }
}

/** The 5-minute signed link (no session; the signature is bound to the member and audited as their view). */
@ApiTags('patients')
@Controller('clinical-files')
export class ClinicalFileLinkController {
  constructor(private readonly files: PatientFilesService) {}

  @Public()
  @Get(':tenantId/:fileId')
  async open(@Param('tenantId', id) tenantId: string, @Param('fileId', id) fileId: string, @Query(new ZodBody(SignedQuery)) q: z.infer<typeof SignedQuery>,
    @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const f = await this.files.open(tenantId, fileId, q.u, q.exp, q.sig, req.ip ?? null);
    res.set({
      'Content-Type': f.mime, 'Content-Length': String(f.length), 'Content-Disposition': `inline; filename="${f.name}"`,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    });
    return new StreamableFile(f.body as never);
  }
}

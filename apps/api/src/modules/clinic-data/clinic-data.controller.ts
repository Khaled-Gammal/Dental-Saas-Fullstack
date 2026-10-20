import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { Public } from '../../auth/decorators';
import { ZodBody } from '../../shared/validation/zod-body.pipe';
import { ClinicDataService } from './clinic-data.service';

const id = new ParseUUIDPipe();
const Password = z.object({ password: z.string().min(1).max(128) }).strict();
const DeleteClinic = z.object({ password: z.string().min(1).max(128), confirmName: z.string().trim().min(1).max(200) }).strict();
const SignedQuery = z.object({ u: z.string().uuid(), exp: z.coerce.number().int(), sig: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/) }).strict();

/** The clinic's data (H8, NFR-08): export and deletion, for the clinic owner only. */
@ApiTags('clinic-data')
@ApiBearerAuth()
@Controller('clinic/data')
export class ClinicDataController {
  constructor(private readonly data: ClinicDataService) {}

  @Get('exports')
  exports() { return this.data.exports(); }

  @Post('exports')
  requestExport(@Body(new ZodBody(Password)) b: z.infer<typeof Password>) { return this.data.requestExport(b.password); }

  @Post('exports/:id/link') @HttpCode(200)
  link(@Param('id', id) exportId: string) { return this.data.exportLink(exportId); }

  @Post('delete') @HttpCode(200)
  deleteClinic(@Body(new ZodBody(DeleteClinic)) b: z.infer<typeof DeleteClinic>) { return this.data.deleteClinic(b.password, b.confirmName); }
}

/** An export's 5-minute signed download link (no session; the signature is bound to the owner who asked for it). */
@ApiTags('clinic-data')
@Controller('data-exports')
export class ExportDownloadController {
  constructor(private readonly data: ClinicDataService) {}

  @Public()
  @Get(':tenantId/:exportId')
  async open(@Param('tenantId', id) tenantId: string, @Param('exportId', id) exportId: string, @Query(new ZodBody(SignedQuery)) q: z.infer<typeof SignedQuery>,
    @Res({ passthrough: true }) res: Response) {
    const f = await this.data.openExport(tenantId, exportId, q.u, q.exp, q.sig);
    res.set({
      'Content-Type': 'application/zip', 'Content-Length': String(f.length), 'Content-Disposition': `attachment; filename="${f.name}"`,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    });
    return new StreamableFile(f.body as never);
  }
}

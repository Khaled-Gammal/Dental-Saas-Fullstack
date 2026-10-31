import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { Public, RequirePermission } from '../../auth/decorators';
import { ZodBody } from '../../shared/validation/zod-body.pipe';
import { GalleryService } from './gallery.service';
import { CreateGalleryItem, ListGalleryQuery, PublicGalleryQuery, ReorderGallery, UpdateGalleryItem } from './gallery.schemas';
import { CaseOrder, EditCase, NewCase } from './cases.schemas';
import { CasesService } from './cases.service';

const id = new ParseUUIDPipe();

/**
 * Phase 2C-2: before/after cases (dashboard). Registered before GalleryController so `/gallery/cases` is never read as
 * a photo id. Website content is the owner's (`website:write`).
 */
@ApiTags('gallery')
@ApiBearerAuth()
@Controller('gallery/cases')
@RequirePermission('website:write')
export class CasesController {
  constructor(private readonly cases: CasesService) {}

  @Get()
  list() { return this.cases.list(); }

  @Post()
  create(@Body(new ZodBody(NewCase)) b: z.infer<typeof NewCase>) { return this.cases.create(b); }

  @Put('order')
  reorder(@Body(new ZodBody(CaseOrder)) b: z.infer<typeof CaseOrder>) { return this.cases.reorder(b.ids); }

  @Patch(':id')
  update(@Param('id', id) caseId: string, @Body(new ZodBody(EditCase)) b: z.infer<typeof EditCase>) { return this.cases.update(caseId, b); }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', id) caseId: string) { return this.cases.remove(caseId); }
}

/** Gallery management (dashboard). Website content is the owner's (`website:write`, SRS 2.2). */
@ApiTags('gallery')
@ApiBearerAuth()
@Controller('gallery')
@RequirePermission('website:write')
export class GalleryController {
  constructor(private readonly gallery: GalleryService) {}

  @Get()
  list(@Query(new ZodBody(ListGalleryQuery)) q: z.infer<typeof ListGalleryQuery>) {
    return this.gallery.list(q);
  }

  /** Declared before ':id' so "order" is never read as an id. */
  @Put('order')
  reorder(@Body(new ZodBody(ReorderGallery)) b: z.infer<typeof ReorderGallery>) {
    return this.gallery.reorder(b.branchId, b.ids);
  }

  @Get(':id')
  get(@Param('id', id) itemId: string) {
    return this.gallery.get(itemId);
  }

  @Post()
  create(@Body(new ZodBody(CreateGalleryItem)) b: z.infer<typeof CreateGalleryItem>) {
    return this.gallery.create(b);
  }

  @Patch(':id')
  update(@Param('id', id) itemId: string, @Body(new ZodBody(UpdateGalleryItem)) b: z.infer<typeof UpdateGalleryItem>) {
    return this.gallery.update(itemId, b);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', id) itemId: string) {
    return this.gallery.remove(itemId);
  }
}

/** Published photos for a clinic website. Cached like the rest of the public site data. */
@ApiTags('public')
@Public()
@Controller('public/gallery')
export class PublicGalleryController {
  constructor(private readonly gallery: GalleryService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300')
  list(@Query(new ZodBody(PublicGalleryQuery)) q: z.infer<typeof PublicGalleryQuery>) {
    return this.gallery.publicList(q.host, q.scope);
  }
}

import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermission } from '../../auth/decorators';
import { ZodBody } from '../../shared/validation/zod-body.pipe';
import { EditFaq, FaqOrder, NewFaq, Sections, Seo } from './faqs.schemas';
import { FaqsService } from './faqs.service';
import { WebsiteService } from './website.service';

const WebsiteSettings = z.object({ showPoweredBy: z.boolean() }).strict();

@ApiTags('clinic')
@ApiBearerAuth()
@Controller('clinic/website')
export class WebsiteController {
  constructor(private readonly website: WebsiteService) {}

  @Get()
  status() {
    return this.website.status();
  }

  /** Makes the draft (theme, and later pages) the live website. */
  @Post('publish')
  @HttpCode(200)
  @RequirePermission('settings:write')
  publish() {
    return this.website.publish();
  }

  /** Phase 1D (WEB-10): the platform badge on the clinic's site; hiding it needs a plan that includes it. */
  @Patch()
  @RequirePermission('website:write')
  update(@Body(new ZodBody(WebsiteSettings)) b: z.infer<typeof WebsiteSettings>) {
    return this.website.setPoweredBy(b.showPoweredBy);
  }

  /** Phase 2C-1: the order of the website's sections and which are shown (live at once). */
  @Put('sections')
  @RequirePermission('website:write')
  setSections(@Body(new ZodBody(Sections)) b: z.infer<typeof Sections>) {
    return this.website.setSections(b.sections);
  }

  /** Phase 2C-3: the search title and description and the share image (live at once). */
  @Put('seo')
  @RequirePermission('website:write')
  setSeo(@Body(new ZodBody(Seo)) b: z.infer<typeof Seo>) {
    return this.website.setSeo(b);
  }
}

const id = new ParseUUIDPipe();

/** Phase 2C-1: the clinic's questions and answers on its website (website content is the owner's, `website:write`). */
@ApiTags('clinic')
@ApiBearerAuth()
@Controller('clinic/website/faqs')
@RequirePermission('website:write')
export class FaqsController {
  constructor(private readonly faqs: FaqsService) {}

  @Get()
  list() { return this.faqs.list(); }

  @Post()
  create(@Body(new ZodBody(NewFaq)) b: z.infer<typeof NewFaq>) { return this.faqs.create(b); }

  /** Declared before ':id' so "order" is never read as an id. */
  @Put('order')
  reorder(@Body(new ZodBody(FaqOrder)) b: z.infer<typeof FaqOrder>) { return this.faqs.reorder(b.ids); }

  @Patch(':id')
  update(@Param('id', id) faqId: string, @Body(new ZodBody(EditFaq)) b: z.infer<typeof EditFaq>) { return this.faqs.update(faqId, b); }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', id) faqId: string) { return this.faqs.remove(faqId); }
}

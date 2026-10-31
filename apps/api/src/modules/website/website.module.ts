import { Module } from '@nestjs/common';
import { MediaModule } from '../media';
import { LiveSiteWrite } from './live-site';
import { SiteCache } from './site-cache';
import { FaqsRepository } from './faqs.repository';
import { FaqsService } from './faqs.service';
import { FaqsController, WebsiteController } from './website.controller';
import { WebsiteRepository } from './website.repository';
import { WebsiteService } from './website.service';

/** Publish the clinic website (draft -> published), its sections and questions (Phase 2C-1), and keep the public site's cache fresh. */
@Module({
  imports: [MediaModule], // Phase 2C-3: the share image
  controllers: [WebsiteController, FaqsController],
  providers: [WebsiteService, WebsiteRepository, SiteCache, LiveSiteWrite, FaqsService, FaqsRepository],
  exports: [SiteCache, LiveSiteWrite],
})
export class WebsiteModule {}

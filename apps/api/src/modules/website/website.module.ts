import { Module } from '@nestjs/common';
import { SiteCache } from './site-cache';
import { WebsiteController } from './website.controller';
import { WebsiteRepository } from './website.repository';
import { WebsiteService } from './website.service';

/** Publish the clinic website (draft -> published) and keep the public site's cache fresh. */
@Module({
  controllers: [WebsiteController],
  providers: [WebsiteService, WebsiteRepository, SiteCache],
  exports: [SiteCache],
})
export class WebsiteModule {}

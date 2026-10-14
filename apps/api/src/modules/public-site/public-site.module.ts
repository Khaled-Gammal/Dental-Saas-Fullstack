import { Module } from '@nestjs/common';
import { PublicSiteController } from './public-site.controller';
import { PublicSiteRepository } from './public-site.repository';

@Module({ controllers: [PublicSiteController], providers: [PublicSiteRepository] })
export class PublicSiteModule {}

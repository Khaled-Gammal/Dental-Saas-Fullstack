import { Module } from '@nestjs/common';
import { PublicSiteController } from './public-site.controller';

@Module({ controllers: [PublicSiteController] })
export class PublicSiteModule {}

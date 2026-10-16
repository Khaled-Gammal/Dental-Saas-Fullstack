import { Module } from '@nestjs/common';
import { MediaModule } from '../media';
import { WebsiteModule } from '../website/website.module';
import { GalleryController, PublicGalleryController } from './gallery.controller';
import { GalleryRepository } from './gallery.repository';
import { GalleryService } from './gallery.service';

/** Clinic and branch photo galleries (standard module, SRS 8.11). Images come from the media module. */
@Module({
  imports: [MediaModule, WebsiteModule],
  controllers: [GalleryController, PublicGalleryController],
  providers: [GalleryService, GalleryRepository],
})
export class GalleryModule {}

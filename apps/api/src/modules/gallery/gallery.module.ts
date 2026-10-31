import { Module } from '@nestjs/common';
import { MediaModule } from '../media';
import { WebsiteModule } from '../website/website.module';
import { CasesRepository } from './cases.repository';
import { CasesService } from './cases.service';
import { CasesController, GalleryController, PublicGalleryController } from './gallery.controller';
import { GalleryRepository } from './gallery.repository';
import { GalleryService } from './gallery.service';

/** Clinic and branch photo galleries (standard module, SRS 8.11) and before/after cases (Phase 2C-2). Images come from the media module. */
@Module({
  imports: [MediaModule, WebsiteModule],
  // CasesController first: its `/gallery/cases` routes must match before GalleryController's `/gallery/:id`
  controllers: [CasesController, GalleryController, PublicGalleryController],
  providers: [GalleryService, GalleryRepository, CasesService, CasesRepository],
})
export class GalleryModule {}

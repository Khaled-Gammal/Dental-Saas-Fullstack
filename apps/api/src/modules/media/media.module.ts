import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config';
import { MediaController } from './media.controller';
import { MediaRepository } from './media.repository';
import { MediaService } from './media.service';
import { MEDIA_SIGNER, MediaSigner } from './media-urls';

/**
 * Media (shared by gallery, offers, stories and banners): upload, image processing, storage and delivery.
 * Content modules attach files through `MediaService` from `index.ts`.
 */
@Module({
  controllers: [MediaController],
  providers: [
    MediaService, MediaRepository,
    { provide: MEDIA_SIGNER, inject: [APP_CONFIG], useFactory: (cfg: AppConfig) => new MediaSigner(cfg.MEDIA_URL_SECRET, cfg.API_PUBLIC_URL.replace(/\/$/, '')) },
  ],
  exports: [MediaService],
})
export class MediaModule {}

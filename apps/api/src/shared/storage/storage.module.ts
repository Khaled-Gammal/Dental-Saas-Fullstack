import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config';
import { createObjectStorage } from './create-storage';
import { OBJECT_STORAGE } from './ports';

/** Binds the OBJECT_STORAGE port to the adapter chosen by STORAGE_DRIVER. */
@Global()
@Module({
  providers: [{ provide: OBJECT_STORAGE, inject: [APP_CONFIG], useFactory: (cfg: AppConfig) => createObjectStorage(cfg) }],
  exports: [OBJECT_STORAGE],
})
export class StorageModule {}

import { Logger } from '@nestjs/common';
import type { AppConfig } from '../../config';
import { LocalObjectStorage } from './local-storage';
import type { ObjectStorage } from './ports';
import { S3ObjectStorage } from './s3-storage';

/** The adapter chosen by STORAGE_DRIVER. Shared by the API (StorageModule) and the worker (built by hand). */
export async function createObjectStorage(cfg: AppConfig): Promise<ObjectStorage> {
  switch (cfg.STORAGE_DRIVER) {
    case 'local':
      return new LocalObjectStorage(cfg.STORAGE_DIR);
    case 's3': {
      const s3 = new S3ObjectStorage({
        endpoint: cfg.S3_ENDPOINT, region: cfg.S3_REGION, accessKeyId: cfg.S3_ACCESS_KEY, secretAccessKey: cfg.S3_SECRET_KEY,
        bucket: cfg.S3_BUCKET, forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
      });
      if (cfg.NODE_ENV !== 'production') await s3.ensureBucket().catch((e) => new Logger('Storage').warn(`bucket check failed: ${(e as Error).message}`));
      return s3;
    }
    default: {
      const unknown: never = cfg.STORAGE_DRIVER;
      throw new Error(`No storage adapter for ${String(unknown)}`);
    }
  }
}

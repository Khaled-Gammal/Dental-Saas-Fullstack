import { CreateBucketCommand, DeleteObjectsCommand, GetObjectCommand, HeadBucketCommand, NoSuchKey, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { assertKey, type ObjectStorage, type StoredObject } from './ports';

export interface S3Settings { endpoint?: string; region: string; accessKeyId?: string; secretAccessKey?: string; bucket: string; forcePathStyle: boolean }

/** Any S3-compatible service: Cloudflare R2, AWS S3, MinIO, SeaweedFS. One private bucket; nothing is public-read. */
export class S3ObjectStorage implements ObjectStorage {
  private readonly s3: S3Client;

  constructor(private readonly cfg: S3Settings) {
    this.s3 = new S3Client({
      endpoint: cfg.endpoint, region: cfg.region, forcePathStyle: cfg.forcePathStyle,
      credentials: cfg.accessKeyId && cfg.secretAccessKey ? { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey } : undefined,
    });
  }

  /** Development convenience: create the bucket if it is missing. Production buckets are provisioned, not created here. */
  async ensureBucket(): Promise<void> {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.cfg.bucket }));
    } catch {
      await this.s3.send(new CreateBucketCommand({ Bucket: this.cfg.bucket }));
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    assertKey(key);
    await this.s3.send(new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  /** One streamed PUT: S3 takes up to 5 GB this way (a larger export fails and is reported; multipart would lift it). */
  async putFile(key: string, filePath: string, contentType: string): Promise<void> {
    assertKey(key);
    const { size } = await stat(filePath);
    await this.s3.send(new PutObjectCommand({
      Bucket: this.cfg.bucket, Key: key, Body: createReadStream(filePath), ContentLength: size, ContentType: contentType,
    }));
  }

  async get(key: string): Promise<StoredObject | null> {
    assertKey(key);
    try {
      const r = await this.s3.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      return { body: r.Body as Readable, contentType: r.ContentType ?? 'application/octet-stream', length: Number(r.ContentLength ?? 0) };
    } catch (e) {
      if (e instanceof NoSuchKey || (e as { name?: string }).name === 'NoSuchKey') return null;
      throw e;
    }
  }

  async deleteMany(keys: string[]): Promise<void> {
    if (!keys.length) return;
    keys.forEach(assertKey);
    for (let i = 0; i < keys.length; i += 1000) {
      await this.s3.send(new DeleteObjectsCommand({ Bucket: this.cfg.bucket, Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true } }));
    }
  }
}

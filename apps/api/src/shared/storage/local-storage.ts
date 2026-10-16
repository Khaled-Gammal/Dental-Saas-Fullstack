import { createReadStream } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertKey, type ObjectStorage, type StoredObject } from './ports';

/**
 * Development/test adapter: objects are files under one directory. Not for production (config.ts refuses it there):
 * several API instances would not share the disk.
 */
export class LocalObjectStorage implements ObjectStorage {
  constructor(private readonly root: string) {}

  private file(key: string): string {
    assertKey(key);
    const full = path.resolve(this.root, ...key.split('/'));
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error('storage key escapes the root');
    return full;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const full = this.file(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body);
    await writeFile(`${full}.type`, contentType); // the content type travels with the object, as in S3
  }

  async get(key: string): Promise<StoredObject | null> {
    const full = this.file(key);
    try {
      const [{ size }, contentType] = await Promise.all([stat(full), readFile(`${full}.type`, 'utf8')]);
      return { body: createReadStream(full), contentType, length: size };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async deleteMany(keys: string[]): Promise<void> {
    await Promise.all(keys.flatMap((k) => { const f = this.file(k); return [rm(f, { force: true }), rm(`${f}.type`, { force: true })]; }));
  }
}

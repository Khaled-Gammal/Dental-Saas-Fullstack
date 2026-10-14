// Loads the root .env so every script works the same on Windows, macOS and Linux.
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
config({ path: path.join(root, '.env') });
export function need(name) {
  const v = process.env[name];
  if (!v) { console.error(`Missing ${name}. Copy .env.example to .env in the repo root.`); process.exit(1); }
  return v;
}

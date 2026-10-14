/** Build-time settings for the dashboard (only VITE_* variables reach the browser). */
export const ROOT_DOMAIN = import.meta.env.VITE_ROOT_DOMAIN ?? 'lvh.me';
export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

/** Public address of a clinic's website (the Next.js app runs on :3000 in development). */
export const siteUrl = (slug: string) =>
  import.meta.env.DEV ? `http://${slug}.${ROOT_DOMAIN}:3000` : `https://${slug}.${ROOT_DOMAIN}`;

/** Seeded demo accounts for the development quick sign-in (password in packages/db/seeds/dev_seed.sql). */
export const DEMO_USERS = ['owner.a@demo.test', 'reception.a@demo.test', 'doctor.a@demo.test', 'owner.b@demo.test'];
export const DEMO_PASSWORD = 'Demo@12345';

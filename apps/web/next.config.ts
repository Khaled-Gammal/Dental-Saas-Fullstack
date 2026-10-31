import type { NextConfig } from 'next';
import { config } from 'dotenv';
import path from 'node:path';

// all apps share the root .env
config({ path: path.resolve(process.cwd(), '../../.env') }); // cwd = apps/web

/**
 * Review R11 (hardening): headers for every page of every clinic's site. No Content-Security-Policy yet — Next.js
 * inlines its bootstrap scripts, so a CSP needs nonces (middleware) to be done properly; these are the safe ones.
 */
const SECURITY_HEADERS = [
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' }, // no includeSubDomains: a clinic's own domain may have other, older subdomains; ignored over plain http (dev)
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' }, // nobody frames a clinic's site to click-jack its booking form
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
  transpilePackages: ['@dental/ui'], // workspace package (shared design tokens): let Next bundle it like app code
  eslint: { ignoreDuringBuilds: true }, // linting runs from the monorepo root (pnpm lint, eslint.config.mjs), not inside next build
  distDir: process.env.NEXT_DIST_DIR ?? '.next', // NEXT_DIST_DIR=.next-build next build: verify a production build while `next dev` is running
  // `env` is inlined into every bundle, the browser's included: public values only. Secrets (REVALIDATE_SECRET) are
  // read from process.env at runtime by the server code that needs them (review R11).
  env: {
    ROOT_DOMAIN: process.env.ROOT_DOMAIN ?? 'lvh.me',
    API_INTERNAL_URL: process.env.API_INTERNAL_URL ?? process.env.API_PUBLIC_URL ?? 'http://localhost:4000',
    DASHBOARD_URL: process.env.DASHBOARD_URL ?? 'http://localhost:5173',
    // the landing page's sample-website link (H7); unset in production until a real sample clinic exists
    DEMO_SITE_URL: process.env.DEMO_SITE_URL ?? (process.env.NODE_ENV === 'production' ? '' : `http://clinic-a.${process.env.ROOT_DOMAIN ?? 'lvh.me'}:3000`),
  },
};

export default nextConfig;

import type { NextConfig } from 'next';
import { config } from 'dotenv';
import path from 'node:path';

// all apps share the root .env
config({ path: path.resolve(process.cwd(), '../../.env') }); // cwd = apps/web

const nextConfig: NextConfig = {
  transpilePackages: ['@dental/ui'], // workspace package (shared design tokens): let Next bundle it like app code
  eslint: { ignoreDuringBuilds: true }, // linting runs from the monorepo root (pnpm lint, eslint.config.mjs), not inside next build
  distDir: process.env.NEXT_DIST_DIR ?? '.next', // NEXT_DIST_DIR=.next-build next build: verify a production build while `next dev` is running
  env: {
    ROOT_DOMAIN: process.env.ROOT_DOMAIN ?? 'lvh.me',
    API_INTERNAL_URL: process.env.API_INTERNAL_URL ?? process.env.API_PUBLIC_URL ?? 'http://localhost:4000',
    DASHBOARD_URL: process.env.DASHBOARD_URL ?? 'http://localhost:5173',
    // the landing page's sample-website link (H7); unset in production until a real sample clinic exists
    DEMO_SITE_URL: process.env.DEMO_SITE_URL ?? (process.env.NODE_ENV === 'production' ? '' : `http://clinic-a.${process.env.ROOT_DOMAIN ?? 'lvh.me'}:3000`),
    REVALIDATE_SECRET: process.env.REVALIDATE_SECRET ?? 'dev-only-revalidate-secret',
  },
};

export default nextConfig;

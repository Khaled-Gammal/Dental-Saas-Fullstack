import type { NextConfig } from 'next';
import { config } from 'dotenv';
import path from 'node:path';

// all apps share the root .env
config({ path: path.resolve(process.cwd(), '../../.env') }); // cwd = apps/web

const nextConfig: NextConfig = {
  transpilePackages: ['@dental/ui'], // workspace package (shared design tokens): let Next bundle it like app code
  eslint: { ignoreDuringBuilds: true }, // ESLint is not set up yet; add it in a later sprint
  env: {
    ROOT_DOMAIN: process.env.ROOT_DOMAIN ?? 'lvh.me',
    API_INTERNAL_URL: process.env.API_INTERNAL_URL ?? process.env.API_PUBLIC_URL ?? 'http://localhost:4000',
    DASHBOARD_URL: process.env.DASHBOARD_URL ?? 'http://localhost:5173',
    REVALIDATE_SECRET: process.env.REVALIDATE_SECRET ?? 'dev-only-revalidate-secret',
  },
};

export default nextConfig;

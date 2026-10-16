// Flat config for the whole monorepo (pnpm lint). Kept small on purpose: the rules that catch real bugs,
// plus the one architectural rule the code review keeps asking for.
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', '**/next-env.d.ts', '**/openapi.json', 'packages/db/src/generated/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // React apps: hooks rules catch the bugs a type checker cannot
    files: ['apps/dashboard/**/*.{ts,tsx}', 'apps/web/**/*.{ts,tsx}', 'packages/ui/**/*.ts'],
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    // NestJS DI reads constructor parameter types at runtime (emitDecoratorMetadata). Without these flags the
    // type-imports rule would rewrite injected classes to `import type` and Nest would receive `undefined`.
    files: ['apps/api/**/*.ts'],
    languageOptions: { parserOptions: { emitDecoratorMetadata: true, experimentalDecorators: true } },
  },
  {
    // Tenant isolation: TenantDb is the only door to the database (see shared/database/tenant-db.service.ts)
    files: ['apps/api/src/**/*.ts'],
    ignores: ['apps/api/src/shared/database/**', 'apps/api/src/worker.ts'], // the worker runs as the worker role, outside RLS, by design
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{ name: '@dental/db', importNames: ['withTenant', 'createDb'], message: 'Use TenantDb (shared/database). Nothing else may open a tenant transaction.' }],
      }],
    },
  },
  {
    // Plain Node scripts (no tsconfig): declare the runtime globals the TS packages get from @types/node
    files: ['**/*.{js,mjs}'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly', URL: 'readonly', Buffer: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly' } },
  },
  {
    files: ['apps/api/src/main.ts', 'apps/api/src/worker.ts', 'packages/db/scripts/**', '**/*.config.{js,mjs,ts}'],
    rules: { 'no-console': 'off' },
  },
);

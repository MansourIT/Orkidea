import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          // Bindings réservés aux tests : migrations + seed appliqués dans test/apply-migrations.ts
          TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, 'migrations')),
          TEST_SEED: readFileSync(path.join(import.meta.dirname, 'seed/dev.sql'), 'utf8'),
          APP_URL: 'http://localhost',
          MAIL_DEV_LOG: 'true',
          API_DOCS: 'true',
        },
      },
    })),
  ],
  test: {
    include: ['test/**/*.test.ts', '../shared/**/*.test.ts'],
    setupFiles: ['./test/apply-migrations.ts'],
  },
});

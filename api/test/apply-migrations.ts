import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeEach } from 'vitest';

// Schéma appliqué une fois par fichier de test.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

const seed = env.TEST_SEED.split(/;\s*(?:\n|$)/)
  .map((s: string) => s.replace(/^\s*--.*$/gm, '').trim())
  .filter(Boolean);

// Chaque test repart des données de démo (les absences communes viennent de la migration).
beforeEach(async () => {
  await env.DB.batch(
    [
      'DELETE FROM entries',
      'DELETE FROM validations',
      'DELETE FROM timesheets',
      'DELETE FROM activity_order',
      'DELETE FROM sessions',
      'DELETE FROM login_tokens',
      'DELETE FROM activities WHERE mission_id IS NOT NULL',
      'DELETE FROM missions',
      'DELETE FROM clients',
      'DELETE FROM users',
      ...seed,
    ].map((s) => env.DB.prepare(s)),
  );
});

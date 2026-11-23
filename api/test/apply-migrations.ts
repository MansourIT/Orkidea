import { applyD1Migrations, env } from 'cloudflare:test';
import { afterEach, beforeEach, vi } from 'vitest';

// Schéma appliqué une fois par fichier de test.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

const seed = env.TEST_SEED.split(/;\s*(?:\n|$)/)
  .map((s: string) => s.replace(/^\s*--.*$/gm, '').trim())
  .filter(Boolean);

/** Date du jour de référence des tests : vendredi 27/11/2026 (soumission de novembre ouverte). */
export const TEST_NOW = '2026-11-27T10:00:00Z';

// Chaque test repart des données de démo (les absences communes viennent de la migration).
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(TEST_NOW));
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
      'DELETE FROM timesheet_events',
      'DELETE FROM settings',
      'DELETE FROM users',
      ...seed,
    ].map((s) => env.DB.prepare(s)),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from '@playwright/test';
import { BASE_URL, PORT } from './playwright.config';
import { ADMIN, CONSULTANT, STATE, WRANGLER_LOG, latestLink } from './tests/support';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = join(ROOT, 'api');

function wrangler(args: string[]): void {
  execFileSync('npx', ['wrangler', ...args], { cwd: API, stdio: 'pipe' });
}

async function waitForHealth(proc: ChildProcess): Promise<void> {
  for (let i = 0; i < 120; i++) {
    if (proc.exitCode !== null) throw new Error(`wrangler dev s'est arrêté (voir ${WRANGLER_LOG})`);
    try {
      if ((await fetch(`${BASE_URL}/api/health`)).ok) return;
    } catch {
      /* pas encore prêt */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('wrangler dev ne répond pas sur /api/health');
}

/** Connexion par lien magique via l'API, puis sauvegarde du cookie de session (storageState). */
async function saveSession(email: string, file: string): Promise<void> {
  const ctx = await request.newContext({ baseURL: BASE_URL });
  const res = await ctx.post('/api/auth/login', { data: { email } });
  if (!res.ok()) throw new Error(`login ${email} : ${res.status()}`);
  await new Promise((r) => setTimeout(r, 500));
  const token = new URL(latestLink(email, '/connexion')).searchParams.get('token');
  const cb = await ctx.post('/api/auth/callback', { data: { token } });
  if (!cb.ok()) throw new Error(`callback ${email} : ${cb.status()}`);
  await ctx.storageState({ path: file });
  await ctx.dispose();
}

export default async function globalSetup(): Promise<() => void> {
  const index = join(ROOT, 'front/dist/front/browser/index.html');
  if (!existsSync(index) || !readFileSync(index, 'utf8').includes('<app-root')) {
    throw new Error('Front non construit : lancez « npm run build » avant les tests e2e.');
  }

  // Base D1 locale dédiée, recréée à chaque lancement.
  rmSync(STATE, { recursive: true, force: true });
  mkdirSync(STATE, { recursive: true });
  const persist = join(STATE, 'd1');
  const envFile = join(STATE, 'e2e.env');
  writeFileSync(envFile, `APP_URL=${BASE_URL}\nMAIL_DEV_LOG=true\n`);
  wrangler(['d1', 'migrations', 'apply', 'orkidea-cra', '--local', '--persist-to', persist]);
  wrangler(['d1', 'execute', 'orkidea-cra', '--local', '--persist-to', persist, '--file=seed/dev.sql']);

  // Le Worker (front + API). Les emails sont écrits dans le journal, d'où les tests lisent les liens.
  const log = openSync(WRANGLER_LOG, 'w');
  const proc = spawn(
    'npx',
    ['wrangler', 'dev', '--port', String(PORT), '--persist-to', persist, '--env-file', envFile, '--show-interactive-dev-session=false'],
    { cwd: API, stdio: ['ignore', log, log], detached: true },
  );
  await waitForHealth(proc);

  await saveSession(CONSULTANT, join(STATE, 'consultant.json'));
  await saveSession(ADMIN, join(STATE, 'admin.json'));

  return () => {
    try {
      process.kill(-proc.pid!, 'SIGTERM'); // tout le groupe (npx → wrangler → workerd)
    } catch {
      proc.kill('SIGTERM');
    }
  };
}

import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { expect, vi } from 'vitest';
import app from '../src/index';
import type { Entry, Timesheet } from '../../shared/types';

export const BASE = 'http://localhost';

export interface CallOptions {
  method?: string;
  body?: unknown;
  /** Corps brut (fichier) et son type, au lieu d'un corps JSON. */
  raw?: { data: Uint8Array; type: string };
  cookie?: string;
  origin?: string;
  /** IP cliente (limiteur de débit) ; aléatoire par défaut pour ne pas mélanger les tests. */
  ip?: string;
  base?: string;
}

/** Appelle le Worker comme le ferait le navigateur, et attend les tâches waitUntil (emails). */
export async function call(path: string, opts: CallOptions = {}): Promise<Response> {
  const headers = new Headers();
  if (opts.body !== undefined) headers.set('content-type', 'application/json');
  if (opts.raw) headers.set('content-type', opts.raw.type);
  if (opts.cookie) headers.set('cookie', opts.cookie);
  if (opts.origin) headers.set('origin', opts.origin);
  headers.set('cf-connecting-ip', opts.ip ?? `10.0.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`);
  const req = new Request(`${opts.base ?? BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.raw ? opts.raw.data : opts.body === undefined ? undefined : JSON.stringify(opts.body),
    redirect: 'manual',
  });
  const ctx = createExecutionContext();
  const res = await app.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

export interface SentMail {
  to: string;
  subject: string;
  links: string[];
}

/** Capture les emails affichés dans la console (MAIL_DEV_LOG=true). */
export function captureMails(): SentMail[] {
  const mails: SentMail[] = [];
  vi.spyOn(console, 'log').mockImplementation((msg: unknown) => {
    const text = String(msg);
    if (!text.includes('[MAIL]')) return;
    mails.push({
      to: /\[MAIL\] À: (.+)/.exec(text)?.[1]?.trim() ?? '',
      subject: /\[MAIL\] Objet: (.+)/.exec(text)?.[1]?.trim() ?? '',
      links: [...text.matchAll(/\[MAIL\] Lien: (\S+)/g)].map((m) => m[1]),
    });
  });
  return mails;
}

/** Connexion complète par lien magique ; retourne l'en-tête cookie de session. */
export async function login(email: string): Promise<string> {
  const mails = captureMails();
  const res = await call('/api/auth/login', { method: 'POST', body: { email } });
  expect(res.status).toBe(200);
  const link = mails.at(-1)?.links[0];
  expect(link).toBeDefined();
  const cb = await call('/api/auth/callback', { method: 'POST', body: { token: loginToken(link!) } });
  expect(cb.status).toBe(200);
  const setCookie = cb.headers.get('set-cookie') ?? '';
  const cookie = setCookie.split(';')[0];
  expect(cookie).toMatch(/^ork_session=/);
  vi.restoreAllMocks();
  return cookie;
}

export const CONSULTANT = 'jean.dupont@example.com';
export const ADMIN = 'contact@orkidea.fr';
export const MONTH = '2026-11';

export async function save(cookie: string, entries: Entry[], comment?: string): Promise<Response> {
  return call(`/api/timesheets/${MONTH}`, { method: 'PUT', cookie, body: { entries, comment } });
}

export async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

export type { Timesheet };

/** Jours ouvrés de la 1re semaine de novembre 2026 (lundi 2 → vendredi 6). */
export const WEEK1 = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'];

/** Extrait le jeton d'un lien de validation client. */
export function validationToken(link: string): string {
  return decodeURIComponent(new URL(link).pathname.split('/').pop()!);
}

/** Jeton d'un lien de connexion (/connexion?token=…). */
export function loginToken(link: string): string {
  const url = new URL(link);
  expect(url.pathname).toBe('/connexion');
  return url.searchParams.get('token')!;
}

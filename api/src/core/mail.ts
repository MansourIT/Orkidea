import type { Context } from 'hono';
import type { AppEnv, Bindings } from '../env';

export interface Mail {
  to: string;
  toName?: string;
  subject: string;
  html: string;
}

/**
 * Envoi via l'API transactionnelle Brevo.
 * En local (MAIL_DEV_LOG="true"), l'email est affiché dans la console.
 * Sans clé Brevo hors mode dev : erreur (jamais de lien de connexion dans les logs de production).
 */
export async function sendMail(env: Bindings, mail: Mail): Promise<void> {
  if (env.MAIL_DEV_LOG === 'true') {
    const links = [...mail.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
    const text = mail.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    console.log(`\n[MAIL] À: ${mail.to}\n[MAIL] Objet: ${mail.subject}\n[MAIL] ${text}\n${links.map((l) => `[MAIL] Lien: ${l}`).join('\n')}\n`);
    return;
  }
  if (!env.BREVO_API_KEY) throw new Error('BREVO_API_KEY absente : email non envoyé');
  const match = /^(.*)<(.+)>$/.exec(env.MAIL_FROM.trim());
  const sender = match ? { name: match[1].trim(), email: match[2].trim() } : { email: env.MAIL_FROM };
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender,
      to: [{ email: mail.to, name: mail.toName }],
      subject: mail.subject,
      htmlContent: mail.html,
    }),
  });
  if (!res.ok) {
    throw new Error(`Brevo ${res.status}: ${await res.text()}`);
  }
}

/** Envoi après la réponse (waitUntil) : le temps de réponse ne dépend pas de l'envoi. */
export function sendInBackground(c: Context<AppEnv>, mail: Mail, label: string): void {
  c.executionCtx.waitUntil(sendMail(c.env, mail).catch((err: Error) => console.error(`Envoi email (${label}) : ${err.message}`)));
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function layout(title: string, body: string): string {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1B2340">
  <h2 style="color:#7C5CBF">${escapeHtml(title)}</h2>${body}
  <p style="color:#888;font-size:12px;margin-top:32px">Orkidea — conseil &amp; portage salarial</p></div>`;
}

export function button(href: string, label: string): string {
  return `<p><a href="${escapeHtml(href)}" style="display:inline-block;background:#7C5CBF;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">${escapeHtml(label)}</a></p>`;
}

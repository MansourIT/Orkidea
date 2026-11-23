import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Page, expect } from '@playwright/test';
import { addMonths, monthOf, todayInParis } from '../../shared/dates';
import { workingDates } from '../../shared/holidays';

export const STATE = join(dirname(fileURLToPath(import.meta.url)), '..', '.state');
export const WRANGLER_LOG = join(STATE, 'wrangler.log');
export const CONSULTANT = 'jean.dupont@example.com';
export const ADMIN = 'contact@orkidea.fr';
export const VALIDATOR = 'marie.martin@client-alpha.example';
export const consultantState = join(STATE, 'consultant.json');
export const adminState = join(STATE, 'admin.json');

/** Liens des emails envoyés à `to` (journal wrangler dev, MAIL_DEV_LOG=true), du plus ancien au plus récent. */
export function mailLinks(to: string, pathPart: string): string[] {
  const log = readFileSync(WRANGLER_LOG, 'utf8');
  const links: string[] = [];
  for (const block of log.split('[MAIL] À: ').slice(1)) {
    if (!block.startsWith(to)) continue;
    for (const m of block.matchAll(/\[MAIL\] Lien: (\S+)/g)) if (m[1].includes(pathPart)) links.push(m[1]);
  }
  return links;
}

export function latestLink(to: string, pathPart: string): string {
  const links = mailLinks(to, pathPart);
  if (!links.length) throw new Error(`Aucun email « ${pathPart} » pour ${to}`);
  return links[links.length - 1];
}

/** Attend un nouvel email (au-delà de `previous` liens déjà reçus). */
export async function nextLink(to: string, pathPart: string, previous: number): Promise<string> {
  await expect.poll(() => mailLinks(to, pathPart).length, { message: `email ${pathPart} pour ${to}` }).toBeGreaterThan(previous);
  return latestLink(to, pathPart);
}

/** Mois relatif au mois courant (Europe/Paris). */
export const monthFromNow = (n: number) => addMonths(monthOf(todayInParis()), n);
export const workdays = (month: string) => workingDates(month);

/** Toutes les dates entre deux dates incluses (le pinceau traverse aussi les week-ends). */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d = new Date(d.getTime() + 86_400_000)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export const cell = (page: Page, date: string) => page.locator(`[data-date="${date}"]`);

/** Sélectionne une carte d'activité comme pinceau, avec ou sans « Partiel ». */
export async function selectBrush(page: Page, name: string, partial = false): Promise<void> {
  const button = page.getByRole('button', { name: `Pinceau : ${name}`, exact: true });
  const card = button.locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');
  const box = card.getByRole('checkbox', { name: 'Partiel' });
  if ((await box.isChecked()) !== partial) await box.setChecked(partial);
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
}

/** Glisser à la souris du premier au dernier jour (pointer events). */
export async function dragAcross(page: Page, dates: string[]): Promise<void> {
  const center = async (d: string) => {
    const b = (await cell(page, d).boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const start = await center(dates[0]);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (const d of dates.slice(1)) {
    const p = await center(d);
    await page.mouse.move(p.x, p.y, { steps: 4 });
  }
  await page.mouse.up();
}

export async function loginThroughUi(page: Page, email: string): Promise<void> {
  const before = mailLinks(email, '/connexion').length;
  await page.goto('/login');
  await page.getByLabel('Adresse email').fill(email);
  await page.getByRole('button', { name: 'Recevoir mon lien de connexion' }).click();
  await expect(page.getByText('Si un compte existe, un lien vous a été envoyé')).toBeVisible();
  await page.goto(await nextLink(email, '/connexion', before));
}

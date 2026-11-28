import { expect, test } from '@playwright/test';
import { monthDays } from '../../shared/holidays';
import { adminState, cell, consultantState, monthFromNow } from './support';

test('astreinte : option de mission, astreinte un samedi avec intervention de nuit, enregistrement', async ({ browser }) => {
  const month = monthFromNow(0);
  const saturday = monthDays(month).find((d) => d.weekday === 6)!.date;

  // L'administrateur ouvre l'astreinte sur la mission Alpha.
  const admin = await (await browser.newContext({ storageState: adminState })).newPage();
  await admin.goto('/admin?onglet=missions');
  await admin.getByText('Projet Alpha').first().click();
  await admin.getByRole('switch', { name: 'Astreintes possibles sur cette mission' }).click();
  await admin.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(admin.getByRole('dialog')).toHaveCount(0);

  const page = await (await browser.newContext({ storageState: consultantState })).newPage();
  await page.goto(`/saisie/${month}`);
  await expect(page.getByRole('heading', { name: 'Astreintes' })).toBeVisible();

  // Sans activité sélectionnée, le clic sur un jour ouvre le détail avec l'astreinte.
  await cell(page, saturday).click();
  await page.getByRole('button', { name: 'Ajouter une intervention' }).click();
  await page.getByLabel('Heure de début').fill('22:30');
  await page.getByLabel('Heure de fin').fill('01:15');
  await expect(page.getByText('Durée : 2 h 45 (fin le lendemain)')).toBeVisible();
  await page.getByLabel('Motif').fill('INC-42 base indisponible');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Astreinte Projet Alpha ce jour' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('INC-42 base indisponible')).toBeVisible();
  await page.keyboard.press('Escape');

  await expect(page.getByText(/1\s*jour d’astreinte/)).toBeVisible();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Brouillon enregistré')).toBeVisible();

  // Rechargement : l'astreinte est conservée et visible sur la case.
  await page.reload();
  await expect(cell(page, saturday)).toHaveAttribute('title', /Astreinte · interventions 2h45/);
});

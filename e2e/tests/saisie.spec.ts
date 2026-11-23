import { expect, test } from '@playwright/test';
import { cell, consultantState, monthFromNow, selectBrush, workdays } from './support';

test.use({ storageState: consultantState });

test.describe('Écran de saisie', () => {
  // Mois dédié pour ne pas interférer avec le parcours principal.
  const month = monthFromNow(-3);
  const days = workdays(month);

  test('week-end refusé, vue tableau partagée avec le calendrier, garde de sortie', async ({ page }) => {
    await page.goto(`/saisie/${month}`);
    await selectBrush(page, 'Projet Gamma – Support');
    const weekend = page.locator('[data-date][aria-label*="week-end"]').first();
    await expect(weekend).toHaveAttribute('aria-disabled', 'true');
    await weekend.click({ force: true });
    await expect(page.getByText(/est un week-end : saisie non autorisée pour Projet Gamma · Support/)).toBeVisible();

    await cell(page, days[0]).click();
    await page.getByRole('tab', { name: 'Vue tableau' }).click();
    const row = page.locator('tbody tr', { hasText: 'Support' });
    await expect(row.locator('td').last()).toHaveText('1 j');

    // Clavier : ½ sur le 2e jour ouvré de la ligne Formation, puis dépassement signalé.
    const formation = page.locator('tbody tr', { hasText: 'Formation' });
    const col = Number(days[0].slice(8)) - 1;
    await formation.locator(`[data-cell$=":${col}"]`).focus();
    await page.keyboard.press('5');
    await expect(page.getByText(/Plus d’une journée saisie le/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Soumettre' })).toBeDisabled();
    await page.keyboard.press('0');
    await expect(page.getByText(/Plus d’une journée saisie le/)).toBeHidden();

    await page.getByRole('tab', { name: 'Vue calendrier' }).click();
    await expect(cell(page, days[0])).toHaveAttribute('aria-label', /Projet Gamma Support, 1 jour/);

    // Changer de mois sans enregistrer : confirmation.
    await page.getByRole('link', { name: 'Mois suivant' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Modifications non enregistrées');
    await dialog.getByRole('button', { name: 'Rester' }).click();
    await expect(page).toHaveURL(new RegExp(`/saisie/${month}$`));
  });

  test('tableau de bord : accès rapide au mois', async ({ page }) => {
    await page.goto('/tableau-de-bord');
    await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible();
    await expect(page.locator('ul li a')).toHaveCount(12);
    await page.locator('ul li a').first().click();
    await expect(page).toHaveURL(/\/saisie\/\d{4}-\d{2}$/);
  });
});

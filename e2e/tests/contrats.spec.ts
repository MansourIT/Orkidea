import { expect, test } from '@playwright/test';
import { adminState } from './support';

test.use({ storageState: adminState });

test.describe('Modèles de contrat', () => {
  test('création depuis la démonstration, erreur bloquante, publication, comparaison, v2 en brouillon', async ({ page }) => {
    await page.goto('/admin?onglet=contrats');
    await page.getByRole('button', { name: 'Nouveau modèle' }).first().click();
    await page.getByLabel('Nom du modèle').fill('Régie e2e');
    await page.getByRole('button', { name: 'Créer et ouvrir' }).click();
    await page.waitForURL(/\/admin\/modeles\//);

    // Aperçu : mission Alpha choisie par défaut, données du client remplies.
    await expect(page.getByLabel('Mission utilisée pour l’aperçu')).toHaveValue('m-alpha');
    const preview = page.getByRole('article', { name: 'Aperçu du contrat' });
    await expect(preview).toContainText('cinq cent cinquante euros');
    await expect(preview).toContainText('Article 5 – Validation des comptes rendus');

    // Variable inconnue : erreur listée, publication impossible.
    const area = page.locator('textarea');
    const original = await area.inputValue();
    await area.fill(`${original}\nLieu : {{mission.lieux}}\n`);
    await expect(page.getByRole('button', { name: /Ligne \d+ · Variable inconnue « mission.lieux »/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publier la v1' })).toBeDisabled();

    await area.fill(`${original}\nLieu : {{mission.lieu}}\n`);
    await expect(page.getByRole('button', { name: 'Publier la v1' })).toBeEnabled();
    await page.getByRole('button', { name: 'Publier la v1' }).click();
    await page.getByRole('button', { name: 'Publier', exact: true }).click();
    await expect(page.getByText('v1 publiée', { exact: true })).toBeVisible();

    // Modification après publication : comparaison avec la v1, enregistrement en v2.
    await area.fill(`${await area.inputValue()}Ajout de la v2\n`);
    await expect(page.getByRole('button', { name: 'Publier la v2' })).toBeVisible();
    await page.getByRole('button', { name: 'Comparer' }).click();
    const dialog = page.getByRole('dialog', { name: 'Comparer les versions' }).last();
    await expect(dialog).toContainText('+1 ligne ajoutée');
    await expect(dialog).toContainText('Ajout de la v2');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('v2 brouillon', { exact: true })).toBeVisible();

    // Aperçu sur l'exemple fictif.
    await page.getByLabel('Mission utilisée pour l’aperçu').selectOption('exemple');
    await expect(preview).toContainText('Société Exemple SA');

    await page.getByRole('link', { name: 'Modèles' }).click();
    const card = page.getByRole('listitem').filter({ hasText: 'Régie e2e' });
    await expect(card).toContainText('v1 publiée');
    await expect(card).toContainText('v2 brouillon');
  });

  test('garde : quitter l’éditeur avec des modifications demande confirmation', async ({ page }) => {
    await page.goto('/admin?onglet=contrats');
    await page.getByRole('listitem').filter({ hasText: 'Régie e2e' }).getByRole('link', { name: 'Modifier' }).click();
    await page.locator('textarea').fill('Texte modifié');
    await page.getByRole('link', { name: 'Modèles' }).click();
    await expect(page.getByText('Modèle non enregistré')).toBeVisible();
    await page.getByRole('button', { name: 'Rester' }).click();
    await expect(page).toHaveURL(/\/admin\/modeles\//);
  });
});

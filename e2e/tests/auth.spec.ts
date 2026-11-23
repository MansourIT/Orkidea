import { expect, test } from '@playwright/test';
import { CONSULTANT, consultantState, latestLink, loginThroughUi } from './support';

test.describe('Connexion par lien magique', () => {
  test('non connecté : redirection vers /login', async ({ page }) => {
    await page.goto('/tableau-de-bord');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
  });

  test('email invalide signalé sans envoi', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Adresse email').fill('pas-un-email');
    await page.getByRole('button', { name: 'Recevoir mon lien de connexion' }).click();
    await expect(page.getByText('Saisissez une adresse email valide.')).toBeVisible();
  });

  test('connexion, lien à usage unique, déconnexion', async ({ page }) => {
    await loginThroughUi(page, CONSULTANT);
    await expect(page).toHaveURL(/\/saisie\/\d{4}-\d{2}$/);
    await expect(page.getByRole('heading', { name: 'Saisie des temps' })).toBeVisible();

    // Le même lien ne fonctionne qu'une fois.
    const used = latestLink(CONSULTANT, '/connexion');
    await page.context().clearCookies();
    await page.goto(used);
    await expect(page.getByText('Lien invalide ou expiré')).toBeVisible();
    await expect(page).not.toHaveURL(/token=/);
  });

  test.describe('consultant connecté', () => {
    test.use({ storageState: consultantState });

    test('pas d’accès à l’administration', async ({ page }) => {
      await page.goto('/admin');
      await expect(page).toHaveURL(/\/saisie\//);
      await expect(page.getByRole('link', { name: 'Administration' })).toHaveCount(0);
    });

    test('menu avatar et déconnexion', async ({ browser }) => {
      // Session dédiée (vide : browser.newContext hérite sinon du storageState de test.use),
      // car la déconnexion supprime la session côté serveur.
      const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      const page = await context.newPage();
      await loginThroughUi(page, CONSULTANT);
      await page.getByRole('button', { name: 'Menu de Jean Dupont' }).click();
      await page.getByRole('menuitem', { name: 'Déconnexion' }).click();
      await expect(page).toHaveURL(/\/login$/);
      await page.goto('/tableau-de-bord');
      await expect(page).toHaveURL(/\/login$/);
      await context.close();
    });
  });
});

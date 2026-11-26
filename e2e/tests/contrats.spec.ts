import { expect, test } from '@playwright/test';
import { adminState } from './support';

test.use({ storageState: adminState });

test.describe('Modèles de contrat', () => {
  test('création depuis la démonstration, erreur bloquante, publication, comparaison, v2 en brouillon', async ({ page }) => {
    await page.goto('/admin?onglet=contrats&vue=modeles');
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
    await page.goto('/admin?onglet=contrats&vue=modeles');
    await page.getByRole('listitem').filter({ hasText: 'Régie e2e' }).getByRole('link', { name: 'Modifier' }).click();
    await page.locator('textarea').fill('Texte modifié');
    await page.getByRole('link', { name: 'Modèles' }).click();
    await expect(page.getByText('Modèle non enregistré')).toBeVisible();
    await page.getByRole('button', { name: 'Rester' }).click();
    await expect(page).toHaveURL(/\/admin\/modeles\//);
  });
});

test.describe('Contrats générés', () => {
  test('génération depuis la mission, données manquantes, ajustement, émission et PDF', async ({ page }) => {
    // Modèle « Régie e2e » publié par le parcours précédent ; on part de la mission Alpha.
    await page.goto('/admin?onglet=missions');
    await page.getByText('Projet Alpha').first().click();
    await page.getByRole('button', { name: 'Générer un contrat' }).click();
    await page.getByRole('radio', { name: /Régie e2e/ }).check();
    await page.getByRole('button', { name: 'Créer le brouillon' }).click();
    await page.waitForURL(/\/admin\/contrats\//);
    await expect(page.getByRole('heading', { name: 'Contrat en brouillon' })).toBeVisible();

    // Fiche société incomplète : émission impossible, lien vers Paramètres.
    await expect(page.getByText('Données à compléter avant l’émission')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Émettre le contrat' })).toBeDisabled();
    const company = {
      legalName: 'Orkidea', legalForm: 'SASU', capital: '1 000 €', siret: '98765432100019', rcs: 'Paris 987 654 321', vatNumber: '',
      address: '1 avenue des Orchidées', postalCode: '75008', city: 'Paris', representativeName: 'Camille Bernard', representativeRole: 'Président',
      financialGuarantee: 'Garantie n° 123, Banque X', contractNumberPrefix: 'CS',
    };
    expect((await page.request.put('/api/admin/company', { data: company })).ok()).toBe(true);
    await page.getByRole('button', { name: 'Actualiser les données' }).click();
    await expect(page.getByText('Prêt à émettre')).toBeVisible();

    // Ajustement d'une clause, visible dans l'aperçu et compté comme écart au modèle.
    const area = page.locator('textarea');
    await area.fill(`${await area.inputValue()}\nClause particulière : confidentialité renforcée.\n`);
    await expect(page.getByRole('article', { name: 'Aperçu du contrat' })).toContainText('confidentialité renforcée');
    await expect(page.getByText(/Ajusté : \+\d+/)).toBeVisible();

    await page.getByRole('button', { name: 'Émettre le contrat' }).click();
    await page.getByRole('button', { name: 'Émettre', exact: true }).click();
    const heading = page.getByRole('heading', { name: /^Contrat CS-\d{4}-\d{3}$/ });
    await expect(heading).toBeVisible();
    const number = (await heading.textContent())!.replace('Contrat ', '');
    await expect(page.getByText('Émis', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('article')).toContainText(number);

    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'PDF émis' }).click();
    expect((await download).suggestedFilename()).toBe(`${number}.pdf`);

    // Suivi depuis la liste : compteurs, panneau, envoi puis dépôt du PDF signé.
    await page.getByRole('link', { name: 'Contrats', exact: true }).click();
    const toSend = page.getByRole('button', { name: /À envoyer/ });
    await expect(toSend).toContainText('1');
    await toSend.click();
    await page.getByRole('row').filter({ hasText: number }).click();
    const drawer = page.getByRole('dialog', { name: `Contrat ${number}` }).last();
    await drawer.getByRole('button', { name: 'Marquer envoyé' }).click();
    await page.getByLabel('Commentaire (destinataire, moyen d’envoi…)').fill('Envoyé à Sophie Bernard par email');
    await page.getByRole('button', { name: 'Marquer envoyé' }).last().click();
    await expect(drawer).toContainText('Envoyé · Envoyé à Sophie Bernard par email');
    await drawer.getByRole('button', { name: 'Déposer le PDF signé' }).last().click();
    await page.locator('#signe-fichier').setInputFiles({ name: 'signe.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n% signé\n%%EOF') });
    await page.getByRole('button', { name: 'Marquer signé' }).click();
    await expect(drawer.getByText('Contrat signé')).toBeVisible();
    await drawer.getByRole('button', { name: 'Fermer' }).click();
    await page.getByRole('button', { name: /Signés/ }).click();
    await expect(page.getByRole('row').filter({ hasText: number })).toContainText('Signé');
  });
});

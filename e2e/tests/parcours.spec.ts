import { type Browser, type Page, expect, test } from '@playwright/test';
import { STATUS_LABELS } from '../../shared/types';
import { frDate, monthName } from '../../shared/dates';
import {
  VALIDATOR,
  adminState,
  cell,
  consultantState,
  datesBetween,
  dragAcross,
  mailLinks,
  monthFromNow,
  nextLink,
  selectBrush,
  workdays,
} from './support';

/**
 * Parcours complet sur le mois précédent (toujours soumissible) :
 * saisie → soumission → rejet client → correction → nouvelle soumission → validation → clôture admin.
 */
test.describe.serial('Cycle de vie d’un CRA', () => {
  const month = monthFromNow(-1);
  const days = workdays(month);
  const alphaDays = days.slice(0, 5);
  let consultant: Page;
  let firstLink: string;

  const openConsultant = async (browser: Browser) => {
    consultant = await (await browser.newContext({ storageState: consultantState })).newPage();
  };
  const badge = () => consultant.locator('app-status-badge').first();

  test('saisie au pinceau (glisser), demi-journée, enregistrement', async ({ browser }) => {
    await openConsultant(browser);
    await consultant.goto(`/saisie/${month}`);
    await expect(consultant.getByRole('heading', { name: 'Saisie des temps' })).toBeVisible();
    await expect(badge()).toHaveText(STATUS_LABELS.BROUILLON);

    await selectBrush(consultant, 'Projet Alpha – Développement');
    await dragAcross(consultant, datesBetween(alphaDays[0], alphaDays[4]));
    for (const d of alphaDays) await expect(cell(consultant, d)).toHaveAttribute('aria-label', /Projet Alpha Développement, 1 jour/);

    await selectBrush(consultant, 'Projet Beta – Documentation', true);
    await cell(consultant, days[5]).click();
    await selectBrush(consultant, 'Congés payés', true);
    await cell(consultant, days[5]).click();
    await expect(cell(consultant, days[5])).toHaveAttribute('aria-label', /Projet Beta Documentation, une demi-journée ; Congés payés, une demi-journée/);

    await expect(consultant.getByText('Modifications non enregistrées')).toBeVisible();
    await consultant.getByRole('button', { name: 'Enregistrer brouillon' }).click();
    await expect(consultant.getByText('Brouillon enregistré')).toBeVisible();
    await expect(consultant.getByText('Modifications non enregistrées')).toBeHidden();
    await expect(consultant.getByText(/6 j saisis/)).toBeVisible();
  });

  test('soumission avec avertissement des jours manquants', async () => {
    const before = mailLinks(VALIDATOR, '/validation/').length;
    await consultant.getByRole('button', { name: 'Soumettre' }).click();
    const dialog = consultant.getByRole('alertdialog');
    await expect(dialog).toContainText(`${days.length - 6} jours ouvrés non renseignés`);
    await dialog.getByRole('button', { name: 'Soumettre quand même' }).click();
    await expect(badge()).toHaveText(STATUS_LABELS.SOUMIS);
    await expect(consultant.getByText('En attente de validation client – la saisie est verrouillée.')).toBeVisible();
    await expect(consultant.getByRole('button', { name: 'Enregistrer brouillon' })).toHaveCount(0);
    firstLink = await nextLink(VALIDATOR, '/validation/', before);
  });

  test('le valideur ne voit que sa mission et rejette avec motif', async ({ page }) => {
    await page.goto(firstLink);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(`CRA de Jean Dupont – ${monthName(month)}`.replace(/^(.*– )(\w)/, (_, a, b) => a + b.toUpperCase()));
    await expect(page.locator('tbody tr')).toHaveCount(5);
    await expect(page.locator('tbody')).not.toContainText('Congés');
    await expect(page.locator('tbody')).not.toContainText('Documentation');
    await expect(page.locator('tfoot')).toContainText('5 j');

    await page.getByRole('button', { name: 'Rejeter' }).click();
    await page.getByRole('button', { name: 'Confirmer le rejet' }).click();
    await expect(page.getByText('Indiquez le motif du rejet.')).toBeVisible();
    await page.getByLabel(/Motif du rejet/).fill(`Le ${frDate(alphaDays[4])} n’a pas été travaillé chez nous.`);
    await page.getByRole('button', { name: 'Confirmer le rejet' }).click();
    await expect(page.getByText('Le CRA a été rejeté')).toBeVisible();
  });

  test('le consultant voit le motif, corrige et soumet à nouveau', async () => {
    await consultant.reload();
    await expect(badge()).toHaveText(STATUS_LABELS.REJETE);
    await expect(consultant.getByText('n’a pas été travaillé chez nous')).toBeVisible();

    await selectBrush(consultant, 'Projet Alpha – Développement');
    await cell(consultant, alphaDays[4]).click(); // re-cliquer retire le jour
    await expect(cell(consultant, alphaDays[4])).toHaveAttribute('aria-label', /non renseigné/);

    const before = mailLinks(VALIDATOR, '/validation/').length;
    await consultant.getByRole('button', { name: 'Soumettre' }).click();
    await consultant.getByRole('alertdialog').getByRole('button', { name: /Soumettre/ }).click();
    await expect(badge()).toHaveText(STATUS_LABELS.SOUMIS);
    const secondLink = await nextLink(VALIDATOR, '/validation/', before);
    expect(secondLink).not.toBe(firstLink);
  });

  test('ancien lien remplacé, nouveau lien validé', async ({ page }) => {
    await page.goto(firstLink);
    await expect(page.getByRole('heading', { name: 'Lien remplacé' })).toBeVisible();

    const links = mailLinks(VALIDATOR, '/validation/');
    await page.goto(links[links.length - 1]);
    await expect(page.locator('tfoot')).toContainText('4 j');
    await page.getByLabel(/Commentaire/).fill('RAS, merci.');
    await page.getByRole('button', { name: 'Valider le CRA' }).click();
    await expect(page.getByText('Merci, le CRA est validé')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Demande déjà traitée : CRA validé.')).toBeVisible();
  });

  test('CRA validé : lecture seule, PDF disponible', async () => {
    await consultant.reload();
    await expect(badge()).toHaveText(STATUS_LABELS.VALIDE);
    await expect(consultant.getByRole('button', { name: 'Soumettre' })).toHaveCount(0);
    await expect(cell(consultant, days[0])).toHaveAttribute('aria-disabled', 'true');
    const pdf = await consultant.request.get(`/api/timesheets/${month}/pdf`);
    expect(pdf.headers()['content-type']).toBe('application/pdf');
    expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('admin : historique puis clôture', async ({ browser }) => {
    const admin = await (await browser.newContext({ storageState: adminState })).newPage();
    await admin.goto('/admin');
    await admin.getByLabel('Mois affiché').fill(month);
    const row = admin.locator('tbody tr', { hasText: 'Jean Dupont' }).first();
    await expect(row).toContainText(STATUS_LABELS.VALIDE);
    await expect(row).toContainText('4,5 j'); // 4 j Alpha + ½ j Beta (le ½ j de congé est compté en absence)

    await row.getByRole('button', { name: 'Historique' }).click();
    const history = admin.locator('ol');
    for (const step of ['Soumission', 'Rejet client', 'Validation client', 'CRA validé']) await expect(history).toContainText(step);

    await row.getByRole('button', { name: 'Clôturer' }).click();
    await admin.getByRole('alertdialog').getByRole('button', { name: 'Clôturer' }).click();
    await expect(admin.locator('tbody tr', { hasText: 'Jean Dupont' }).first()).toContainText(STATUS_LABELS.CLOTURE);

    await consultant.reload();
    await expect(badge()).toHaveText(STATUS_LABELS.CLOTURE);
    await expect(consultant.getByText('CRA clôturé par Orkidea')).toBeVisible();
  });
});

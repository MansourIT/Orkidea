import { expect, test } from '@playwright/test';
import { cell, consultantState, monthFromNow, workdays } from './support';

test.use({ storageState: consultantState });

test('mobile : panneau horizontal et glisser au doigt', async ({ page }) => {
  const month = monthFromNow(-2);
  const days = workdays(month).slice(0, 3);
  await page.goto(`/saisie/${month}`);
  await expect(page.getByRole('heading', { name: 'Saisie des temps' })).toBeVisible();

  // Pas de défilement horizontal de la page.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByRole('button', { name: 'Pinceau : Projet Gamma – Formation', exact: true }).click();
  await cell(page, days[0]).scrollIntoViewIfNeeded();

  // Événements tactiles réels (CDP) : appui sur le 1er jour, glisser jusqu'au 3e.
  const cdp = await page.context().newCDPSession(page);
  const points = [];
  for (const d of days) {
    const b = (await cell(page, d).boundingBox())!;
    points.push({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [points[0]] });
  for (let i = 1; i < points.length; i++) {
    for (let k = 1; k <= 4; k++) {
      const x = points[i - 1].x + ((points[i].x - points[i - 1].x) * k) / 4;
      const y = points[i - 1].y + ((points[i].y - points[i - 1].y) * k) / 4;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    }
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

  for (const d of days) await expect(cell(page, d)).toHaveAttribute('aria-label', /Projet Gamma Formation, 1 jour/);
  await page.getByRole('button', { name: 'Enregistrer brouillon' }).click();
  await expect(page.getByText('Brouillon enregistré')).toBeVisible();
});

import { defineConfig, devices } from '@playwright/test';

export const PORT = 8788;
export const BASE_URL = `http://localhost:${PORT}`;

/**
 * Tests de bout en bout sur l'application « comme en production » : un seul Worker (wrangler dev)
 * sert le front construit (front/dist) et l'API, avec une base D1 locale recréée à chaque lancement.
 * Prérequis : npm run build (front).
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1, // une seule base partagée : scénarios exécutés dans l'ordre
  retries: process.env['CI'] ? 1 : 0,
  forbidOnly: !!process.env['CI'],
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL: BASE_URL,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'ordinateur', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } }, testIgnore: /mobile/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile/ },
  ],
});

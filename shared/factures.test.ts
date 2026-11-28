import { describe, expect, it } from 'vitest';
import { buildInvoiceLines, creditLines, formatCents, invoiceNumber, invoiceTotals } from './factures';

describe('facturation', () => {
  it('lignes : jours × TJM par activité, astreinte, interventions et majorations', () => {
    const { lines, problems } = buildInvoiceLines({
      month: '2026-11',
      tjm: 550,
      activities: [
        { label: 'Développement', days: 15.5 },
        { label: 'Réunion', days: 2 },
        { label: 'Vide', days: 0 },
      ],
      onCallDays: 2,
      interventions: [
        { date: '2026-11-07', missionId: 'm', start: '22:30', end: '01:15', reason: null }, // samedi, nuit 2 h 45
        { date: '2026-11-11', missionId: 'm', start: '10:00', end: '11:30', reason: null }, // férié, jour 1 h 30
      ],
      rates: { daily: 80, hourly: 60, nightPct: 50, weekendPct: 100 },
      region: 'metropole',
    });
    expect(problems).toEqual([]);
    expect(lines).toEqual([
      { description: 'Prestation novembre 2026 – Développement', quantity: 15.5, unit: 'jour', unitPrice: 55000 },
      { description: 'Prestation novembre 2026 – Réunion', quantity: 2, unit: 'jour', unitPrice: 55000 },
      { description: 'Astreinte novembre 2026', quantity: 2, unit: 'jour', unitPrice: 8000 },
      { description: 'Interventions d’astreinte novembre 2026', quantity: 4.25, unit: 'heure', unitPrice: 6000 },
      { description: 'Majoration nuit (50 %)', quantity: 2.75, unit: 'heure', unitPrice: 3000 },
      { description: 'Majoration week-end et jours fériés (100 %)', quantity: 4.25, unit: 'heure', unitPrice: 6000 },
    ]);
    // 8525 + 1100 + 160 + 255 + 82,50 + 255 = 10 377,50 € HT
    expect(invoiceTotals(lines, 20)).toEqual({ ht: 1037750, vat: 207550, ttc: 1245300 });
  });

  it('problèmes bloquants : TJM ou tarifs d’astreinte manquants', () => {
    const { problems } = buildInvoiceLines({
      month: '2026-11',
      tjm: null,
      activities: [{ label: 'Dev', days: 1 }],
      onCallDays: 1,
      interventions: [{ date: '2026-11-02', missionId: 'm', start: '10:00', end: '11:00', reason: null }],
      rates: { daily: null, hourly: null, nightPct: null, weekendPct: null },
      region: 'metropole',
    });
    expect(problems).toHaveLength(3);
  });

  it('avoir, numérotation, format monétaire', () => {
    const lines = [{ description: 'X', quantity: 2, unit: 'jour' as const, unitPrice: 50000 }];
    expect(invoiceTotals(creditLines(lines), 20)).toEqual({ ht: -100000, vat: -20000, ttc: -120000 });
    expect(invoiceNumber('FA', 2026, 7)).toBe('FA-2026-0007');
    expect(formatCents(125050)).toBe('1 250,50 €');
  });
});

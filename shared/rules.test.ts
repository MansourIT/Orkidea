import { describe, expect, it } from 'vitest';
import { addMonths, frDate, monthDiff, monthName, todayInParis } from './dates';
import { holidayAt, workingDays } from './holidays';
import { dayRefusal, resolveRules } from './calendar-rules';
import { DEFAULT_SETTINGS } from './settings';
import { isTooOld, missingWorkingDays, submissionDeadline, submissionOpensOn, submissionRefusal } from './submission';

const S = DEFAULT_SETTINGS.submission;

describe('dates', () => {
  it('mois : décalage, écart, libellé', () => {
    expect(addMonths('2026-11', 2)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(monthDiff('2025-12', '2026-11')).toBe(11);
    expect(monthName('2026-11')).toBe('novembre 2026');
    expect(frDate('2026-11-07')).toBe('07/11/2026');
  });

  it('date du jour à Paris (et non en UTC)', () => {
    expect(todayInParis(new Date('2026-11-30T23:30:00Z'))).toBe('2026-12-01');
    expect(todayInParis(new Date('2026-07-31T21:59:00Z'))).toBe('2026-07-31');
  });
});

describe('Alsace-Moselle', () => {
  it('Vendredi saint et Saint-Étienne en plus', () => {
    expect(holidayAt('2026-04-03', 'alsace-moselle')?.code).toBe('vendredi-saint');
    expect(holidayAt('2026-04-03')).toBeNull();
    expect(workingDays('2025-12', 'alsace-moselle')).toBe(workingDays('2025-12') - 1); // 26/12/2025 = vendredi
  });
});

describe('règles de saisie', () => {
  const travail = { kind: 'travail' as const, label: 'Dev', missionLabel: 'Alpha', startDate: '2026-01-01', endDate: null };

  it('surcharge de mission sur le réglage global ; absences toujours strictes', () => {
    const rules = resolveRules(DEFAULT_SETTINGS.calendar, 'travail', { weekendPolicy: 'AUTORISE', holidayRegion: 'alsace-moselle' });
    expect(rules).toEqual({ weekend: 'AUTORISE', holidays: 'INTERDIT', workedHolidays: [], region: 'alsace-moselle' });
    expect(resolveRules({ ...DEFAULT_SETTINGS.calendar, weekendPolicy: 'AUTORISE' }, 'absence').weekend).toBe('INTERDIT');
  });

  it('Pentecôte travaillée par exception', () => {
    const rules = resolveRules({ ...DEFAULT_SETTINGS.calendar, workedHolidays: ['lundi-pentecote'] }, 'travail');
    expect(dayRefusal('2026-05-25', { ...travail, rules })).toBeNull();
    expect(dayRefusal('2026-05-14', { ...travail, rules })).toBe('Le 14/05/2026 est férié (Ascension) : saisie non autorisée pour Alpha · Dev');
  });

  it('dates de mission', () => {
    const rules = resolveRules(DEFAULT_SETTINGS.calendar, 'travail');
    expect(dayRefusal('2025-12-31', { ...travail, rules })).toBe('Le 31/12/2025 est avant le début de la mission Alpha');
  });
});

describe('soumission', () => {
  it('ouverture selon le paramétrage', () => {
    expect(submissionOpensOn('2026-11', S, 'metropole')).toBe('2026-11-26');
    expect(submissionOpensOn('2026-11', { ...S, opening: 'FIN_DE_MOIS' }, 'metropole')).toBe('2026-11-30');
    expect(submissionOpensOn('2026-11', { ...S, opening: 'TOUJOURS' }, 'metropole')).toBeNull();
  });

  it('refus : avant ouverture, mois futur ; mois passés toujours ouverts', () => {
    expect(submissionRefusal('2026-11', '2026-11-25', S, 'metropole')).toBe('La soumission de novembre 2026 ouvre le 26/11/2026');
    expect(submissionRefusal('2026-11', '2026-11-26', S, 'metropole')).toBeNull();
    expect(submissionRefusal('2026-12', '2026-11-26', S, 'metropole')).toMatch(/mois futur/);
    expect(submissionRefusal('2026-12', '2026-11-26', { ...S, futureMonths: true }, 'metropole')).toBeNull();
    expect(submissionRefusal('2026-10', '2026-11-02', S, 'metropole')).toBeNull();
  });

  it('ancienneté, jours manquants, date limite', () => {
    expect(isTooOld('2026-08', '2026-11-27', S)).toBe(false);
    expect(isTooOld('2026-07', '2026-11-27', S)).toBe(true);
    expect(missingWorkingDays('2026-11', [{ date: '2026-11-02', activityId: 'a', quantity: 0.5 }], 'metropole')).toHaveLength(20);
    expect(submissionDeadline('2026-11', S, 'metropole')).toBe('2026-12-03');
  });
});

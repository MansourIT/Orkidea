import { describe, expect, it } from 'vitest';
import { easterSunday, frenchHolidays, isValidMonth, monthDays, workingDays } from './holidays';

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe('jours fériés', () => {
  it.each([
    [2024, '2024-03-31'],
    [2025, '2025-04-20'],
    [2026, '2026-04-05'],
    [2027, '2027-03-28'],
    [2028, '2028-04-16'],
    [2030, '2030-04-21'],
  ])('Pâques %i = %s', (year, date) => {
    expect(iso(easterSunday(year))).toBe(date);
  });

  it('fêtes mobiles 2025 et 2026 (Lundi de Pâques, Ascension, Pentecôte)', () => {
    const h25 = frenchHolidays(2025);
    expect(h25['2025-04-21']).toBe('Lundi de Pâques');
    expect(h25['2025-05-29']).toBe('Ascension');
    expect(h25['2025-06-09']).toBe('Lundi de Pentecôte');
    const h26 = frenchHolidays(2026);
    expect(h26['2026-04-06']).toBe('Lundi de Pâques');
    expect(h26['2026-05-14']).toBe('Ascension');
    expect(h26['2026-05-25']).toBe('Lundi de Pentecôte');
  });

  it('11 jours fériés par an', () => {
    expect(Object.keys(frenchHolidays(2026))).toHaveLength(11);
  });

  it('novembre 2026 : 30 jours, commence un dimanche, 20 jours ouvrés', () => {
    const days = monthDays('2026-11');
    expect(days).toHaveLength(30);
    expect(days[0]).toMatchObject({ date: '2026-11-01', weekday: 7, weekend: true, holiday: 'Toussaint' });
    expect(days[10]).toMatchObject({ date: '2026-11-11', weekday: 3, holiday: 'Armistice 1918' });
    expect(workingDays('2026-11')).toBe(20);
  });

  it('février bissextile et mai 2026', () => {
    expect(monthDays('2028-02')).toHaveLength(29);
    // Mai 2026 : 21 jours de semaine − 1er, 8, 14 (Ascension), 25 (Pentecôte) = 17
    expect(workingDays('2026-05')).toBe(17);
  });

  it('valide le format de mois', () => {
    expect(isValidMonth('2026-11')).toBe(true);
    expect(isValidMonth('2026-13')).toBe(false);
    expect(isValidMonth('2026-1')).toBe(false);
  });
});

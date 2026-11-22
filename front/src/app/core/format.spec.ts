import { formatDays, initials, monthTitle } from './format';

describe('format', () => {
  it('formate les jours à la française', () => {
    expect(formatDays(1)).toBe('1 j');
    expect(formatDays(0.5)).toBe('½ j');
    expect(formatDays(12.5)).toBe('12,5 j');
    expect(formatDays(0)).toBe('0 j');
  });

  it('initiales et titre de mois', () => {
    expect(initials('Jean Dupont')).toBe('JD');
    expect(initials('Marie Claire de La Tour')).toBe('MT');
    expect(initials('Admin')).toBe('A');
    expect(monthTitle('2026-11')).toBe('Novembre 2026');
  });
});

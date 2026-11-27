import { describe, expect, it } from 'vitest';
import { checkEntries } from '../src/modules/timesheets/check-entries';
import type { Activity, Entry } from '../../shared/types';
import type { DayRules } from '../../shared/settings';

const STRICT: DayRules = { weekend: 'INTERDIT', holidays: 'INTERDIT', workedHolidays: [], region: 'metropole' };

const acts: Activity[] = [
  { id: 'dev', missionId: 'm1', missionLabel: 'Alpha', clientName: 'C', label: 'Dev', code: 'DEV', kind: 'travail', color: '#000', startDate: '2026-11-05', endDate: '2026-11-20', rules: STRICT },
  { id: 'cp', missionId: null, missionLabel: null, clientName: null, label: 'CP', code: 'CP', kind: 'absence', color: '#000', startDate: null, endDate: null, rules: STRICT },
  { id: 'astreinte', missionId: 'm2', missionLabel: 'Beta', clientName: 'C', label: 'Astreinte', code: 'AST', kind: 'travail', color: '#000', startDate: null, endDate: null, rules: { ...STRICT, weekend: 'AUTORISE', workedHolidays: ['armistice'] } },
];

const e = (date: string, activityId = 'dev', quantity: number = 1) => ({ date, activityId, quantity }) as Entry;

describe('checkEntries', () => {
  it('accepte une saisie valide', () => {
    expect(checkEntries('2026-11', [e('2026-11-05'), e('2026-11-06', 'dev', 0.5), e('2026-11-06', 'cp', 0.5)], acts)).toEqual([]);
  });

  it('refuse une date hors du mois', () => {
    expect(checkEntries('2026-11', [e('2026-10-31', 'cp')], acts)).toEqual(['Date hors du mois : 2026-10-31']);
  });

  it('refuse une activité inconnue', () => {
    expect(checkEntries('2026-11', [e('2026-11-10', 'x')], acts)).toEqual(['Activité inconnue le 2026-11-10']);
  });

  it('refuse une quantité autre que 0,5 ou 1', () => {
    expect(checkEntries('2026-11', [e('2026-11-10', 'dev', 0.25)], acts)).toEqual(['Quantité invalide le 2026-11-10 (0,5 ou 1 jour)']);
  });

  it('refuse une date hors des dates de la mission (pas pour les absences)', () => {
    expect(checkEntries('2026-11', [e('2026-11-04'), e('2026-11-23'), e('2026-11-03', 'cp', 0.5)], acts)).toEqual([
      'Le 2026-11-04 est en dehors des dates de la mission Alpha',
      'Le 2026-11-23 est en dehors des dates de la mission Alpha',
    ]);
  });

  it('refuse plus d’une journée par date et les doublons', () => {
    expect(checkEntries('2026-11', [e('2026-11-10'), e('2026-11-10', 'cp', 0.5)], acts)).toEqual(["Plus d'une journée saisie le 2026-11-10"]);
    expect(checkEntries('2026-11', [e('2026-11-10', 'dev', 0.5), e('2026-11-10', 'dev', 0.5)], acts)).toEqual(['Doublon le 2026-11-10']);
  });

  it('refuse un format invalide ou trop de lignes', () => {
    expect(checkEntries('2026-11', 'x' as unknown as Entry[], acts)).toEqual(['Format de saisie invalide']);
    expect(checkEntries('2026-11', Array.from({ length: 125 }, () => e('2026-11-10', 'cp', 0.5)), acts)).toEqual(['Trop de lignes de saisie']);
  });

  it('refuse les week-ends et jours fériés sauf si la mission l’autorise', () => {
    expect(checkEntries('2026-11', [e('2026-11-14'), e('2026-11-11'), e('2026-11-07', 'cp')], acts)).toEqual([
      'Le 14/11/2026 est un week-end : saisie non autorisée pour Alpha · Dev',
      'Le 11/11/2026 est férié (Armistice 1918) : saisie non autorisée pour Alpha · Dev',
      'Le 07/11/2026 est un week-end : saisie non autorisée pour CP',
    ]);
    expect(checkEntries('2026-11', [e('2026-11-14', 'astreinte'), e('2026-11-11', 'astreinte')], acts)).toEqual([]);
  });
});

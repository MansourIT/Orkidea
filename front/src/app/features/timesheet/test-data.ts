// Données de test partagées par les specs de la saisie.
import type { Activity, ClientConfig, Timesheet } from '@shared/types';
import { DEFAULT_SETTINGS, type DayRules } from '@shared/settings';

export const MONTH = '2026-11';
const STRICT: DayRules = { weekend: 'INTERDIT', holidays: 'INTERDIT', workedHolidays: [], region: 'metropole' };

export const CONFIG: ClientConfig = { settings: DEFAULT_SETTINGS, today: '2026-11-27' };

export const ACTIVITIES: Activity[] = [
  { id: 'a-alpha-dev', missionId: 'm-alpha', missionLabel: 'Projet Alpha', clientName: 'Client Alpha', label: 'Développement', code: 'DEV', kind: 'travail', color: '#3B82F6', startDate: '2026-01-01', endDate: null, rules: STRICT },
  { id: 'a-beta-doc', missionId: 'm-beta', missionLabel: 'Projet Beta', clientName: 'Client Beta', label: 'Documentation', code: 'DOC', kind: 'travail', color: '#A855F7', startDate: '2026-01-01', endDate: null, rules: { ...STRICT, weekend: 'AUTORISE' } },
  { id: 'abs-cp', missionId: null, missionLabel: null, clientName: null, label: 'Congés payés', code: 'CP', kind: 'absence', color: '#F2A93B', startDate: null, endDate: null, rules: STRICT },
];

export function timesheet(partial: Partial<Timesheet> = {}): Timesheet {
  return {
    month: MONTH,
    status: 'BROUILLON',
    comment: null,
    entries: [],
    workingDays: 20,
    validations: [],
    submittedAt: null,
    submissionOpensOn: '2026-11-26',
    submissionBlockedReason: null,
    ...partial,
  };
}

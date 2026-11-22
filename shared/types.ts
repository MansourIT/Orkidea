// Types partagés entre le front Angular et l'API Worker.

export type Role = 'consultant' | 'admin';

/** BROUILLON -> SOUMIS -> VALIDE -> CLOTURE ; REJETE renvoie le consultant en saisie. */
export type TimesheetStatus = 'BROUILLON' | 'SOUMIS' | 'VALIDE' | 'REJETE' | 'CLOTURE';

export type ActivityKind = 'travail' | 'absence';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface Activity {
  id: string;
  missionId: string | null; // null = type d'absence commun (congés, RTT, maladie…)
  missionLabel: string | null;
  clientName: string | null;
  label: string;
  kind: ActivityKind;
  color: string;
}

export interface Entry {
  date: string; // YYYY-MM-DD
  activityId: string;
  quantity: 0.5 | 1; // fraction de journée
}

export interface ValidationSummary {
  missionId: string;
  missionLabel: string;
  clientName: string;
  status: 'EN_ATTENTE' | 'VALIDE' | 'REJETE';
  comment: string | null;
  decidedAt: string | null;
}

export interface Timesheet {
  month: string; // YYYY-MM
  status: TimesheetStatus;
  comment: string | null;
  entries: Entry[];
  workingDays: number;
  validations: ValidationSummary[];
  submittedAt: string | null;
}

export interface SaveTimesheetBody {
  entries: Entry[];
  comment?: string | null;
}

export const EDITABLE_STATUSES: TimesheetStatus[] = ['BROUILLON', 'REJETE'];

export const STATUS_LABELS: Record<TimesheetStatus, string> = {
  BROUILLON: 'Brouillon',
  SOUMIS: 'En attente de validation',
  VALIDE: 'Validé',
  REJETE: 'Rejeté – à corriger',
  CLOTURE: 'Clôturé',
};


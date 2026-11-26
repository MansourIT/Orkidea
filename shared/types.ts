// Types partagés entre le front Angular et l'API Worker.
import type { AppSettings, DayRules, MissionCalendarOverrides } from './settings';
import type { HolidayCode, HolidayRegion } from './holidays';

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
  /** Dates de la mission (null pour les absences ou mission sans fin). */
  startDate: string | null;
  endDate: string | null;
  /** Règles de saisie effectives (week-ends, fériés) pour cette activité. */
  rules: DayRules;
  /** Activité désactivée mais encore présente dans des saisies du mois demandé. */
  archived?: boolean;
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
  /** Première date de soumission possible (null = dès le 1er du mois). */
  submissionOpensOn: string | null;
  /** Raison pour laquelle la soumission est impossible aujourd'hui (null = possible). */
  submissionBlockedReason: string | null;
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


/** Statut affiché côté admin / tableau de bord : un CRA jamais ouvert n'existe pas en base. */
export type TimesheetListStatus = TimesheetStatus | 'NON_COMMENCE';

/** Ligne du tableau de bord consultant (GET /api/timesheets?from=&to=). */
export interface TimesheetSummary {
  month: string;
  status: TimesheetListStatus;
  workedDays: number;
  absenceDays: number;
  workingDays: number;
  submittedAt: string | null;
}

/** Configuration exposée au front (GET /api/config). */
export interface ClientConfig {
  settings: AppSettings;
  today: string;
}

/** Ligne du tableau de bord admin (GET /api/admin/timesheets?month=). */
export interface AdminTimesheetRow {
  consultantId: string;
  consultant: string;
  consultantEmail: string;
  id: string | null;
  status: TimesheetListStatus;
  submittedAt: string | null;
  validatedAt: string | null;
  workedDays: number;
  absenceDays: number;
  late: boolean;
}

export interface AdminTimesheetBoard {
  month: string;
  workingDays: number;
  deadline: string;
  rows: AdminTimesheetRow[];
}

/** Détail d'un CRA pour l'administration (GET /api/admin/timesheets/:id/detail). */
export interface AdminTimesheetDetail {
  id: string;
  consultant: { id: string; name: string; email: string };
  timesheet: Timesheet;
  activities: Activity[];
}

export interface AdminUser extends User {
  active: boolean;
  /** Qualification du consultant, reprise dans les contrats (ex. « Architecte logiciel »). */
  qualification: string | null;
}

export interface Client {
  id: string;
  name: string;
  siret: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  /** Signataire du contrat côté client. */
  representativeName: string | null;
  representativeRole: string | null;
  /** Destinataire des contrats (peut différer du valideur des CRA). */
  contractEmail: string | null;
}

/** Champs modifiables d'un client (création et modification). */
export type ClientInput = Omit<Client, 'id'>;

export interface Mission extends MissionCalendarOverrides {
  id: string;
  consultantId: string;
  consultant: string;
  clientId: string;
  client: string;
  label: string;
  startDate: string;
  endDate: string | null;
  tjm: number | null;
  clientValidation: boolean;
  validatorName: string | null;
  validatorEmail: string | null;
  /** Objet de la prestation, lieu, modalités d'exécution et délai de paiement (contrat de prestation). */
  purpose: string | null;
  location: string | null;
  terms: string | null;
  paymentTermsDays: number | null;
  active: boolean;
  activities: Array<{ id: string; label: string; color: string; active: boolean }>;
}

export type TimesheetEventAction = 'SOUMISSION' | 'VALIDATION_CLIENT' | 'REJET_CLIENT' | 'VALIDATION' | 'CLOTURE' | 'REOUVERTURE' | 'RELANCE';

export interface TimesheetEvent {
  action: TimesheetEventAction;
  actorType: 'consultant' | 'admin' | 'client' | 'systeme';
  actor: string;
  fromStatus: TimesheetStatus | null;
  toStatus: TimesheetStatus | null;
  comment: string | null;
  createdAt: string;
}

/** Vue publique du valideur client (GET /api/public/validations/:token). */
export interface PublicValidationView {
  consultant: string;
  month: string;
  mission: string;
  client: string;
  status: 'EN_ATTENTE' | 'VALIDE' | 'REJETE';
  expired: boolean;
  comment: string | null;
  totalDays: number;
  entries: Array<{ date: string; activity: string; quantity: number }>;
}

/** Codes d'erreur stables renvoyés par l'API, en plus du message. */
export type ApiErrorCode = 'LIEN_INVALIDE' | 'LIEN_REMPLACE' | 'LIEN_EXPIRE' | 'DEJA_TRAITE' | 'JOURS_MANQUANTS';

export interface ApiError {
  error: string;
  details?: string[];
  code?: ApiErrorCode;
}

export type { HolidayCode, HolidayRegion };

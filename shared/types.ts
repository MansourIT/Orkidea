// Types partagés entre le front Angular et l'API Worker.
import type { AppSettings, DayRules, MissionCalendarOverrides } from './settings';
import type { HolidayCode, HolidayRegion } from './holidays';
import type { Intervention, OnCallDay, OnCallMission } from './astreintes';

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
  /** Code court affiché dans le calendrier (DEV, REU, CP…). */
  code: string;
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
  /** Jours d'astreinte et interventions du mois. */
  onCall: OnCallDay[];
  interventions: Intervention[];
  /** Missions du consultant ouvertes à l'astreinte (vide : pas d'astreinte à saisir). */
  onCallMissions: OnCallMission[];
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
  /** Absent : astreintes inchangées. */
  onCall?: OnCallDay[];
  interventions?: Intervention[];
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
  /** Astreintes possibles sur cette mission. */
  onCall: boolean;
  /** Objet de la prestation, lieu, modalités d'exécution et délai de paiement (contrat de prestation). */
  purpose: string | null;
  location: string | null;
  terms: string | null;
  paymentTermsDays: number | null;
  active: boolean;
  activities: Array<{ id: string; label: string; code: string; color: string; active: boolean }>;
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
  onCallDays: string[];
  interventions: Array<{ date: string; start: string; end: string; minutes: number; reason: string | null }>;
}

/** Codes d'erreur stables renvoyés par l'API, en plus du message. */
export type ApiErrorCode = 'LIEN_INVALIDE' | 'LIEN_REMPLACE' | 'LIEN_EXPIRE' | 'DEJA_TRAITE' | 'JOURS_MANQUANTS';

export interface ApiError {
  error: string;
  details?: string[];
  code?: ApiErrorCode;
}

export type { HolidayCode, HolidayRegion };
export type { Intervention, OnCallDay, OnCallMission };

// ---------------------------------------------------------------- Modèles de contrat

export type TemplateVersionStatus = 'BROUILLON' | 'PUBLIEE';

/** Ligne de la liste des modèles (GET /api/admin/contract-templates). */
export interface ContractTemplateSummary {
  id: string;
  name: string;
  description: string | null;
  archived: boolean;
  createdAt: string;
  /** Dernière version publiée (utilisée pour générer les contrats). */
  published: { version: number; publishedAt: string } | null;
  /** Brouillon en cours (au plus un par modèle). */
  draft: { version: number; updatedAt: string } | null;
  contractsCount: number;
}

export interface TemplateVersionInfo {
  version: number;
  status: TemplateVersionStatus;
  updatedAt: string;
  updatedBy: string | null;
  publishedAt: string | null;
  publishedBy: string | null;
}

/** Modèle ouvert dans l'éditeur (GET /api/admin/contract-templates/:id). */
export interface ContractTemplateDetail extends ContractTemplateSummary {
  versions: TemplateVersionInfo[];
  draftBody: string | null;
  publishedBody: string | null;
}

// ---------------------------------------------------------------- Contrats générés

/** BROUILLON (texte ajustable) → EMIS (numéroté, PDF figé) → ENVOYE → SIGNE ; ANNULE à tout moment avant signature. */
export type ContractStatus = 'BROUILLON' | 'EMIS' | 'ENVOYE' | 'SIGNE' | 'ANNULE';

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  BROUILLON: 'Brouillon',
  EMIS: 'Émis',
  ENVOYE: 'Envoyé',
  SIGNE: 'Signé',
  ANNULE: 'Annulé',
};

export type ContractEventAction = 'CREATION' | 'MODIFICATION' | 'EMISSION' | 'ENVOI' | 'SIGNATURE' | 'ANNULATION';

export interface ContractSummary {
  id: string;
  number: string | null;
  status: ContractStatus;
  mission: { id: string; label: string };
  client: string;
  consultant: string;
  template: { id: string; name: string; version: number };
  createdAt: string;
  issuedAt: string | null;
  sentAt: string | null;
  /** Date de signature (YYYY-MM-DD) saisie au dépôt du PDF signé. */
  signedOn: string | null;
  updatedAt: string;
}

export interface ContractEvent {
  action: ContractEventAction;
  actor: string;
  comment: string | null;
  createdAt: string;
}

/** Contrat ouvert (GET /api/admin/contracts/:id). */
export interface ContractDetail extends ContractSummary {
  /**
   * Texte source : modèle + ajustements, variables comprises. Les valeurs sont celles de `data`
   * (calculées à l'instant pour un brouillon, figées à l'émission ensuite).
   */
  body: string;
  /** Texte de la version du modèle, pour mesurer les ajustements. */
  templateBody: string;
  data: Record<string, string | boolean | null>;
  /** Variables vides : l'émission est impossible tant que la liste n'est pas vide. */
  missing: string[];
  pdfSha256: string | null;
  signedPdfSha256: string | null;
  cancelReason: string | null;
  events: ContractEvent[];
}

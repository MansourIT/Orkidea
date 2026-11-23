// Paramétrage Orkidea : règles de calendrier (valeurs par défaut, surchargées par mission) et règles de soumission.
import type { HolidayCode, HolidayRegion } from './holidays';

/** Saisie possible ou non sur les jours non ouvrés. */
export type DayPolicy = 'INTERDIT' | 'AUTORISE';
export const DAY_POLICIES: DayPolicy[] = ['INTERDIT', 'AUTORISE'];

export interface CalendarSettings {
  weekendPolicy: DayPolicy;
  holidayPolicy: DayPolicy;
  /** Jours fériés travaillés par exception, même si holidayPolicy = INTERDIT (ex. lundi-pentecote). */
  workedHolidays: HolidayCode[];
  holidayRegion: HolidayRegion;
}

/**
 * Ouverture de la soumission pour le mois en cours :
 * - TOUJOURS : dès le 1er du mois ;
 * - DERNIERS_JOURS_OUVRES : à partir du Nème dernier jour ouvré (opensDays) ;
 * - FIN_DE_MOIS : à partir du dernier jour ouvré.
 */
export type SubmissionOpening = 'TOUJOURS' | 'DERNIERS_JOURS_OUVRES' | 'FIN_DE_MOIS';
export const SUBMISSION_OPENINGS: SubmissionOpening[] = ['TOUJOURS', 'DERNIERS_JOURS_OUVRES', 'FIN_DE_MOIS'];

/** Jours ouvrés non renseignés : simple avertissement, ou soumission bloquée. */
export type Completeness = 'AVERTIR' | 'BLOQUER';

export interface SubmissionSettings {
  opening: SubmissionOpening;
  opensDays: number;
  futureMonths: boolean;
  completeness: Completeness;
  /** Nombre de mois passés encore modifiables / soumettables (hors CRA rejeté). */
  pastMonthsLimit: number;
  /** Date limite : Nème jour ouvré du mois suivant (badge « en retard », relances). */
  deadlineWorkingDay: number;
}

export interface AppSettings {
  calendar: CalendarSettings;
  submission: SubmissionSettings;
}

export const DEFAULT_SETTINGS: AppSettings = {
  calendar: { weekendPolicy: 'INTERDIT', holidayPolicy: 'INTERDIT', workedHolidays: [], holidayRegion: 'metropole' },
  submission: { opening: 'DERNIERS_JOURS_OUVRES', opensDays: 3, futureMonths: false, completeness: 'AVERTIR', pastMonthsLimit: 3, deadlineWorkingDay: 3 },
};

/** Surcharges de calendrier portées par une mission (null = hérite du réglage global). */
export interface MissionCalendarOverrides {
  weekendPolicy: DayPolicy | null;
  holidayPolicy: DayPolicy | null;
  workedHolidays: HolidayCode[] | null;
  holidayRegion: HolidayRegion | null;
}

/** Règles effectives pour une activité. */
export interface DayRules {
  weekend: DayPolicy;
  holidays: DayPolicy;
  workedHolidays: HolidayCode[];
  region: HolidayRegion;
}

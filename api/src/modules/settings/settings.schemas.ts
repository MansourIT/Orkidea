import { z } from '../../core/router';
import { HOLIDAY_CODES, HOLIDAY_REGIONS } from '../../../../shared/holidays';
import { DAY_POLICIES, SUBMISSION_OPENINGS } from '../../../../shared/settings';

export const DayPolicySchema = z.enum(DAY_POLICIES as ['INTERDIT', 'AUTORISE']);
export const HolidayCodeSchema = z.enum(HOLIDAY_CODES);
export const HolidayRegionSchema = z.enum(HOLIDAY_REGIONS as ['metropole', 'alsace-moselle']);

export const CalendarSettingsSchema = z.object({
  weekendPolicy: DayPolicySchema,
  holidayPolicy: DayPolicySchema,
  workedHolidays: z.array(HolidayCodeSchema).max(HOLIDAY_CODES.length),
  holidayRegion: HolidayRegionSchema,
});

export const SubmissionSettingsSchema = z.object({
  opening: z.enum(SUBMISSION_OPENINGS as ['TOUJOURS', 'DERNIERS_JOURS_OUVRES', 'FIN_DE_MOIS']),
  opensDays: z.number().int().min(1).max(15),
  futureMonths: z.boolean(),
  completeness: z.enum(['AVERTIR', 'BLOQUER']),
  pastMonthsLimit: z.number().int().min(0).max(24),
  deadlineWorkingDay: z.number().int().min(1).max(15),
});

export const AppSettingsSchema = z
  .object({ calendar: CalendarSettingsSchema, submission: SubmissionSettingsSchema })
  .openapi('AppSettings');

const text = (max: number) => z.string().trim().max(max);
const optionalMatch = (re: RegExp, message: string) => z.string().trim().refine((v) => v === '' || re.test(v), message);

/** Identité d'Orkidea pour les contrats : chaque champ peut rester vide tant qu'aucun contrat n'est émis. */
export const CompanySettingsSchema = z
  .object({
    legalName: text(120).min(1, 'Raison sociale obligatoire'),
    legalForm: text(40),
    capital: text(40),
    siret: optionalMatch(/^\d{14}$/, 'SIRET invalide (14 chiffres)'),
    rcs: text(80),
    vatNumber: optionalMatch(/^FR[0-9A-Z]{2}\d{9}$/, 'N° de TVA invalide (ex. FR12345678901)'),
    address: text(200),
    postalCode: text(10),
    city: text(80),
    representativeName: text(120),
    representativeRole: text(80),
    financialGuarantee: text(300),
    contractNumberPrefix: z.string().trim().regex(/^[A-Z]{1,6}$/, 'Préfixe : 1 à 6 lettres majuscules'),
  })
  .openapi('CompanySettings');

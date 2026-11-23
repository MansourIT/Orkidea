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

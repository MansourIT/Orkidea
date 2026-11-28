// Facturation : paramètres, lignes, calcul des montants (en centimes) depuis un CRA validé.
import { interventionMinutes, nightMinutes, type Intervention } from './astreintes';
import { frenchHolidays, type HolidayRegion } from './holidays';
import { MONTH_NAMES } from './dates';

export interface InvoiceSettings {
  /** Préfixe des numéros : FA → FA-2026-0001 (avoirs : AV-2026-0001). */
  prefix: string;
  creditPrefix: string;
  /** Taux de TVA en % (20 par défaut). */
  vatRate: number;
  /** Option pour le paiement de la TVA d'après les débits (mention obligatoire sur la facture). */
  vatOnDebits: boolean;
  /** Délai de paiement par défaut (jours) si la mission n'en a pas. */
  defaultPaymentDays: number;
  /** Taux des pénalités de retard, tel qu'il figure sur la facture. */
  latePenalty: string;
  iban: string;
  bic: string;
}

export const DEFAULT_INVOICE_SETTINGS: InvoiceSettings = {
  prefix: 'FA',
  creditPrefix: 'AV',
  vatRate: 20,
  vatOnDebits: false,
  defaultPaymentDays: 30,
  latePenalty: 'trois fois le taux d’intérêt légal',
  iban: '',
  bic: '',
};

export type InvoiceKind = 'FACTURE' | 'AVOIR';
export type InvoiceStatus = 'BROUILLON' | 'EMISE' | 'ENVOYEE' | 'PAYEE';

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  BROUILLON: 'Brouillon',
  EMISE: 'Émise',
  ENVOYEE: 'Envoyée',
  PAYEE: 'Payée',
};

export type InvoiceUnit = 'jour' | 'heure' | 'forfait';

export interface InvoiceLine {
  description: string;
  quantity: number;
  unit: InvoiceUnit;
  /** Prix unitaire HT en centimes. */
  unitPrice: number;
}

export interface InvoiceTotals {
  ht: number;
  vat: number;
  ttc: number;
}

export const toCents = (euros: number) => Math.round(euros * 100);
export const lineTotal = (l: InvoiceLine) => Math.round(l.quantity * l.unitPrice);

/** Totaux en centimes : TVA calculée sur le total HT, arrondie au centime. */
export function invoiceTotals(lines: InvoiceLine[], vatRate: number): InvoiceTotals {
  const ht = lines.reduce((n, l) => n + lineTotal(l), 0);
  const vat = Math.round((ht * vatRate) / 100);
  return { ht, vat, ttc: ht + vat };
}

/** 125050 → « 1 250,50 € » (espaces insécables fines). */
export function formatCents(cents: number): string {
  return `${(cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\s/g, ' ')} €`;
}

/** Numéro : préfixe, année, rang sur 4 chiffres (FA-2026-0001). */
export function invoiceNumber(prefix: string, year: number, rank: number): string {
  return `${prefix}-${year}-${String(rank).padStart(4, '0')}`;
}

export const monthLabel = (month: string) => `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

export interface BillingInput {
  month: string;
  tjm: number | null;
  /** Jours saisis par activité de la mission (activités de travail seulement). */
  activities: Array<{ label: string; days: number }>;
  onCallDays: number;
  interventions: Intervention[];
  rates: { daily: number | null; hourly: number | null; nightPct: number | null; weekendPct: number | null };
  region: HolidayRegion;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Lignes d'une facture mensuelle : jours × TJM par activité, forfait d'astreinte, heures d'intervention et majorations
 * (nuit 21 h → 6 h ; week-end ou férié selon le jour de début, une seule majoration de ce type par intervention).
 * Retourne aussi les problèmes bloquants (TJM ou tarif d'astreinte manquant).
 */
export function buildInvoiceLines(input: BillingInput): { lines: InvoiceLine[]; problems: string[] } {
  const lines: InvoiceLine[] = [];
  const problems: string[] = [];
  const period = monthLabel(input.month);
  const worked = input.activities.filter((a) => a.days > 0);
  if (worked.length) {
    if (input.tjm === null) problems.push('TJM de la mission non renseigné');
    else for (const a of worked) lines.push({ description: `Prestation ${period} – ${a.label}`, quantity: a.days, unit: 'jour', unitPrice: toCents(input.tjm) });
  }
  if (input.onCallDays) {
    if (input.rates.daily === null) problems.push('Forfait d’astreinte par jour non renseigné sur la mission');
    else if (input.rates.daily > 0) lines.push({ description: `Astreinte ${period}`, quantity: input.onCallDays, unit: 'jour', unitPrice: toCents(input.rates.daily) });
  }
  if (input.interventions.length) {
    if (input.rates.hourly === null) problems.push('Taux horaire des interventions d’astreinte non renseigné sur la mission');
    else {
      let minutes = 0;
      let night = 0;
      let special = 0;
      const holidays = new Map<number, Record<string, string>>();
      for (const i of input.interventions) {
        const m = interventionMinutes(i.start, i.end);
        const year = Number(i.date.slice(0, 4));
        if (!holidays.has(year)) holidays.set(year, frenchHolidays(year, input.region));
        const weekday = new Date(`${i.date}T00:00:00Z`).getUTCDay();
        minutes += m;
        night += nightMinutes(i.start, i.end);
        if (weekday === 0 || weekday === 6 || holidays.get(year)![i.date]) special += m;
      }
      const hourly = toCents(input.rates.hourly);
      lines.push({ description: `Interventions d’astreinte ${period}`, quantity: round2(minutes / 60), unit: 'heure', unitPrice: hourly });
      const nightPct = input.rates.nightPct ?? 0;
      const weekendPct = input.rates.weekendPct ?? 0;
      if (night && nightPct) lines.push({ description: `Majoration nuit (${nightPct} %)`, quantity: round2(night / 60), unit: 'heure', unitPrice: Math.round((hourly * nightPct) / 100) });
      if (special && weekendPct) {
        lines.push({ description: `Majoration week-end et jours fériés (${weekendPct} %)`, quantity: round2(special / 60), unit: 'heure', unitPrice: Math.round((hourly * weekendPct) / 100) });
      }
    }
  }
  return { lines, problems };
}

/** Lignes d'un avoir : mêmes lignes en quantités négatives (annulation totale). */
export function creditLines(lines: InvoiceLine[]): InvoiceLine[] {
  return lines.map((l) => ({ ...l, quantity: -l.quantity }));
}

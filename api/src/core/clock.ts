import { todayInParis } from '../../../shared/dates';

export const HOUR = 3600_000;
export const DAY = 24 * HOUR;

export function isoIn(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Date métier du jour (Europe/Paris). */
export function today(): string {
  return todayInParis(new Date());
}

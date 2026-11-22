import { monthName } from '@shared/dates';

/** 1 → « 1 j », 0,5 → « ½ j », 12,5 → « 12,5 j ». */
export function formatDays(n: number): string {
  if (n === 0.5) return '½ j';
  return `${n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} j`;
}

/** « Jean Dupont » → « JD ». */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}

/** « novembre 2026 » → « Novembre 2026 ». */
export function monthTitle(month: string): string {
  const s = monthName(month);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

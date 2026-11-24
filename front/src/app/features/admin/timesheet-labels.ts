import type { TimesheetEvent } from '@shared/types';

export const EVENT_LABELS: Record<TimesheetEvent['action'], string> = {
  SOUMISSION: 'Soumission',
  VALIDATION_CLIENT: 'Validation client',
  REJET_CLIENT: 'Rejet client',
  VALIDATION: 'CRA validé',
  CLOTURE: 'Clôture',
  REOUVERTURE: 'Réouverture',
  RELANCE: 'Relance du valideur',
};

export function actorLabel(e: TimesheetEvent): string {
  switch (e.actorType) {
    case 'client':
      return `par le client ${e.actor}`;
    case 'systeme':
      return 'automatique';
    case 'admin':
      return 'par Orkidea';
    default:
      return 'par le consultant';
  }
}

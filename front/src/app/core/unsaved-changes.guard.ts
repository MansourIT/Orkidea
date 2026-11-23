import type { CanDeactivateFn } from '@angular/router';

/** Écran qui peut avoir des modifications non enregistrées. */
export interface HasUnsavedChanges {
  confirmLeave(): Promise<boolean> | boolean;
}

export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = (component) => component.confirmLeave();

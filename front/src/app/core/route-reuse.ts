import { Injectable } from '@angular/core';
import { type ActivatedRouteSnapshot, BaseRouteReuseStrategy } from '@angular/router';

/**
 * Les routes marquées `data: { recreateOnParamChange: true }` ne réutilisent pas leur composant
 * quand les paramètres changent (ex. /saisie/2026-11 → /saisie/2026-12) : l'écran est recréé
 * et la garde « modifications non enregistrées » s'applique aussi au changement de mois.
 */
@Injectable()
export class AppRouteReuseStrategy extends BaseRouteReuseStrategy {
  override shouldReuseRoute(future: ActivatedRouteSnapshot, curr: ActivatedRouteSnapshot): boolean {
    if (future.routeConfig !== curr.routeConfig) return false;
    if (future.routeConfig?.data?.['recreateOnParamChange']) {
      return JSON.stringify(future.params) === JSON.stringify(curr.params);
    }
    return true;
  }
}

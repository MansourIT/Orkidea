import { inject } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';
import { AuthStore } from './auth.store';

// inject() doit être appelé avant tout await (contexte d'injection synchrone).

/** Non connecté → /login. */
export const authGuard: CanActivateFn = async () => {
  const [store, router] = [inject(AuthStore), inject(Router)];
  return (await store.ensureLoaded()) ? true : router.createUrlTree(['/login']);
};

/** Réservé au rôle admin. */
export const adminGuard: CanActivateFn = async () => {
  const [store, router] = [inject(AuthStore), inject(Router)];
  return (await store.ensureLoaded())?.role === 'admin' ? true : router.createUrlTree(['/']);
};

/** Page de connexion : inutile si déjà connecté. */
export const guestGuard: CanActivateFn = async () => {
  const [store, router] = [inject(AuthStore), inject(Router)];
  return (await store.ensureLoaded()) ? router.createUrlTree(['/']) : true;
};

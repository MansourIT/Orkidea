import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthStore } from './auth.store';

/** Session expirée pendant l'utilisation : retour à la page de connexion. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const store = inject(AuthStore);
  const router = inject(Router);
  return next(req).pipe(
    catchError((err: unknown) => {
      const silent = req.url.startsWith('/api/auth/') || req.url.startsWith('/api/public/');
      if (err instanceof HttpErrorResponse && err.status === 401 && !silent) {
        store.set(null);
        void router.navigate(['/login']);
      }
      return throwError(() => err);
    }),
  );
};

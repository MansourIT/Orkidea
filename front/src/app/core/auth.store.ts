import { Injectable, computed, inject, signal } from '@angular/core';
import type { User } from '@shared/types';
import { Api } from './api';

/** Utilisateur connecté (signals). Chargé une fois via /api/auth/me. */
@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly api = inject(Api);
  private loading: Promise<User | null> | null = null;

  readonly user = signal<User | null>(null);
  readonly isAdmin = computed(() => this.user()?.role === 'admin');

  ensureLoaded(): Promise<User | null> {
    this.loading ??= this.api.me().then(
      (u) => this.set(u),
      () => this.set(null),
    );
    return this.loading;
  }

  set(user: User | null): User | null {
    this.user.set(user);
    this.loading = Promise.resolve(user);
    return user;
  }

  async logout(): Promise<void> {
    try {
      await this.api.logout();
    } finally {
      this.set(null);
    }
  }
}

/** Page d'accueil selon le rôle. */
export function homeFor(user: User | null): string {
  return user?.role === 'admin' ? '/admin' : '/';
}

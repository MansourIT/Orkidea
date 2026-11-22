import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  Activity,
  AdminTimesheetBoard,
  AdminUser,
  ApiError,
  Client,
  ClientConfig,
  Entry,
  Mission,
  PublicValidationView,
  Timesheet,
  TimesheetEvent,
  TimesheetSummary,
  User,
} from '@shared/types';
import type { AppSettings } from '@shared/settings';

/** Client HTTP typé de l'API (même origine : cookie de session automatique). */
@Injectable({ providedIn: 'root' })
export class Api {
  private readonly http = inject(HttpClient);

  private get<T>(url: string, params?: Record<string, string>): Promise<T> {
    return firstValueFrom(this.http.get<T>(url, { params }));
  }
  private send<T>(method: 'POST' | 'PUT' | 'PATCH', url: string, body: unknown = {}): Promise<T> {
    return firstValueFrom(this.http.request<T>(method, url, { body }));
  }

  // Authentification
  me = () => this.get<User>('/api/auth/me');
  requestLogin = (email: string) => this.send<{ ok: true }>('POST', '/api/auth/login', { email });
  confirmLogin = (token: string) => this.send<User>('POST', '/api/auth/callback', { token });
  logout = () => this.send<{ ok: true }>('POST', '/api/auth/logout');

  // Consultant
  config = () => this.get<ClientConfig>('/api/config');
  activities = (month?: string) => this.get<Activity[]>('/api/activities', month ? { month } : undefined);
  saveActivityOrder = (ids: string[]) => this.send<{ ok: true }>('PUT', '/api/activities/order', { ids });
  summaries = (from?: string, to?: string) =>
    this.get<TimesheetSummary[]>('/api/timesheets', { ...(from ? { from } : {}), ...(to ? { to } : {}) });
  timesheet = (month: string) => this.get<Timesheet>(`/api/timesheets/${month}`);
  saveTimesheet = (month: string, entries: Entry[], comment: string | null) =>
    this.send<Timesheet>('PUT', `/api/timesheets/${month}`, { entries, comment });
  submitTimesheet = (month: string) => this.send<Timesheet>('POST', `/api/timesheets/${month}/submit`);
  pdfUrl = (month: string) => `/api/timesheets/${month}/pdf`;

  // Valideur client (public)
  validation = (token: string) => this.get<PublicValidationView>(`/api/public/validations/${encodeURIComponent(token)}`);
  decide = (token: string, decision: 'VALIDE' | 'REJETE', comment: string | null) =>
    this.send<{ ok: true }>('POST', `/api/public/validations/${encodeURIComponent(token)}`, { decision, comment });

  // Admin
  board = (month: string) => this.get<AdminTimesheetBoard>('/api/admin/timesheets', { month });
  closeTimesheet = (id: string) => this.send<{ ok: true }>('POST', `/api/admin/timesheets/${id}/close`);
  reopenTimesheet = (id: string, comment?: string) => this.send<{ ok: true }>('POST', `/api/admin/timesheets/${id}/reopen`, { comment });
  resendValidation = (id: string) => this.send<{ ok: true; sent: number }>('POST', `/api/admin/timesheets/${id}/resend`);
  timesheetEvents = (id: string) => this.get<TimesheetEvent[]>(`/api/admin/timesheets/${id}/events`);
  adminPdfUrl = (id: string) => `/api/admin/timesheets/${id}/pdf`;
  users = () => this.get<AdminUser[]>('/api/admin/users');
  createUser = (body: { email: string; name: string; role: 'consultant' | 'admin' }) => this.send<{ id: string }>('POST', '/api/admin/users', body);
  updateUser = (id: string, body: Partial<Omit<AdminUser, 'id'>>) => this.send<AdminUser>('PATCH', `/api/admin/users/${id}`, body);
  clients = () => this.get<Client[]>('/api/admin/clients');
  createClient = (body: { name: string; siret?: string | null }) => this.send<{ id: string }>('POST', '/api/admin/clients', body);
  missions = () => this.get<Mission[]>('/api/admin/missions');
  createMission = (body: Record<string, unknown>) => this.send<{ id: string }>('POST', '/api/admin/missions', body);
  updateMission = (id: string, body: Record<string, unknown>) => this.send<Mission>('PATCH', `/api/admin/missions/${id}`, body);
  settings = () => this.get<AppSettings>('/api/admin/settings');
  saveSettings = (s: AppSettings) => this.send<AppSettings>('PUT', '/api/admin/settings', s);
}

/** Erreur API normalisée (message en français fourni par le serveur). */
export function apiError(err: unknown): ApiError & { status: number } {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as Partial<ApiError> | null;
    if (body && typeof body === 'object' && typeof body.error === 'string') return { ...(body as ApiError), status: err.status };
    if (err.status === 0) return { error: 'Serveur injoignable, vérifiez votre connexion', status: 0 };
    return { error: `Erreur ${err.status}`, status: err.status };
  }
  return { error: 'Erreur inattendue', status: -1 };
}

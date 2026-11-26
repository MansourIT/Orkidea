import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  Activity,
  AdminTimesheetBoard,
  AdminTimesheetDetail,
  AdminUser,
  ApiError,
  Client,
  ClientConfig,
  ClientInput,
  ContractDetail,
  ContractSummary,
  ContractTemplateDetail,
  ContractTemplateSummary,
  Entry,
  Mission,
  PublicValidationView,
  Timesheet,
  TimesheetEvent,
  TimesheetSummary,
  User,
} from '@shared/types';
import type { CompanySettings } from '@shared/company';
import type { AppSettings, MissionCalendarOverrides } from '@shared/settings';

/** Champs modifiables d'une mission (création et modification). */
export interface MissionInput extends MissionCalendarOverrides {
  label: string;
  startDate: string;
  endDate: string | null;
  tjm: number | null;
  clientValidation: boolean;
  validatorName: string | null;
  validatorEmail: string | null;
  purpose: string | null;
  location: string | null;
  terms: string | null;
  paymentTermsDays: number | null;
}

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
  timesheetDetail = (id: string) => this.get<AdminTimesheetDetail>(`/api/admin/timesheets/${id}/detail`);
  closeValidated = (month: string) => firstValueFrom(this.http.post<{ closed: number }>('/api/admin/timesheets/close-validated', {}, { params: { month } }));
  exportUrl = (month: string) => `/api/admin/timesheets/export?month=${month}`;
  adminPdfUrl = (id: string) => `/api/admin/timesheets/${id}/pdf`;
  users = () => this.get<AdminUser[]>('/api/admin/users');
  createUser = (body: { email: string; name: string; role: 'consultant' | 'admin'; qualification?: string | null }) => this.send<{ id: string }>('POST', '/api/admin/users', body);
  updateUser = (id: string, body: Partial<Omit<AdminUser, 'id'>>) => this.send<AdminUser>('PATCH', `/api/admin/users/${id}`, body);
  clients = () => this.get<Client[]>('/api/admin/clients');
  createClient = (body: ClientInput) => this.send<{ id: string }>('POST', '/api/admin/clients', body);
  updateClient = (id: string, body: Partial<ClientInput>) => this.send<Client>('PATCH', `/api/admin/clients/${id}`, body);
  updateActivity = (id: string, body: { label?: string; color?: string; active?: boolean }) =>
    this.send<{ id: string; label: string; color: string; active: boolean }>('PATCH', `/api/admin/activities/${id}`, body);
  missions = () => this.get<Mission[]>('/api/admin/missions');
  createMission = (body: MissionInput & { consultantId: string; clientId: string; color?: string; activities?: string[] }) =>
    this.send<{ id: string }>('POST', '/api/admin/missions', body);
  updateMission = (id: string, body: Partial<MissionInput> & { active?: boolean; color?: string; addActivities?: string[] }) =>
    this.send<Mission>('PATCH', `/api/admin/missions/${id}`, body);
  settings = () => this.get<AppSettings>('/api/admin/settings');
  saveSettings = (s: AppSettings) => this.send<AppSettings>('PUT', '/api/admin/settings', s);
  // Modèles de contrat
  templates = () => this.get<ContractTemplateSummary[]>('/api/admin/contract-templates');
  template = (id: string) => this.get<ContractTemplateDetail>(`/api/admin/contract-templates/${id}`);
  createTemplate = (body: { name: string; description?: string | null; body: string }) => this.send<{ id: string }>('POST', '/api/admin/contract-templates', body);
  updateTemplate = (id: string, body: { name?: string; description?: string | null; archived?: boolean }) =>
    this.send<ContractTemplateDetail>('PATCH', `/api/admin/contract-templates/${id}`, body);
  saveTemplateDraft = (id: string, body: string, baseUpdatedAt: string | null) =>
    this.send<ContractTemplateDetail>('PUT', `/api/admin/contract-templates/${id}/draft`, { body, baseUpdatedAt });
  discardTemplateDraft = (id: string) => firstValueFrom(this.http.delete<ContractTemplateDetail>(`/api/admin/contract-templates/${id}/draft`));
  publishTemplate = (id: string) => this.send<ContractTemplateDetail>('POST', `/api/admin/contract-templates/${id}/publish`);
  templateVersion = (id: string, version: number) => this.get<{ version: number; body: string }>(`/api/admin/contract-templates/${id}/versions/${version}`);

  // Contrats générés
  contracts = (missionId?: string) => this.get<ContractSummary[]>('/api/admin/contracts', missionId ? { missionId } : undefined);
  contract = (id: string) => this.get<ContractDetail>(`/api/admin/contracts/${id}`);
  createContract = (missionId: string, templateId: string) => this.send<{ id: string }>('POST', '/api/admin/contracts', { missionId, templateId });
  saveContractBody = (id: string, body: string, baseUpdatedAt: string) => this.send<ContractDetail>('PUT', `/api/admin/contracts/${id}/body`, { body, baseUpdatedAt });
  resetContract = (id: string) => this.send<ContractDetail>('POST', `/api/admin/contracts/${id}/reset`);
  issueContract = (id: string, baseUpdatedAt: string) => this.send<ContractDetail>('POST', `/api/admin/contracts/${id}/issue`, { baseUpdatedAt });
  cancelContract = (id: string, reason: string) => this.send<ContractDetail>('POST', `/api/admin/contracts/${id}/cancel`, { reason });
  contractPdfUrl = (id: string) => `/api/admin/contracts/${id}/pdf`;
  contractDraftPdfUrl = (id: string) => `/api/admin/contracts/${id}/draft.pdf`;
  contractSignedPdfUrl = (id: string) => `/api/admin/contracts/${id}/signed.pdf`;
  markContractSent = (id: string, comment?: string) => this.send<ContractDetail>('POST', `/api/admin/contracts/${id}/sent`, { comment });
  uploadSignedContract = (id: string, file: Blob, signedOn: string) =>
    firstValueFrom(this.http.put<ContractDetail>(`/api/admin/contracts/${id}/signed`, file, { params: { signedOn }, headers: { 'content-type': 'application/pdf' } }));

  company = () => this.get<CompanySettings>('/api/admin/company');
  saveCompany = (c: CompanySettings) => this.send<CompanySettings>('PUT', '/api/admin/company', c);
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

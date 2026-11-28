import type { Routes } from '@angular/router';
import { monthOf, todayInParis } from '@shared/dates';
import { isValidMonth } from '@shared/holidays';
import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { adminGuard, authGuard, guestGuard } from './core/guards';
import { unsavedChangesGuard } from './core/unsaved-changes.guard';
import { Shell } from './layout/shell';

const T = (s: string) => `${s} · Orkidea CRA`;

export const currentMonth = () => monthOf(todayInParis());

/** /saisie/:month : mois invalide → mois courant. */
const validMonth: CanActivateFn = (route) =>
  isValidMonth(route.paramMap.get('month') ?? '') ? true : inject(Router).createUrlTree(['/saisie', currentMonth()]);

export const routes: Routes = [
  { path: 'login', title: T('Connexion'), canActivate: [guestGuard], loadComponent: () => import('./features/login/login-page').then((m) => m.LoginPage) },
  { path: 'connexion', title: T('Connexion'), loadComponent: () => import('./features/login/callback-page').then((m) => m.CallbackPage) },
  {
    path: 'validation/:token',
    title: T('Validation du CRA'),
    loadComponent: () => import('./features/validation/validation-page').then((m) => m.ValidationPage),
  },
  {
    path: '',
    component: Shell,
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: () => `/saisie/${currentMonth()}` },
      {
        path: 'saisie/:month',
        title: T('Saisie des temps'),
        canActivate: [validMonth],
        canDeactivate: [unsavedChangesGuard],
        data: { recreateOnParamChange: true },
        loadComponent: () => import('./features/timesheet/timesheet-page').then((m) => m.TimesheetPage),
      },
      { path: 'tableau-de-bord', title: T('Tableau de bord'), loadComponent: () => import('./features/dashboard/dashboard-page').then((m) => m.DashboardPage) },
      {
        path: 'admin/modeles/:id',
        title: T('Modèle de contrat'),
        canActivate: [adminGuard],
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () => import('./features/contracts/template-editor-page').then((m) => m.TemplateEditorPage),
      },
      {
        path: 'admin/contrats/:id',
        title: T('Contrat de prestation'),
        canActivate: [adminGuard],
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () => import('./features/contracts/contract-page').then((m) => m.ContractPage),
      },
      {
        path: 'admin/factures/:id',
        title: T('Facture'),
        canActivate: [adminGuard],
        canDeactivate: [unsavedChangesGuard],
        data: { recreateOnParamChange: true }, // avoir ↔ facture d'origine : nouvelle instance
        loadComponent: () => import('./features/invoices/invoice-page').then((m) => m.InvoicePage),
      },
      { path: 'admin', title: T('Administration'), canActivate: [adminGuard], canDeactivate: [unsavedChangesGuard], loadComponent: () => import('./features/admin/admin-page').then((m) => m.AdminPage) },
    ],
  },
  { path: '**', redirectTo: '' },
];

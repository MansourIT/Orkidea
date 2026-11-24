import { ChangeDetectionStrategy, Component, computed, inject, input, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import type { HasUnsavedChanges } from '../../core/unsaved-changes.guard';
import { Confirm } from '../../ui/confirm-dialog';
import { type Tab, Tabs } from '../../ui/tabs';
import { AdminClients } from './admin-clients';
import { AdminMissions } from './admin-missions';
import { AdminSettings } from './admin-settings';
import { AdminTimesheets } from './admin-timesheets';
import { AdminUsers } from './admin-users';

type TabId = 'cra' | 'consultants' | 'clients' | 'missions' | 'parametres';

const TABS: Tab<TabId>[] = [
  { id: 'cra', label: 'CRA du mois', icon: 'lucideCalendarDays' },
  { id: 'consultants', label: 'Consultants', icon: 'lucideUsers' },
  { id: 'clients', label: 'Clients', icon: 'lucideBuilding2' },
  { id: 'missions', label: 'Missions', icon: 'lucideBriefcase' },
  { id: 'parametres', label: 'Paramètres', icon: 'lucideSettings' },
];

/** Back-office Orkidea. L'onglet est dans l'URL (?onglet=…) pour pouvoir le partager / y revenir. */
@Component({
  selector: 'app-admin-page',
  imports: [Tabs, AdminTimesheets, AdminUsers, AdminClients, AdminMissions, AdminSettings],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="text-2xl font-bold sm:text-3xl">Administration</h1>
    <app-tabs class="mt-5 block" label="Administration" [tabs]="tabs" [active]="tab()" (selected)="select($event)" />
    <div class="mt-5" role="tabpanel" [attr.aria-labelledby]="'onglet-' + tab()">
      @switch (tab()) {
        @case ('cra') { <app-admin-timesheets /> }
        @case ('consultants') { <app-admin-users /> }
        @case ('clients') { <app-admin-clients /> }
        @case ('missions') { <app-admin-missions /> }
        @case ('parametres') { <app-admin-settings /> }
      }
    </div>
  `,
})
export class AdminPage implements HasUnsavedChanges {
  private readonly router = inject(Router);
  private readonly confirm = inject(Confirm);
  private readonly settings = viewChild(AdminSettings);
  readonly onglet = input<string>();
  protected readonly tabs = TABS;
  protected readonly tab = computed<TabId>(() => (TABS.some((t) => t.id === this.onglet()) ? (this.onglet() as TabId) : 'cra'));

  async select(id: TabId): Promise<void> {
    if (id === this.tab() || !(await this.confirmLeave())) return;
    void this.router.navigate([], { queryParams: { onglet: id === 'cra' ? null : id }, replaceUrl: true });
  }

  /** Paramètres modifiés mais non enregistrés : confirmation avant de changer d'onglet ou de page. */
  async confirmLeave(): Promise<boolean> {
    if (!this.settings()?.hasUnsavedChanges()) return true;
    return this.confirm.ask({
      title: 'Paramètres non enregistrés',
      message: 'Vos modifications des paramètres seront perdues.',
      confirmLabel: 'Quitter sans enregistrer',
      cancelLabel: 'Rester',
      tone: 'danger',
    });
  }
}

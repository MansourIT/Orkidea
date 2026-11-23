import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
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
    <app-tabs class="mt-5 block" label="Administration" [tabs]="tabs" [active]="tab()" (activeChange)="select($event)" />
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
export class AdminPage {
  private readonly router = inject(Router);
  readonly onglet = input<string>();
  protected readonly tabs = TABS;
  protected readonly tab = computed<TabId>(() => (TABS.some((t) => t.id === this.onglet()) ? (this.onglet() as TabId) : 'cra'));

  select(id: TabId): void {
    void this.router.navigate([], { queryParams: { onglet: id === 'cra' ? null : id }, replaceUrl: true });
  }
}

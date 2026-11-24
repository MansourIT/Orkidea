import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import type { AdminUser, Client, Mission } from '@shared/types';
import type { AppSettings } from '@shared/settings';
import { Api, apiError } from '../../core/api';
import { MissionForm } from './mission-form';

export interface MissionDrawerData {
  mission: Mission | null;
  consultants: AdminUser[];
  clients: Client[];
  settings: AppSettings | null;
}

/** Panneau latéral de création / modification d'une mission. Se ferme avec `true` si une mission a changé. */
@Component({
  selector: 'app-mission-drawer',
  imports: [NgIcon, MissionForm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside class="flex h-dvh w-[min(100vw,42rem)] flex-col bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="mission-drawer-titre">
      <header class="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
        <div class="min-w-0 flex-1">
          <h2 id="mission-drawer-titre" class="truncate text-lg font-bold">{{ mission() ? mission()!.label : 'Nouvelle mission' }}</h2>
          @if (mission(); as m) { <p class="text-sm text-ink-soft">{{ m.consultant }} · {{ m.client }}</p> }
          @else { <p class="text-sm text-ink-soft">Contrat entre un consultant et un client</p> }
        </div>
        <button type="button" class="btn-ghost p-2" (click)="ref.close(changed)" aria-label="Fermer"><ng-icon name="lucideX" size="18" /></button>
      </header>
      @if (error()) { <p class="alert-error mx-5 mt-4" role="alert">{{ error() }}</p> }
      <div class="flex-1 overflow-y-auto">
        @for (m of [mission()]; track version()) {
          <app-mission-form [mission]="m" [consultants]="data.consultants" [clients]="data.clients" [settings]="data.settings"
                            (saved)="ref.close(true)" (changed)="reload()" (cancelled)="ref.close(changed)" />
        }
      </div>
    </aside>
  `,
})
export class MissionDrawer {
  protected readonly data = inject<MissionDrawerData>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<boolean>>(DialogRef);
  private readonly api = inject(Api);

  protected readonly mission = signal<Mission | null>(this.data.mission);
  /** Incrémenté pour recréer le formulaire avec la mission rechargée. */
  protected readonly version = signal(0);
  protected readonly error = signal<string | null>(null);
  protected changed = false;

  /** Après (dés)activation d'une activité : on recharge la mission sans fermer le panneau. */
  async reload(): Promise<void> {
    this.changed = true;
    try {
      const m = (await this.api.missions()).find((x) => x.id === this.mission()?.id) ?? null;
      this.mission.set(m);
      this.version.update((v) => v + 1);
    } catch (err) {
      this.error.set(apiError(err).error);
    }
  }
}

import { DIALOG_DATA, Dialog, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import type { AdminUser, Client, Mission } from '@shared/types';
import type { AppSettings } from '@shared/settings';
import { Api, apiError } from '../../core/api';
import { ContractList, openGenerateContract } from '../contracts/contract-list';
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
  imports: [NgIcon, MissionForm, ContractList],
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
      @if (mission(); as m) {
        <section class="border-b border-slate-200 bg-slate-50/60 px-5 py-3" aria-labelledby="mission-contrats-titre">
          <div class="mb-2 flex items-center justify-between gap-2">
            <h3 id="mission-contrats-titre" class="text-sm font-semibold">Contrats de prestation</h3>
            <button type="button" class="btn-secondary px-3 py-1 text-xs" (click)="generate(m.id)" [disabled]="!m.active"><ng-icon name="lucideFileText" size="14" aria-hidden="true" /> Générer un contrat</button>
          </div>
          <app-contract-list [missionId]="m.id" [compact]="true" />
        </section>
      }
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
  private readonly dialog = inject(Dialog);
  private readonly router = inject(Router);

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

  /** Ferme le panneau puis ouvre la génération du contrat de cette mission. */
  generate(missionId: string): void {
    this.ref.close(this.changed);
    openGenerateContract(this.dialog, this.router, { missionId });
  }
}

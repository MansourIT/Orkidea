import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import type { AdminUser, Client, Mission } from '@shared/types';
import { Api, apiError } from '../../core/api';
import { MissionForm } from './mission-form';

/** Missions : liste, création, modification (valideur, dates, activités, jours non ouvrés). */
@Component({
  selector: 'app-admin-missions',
  imports: [NgIcon, MissionForm, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-wrap items-center justify-between gap-3">
      <label class="flex items-center gap-2 text-sm text-ink-soft"><input type="checkbox" class="accent-orchid" [checked]="showInactive()" (change)="showInactive.set(!showInactive())" /> Afficher les missions désactivées</label>
      @if (editing() !== 'nouvelle') {
        <button type="button" class="btn-primary" (click)="editing.set('nouvelle')"><ng-icon name="lucidePlus" size="16" aria-hidden="true" /> Nouvelle mission</button>
      }
    </div>

    @if (error()) { <div class="alert-error mt-4" role="alert">{{ error() }}</div> }

    @if (editing() === 'nouvelle') {
      <section class="card mt-4 p-5" aria-labelledby="nouvelle-mission">
        <h3 id="nouvelle-mission" class="mb-4 font-semibold">Nouvelle mission</h3>
        <app-mission-form [consultants]="consultants()" [clients]="clients()" (saved)="onSaved()" (cancelled)="editing.set(null)" />
      </section>
    }

    <ul class="mt-4 space-y-3">
      @for (m of visible(); track m.id) {
        <li class="card p-4" [class.opacity-60]="!m.active && editing() !== m.id">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="font-semibold text-ink">{{ m.label }} <span class="font-normal text-ink-soft">· {{ m.client }}</span></p>
              <p class="text-sm text-ink-soft">
                {{ m.consultant }} · du {{ m.startDate | date: 'dd/MM/yyyy' }}{{ m.endDate ? ' au ' + (m.endDate | date: 'dd/MM/yyyy') : ' (sans fin)' }}
                @if (m.tjm !== null) { · TJM {{ m.tjm }} € }
              </p>
              <div class="mt-2 flex flex-wrap gap-1.5 text-xs">
                @if (m.clientValidation) {
                  <span class="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-800 ring-1 ring-amber/40">Validation client : {{ m.validatorName }} &lt;{{ m.validatorEmail }}&gt;</span>
                } @else {
                  <span class="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">Sans validation client</span>
                }
                @if (m.weekendPolicy === 'AUTORISE') { <span class="rounded-full bg-orchid-50 px-2 py-0.5 text-orchid-700">Week-ends autorisés</span> }
                @if (m.holidayPolicy === 'AUTORISE') { <span class="rounded-full bg-orchid-50 px-2 py-0.5 text-orchid-700">Fériés autorisés</span> }
                @if (!m.active) { <span class="rounded-full bg-slate-200 px-2 py-0.5 text-slate-700">Désactivée</span> }
                @for (a of m.activities; track a.id) {
                  <span class="flex items-center gap-1 rounded-full border border-slate-200 px-2 py-0.5" [class.line-through]="!a.active">
                    <span class="h-2 w-2 rounded-full" [style.background]="a.color" aria-hidden="true"></span>{{ a.label }}
                  </span>
                }
              </div>
            </div>
            @if (editing() !== m.id) {
              <button type="button" class="btn-secondary px-3 py-1.5 text-xs" (click)="editing.set(m.id)"><ng-icon name="lucidePencil" size="14" aria-hidden="true" /> Modifier</button>
            }
          </div>
          @if (editing() === m.id) {
            <div class="mt-4 border-t border-slate-100 pt-4">
              <app-mission-form [mission]="m" (saved)="onSaved(m.id)" (cancelled)="editing.set(null)" />
            </div>
          }
        </li>
      } @empty {
        <li class="card p-10 text-center text-ink-soft">Aucune mission.</li>
      }
    </ul>
  `,
})
export class AdminMissions implements OnInit {
  private readonly api = inject(Api);
  protected readonly missions = signal<Mission[]>([]);
  protected readonly consultants = signal<AdminUser[]>([]);
  protected readonly clients = signal<Client[]>([]);
  protected readonly editing = signal<string | 'nouvelle' | null>(null);
  protected readonly showInactive = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly visible = computed(() => this.missions().filter((m) => m.active || this.showInactive() || this.editing() === m.id));

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const [missions, users, clients] = await Promise.all([this.api.missions(), this.api.users(), this.api.clients()]);
      this.missions.set(missions);
      this.consultants.set(users.filter((u) => u.active));
      this.clients.set(clients);
    } catch (err) {
      this.error.set(apiError(err).error);
    }
  }

  async onSaved(keepEditing?: string): Promise<void> {
    await this.load();
    // Après une action sur une activité, on reste dans le formulaire de la mission ; après création, on le ferme.
    this.editing.set(keepEditing && this.missions().some((m) => m.id === keepEditing) ? keepEditing : null);
  }
}

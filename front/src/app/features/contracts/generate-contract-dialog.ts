import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import type { ContractTemplateSummary, Mission } from '@shared/types';
import { Api, apiError } from '../../core/api';

export interface GenerateContractData {
  /** Mission imposée (depuis le panneau de la mission) ; sinon choix dans la liste. */
  missionId?: string;
}

/** Choix de la mission et du modèle publié ; crée le contrat en brouillon et se ferme avec son id. */
@Component({
  selector: 'app-generate-contract-dialog',
  imports: [NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="w-[min(94vw,32rem)] rounded-2xl bg-white p-6 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="gen-titre" (submit)="$event.preventDefault(); create()" novalidate>
      <h2 id="gen-titre" class="text-lg font-bold">Générer un contrat</h2>
      <p class="mt-1 text-sm text-ink-soft">Le contrat est créé en brouillon : vous pourrez le relire, l’ajuster puis l’émettre. Rien n’est envoyé.</p>

      @if (loading()) {
        <p class="mt-6 flex items-center gap-2 text-sm text-ink-soft" role="status"><ng-icon name="lucideLoaderCircle" size="16" class="animate-spin" aria-hidden="true" /> Chargement…</p>
      } @else {
        @if (!data.missionId) {
          <label for="gen-mission" class="label mt-5">Mission</label>
          <select id="gen-mission" class="input" [value]="missionId()" (change)="missionId.set($any($event.target).value)">
            <option value="">— Choisir —</option>
            @for (m of missions(); track m.id) { <option [value]="m.id" [selected]="m.id === missionId()">{{ m.label }} — {{ m.client }} ({{ m.consultant }})</option> }
          </select>
        } @else if (mission(); as m) {
          <p class="mt-5 rounded-lg bg-slate-50 px-3 py-2 text-sm"><span class="text-ink-soft">Mission :</span> <span class="font-medium">{{ m.label }}</span> · {{ m.client }} · {{ m.consultant }}</p>
        }

        <p class="label mt-4" id="gen-modele">Modèle</p>
        @if (templates().length) {
          <div class="grid gap-2" role="radiogroup" aria-labelledby="gen-modele">
            @for (t of templates(); track t.id) {
              <label class="flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-orchid"
                     [class]="templateId() === t.id ? 'border-orchid bg-orchid-50' : 'border-slate-200 hover:border-slate-300'">
                <input type="radio" name="gen-modele" class="accent-orchid" [checked]="templateId() === t.id" (change)="templateId.set(t.id)" />
                <span class="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{{ t.name }}</span>
                <span class="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">v{{ t.published!.version }}</span>
              </label>
            }
          </div>
        } @else {
          <p class="alert-warning text-sm">Aucun modèle publié. Créez et publiez un modèle dans Contrats › Modèles.</p>
        }
      }

      @if (error()) { <p class="alert-error mt-4" role="alert">{{ error() }}</p> }

      <div class="mt-6 flex justify-end gap-2">
        <button type="button" class="btn-secondary" (click)="ref.close()">Annuler</button>
        <button type="submit" class="btn-primary" [disabled]="busy() || loading() || !templates().length">
          <ng-icon [name]="busy() ? 'lucideLoaderCircle' : 'lucideFileText'" size="16" [class.animate-spin]="busy()" aria-hidden="true" /> Créer le brouillon
        </button>
      </div>
    </form>
  `,
})
export class GenerateContractDialog implements OnInit {
  protected readonly data = inject<GenerateContractData>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<string>>(DialogRef);
  private readonly api = inject(Api);

  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly missions = signal<Mission[]>([]);
  protected readonly templates = signal<ContractTemplateSummary[]>([]);
  protected readonly missionId = signal(this.data.missionId ?? '');
  protected readonly templateId = signal('');
  protected readonly mission = computed(() => this.missions().find((m) => m.id === this.missionId()) ?? null);

  async ngOnInit(): Promise<void> {
    try {
      const [missions, templates] = await Promise.all([this.api.missions(), this.api.templates()]);
      this.missions.set(missions.filter((m) => m.active));
      const usable = templates.filter((t) => t.published && !t.archived);
      this.templates.set(usable);
      if (usable.length === 1) this.templateId.set(usable[0].id);
    } catch (err) {
      this.error.set(apiError(err).error);
    } finally {
      this.loading.set(false);
    }
  }

  async create(): Promise<void> {
    if (!this.missionId()) return this.error.set('Choisissez une mission.');
    if (!this.templateId()) return this.error.set('Choisissez un modèle.');
    this.busy.set(true);
    this.error.set(null);
    try {
      const { id } = await this.api.createContract(this.missionId(), this.templateId());
      this.ref.close(id);
    } catch (err) {
      this.error.set(apiError(err).error);
    } finally {
      this.busy.set(false);
    }
  }
}

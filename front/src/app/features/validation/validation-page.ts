import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { formatMinutes } from '@shared/astreintes';
import type { ApiErrorCode, PublicValidationView } from '@shared/types';
import { WEEKDAY_NAMES, frDate } from '@shared/dates';
import { Api, apiError } from '../../core/api';
import { formatDays, monthTitle } from '../../core/format';
import { Logo } from '../../layout/logo';

type State =
  | { kind: 'chargement' }
  | { kind: 'erreur'; code: ApiErrorCode | null; message: string }
  | { kind: 'vue'; view: PublicValidationView };

const ERRORS: Partial<Record<ApiErrorCode, { title: string; text: string }>> = {
  LIEN_INVALIDE: { title: 'Lien invalide', text: 'Ce lien de validation n’existe pas. Vérifiez qu’il a été copié en entier depuis l’email.' },
  LIEN_REMPLACE: {
    title: 'Lien remplacé',
    text: 'Le consultant a soumis une nouvelle version de ce CRA. Un nouvel email de validation vous a été envoyé : utilisez le lien le plus récent.',
  },
  LIEN_EXPIRE: { title: 'Lien expiré', text: 'Ce lien n’est plus valable (30 jours). Contactez le consultant ou Orkidea pour recevoir un nouveau lien.' },
  DEJA_TRAITE: { title: 'Demande déjà traitée', text: 'Une décision a déjà été enregistrée pour cette demande.' },
};

/** Page publique du valideur client (lien reçu par email, sans compte). Il ne voit que les jours de sa mission. */
@Component({
  selector: 'app-validation-page',
  imports: [NgIcon, Logo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="min-h-dvh">
      <header class="border-b border-slate-200 bg-white">
        <div class="mx-auto flex h-16 max-w-3xl items-center gap-3 px-4">
          <app-logo [height]="28" />
          <span class="text-sm text-ink-soft">Validation de compte rendu d’activité</span>
        </div>
      </header>

      <main class="mx-auto max-w-3xl px-4 py-8">
        @switch (state().kind) {
          @case ('chargement') {
            <div class="card flex items-center justify-center gap-2 p-16 text-ink-soft" role="status">
              <ng-icon name="lucideLoaderCircle" size="20" class="animate-spin" aria-hidden="true" /> Chargement…
            </div>
          }
          @case ('erreur') {
            <div class="card p-8 text-center" role="alert">
              <ng-icon name="lucideCircleAlert" size="32" class="text-amber" aria-hidden="true" />
              <h1 class="mt-3 text-xl font-bold">{{ errorInfo().title }}</h1>
              <p class="mx-auto mt-2 max-w-md text-ink-soft">{{ errorInfo().text }}</p>
            </div>
          }
          @case ('vue') {
            @let v = view()!;
            <h1 class="text-2xl font-bold">CRA de {{ v.consultant }} – {{ monthTitle(v.month) }}</h1>

            <dl class="card mt-5 grid grid-cols-2 gap-x-6 gap-y-4 p-5 sm:grid-cols-4">
              <div><dt class="text-xs text-ink-soft">Consultant</dt><dd class="font-semibold">{{ v.consultant }}</dd></div>
              <div><dt class="text-xs text-ink-soft">Période</dt><dd class="font-semibold">{{ monthTitle(v.month) }}</dd></div>
              <div><dt class="text-xs text-ink-soft">Mission</dt><dd class="font-semibold">{{ v.mission }}</dd></div>
              <div><dt class="text-xs text-ink-soft">Client</dt><dd class="font-semibold">{{ v.client }}</dd></div>
            </dl>

            <section class="card mt-5 overflow-hidden" aria-labelledby="jours-titre">
              <h2 id="jours-titre" class="border-b border-slate-100 px-3 py-3 sm:px-5 font-semibold">Jours déclarés sur la mission</h2>
              <div class="overflow-x-auto"><table class="w-full text-sm">
                <thead class="bg-slate-50 text-left text-xs text-ink-soft">
                  <tr>
                    <th scope="col" class="px-3 py-2 sm:px-5 font-medium">Date</th>
                    <th scope="col" class="px-3 py-2 sm:px-5 font-medium">Activité</th>
                    <th scope="col" class="px-3 py-2 sm:px-5 text-right font-medium">Jours</th>
                  </tr>
                </thead>
                <tbody>
                  @for (e of v.entries; track $index) {
                    <tr class="border-t border-slate-100">
                      <td class="px-3 py-2 whitespace-nowrap sm:px-5"><span class="capitalize sm:hidden">{{ weekday(e.date).slice(0, 3) }}.</span><span class="hidden capitalize sm:inline">{{ weekday(e.date) }}</span> {{ frDate(e.date) }}</td>
                      <td class="px-3 py-2 sm:px-5">{{ e.activity }}</td>
                      <td class="px-3 py-2 sm:px-5 text-right font-medium">{{ e.quantity === 1 ? '1' : '½' }}</td>
                    </tr>
                  } @empty {
                    <tr><td colspan="3" class="px-3 py-6 sm:px-5 text-center text-ink-soft">Aucun jour déclaré sur cette mission.</td></tr>
                  }
                </tbody>
                <tfoot>
                  <tr class="border-t-2 border-slate-200 bg-slate-50">
                    <th scope="row" colspan="2" class="px-3 py-3 sm:px-5 text-left">Total</th>
                    <td class="px-3 py-3 sm:px-5 text-right text-base font-bold">{{ formatDays(v.totalDays) }}</td>
                  </tr>
                </tfoot>
              </table></div>
            </section>

            @if (v.onCallDays.length) {
              <section class="card mt-5 overflow-hidden" aria-labelledby="astreintes-titre">
                <h2 id="astreintes-titre" class="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-3 py-3 sm:px-5 font-semibold">
                  Astreintes
                  <span class="text-sm font-normal text-ink-soft">{{ v.onCallDays.length }} jour{{ v.onCallDays.length > 1 ? 's' : '' }} · {{ formatMinutes(interventionTotal(v)) }} d’intervention</span>
                </h2>
                <div class="overflow-x-auto"><table class="w-full text-sm">
                  <thead class="bg-slate-50 text-left text-xs text-ink-soft">
                    <tr>
                      <th scope="col" class="px-3 py-2 sm:px-5 font-medium">Date</th>
                      <th scope="col" class="px-3 py-2 sm:px-5 font-medium">Intervention</th>
                      <th scope="col" class="px-3 py-2 sm:px-5 text-right font-medium">Durée</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (d of v.onCallDays; track d) {
                      @let list = interventionsOn(v, d);
                      @for (i of list.length ? list : [null]; track $index) {
                        <tr class="border-t border-slate-100">
                          <td class="px-3 py-2 whitespace-nowrap sm:px-5">@if ($first) { <span class="capitalize">{{ weekday(d).slice(0, 3) }}.</span> {{ frDate(d) }} }</td>
                          <td class="px-3 py-2 sm:px-5">
                            @if (i) { <span class="font-mono">{{ i.start }}–{{ i.end }}</span>@if (i.reason) { · {{ i.reason }} } }
                            @else { <span class="text-ink-soft">Astreinte sans intervention</span> }
                          </td>
                          <td class="px-3 py-2 sm:px-5 text-right font-medium">{{ i ? formatMinutes(i.minutes) : '' }}</td>
                        </tr>
                      }
                    }
                  </tbody>
                </table></div>
              </section>
            }

            <section class="mt-5" aria-live="polite">
              @if (done(); as d) {
                <div [class]="d === 'VALIDE' ? 'alert-success' : 'alert-warning'" role="status">
                  <ng-icon [name]="d === 'VALIDE' ? 'lucideCircleCheck' : 'lucideCircleAlert'" size="18" aria-hidden="true" />
                  <p>
                    @if (d === 'VALIDE') { Merci, le CRA est validé. Le consultant et Orkidea en sont informés. }
                    @else { Le CRA a été rejeté. Le consultant est informé du motif et pourra le corriger. }
                  </p>
                </div>
              } @else if (v.status !== 'EN_ATTENTE') {
                <div [class]="v.status === 'VALIDE' ? 'alert-success' : 'alert-warning'" role="status">
                  <ng-icon name="lucideInfo" size="18" aria-hidden="true" />
                  <div>
                    <p class="font-semibold">Demande déjà traitée : {{ v.status === 'VALIDE' ? 'CRA validé' : 'CRA rejeté' }}.</p>
                    @if (v.comment) { <p class="mt-1">Commentaire : « {{ v.comment }} »</p> }
                  </div>
                </div>
              } @else if (v.expired) {
                <div class="alert-warning" role="status">
                  <ng-icon name="lucideClock" size="18" aria-hidden="true" />
                  <p>{{ errors.LIEN_EXPIRE!.text }}</p>
                </div>
              } @else {
                <div class="card p-5">
                  @if (mode() === 'rejet') {
                    <label for="motif" class="label">Motif du rejet <span class="text-red-700">(obligatoire)</span></label>
                    <textarea id="motif" rows="4" maxlength="2000" class="input" [value]="comment()" (input)="comment.set($any($event.target).value)"
                              placeholder="Ex. : le 12 n’a pas été travaillé sur la mission" [attr.aria-invalid]="motifMissing() ? 'true' : null" aria-describedby="motif-erreur"></textarea>
                    <p id="motif-erreur" class="mt-1 min-h-5 text-sm text-red-700">@if (motifMissing()) { Indiquez le motif du rejet. }</p>
                    <div class="mt-2 flex flex-wrap justify-end gap-2">
                      <button type="button" class="btn-secondary" (click)="mode.set('choix'); submitted.set(false)" [disabled]="busy()">Annuler</button>
                      <button type="button" class="btn bg-red-600 text-white hover:bg-red-700" (click)="decide('REJETE')" [disabled]="busy()">Confirmer le rejet</button>
                    </div>
                  } @else {
                    <label for="commentaire" class="label">Commentaire <span class="font-normal text-ink-soft">(facultatif)</span></label>
                    <textarea id="commentaire" rows="2" maxlength="2000" class="input" [value]="comment()" (input)="comment.set($any($event.target).value)"></textarea>
                    <div class="mt-4 flex flex-wrap justify-end gap-2">
                      <button type="button" class="btn-secondary border-red-200 text-red-700 hover:bg-red-50" (click)="mode.set('rejet')" [disabled]="busy()">
                        <ng-icon name="lucideX" size="16" aria-hidden="true" /> Rejeter
                      </button>
                      <button type="button" class="btn bg-emerald-600 text-white hover:bg-emerald-700" (click)="decide('VALIDE')" [disabled]="busy()">
                        <ng-icon [name]="busy() ? 'lucideLoaderCircle' : 'lucideCircleCheck'" size="16" [class.animate-spin]="busy()" aria-hidden="true" /> Valider le CRA
                      </button>
                    </div>
                  }
                  @if (actionError()) { <p class="alert-error mt-4" role="alert">{{ actionError() }}</p> }
                </div>
              }
            </section>
            <p class="mt-8 text-center text-xs text-ink-soft">Orkidea — conseil &amp; portage salarial. Ce lien vous est personnel : ne le transférez pas.</p>
          }
        }
      </main>
    </div>
  `,
})
export class ValidationPage implements OnInit {
  protected readonly formatMinutes = formatMinutes;
  protected interventionTotal(v: PublicValidationView): number {
    return v.interventions.reduce((n, i) => n + i.minutes, 0);
  }
  protected interventionsOn(v: PublicValidationView, date: string): PublicValidationView['interventions'] {
    return v.interventions.filter((i) => i.date === date);
  }

  private readonly api = inject(Api);

  readonly token = input.required<string>();

  protected readonly state = signal<State>({ kind: 'chargement' });
  protected readonly mode = signal<'choix' | 'rejet'>('choix');
  protected readonly comment = signal('');
  protected readonly submitted = signal(false);
  protected readonly busy = signal(false);
  protected readonly done = signal<'VALIDE' | 'REJETE' | null>(null);
  protected readonly actionError = signal<string | null>(null);

  protected readonly errors = ERRORS;
  protected readonly frDate = frDate;
  protected readonly formatDays = formatDays;
  protected readonly monthTitle = monthTitle;

  protected readonly view = computed(() => {
    const s = this.state();
    return s.kind === 'vue' ? s.view : null;
  });
  protected readonly errorInfo = computed(() => {
    const s = this.state();
    if (s.kind !== 'erreur') return { title: '', text: '' };
    return (s.code && ERRORS[s.code]) || { title: 'Erreur', text: s.message };
  });
  protected readonly motifMissing = computed(() => this.submitted() && this.mode() === 'rejet' && !this.comment().trim());

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.state.set({ kind: 'vue', view: await this.api.validation(this.token()) });
    } catch (err) {
      const e = apiError(err);
      this.state.set({ kind: 'erreur', code: e.code ?? null, message: e.error });
    }
  }

  protected weekday(date: string): string {
    const js = new Date(`${date}T00:00:00Z`).getUTCDay();
    return WEEKDAY_NAMES[js === 0 ? 7 : js];
  }

  async decide(decision: 'VALIDE' | 'REJETE'): Promise<void> {
    this.submitted.set(true);
    this.actionError.set(null);
    if (decision === 'REJETE' && !this.comment().trim()) return;
    this.busy.set(true);
    try {
      await this.api.decide(this.token(), decision, this.comment().trim() || null);
      this.done.set(decision);
    } catch (err) {
      const e = apiError(err);
      if (e.code && ERRORS[e.code]) this.state.set({ kind: 'erreur', code: e.code, message: e.error });
      else this.actionError.set(e.error);
    } finally {
      this.busy.set(false);
    }
  }
}

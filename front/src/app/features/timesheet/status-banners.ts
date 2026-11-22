import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { NgIcon } from '@ng-icons/core';
import { frDate } from '@shared/dates';
import { TimesheetStore } from './timesheet.store';

/** Bandeaux selon le statut : rejet (motifs), attente de validation, validé, clôturé, erreurs serveur. */
@Component({
  selector: 'app-status-banners',
  imports: [NgIcon, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.serverErrors(); as err) {
      <div class="alert-error" role="alert">
        <ng-icon name="lucideCircleAlert" size="18" class="mt-0.5 shrink-0" aria-hidden="true" />
        <div>
          <p class="font-semibold">{{ err.message }}</p>
          @if (err.details.length) {
            <ul class="mt-1 list-disc pl-5">
              @for (d of err.details; track $index) { <li>{{ d }}</li> }
            </ul>
          }
        </div>
        <button type="button" class="ml-auto p-1" (click)="store.serverErrors.set(null)" aria-label="Masquer"><ng-icon name="lucideX" size="16" /></button>
      </div>
    }

    @switch (store.status()) {
      @case ('REJETE') {
        <div class="alert-error" role="status">
          <ng-icon name="lucideCircleAlert" size="18" class="mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p class="font-semibold">CRA rejeté – corrigez-le puis soumettez-le à nouveau.</p>
            @for (v of rejected(); track v.missionId) {
              <p class="mt-1"><span class="font-medium">{{ v.missionLabel }} ({{ v.clientName }})</span> : « {{ v.comment }} »</p>
            }
          </div>
        </div>
      }
      @case ('SOUMIS') {
        <div class="alert-warning" role="status">
          <ng-icon name="lucideClock" size="18" class="mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p class="font-semibold">En attente de validation client – la saisie est verrouillée.</p>
            <ul class="mt-1 space-y-0.5">
              @for (v of store.timesheet()?.validations ?? []; track v.missionId) {
                <li>
                  {{ v.missionLabel }} ({{ v.clientName }}) :
                  @if (v.status === 'VALIDE') { <span class="font-medium text-emerald-700">validé le {{ v.decidedAt | date: 'dd/MM/yyyy' }}</span> }
                  @else { <span class="font-medium">en attente</span> }
                </li>
              }
            </ul>
          </div>
        </div>
      }
      @case ('VALIDE') {
        <div class="alert-success" role="status">
          <ng-icon name="lucideCircleCheck" size="18" class="mt-0.5 shrink-0" aria-hidden="true" />
          <p>CRA validé{{ submitted() }}. Contactez Orkidea pour toute correction.</p>
        </div>
      }
      @case ('CLOTURE') {
        <div class="alert-info" role="status">
          <ng-icon name="lucideLock" size="18" class="mt-0.5 shrink-0" aria-hidden="true" />
          <p>CRA clôturé par Orkidea. Il n’est plus modifiable.</p>
        </div>
      }
      @default {
        @if (store.timesheet()?.submissionBlockedReason; as reason) {
          <div class="alert-info" role="status">
            <ng-icon name="lucideInfo" size="18" class="mt-0.5 shrink-0" aria-hidden="true" />
            <p>{{ reason }}. Vous pouvez saisir et enregistrer votre brouillon dès maintenant.</p>
          </div>
        }
      }
    }
  `,
  host: { class: 'flex flex-col gap-3 empty:hidden' },
})
export class StatusBanners {
  protected readonly store = inject(TimesheetStore);
  protected readonly rejected = computed(() => (this.store.timesheet()?.validations ?? []).filter((v) => v.status === 'REJETE'));
  protected readonly submitted = computed(() => {
    const at = this.store.timesheet()?.submittedAt;
    return at ? ` (soumis le ${frDate(at.slice(0, 10))})` : '';
  });
}

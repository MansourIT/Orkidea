import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { formatMinutes, interventionMinutes, type Intervention } from '@shared/astreintes';
import { ToggleSwitch } from '../../ui/toggle-switch';
import { TimesheetStore } from './timesheet.store';

/** Astreinte d'un jour (dans le détail du jour) : une ligne par mission ouverte, interventions et ajout. */
@Component({
  selector: 'app-on-call-editor',
  imports: [NgIcon, ToggleSwitch],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="mt-3 border-t border-slate-100 pt-3" aria-label="Astreinte">
      @for (m of missions(); track m.id) {
        @let on = store.isOnCall(date(), m.id);
        <div class="mb-2">
          <div class="flex items-center gap-2">
            <ng-icon name="lucideSiren" size="14" [class]="on ? 'text-red-600' : 'text-ink-soft'" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate text-sm font-medium">Astreinte · {{ m.label }}</span>
            @if (store.editable()) {
              <app-switch [label]="'Astreinte ' + m.label + ' ce jour'" [checked]="on" (checkedChange)="store.toggleOnCall(date(), m.id)" />
            } @else {
              <span class="text-xs text-ink-soft">{{ on ? 'Oui' : 'Non' }}</span>
            }
          </div>
          @if (on) {
            <ul class="mt-1.5 space-y-1 pl-5">
              @for (i of byMission(m.id); track $index) {
                <li class="flex items-center gap-2 rounded-md bg-red-50/60 px-2 py-1 text-xs">
                  <span class="font-mono font-medium">{{ i.start }}–{{ i.end }}</span>
                  <span class="text-ink-soft">{{ duration(i) }}</span>
                  <span class="min-w-0 flex-1 truncate" [title]="i.reason ?? ''">{{ i.reason }}</span>
                  @if (store.editable()) {
                    <button type="button" class="btn-ghost p-0.5" (click)="store.removeIntervention(i)" [attr.aria-label]="'Supprimer l’intervention de ' + i.start + ' à ' + i.end">
                      <ng-icon name="lucideX" size="12" />
                    </button>
                  }
                </li>
              } @empty {
                <li class="text-xs text-ink-soft">Aucune intervention.</li>
              }
            </ul>
          }
        </div>
      }

      @if (store.editable() && missions().length) {
        @if (!adding()) {
          <button type="button" class="btn-ghost mt-1 w-full justify-center border border-dashed border-slate-300 py-1.5 text-xs" (click)="startAdd()">
            <ng-icon name="lucidePlus" size="14" aria-hidden="true" /> Ajouter une intervention
          </button>
        } @else {
          <form class="mt-2 space-y-2 rounded-lg bg-slate-50 p-2.5" (submit)="$event.preventDefault(); add()" aria-label="Nouvelle intervention">
            @if (missions().length > 1) {
              <select class="input py-1 text-xs" aria-label="Mission" [value]="missionId()" (change)="missionId.set($any($event.target).value)">
                @for (m of missions(); track m.id) { <option [value]="m.id" [selected]="m.id === missionId()">{{ m.label }}</option> }
              </select>
            }
            <div class="flex items-center gap-1.5">
              <input type="time" class="input py-1 text-xs" aria-label="Heure de début" [value]="start()" (input)="start.set($any($event.target).value)" required />
              <span class="text-xs text-ink-soft" aria-hidden="true">→</span>
              <input type="time" class="input py-1 text-xs" aria-label="Heure de fin" [value]="end()" (input)="end.set($any($event.target).value)" required />
            </div>
            @if (preview(); as p) { <p class="text-[11px] text-ink-soft">{{ p }}</p> }
            <input class="input py-1 text-xs" maxlength="200" placeholder="Motif (ticket, incident…)" aria-label="Motif" [value]="reason()" (input)="reason.set($any($event.target).value)" />
            @if (error()) { <p class="text-[11px] text-red-700" role="alert">{{ error() }}</p> }
            <div class="flex justify-end gap-1.5">
              <button type="button" class="btn-ghost px-2 py-1 text-xs" (click)="adding.set(false)">Annuler</button>
              <button type="submit" class="btn-primary px-2.5 py-1 text-xs">Ajouter</button>
            </div>
          </form>
        }
      }
    </section>
  `,
})
export class OnCallEditor {
  protected readonly store = inject(TimesheetStore);
  readonly date = input.required<string>();

  /** Missions ouvertes à l'astreinte et en cours ce jour-là. */
  protected readonly missions = computed(() =>
    this.store.onCallMissions().filter((m) => this.date() >= m.startDate && (!m.endDate || this.date() <= m.endDate)),
  );
  protected readonly adding = signal(false);
  protected readonly missionId = signal('');
  protected readonly start = signal('');
  protected readonly end = signal('');
  protected readonly reason = signal('');
  protected readonly error = signal<string | null>(null);

  protected readonly preview = computed(() => {
    if (!/^\d{2}:\d{2}$/.test(this.start()) || !/^\d{2}:\d{2}$/.test(this.end()) || this.start() === this.end()) return null;
    const next = this.end() <= this.start() ? ' (fin le lendemain)' : '';
    return `Durée : ${formatMinutes(interventionMinutes(this.start(), this.end()))}${next}`;
  });

  protected byMission(missionId: string): Intervention[] {
    return this.store.interventionsAt(this.date()).filter((i) => i.missionId === missionId);
  }

  protected duration(i: Intervention): string {
    return formatMinutes(interventionMinutes(i.start, i.end));
  }

  protected startAdd(): void {
    this.missionId.set(this.missions()[0]?.id ?? '');
    this.start.set('');
    this.end.set('');
    this.reason.set('');
    this.error.set(null);
    this.adding.set(true);
  }

  protected add(): void {
    if (!this.start() || !this.end()) {
      this.error.set('Indiquez l’heure de début et l’heure de fin.');
      return;
    }
    const err = this.store.addIntervention({ date: this.date(), missionId: this.missionId(), start: this.start(), end: this.end(), reason: this.reason() || null });
    if (err) this.error.set(err);
    else this.adding.set(false);
  }
}

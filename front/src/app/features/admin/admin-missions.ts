import { Dialog } from '@angular/cdk/dialog';
import { Overlay } from '@angular/cdk/overlay';
import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import type { AdminUser, Client, Mission } from '@shared/types';
import type { AppSettings } from '@shared/settings';
import { todayInParis } from '@shared/dates';
import { Api, apiError } from '../../core/api';
import { Segmented, type SegmentOption } from '../../ui/segmented';
import { MissionDrawer, type MissionDrawerData } from './mission-drawer';

type Scope = 'actives' | 'toutes' | 'desactivees';
type Quick = 'validation' | 'fin' | null;

const SCOPES: SegmentOption<Scope>[] = [
  { value: 'actives', label: 'Actives' },
  { value: 'toutes', label: 'Toutes' },
  { value: 'desactivees', label: 'Désactivées' },
];

const DAY = 86_400_000;

/** Jours avant la fin de la mission (négatif = terminée), ou null sans date de fin. */
export function daysToEnd(m: Mission, today: string): number | null {
  if (!m.endDate) return null;
  return Math.round((new Date(`${m.endDate}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / DAY);
}

/** Missions : compteurs, recherche et filtres, tableau, création / modification dans un panneau latéral. */
@Component({
  selector: 'app-admin-missions',
  imports: [NgIcon, DatePipe, Segmented],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Compteurs -->
    <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <div class="card p-3"><p class="text-2xl font-bold text-ink">{{ stats().actives }}</p><p class="text-sm font-semibold">Missions actives</p></div>
      <button type="button" class="card p-3 text-left transition-shadow hover:shadow-md" [class.ring-2]="quick() === 'validation'" [class.ring-orchid]="quick() === 'validation'" [attr.aria-pressed]="quick() === 'validation'" (click)="toggleQuick('validation')">
        <p class="text-2xl font-bold text-amber-800">{{ stats().validation }}</p><p class="text-sm font-semibold">Avec validation client</p>
      </button>
      <button type="button" class="card p-3 text-left transition-shadow hover:shadow-md" [class.ring-2]="quick() === 'fin'" [class.ring-orchid]="quick() === 'fin'" [attr.aria-pressed]="quick() === 'fin'" (click)="toggleQuick('fin')">
        <p class="text-2xl font-bold" [class]="stats().ending ? 'text-red-700' : 'text-ink'">{{ stats().ending }}</p><p class="text-sm font-semibold">Fin sous 30 jours ou dépassée</p>
      </button>
      <div class="card p-3"><p class="text-2xl font-bold text-ink">{{ stats().consultants }}</p><p class="text-sm font-semibold">Consultants en mission</p></div>
    </div>

    <!-- Filtres -->
    <div class="mt-4 flex flex-wrap items-center gap-2">
      <input type="search" class="input max-w-xs" placeholder="Rechercher une mission…" aria-label="Rechercher une mission, un client ou un consultant" [value]="query()" (input)="query.set($any($event.target).value)" />
      <select class="input w-auto" aria-label="Filtrer par consultant" [value]="consultantId()" (change)="consultantId.set($any($event.target).value)">
        <option value="">Tous les consultants</option>
        @for (u of consultants(); track u.id) { <option [value]="u.id">{{ u.name }}</option> }
      </select>
      <select class="input w-auto" aria-label="Filtrer par client" [value]="clientId()" (change)="clientId.set($any($event.target).value)">
        <option value="">Tous les clients</option>
        @for (c of clients(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }
      </select>
      <app-segmented label="Missions affichées" [options]="scopes" [value]="scope()" (valueChange)="scope.set($event)" />
      <button type="button" class="btn-primary ml-auto" (click)="open(null)"><ng-icon name="lucidePlus" size="16" aria-hidden="true" /> Nouvelle mission</button>
    </div>

    @if (error()) { <div class="alert-error mt-4" role="alert">{{ error() }}</div> }

    <!-- Tableau (écrans larges) -->
    <div class="card mt-4 hidden overflow-hidden md:block">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-left text-xs text-ink-soft">
          <tr>
            <th scope="col" class="px-4 py-3 font-medium">Mission</th>
            <th scope="col" class="px-4 py-3 font-medium">Consultant</th>
            <th scope="col" class="px-4 py-3 font-medium">Période</th>
            <th scope="col" class="px-4 py-3 text-right font-medium">TJM</th>
            <th scope="col" class="px-4 py-3 font-medium">Validation client</th>
            <th scope="col" class="px-4 py-3 font-medium">Activités</th>
            <th scope="col" class="px-4 py-3"><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          @for (m of rows(); track m.id) {
            <tr class="cursor-pointer border-t border-slate-100 hover:bg-slate-50" [class.opacity-60]="!m.active" (click)="open(m)">
              <td class="px-4 py-3">
                <p class="flex items-center gap-2 font-medium text-ink"><span class="h-2.5 w-2.5 shrink-0 rounded-full" [style.background]="color(m)" aria-hidden="true"></span>{{ m.label }}</p>
                <p class="pl-4.5 text-xs text-ink-soft">{{ m.client }}</p>
              </td>
              <td class="px-4 py-3">{{ m.consultant }}</td>
              <td class="px-4 py-3">
                <p class="whitespace-nowrap">{{ m.startDate | date: 'dd/MM/yyyy' }} → {{ m.endDate ? (m.endDate | date: 'dd/MM/yyyy') : 'sans fin' }}</p>
                @if (endBadge(m); as b) { <span class="mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold" [class]="b.cls">{{ b.text }}</span> }
                @if (!m.active) { <span class="mt-1 inline-block rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700">Désactivée</span> }
              </td>
              <td class="px-4 py-3 text-right whitespace-nowrap">{{ m.tjm !== null ? m.tjm + ' €' : '—' }}</td>
              <td class="px-4 py-3">
                @if (m.clientValidation) {
                  <p class="text-xs font-medium text-amber-800">{{ m.validatorName }}</p><p class="text-xs text-ink-soft">{{ m.validatorEmail }}</p>
                } @else { <span class="text-xs text-ink-soft">Non requise</span> }
              </td>
              <td class="px-4 py-3">
                <p class="text-xs text-ink">{{ activeLabels(m) }}</p>
                @if (rules(m); as r) { <p class="mt-1 text-[11px] text-orchid-700">{{ r }}</p> }
              </td>
              <td class="px-4 py-3 text-right" (click)="$event.stopPropagation()">
                <button type="button" class="btn-ghost px-3 py-1.5 text-xs" (click)="open(m)" [attr.aria-label]="'Modifier ' + m.label"><ng-icon name="lucidePencil" size="14" aria-hidden="true" /> Modifier</button>
              </td>
            </tr>
          } @empty {
            <tr><td colspan="7" class="px-4 py-10 text-center text-ink-soft">{{ loaded() ? 'Aucune mission ne correspond.' : 'Chargement…' }}</td></tr>
          }
        </tbody>
      </table>
    </div>

    <!-- Cartes (mobile) -->
    <ul class="mt-4 space-y-3 md:hidden">
      @for (m of rows(); track m.id) {
        <li>
          <button type="button" class="card w-full p-4 text-left" [class.opacity-60]="!m.active" (click)="open(m)">
            <p class="flex items-center gap-2 font-medium text-ink"><span class="h-2.5 w-2.5 rounded-full" [style.background]="color(m)" aria-hidden="true"></span>{{ m.label }}</p>
            <p class="text-xs text-ink-soft">{{ m.client }} · {{ m.consultant }}</p>
            <p class="mt-2 text-xs">{{ m.startDate | date: 'dd/MM/yyyy' }} → {{ m.endDate ? (m.endDate | date: 'dd/MM/yyyy') : 'sans fin' }} · {{ m.tjm !== null ? m.tjm + ' €' : 'TJM —' }}</p>
            <p class="mt-2 flex flex-wrap gap-1.5">
              @if (endBadge(m); as b) { <span class="rounded-full px-2 py-0.5 text-[11px] font-semibold" [class]="b.cls">{{ b.text }}</span> }
              @if (m.clientValidation) { <span class="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Validation client</span> }
            </p>
          </button>
        </li>
      } @empty {
        <li class="card p-8 text-center text-sm text-ink-soft">{{ loaded() ? 'Aucune mission ne correspond.' : 'Chargement…' }}</li>
      }
    </ul>
  `,
})
export class AdminMissions implements OnInit {
  private readonly api = inject(Api);
  private readonly dialog = inject(Dialog);
  private readonly overlay = inject(Overlay);

  protected readonly scopes = SCOPES;
  private readonly today = todayInParis();
  protected readonly missions = signal<Mission[]>([]);
  protected readonly consultants = signal<AdminUser[]>([]);
  protected readonly clients = signal<Client[]>([]);
  private readonly settings = signal<AppSettings | null>(null);
  protected readonly loaded = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly query = signal('');
  protected readonly consultantId = signal('');
  protected readonly clientId = signal('');
  protected readonly scope = signal<Scope>('actives');
  protected readonly quick = signal<Quick>(null);

  protected readonly stats = computed(() => {
    const active = this.missions().filter((m) => m.active);
    return {
      actives: active.length,
      validation: active.filter((m) => m.clientValidation).length,
      ending: active.filter((m) => this.endingSoon(m)).length,
      consultants: new Set(active.map((m) => m.consultantId)).size,
    };
  });

  protected readonly rows = computed(() => {
    const q = this.query().trim().toLowerCase();
    return this.missions().filter((m) => {
      if (this.scope() === 'actives' && !m.active) return false;
      if (this.scope() === 'desactivees' && m.active) return false;
      if (this.consultantId() && m.consultantId !== this.consultantId()) return false;
      if (this.clientId() && m.clientId !== this.clientId()) return false;
      if (this.quick() === 'validation' && !m.clientValidation) return false;
      if (this.quick() === 'fin' && !this.endingSoon(m)) return false;
      return !q || `${m.label} ${m.client} ${m.consultant}`.toLowerCase().includes(q);
    });
  });

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const [missions, users, clients, settings] = await Promise.all([this.api.missions(), this.api.users(), this.api.clients(), this.api.settings()]);
      this.missions.set(missions);
      this.consultants.set(users.filter((u) => u.active));
      this.clients.set(clients);
      this.settings.set(settings);
      this.loaded.set(true);
    } catch (err) {
      this.error.set(apiError(err).error);
    }
  }

  protected toggleQuick(q: Exclude<Quick, null>): void {
    this.quick.update((c) => (c === q ? null : q));
  }

  private endingSoon(m: Mission): boolean {
    const d = daysToEnd(m, this.today);
    return d !== null && d <= 30;
  }

  protected endBadge(m: Mission): { text: string; cls: string } | null {
    const d = daysToEnd(m, this.today);
    if (d === null || d > 30) return null;
    if (d < 0) return { text: m.active ? 'Terminée – à désactiver ?' : 'Terminée', cls: 'bg-slate-100 text-slate-700' };
    if (d === 0) return { text: 'Se termine aujourd’hui', cls: 'bg-red-100 text-red-700' };
    return { text: `Se termine dans ${d} j`, cls: d <= 7 ? 'bg-red-100 text-red-700' : 'bg-amber-50 text-amber-800' };
  }

  protected color(m: Mission): string {
    return m.activities.find((a) => a.active)?.color ?? m.activities[0]?.color ?? '#94A3B8';
  }

  protected activeLabels(m: Mission): string {
    const active = m.activities.filter((a) => a.active).map((a) => a.label);
    return active.length ? active.join(', ') : 'Aucune activité active';
  }

  /** Règles de calendrier propres à la mission (rien si elle suit le paramétrage global). */
  protected rules(m: Mission): string | null {
    const r: string[] = [];
    if (m.weekendPolicy === 'AUTORISE') r.push('week-ends autorisés');
    if (m.weekendPolicy === 'INTERDIT') r.push('week-ends interdits');
    if (m.holidayPolicy === 'AUTORISE') r.push('fériés autorisés');
    if (m.holidayPolicy === 'INTERDIT') r.push('fériés interdits');
    if (m.workedHolidays?.length) r.push(`${m.workedHolidays.length} férié(s) travaillé(s)`);
    if (m.holidayRegion === 'alsace-moselle') r.push('Alsace-Moselle');
    return r.length ? r.join(' · ') : null;
  }

  open(m: Mission | null): void {
    const ref = this.dialog.open<boolean, MissionDrawerData>(MissionDrawer, {
      data: { mission: m, consultants: this.consultants(), clients: this.clients(), settings: this.settings() },
      positionStrategy: this.overlay.position().global().right('0').top('0'),
      height: '100dvh',
      backdropClass: ['bg-ink/40'],
      ariaLabel: m ? `Modifier la mission ${m.label}` : 'Nouvelle mission',
    });
    ref.closed.subscribe((changed) => {
      if (changed) void this.load();
    });
  }
}

import { Injectable, computed, inject, signal } from '@angular/core';
import type { Activity, ClientConfig, Entry, Intervention, OnCallDay, Timesheet } from '@shared/types';
import { checkOnCall, interventionMinutes, onCallTotals } from '@shared/astreintes';
import { EDITABLE_STATUSES } from '@shared/types';
import { dayRefusal } from '@shared/calendar-rules';
import { frDate, WEEKDAY_NAMES, MONTH_NAMES } from '@shared/dates';
import { monthDays } from '@shared/holidays';
import { missingWorkingDays } from '@shared/submission';
import { Api, apiError } from '../../core/api';
import { formatDays } from '../../core/format';
import { applyBrush, dayTotal, sortEntries, strokeModeAfterFirst, type Brush, type StrokeMode } from './brush';

export interface DayCell {
  date: string;
  day: number;
  weekday: number;
  weekend: boolean;
  holiday: string | null;
  isToday: boolean;
  entries: Entry[];
  total: number;
  /** Week-end ou férié (selon la région globale) : grisé par défaut. */
  nonWorking: boolean;
}

export type LoadState = 'chargement' | 'pret' | 'erreur';

const sortOnCall = (days: readonly OnCallDay[]) => [...days].sort((a, b) => (a.date + a.missionId).localeCompare(b.date + b.missionId));
const sortInterventions = (list: readonly Intervention[]) => [...list].sort((a, b) => (a.date + a.start + a.missionId).localeCompare(b.date + b.start + b.missionId));

const snapshot = (entries: readonly Entry[], comment: string | null, onCall: readonly OnCallDay[] = [], interventions: readonly Intervention[] = []) =>
  JSON.stringify({
    e: sortEntries(entries).map((x) => [x.date, x.activityId, x.quantity]),
    c: comment ?? '',
    o: sortOnCall(onCall).map((d) => [d.date, d.missionId]),
    i: sortInterventions(interventions).map((x) => [x.date, x.missionId, x.start, x.end, x.reason ?? '']),
  });

/** État de l'écran « Saisie des temps » : partagé par la vue calendrier et la vue tableau. */
@Injectable()
export class TimesheetStore {
  private readonly api = inject(Api);

  // ------------------------------------------------------------ état
  readonly month = signal('');
  readonly loadState = signal<LoadState>('chargement');
  readonly loadError = signal<string | null>(null);
  readonly config = signal<ClientConfig | null>(null);
  readonly activities = signal<Activity[]>([]);
  readonly timesheet = signal<Timesheet | null>(null);
  readonly entries = signal<Entry[]>([]);
  readonly comment = signal<string | null>(null);
  /** Jours d'astreinte et interventions du mois (brouillon local jusqu'à l'enregistrement). */
  readonly onCall = signal<OnCallDay[]>([]);
  readonly interventions = signal<Intervention[]>([]);
  private readonly saved = signal(snapshot([], null));

  readonly selectedId = signal<string | 'gomme' | null>(null);
  /** Case « Partiel » par activité (½ jour). */
  readonly partial = signal<Record<string, boolean>>({});

  readonly busy = signal<'enregistrement' | 'soumission' | null>(null);
  /** Erreurs de validation renvoyées par le serveur (422). */
  readonly serverErrors = signal<{ message: string; details: string[] } | null>(null);
  /** Message bref annoncé (aria-live) : jour non saisissable, enregistrement OK… */
  readonly notice = signal<{ text: string; tone: 'info' | 'succes' | 'erreur' } | null>(null);

  private stroke: { mode: StrokeMode; visited: Set<string> } | null = null;

  // ------------------------------------------------------------ dérivés
  readonly status = computed(() => this.timesheet()?.status ?? 'BROUILLON');
  readonly editable = computed(() => !!this.timesheet() && EDITABLE_STATUSES.includes(this.status()));
  readonly dirty = computed(() => snapshot(this.entries(), this.comment(), this.onCall(), this.interventions()) !== this.saved());
  readonly region = computed(() => this.config()?.settings.calendar.holidayRegion ?? 'metropole');
  readonly today = computed(() => this.config()?.today ?? '');

  readonly activityById = computed(() => new Map(this.activities().map((a) => [a.id, a])));
  readonly workActivities = computed(() => this.activities().filter((a) => a.kind === 'travail' && !a.archived));
  readonly absenceActivities = computed(() => this.activities().filter((a) => a.kind === 'absence' && !a.archived));
  /** Activités affichées dans le tableau : actives + archivées encore présentes ce mois-ci. */
  readonly tableActivities = computed(() => {
    const used = new Set(this.entries().map((e) => e.activityId));
    return this.activities().filter((a) => !a.archived || used.has(a.id));
  });

  readonly brush = computed<Brush | null>(() => {
    const id = this.selectedId();
    if (id === 'gomme') return { kind: 'eraser' };
    if (!id || !this.activityById().has(id)) return null;
    return { kind: 'activity', activityId: id, quantity: this.partial()[id] ? 0.5 : 1 };
  });

  readonly byDate = computed(() => {
    const map = new Map<string, Entry[]>();
    for (const e of this.entries()) map.set(e.date, [...(map.get(e.date) ?? []), e]);
    return map;
  });

  readonly days = computed<DayCell[]>(() => {
    if (!this.month()) return [];
    const byDate = this.byDate();
    const today = this.today();
    return monthDays(this.month(), this.region()).map((d) => {
      const entries = byDate.get(d.date) ?? [];
      return { ...d, isToday: d.date === today, entries, total: dayTotal(entries), nonWorking: d.weekend || !!d.holiday };
    });
  });

  /** Semaines Lun → Dim ; null = case vide avant le 1er / après le dernier jour. */
  readonly weeks = computed<Array<Array<DayCell | null>>>(() => {
    const days = this.days();
    if (!days.length) return [];
    const cells: Array<DayCell | null> = [...Array<null>(days[0].weekday - 1).fill(null), ...days];
    while (cells.length % 7) cells.push(null);
    const weeks: Array<Array<DayCell | null>> = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return weeks;
  });

  readonly totalDays = computed(() => dayTotal(this.entries()));

  // ------------------------------------------------------------ astreintes
  readonly onCallMissions = computed(() => this.timesheet()?.onCallMissions ?? []);
  /** Par date : missions d'astreinte et minutes d'intervention. */
  readonly onCallByDate = computed(() => {
    const map = new Map<string, { missions: string[]; minutes: number }>();
    const get = (date: string) => map.get(date) ?? map.set(date, { missions: [], minutes: 0 }).get(date)!;
    for (const d of this.onCall()) get(d.date).missions.push(d.missionId);
    for (const i of this.interventions()) get(i.date).minutes += interventionMinutes(i.start, i.end);
    return map;
  });
  readonly onCallSummary = computed(() => onCallTotals(this.onCall(), this.interventions(), this.region()));

  isOnCall(date: string, missionId: string): boolean {
    return this.onCall().some((d) => d.date === date && d.missionId === missionId);
  }

  interventionsAt(date: string): Intervention[] {
    return sortInterventions(this.interventions().filter((i) => i.date === date));
  }

  /** Active / retire l'astreinte d'une mission ce jour-là (retirer supprime aussi ses interventions). */
  toggleOnCall(date: string, missionId: string): void {
    if (!this.editable()) return;
    if (this.isOnCall(date, missionId)) {
      this.onCall.update((all) => all.filter((d) => !(d.date === date && d.missionId === missionId)));
      this.interventions.update((all) => all.filter((i) => !(i.date === date && i.missionId === missionId)));
    } else {
      const err = checkOnCall(this.month(), [...this.onCall(), { date, missionId }], [], this.onCallMissions())[0];
      if (err) {
        this.notice.set({ text: err, tone: 'erreur' });
        return;
      }
      this.onCall.update((all) => sortOnCall([...all, { date, missionId }]));
    }
  }

  /** Ajoute une intervention (l'astreinte du jour est activée au besoin). Retourne l'erreur éventuelle. */
  addIntervention(i: Intervention): string | null {
    if (!this.editable()) return 'Ce CRA n’est plus modifiable';
    const onCall = this.isOnCall(i.date, i.missionId) ? this.onCall() : [...this.onCall(), { date: i.date, missionId: i.missionId }];
    const interventions = [...this.interventions(), { ...i, reason: i.reason?.trim() || null }];
    const err = checkOnCall(this.month(), onCall, interventions, this.onCallMissions())[0];
    if (err) return err;
    this.onCall.set(sortOnCall(onCall));
    this.interventions.set(sortInterventions(interventions));
    return null;
  }

  removeIntervention(i: Intervention): void {
    if (!this.editable()) return;
    this.interventions.update((all) => all.filter((x) => x !== i));
  }
  readonly workingDays = computed(() => this.timesheet()?.workingDays ?? this.days().filter((d) => !d.nonWorking).length);
  readonly missingDays = computed(() => (this.month() ? missingWorkingDays(this.month(), this.entries(), this.region()) : []));

  /** Raison pour laquelle le pinceau actuel ne peut pas s'appliquer à chaque date (null = autorisé). */
  readonly refusals = computed(() => {
    const brush = this.brush();
    const map = new Map<string, string | null>();
    for (const d of this.days()) {
      if (!brush) map.set(d.date, null);
      else if (brush.kind === 'eraser') map.set(d.date, null);
      else {
        const a = this.activityById().get(brush.activityId);
        map.set(d.date, a ? dayRefusal(d.date, a) : 'Activité inconnue');
      }
    }
    return map;
  });

  // ------------------------------------------------------------ chargement
  async load(month: string): Promise<void> {
    this.month.set(month);
    this.loadState.set('chargement');
    this.loadError.set(null);
    this.serverErrors.set(null);
    this.notice.set(null);
    try {
      const [config, activities, ts] = await Promise.all([
        this.config() ? Promise.resolve(this.config()!) : this.api.config(),
        this.api.activities(month),
        this.api.timesheet(month),
      ]);
      if (this.month() !== month) return; // navigation plus récente
      this.config.set(config);
      this.activities.set(activities);
      this.applyServer(ts);
      if (this.selectedId() && this.selectedId() !== 'gomme' && !activities.some((a) => a.id === this.selectedId())) this.selectedId.set(null);
      this.loadState.set('pret');
    } catch (err) {
      this.loadError.set(apiError(err).error);
      this.loadState.set('erreur');
    }
  }

  private applyServer(ts: Timesheet): void {
    this.timesheet.set(ts);
    this.entries.set(sortEntries(ts.entries));
    this.comment.set(ts.comment);
    this.onCall.set(sortOnCall(ts.onCall ?? []));
    this.interventions.set(sortInterventions(ts.interventions ?? []));
    this.saved.set(snapshot(ts.entries, ts.comment, ts.onCall ?? [], ts.interventions ?? []));
  }

  // ------------------------------------------------------------ pinceau
  select(id: string | 'gomme'): void {
    if (!this.editable()) return;
    this.selectedId.update((cur) => (cur === id ? null : id));
  }

  setPartial(id: string, value: boolean): void {
    this.partial.update((p) => ({ ...p, [id]: value }));
  }

  private setDay(date: string, day: Entry[]): void {
    this.entries.update((all) => sortEntries([...all.filter((e) => e.date !== date), ...day]));
  }

  /** Début d'un trait (clic ou appui) ; retourne false si le jour n'est pas saisissable. */
  beginStroke(date: string): boolean {
    const brush = this.brush();
    if (!brush || !this.editable()) return false;
    this.stroke = { mode: 'toggle', visited: new Set() };
    const applied = this.paint(date);
    // Le premier jour fixe le mode du trait ; un premier jour refusé laisse le trait en mode « ajout ».
    if (this.stroke) this.stroke.mode = applied.before ? strokeModeAfterFirst(applied.before, applied.after ?? [], brush) : 'paint';
    return applied.ok;
  }

  continueStroke(date: string): void {
    if (this.stroke && !this.stroke.visited.has(date)) this.paint(date, true);
  }

  endStroke(): void {
    this.stroke = null;
  }

  /** Application au clavier (Entrée / Espace). */
  applyAt(date: string): boolean {
    const ok = this.beginStroke(date);
    this.endStroke();
    return ok;
  }

  private paint(date: string, silent = false): { ok: boolean; before?: Entry[]; after?: Entry[] } {
    const brush = this.brush();
    if (!brush || !this.stroke) return { ok: false };
    this.stroke.visited.add(date);
    const refusal = this.refusals().get(date);
    if (refusal) {
      if (!silent) this.notice.set({ text: refusal, tone: 'erreur' });
      return { ok: false };
    }
    const before = this.byDate().get(date) ?? [];
    if (brush.kind === 'eraser' && !before.length) return { ok: false, before, after: before };
    const after = applyBrush(before, date, brush, this.stroke.mode);
    this.setDay(date, after);
    return { ok: true, before, after };
  }

  removeEntry(date: string, activityId: string): void {
    if (!this.editable()) return;
    this.setDay(date, (this.byDate().get(date) ?? []).filter((e) => e.activityId !== activityId));
  }

  /**
   * Vue tableau : fixe la quantité d'une activité un jour donné (0 = vide).
   * Mêmes règles de jours que le pinceau ; le total > 1 j est permis temporairement mais signalé (rouge)
   * et refusé par le serveur à l'enregistrement.
   */
  setCell(date: string, activityId: string, quantity: 0 | 0.5 | 1): boolean {
    if (!this.editable()) return false;
    const a = this.activityById().get(activityId);
    if (quantity > 0 && a) {
      const refusal = dayRefusal(date, a);
      if (refusal) {
        this.notice.set({ text: refusal, tone: 'erreur' });
        return false;
      }
    }
    const others = (this.byDate().get(date) ?? []).filter((e) => e.activityId !== activityId);
    this.setDay(date, quantity ? [...others, { date, activityId, quantity }] : others);
    return true;
  }

  /** Quantité saisie pour une activité un jour donné (0 si rien). */
  quantityAt(date: string, activityId: string): 0 | 0.5 | 1 {
    return this.byDate().get(date)?.find((e) => e.activityId === activityId)?.quantity ?? 0;
  }

  /** Cycle vide → ½ → 1 → vide. */
  cycleCell(date: string, activityId: string): boolean {
    const next = ({ 0: 0.5, 0.5: 1, 1: 0 } as const)[this.quantityAt(date, activityId)];
    return this.setCell(date, activityId, next);
  }

  /** Dates dont le total dépasse 1 jour (possible uniquement via la vue tableau). */
  readonly overLimitDays = computed(() => this.days().filter((d) => d.total > 1).map((d) => d.date));

  setComment(value: string): void {
    this.comment.set(value === '' ? null : value);
  }

  // ------------------------------------------------------------ ordre des activités
  async reorder(ids: string[]): Promise<void> {
    const byId = this.activityById();
    const ordered = ids.map((id) => byId.get(id)).filter((a): a is Activity => !!a);
    const rest = this.activities().filter((a) => !ids.includes(a.id));
    this.activities.set([...ordered, ...rest]);
    try {
      await this.api.saveActivityOrder(this.activities().filter((a) => !a.archived).map((a) => a.id));
    } catch (err) {
      this.notice.set({ text: `Ordre non enregistré : ${apiError(err).error}`, tone: 'erreur' });
    }
  }

  // ------------------------------------------------------------ enregistrement / soumission
  async save(): Promise<boolean> {
    if (!this.editable()) return false;
    this.busy.set('enregistrement');
    this.serverErrors.set(null);
    try {
      const ts = await this.api.saveTimesheet(this.month(), this.entries(), this.comment(), this.onCall(), this.interventions());
      this.applyServer(ts);
      this.notice.set({ text: 'Brouillon enregistré', tone: 'succes' });
      return true;
    } catch (err) {
      this.handleError(err);
      return false;
    } finally {
      this.busy.set(null);
    }
  }

  async submit(): Promise<boolean> {
    if (this.dirty() && !(await this.save())) return false;
    this.busy.set('soumission');
    this.serverErrors.set(null);
    try {
      const ts = await this.api.submitTimesheet(this.month());
      this.applyServer(ts);
      this.selectedId.set(null);
      this.notice.set({ text: ts.status === 'VALIDE' ? 'CRA soumis et validé' : 'CRA soumis : en attente de validation client', tone: 'succes' });
      return true;
    } catch (err) {
      this.handleError(err);
      return false;
    } finally {
      this.busy.set(null);
    }
  }

  private handleError(err: unknown): void {
    const e = apiError(err);
    this.serverErrors.set({ message: e.error, details: e.details ?? [] });
    this.notice.set({ text: e.error, tone: 'erreur' });
  }

  // ------------------------------------------------------------ libellés
  activityName(id: string): string {
    const a = this.activityById().get(id);
    if (!a) return 'Activité inconnue';
    return a.missionLabel ? `${a.missionLabel} ${a.label}` : a.label;
  }

  /** « mardi 3 novembre : Projet Alpha Développement, 1 jour » */
  dayLabel(d: DayCell): string {
    const head = `${WEEKDAY_NAMES[d.weekday]} ${d.day} ${MONTH_NAMES[Number(d.date.slice(5, 7)) - 1]}`;
    const content = d.entries.length
      ? d.entries.map((e) => `${this.activityName(e.activityId)}, ${e.quantity === 1 ? '1 jour' : 'une demi-journée'}`).join(' ; ')
      : d.holiday
        ? `férié (${d.holiday})`
        : d.weekend
          ? 'week-end'
          : 'non renseigné';
    return `${head} : ${content}${d.isToday ? " (aujourd'hui)" : ''}`;
  }

  /** « 3 jours ouvrés non renseignés : 12, 13, 14 novembre. » */
  missingSummary(): string {
    const missing = this.missingDays();
    if (!missing.length) return '';
    const month = MONTH_NAMES[Number(this.month().slice(5, 7)) - 1];
    const list = missing.map((d) => Number(d.slice(8))).join(', ');
    return `${missing.length} jour${missing.length > 1 ? 's' : ''} ouvré${missing.length > 1 ? 's' : ''} non renseigné${missing.length > 1 ? 's' : ''} : ${list} ${month}.`;
  }

  subtitleDays(): string {
    return `${formatDays(this.totalDays())} saisi${this.totalDays() > 1 ? 's' : ''} / ${this.workingDays()} j ouvrés`;
  }
}

export { frDate };

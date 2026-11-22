import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Activity, Timesheet } from '../../shared/types';
import { STATUS_LABELS } from '../../shared/types';
import { monthDays } from '../../shared/holidays';

const ORCHID = rgb(0.486, 0.361, 0.749); // #7C5CBF
const INK = rgb(0.106, 0.137, 0.251); // #1B2340
const GREY = rgb(0.45, 0.47, 0.52);
const LINE = rgb(0.88, 0.89, 0.92);

const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const WEEKDAYS = ['', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

/** Helvetica standard = WinAnsi : on remplace les caractères non encodables. */
function safe(text: string): string {
  return text.replace(/[^\x20-\x7E -ÿ–—’€]/g, '?');
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

function fmtDays(n: number): string {
  return n.toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + (n > 1 ? ' jours' : ' jour');
}

export async function renderTimesheetPdf(input: { consultant: string; timesheet: Timesheet; activities: Activity[] }): Promise<Uint8Array> {
  const { consultant, timesheet: ts, activities } = input;
  const doc = await PDFDocument.create();
  doc.setTitle(`CRA ${ts.month} – ${consultant}`);
  doc.setAuthor('Orkidea');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const acts = new Map(activities.map((a) => [a.id, a]));
  const days = new Map(monthDays(ts.month).map((d) => [d.date, d]));

  let page: PDFPage = doc.addPage([595.28, 841.89]);
  const M = 48;
  let y = 841.89 - M;

  const text = (t: string, x: number, size = 10, f: PDFFont = font, color = INK) => page.drawText(safe(t), { x, y, size, font: f, color });
  const ensure = (h: number) => {
    if (y - h < M + 20) {
      page = doc.addPage([595.28, 841.89]);
      y = 841.89 - M;
    }
  };
  const rule = () => page.drawLine({ start: { x: M, y: y - 4 }, end: { x: 595.28 - M, y: y - 4 }, thickness: 0.6, color: LINE });

  // En-tête
  text('ORKIDEA', M, 20, bold, ORCHID);
  text('Compte rendu d’activité', 595.28 - M - bold.widthOfTextAtSize('Compte rendu d’activité', 14), 14, bold);
  y -= 30;
  text(`Consultant : ${consultant}`, M, 11);
  text(`Période : ${monthLabel(ts.month)}`, 330, 11);
  y -= 16;
  text(`Statut : ${STATUS_LABELS[ts.status]}`, M, 10, font, GREY);
  text(`Jours ouvrés du mois : ${ts.workingDays}`, 330, 10, font, GREY);
  y -= 26;

  // Synthèse par activité
  const totals = new Map<string, number>();
  let worked = 0;
  let absent = 0;
  for (const e of ts.entries) {
    totals.set(e.activityId, (totals.get(e.activityId) ?? 0) + e.quantity);
    if (acts.get(e.activityId)?.kind === 'absence') absent += e.quantity;
    else worked += e.quantity;
  }
  text('Synthèse', M, 12, bold, ORCHID);
  y -= 18;
  text('Mission / client', M, 9, bold, GREY);
  text('Activité', 300, 9, bold, GREY);
  text('Jours', 480, 9, bold, GREY);
  y -= 14;
  for (const [id, qty] of totals) {
    const a = acts.get(id);
    ensure(14);
    rule();
    text(a?.missionLabel ? `${a.missionLabel} – ${a.clientName ?? ''}` : 'Absence', M, 10);
    text(a?.label ?? id, 300, 10);
    text(qty.toLocaleString('fr-FR'), 480, 10);
    y -= 14;
  }
  y -= 6;
  text(`Jours travaillés : ${fmtDays(worked)}`, M, 11, bold);
  text(`Absences : ${fmtDays(absent)}`, 300, 11, bold);
  y -= 28;

  // Détail jour par jour
  ensure(40);
  text('Détail', M, 12, bold, ORCHID);
  y -= 18;
  text('Date', M, 9, bold, GREY);
  text('Activité', 160, 9, bold, GREY);
  text('Jour(s)', 480, 9, bold, GREY);
  y -= 14;
  const sorted = [...ts.entries].sort((a, b) => a.date.localeCompare(b.date));
  for (const e of sorted) {
    ensure(14);
    const d = days.get(e.date);
    const a = acts.get(e.activityId);
    rule();
    text(`${WEEKDAYS[d?.weekday ?? 0]} ${e.date.split('-').reverse().join('/')}`, M, 9.5);
    text(a ? (a.missionLabel ? `${a.missionLabel} · ${a.label}` : a.label) : e.activityId, 160, 9.5);
    text(e.quantity === 1 ? '1' : '0,5', 480, 9.5);
    y -= 14;
  }
  y -= 10;

  // Validations client
  if (ts.validations.length) {
    ensure(30 + ts.validations.length * 14);
    text('Validation client', M, 12, bold, ORCHID);
    y -= 18;
    for (const v of ts.validations) {
      const label = v.status === 'VALIDE' ? 'Validé' : v.status === 'REJETE' ? 'Rejeté' : 'En attente';
      const when = v.decidedAt ? ` le ${new Date(v.decidedAt).toLocaleDateString('fr-FR')}` : '';
      text(`${v.missionLabel} (${v.clientName}) : ${label}${when}`, M, 10);
      y -= 14;
    }
    y -= 10;
  }

  if (ts.comment) {
    ensure(40);
    text('Commentaire', M, 12, bold, ORCHID);
    y -= 16;
    text(ts.comment.slice(0, 110), M, 10);
    y -= 24;
  }

  // Cadres de signature
  ensure(110);
  const boxW = (595.28 - 2 * M - 20) / 2;
  for (const [i, title] of ['Le consultant', 'Le client'].entries()) {
    const x = M + i * (boxW + 20);
    page.drawRectangle({ x, y: y - 80, width: boxW, height: 90, borderColor: LINE, borderWidth: 1 });
    page.drawText(title, { x: x + 10, y: y - 6, size: 10, font: bold, color: INK });
    page.drawText('Date et signature', { x: x + 10, y: y - 20, size: 8, font, color: GREY });
  }

  // Pied de page
  const pages = doc.getPages();
  pages.forEach((p, i) =>
    p.drawText(`Orkidea – CRA ${ts.month} – ${safe(consultant)} – page ${i + 1}/${pages.length}`, { x: M, y: 24, size: 8, font, color: GREY }),
  );
  return doc.save();
}


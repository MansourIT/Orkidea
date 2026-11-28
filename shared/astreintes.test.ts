import { describe, expect, it } from 'vitest';
import { checkOnCall, formatMinutes, interventionMinutes, nightMinutes, onCallTotals, type OnCallMission } from './astreintes';

const M: OnCallMission[] = [{ id: 'm1', label: 'Alpha', color: '#000', startDate: '2026-11-01', endDate: '2026-11-20' }];

describe('astreintes', () => {
  it('durées, passage de minuit, heures de nuit (21 h → 6 h)', () => {
    expect(interventionMinutes('09:00', '11:30')).toBe(150);
    expect(interventionMinutes('22:30', '01:15')).toBe(165);
    expect(nightMinutes('22:30', '01:15')).toBe(165);
    expect(nightMinutes('20:00', '22:00')).toBe(60);
    expect(nightMinutes('05:00', '07:00')).toBe(60);
    expect(nightMinutes('10:00', '12:00')).toBe(0);
    expect(nightMinutes('18:00', '08:00')).toBe(540);
    expect(formatMinutes(150)).toBe('2 h 30');
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(180)).toBe('3 h');
  });

  it('totaux : week-end et férié selon le jour de début', () => {
    const t = onCallTotals(
      [{ date: '2026-11-07', missionId: 'm1' }, { date: '2026-11-11', missionId: 'm1' }],
      [
        { date: '2026-11-07', missionId: 'm1', start: '23:00', end: '01:00', reason: null }, // samedi
        { date: '2026-11-11', missionId: 'm1', start: '10:00', end: '11:00', reason: 'INC-42' }, // 11 novembre
      ],
      'metropole',
    );
    expect(t).toEqual({ days: 2, minutes: 180, night: 120, weekend: 120, holiday: 60 });
  });

  it('contrôles : mission, dates, astreinte requise, chevauchement, y compris après minuit', () => {
    const errors = checkOnCall(
      '2026-11',
      [
        { date: '2026-11-05', missionId: 'm1' },
        { date: '2026-11-06', missionId: 'm1' },
        { date: '2026-11-25', missionId: 'm1' },
        { date: '2026-11-05', missionId: 'mX' },
      ],
      [
        { date: '2026-11-05', missionId: 'm1', start: '23:00', end: '02:00', reason: null },
        { date: '2026-11-06', missionId: 'm1', start: '01:00', end: '03:00', reason: null }, // chevauche la précédente
        { date: '2026-11-07', missionId: 'm1', start: '10:00', end: '11:00', reason: null }, // pas d'astreinte
        { date: '2026-11-05', missionId: 'm1', start: '10:00', end: '10:00', reason: null },
        { date: '2026-11-05', missionId: 'm1', start: '9h', end: '10:00', reason: null },
      ],
      M,
    );
    expect(errors).toEqual([
      'Astreinte du 2026-11-25 en dehors des dates de la mission Alpha',
      'Astreinte non prévue pour cette mission le 2026-11-05',
      'Intervention du 2026-11-07 sans astreinte ce jour-là sur la mission',
      'Intervention du 2026-11-05 : l’heure de fin doit différer de l’heure de début',
      'Heures invalides pour l’intervention du 2026-11-05 (format HH:MM)',
      'Interventions qui se chevauchent le 2026-11-06',
    ]);
    expect(checkOnCall('2026-11', [{ date: '2026-11-07', missionId: 'm1' }], [{ date: '2026-11-07', missionId: 'm1', start: '10:00', end: '11:00', reason: 'ok' }], M)).toEqual([]);
  });
});

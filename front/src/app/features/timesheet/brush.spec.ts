import type { Entry } from '@shared/types';
import { applyBrush, dayTotal, strokeModeAfterFirst, type Brush } from './brush';

const D = '2026-11-03';
const e = (activityId: string, quantity: 0.5 | 1): Entry => ({ date: D, activityId, quantity });
const A1: Brush = { kind: 'activity', activityId: 'A', quantity: 1 };
const AH: Brush = { kind: 'activity', activityId: 'A', quantity: 0.5 };
const BH: Brush = { kind: 'activity', activityId: 'B', quantity: 0.5 };
const CH: Brush = { kind: 'activity', activityId: 'C', quantity: 0.5 };

describe('pinceau', () => {
  it('1 jour remplace tout le contenu du jour', () => {
    expect(applyBrush([e('B', 0.5), e('C', 0.5)], D, A1)).toEqual([e('A', 1)]);
    expect(applyBrush([], D, A1)).toEqual([e('A', 1)]);
  });

  it('½ jour s’ajoute s’il reste de la place', () => {
    expect(applyBrush([e('B', 0.5)], D, AH)).toEqual([e('B', 0.5), e('A', 0.5)]);
    expect(applyBrush([], D, AH)).toEqual([e('A', 0.5)]);
  });

  it('½ jour remplace si le jour est plein', () => {
    expect(applyBrush([e('B', 1)], D, AH)).toEqual([e('A', 0.5)]);
    expect(applyBrush([e('A', 0.5), e('B', 0.5)], D, CH)).toEqual([e('C', 0.5)]);
  });

  it('même activité, autre quantum : remplace la ligne', () => {
    expect(applyBrush([e('A', 1)], D, AH)).toEqual([e('A', 0.5)]);
    expect(applyBrush([e('A', 0.5), e('B', 0.5)], D, A1)).toEqual([e('A', 1)]);
  });

  it('re-cliquer la même activité au même quantum la retire (bascule)', () => {
    expect(applyBrush([e('A', 1)], D, A1)).toEqual([]);
    expect(applyBrush([e('A', 0.5), e('B', 0.5)], D, AH)).toEqual([e('B', 0.5)]);
  });

  it('la gomme vide le jour', () => {
    expect(applyBrush([e('A', 0.5), e('B', 0.5)], D, { kind: 'eraser' })).toEqual([]);
  });

  it('le total ne dépasse jamais 1 jour', () => {
    let day: Entry[] = [];
    for (const b of [AH, BH, CH, A1, BH, AH, CH]) {
      day = applyBrush(day, D, b);
      expect(dayTotal(day)).toBeLessThanOrEqual(1);
    }
  });

  it('glisser : mode « paint » n’enlève jamais, « unpaint » retire', () => {
    expect(applyBrush([e('A', 1)], D, A1, 'paint')).toEqual([e('A', 1)]);
    expect(applyBrush([e('B', 0.5)], D, AH, 'paint')).toEqual([e('B', 0.5), e('A', 0.5)]);
    expect(applyBrush([e('A', 0.5), e('B', 0.5)], D, AH, 'unpaint')).toEqual([e('B', 0.5)]);
    expect(applyBrush([e('B', 1)], D, AH, 'unpaint')).toEqual([e('B', 1)]);
  });

  it('le premier jour du trait détermine son mode', () => {
    expect(strokeModeAfterFirst([e('A', 1)], [], A1)).toBe('unpaint');
    expect(strokeModeAfterFirst([], [e('A', 1)], A1)).toBe('paint');
    expect(strokeModeAfterFirst([e('A', 1)], [e('A', 0.5)], AH)).toBe('paint');
    expect(strokeModeAfterFirst([e('A', 1)], [], { kind: 'eraser' })).toBe('paint');
  });
});

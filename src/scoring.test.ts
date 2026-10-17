import { describe, expect, it } from 'vitest';
import { aggregate, formatToPar, holeNumbers, nines, totals, type CompletedRound } from './scoring';
import type { Hole, Round } from './types';

const hole = (n: number, par: number, strokes: number, putts: number, pen: Hole['tee_penalty_type'] = 'none'): Hole => ({
  hole_id: `r_${n}`, round_id: 'r', hole_number: n, par, distance_yards: null,
  strokes, putts, tee_penalty_type: pen, updated_at: '',
});

describe('holeNumbers', () => {
  it('maps round shapes to hole numbers', () => {
    expect(holeNumbers({ hole_count: 18, starting_nine: 'front' })).toHaveLength(18);
    expect(holeNumbers({ hole_count: 9, starting_nine: 'front' })[0]).toBe(1);
    expect(holeNumbers({ hole_count: 9, starting_nine: 'back' })).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18]);
  });
});

describe('totals', () => {
  const holes = [hole(1, 4, 6, 3, 'retee'), hole(2, 3, 3, 0), hole(3, 5, 5, 2, 'drop'), hole(10, 4, 4, 4)];
  it('derives everything from hole data; penalties never add strokes', () => {
    const t = totals(holes);
    expect(t).toMatchObject({ strokes: 18, par: 16, toPar: 2, putts: 9, threePutts: 2, retees: 1, drops: 1, penalties: 2 });
    expect(t.puttsPerHole).toBeCloseTo(2.25);
  });
  it('splits nines', () => {
    const n = nines(holes);
    expect(n.front.holes).toBe(3);
    expect(n.back.strokes).toBe(4);
  });
});

describe('aggregate', () => {
  it('averages only the rounds passed in', () => {
    const mk = (hs: Hole[]): CompletedRound => ({ round: { round_id: 'r' } as Round, holes: hs, totals: totals(hs) });
    const a = aggregate([mk([hole(1, 4, 5, 2), hole(2, 4, 4, 1)]), mk([hole(1, 4, 7, 3), hole(2, 4, 5, 2)])])!;
    expect(a.avgScore).toBe(10.5);
    expect(a.bestScore).toBe(9);
    expect(a.avgToPar).toBe(2.5);
    expect(a.avgPuttsPerHole).toBe(2);
    expect(a.threePuttsPerRound).toBe(0.5);
    expect(aggregate([])).toBeNull();
  });
  it('formats score to par', () => {
    expect(formatToPar(0)).toBe('E');
    expect(formatToPar(24)).toBe('+24');
    expect(formatToPar(-2)).toBe('−2');
  });
});

import type { Hole, Round } from './types';

export function holeNumbers(round: Pick<Round, 'hole_count' | 'starting_nine'>): number[] {
  const start = round.hole_count === 18 || round.starting_nine === 'front' ? 1 : 10;
  return Array.from({ length: round.hole_count }, (_, i) => start + i);
}

export const holeId = (roundId: string, holeNumber: number) => `${roundId}_${holeNumber}`;

export interface Totals {
  holes: number;
  strokes: number;
  par: number;
  toPar: number;
  putts: number;
  puttsPerHole: number;
  threePutts: number;
  retees: number;
  drops: number;
  penalties: number;
}

export function totals(holes: Hole[]): Totals {
  const strokes = holes.reduce((s, h) => s + h.strokes, 0);
  const par = holes.reduce((s, h) => s + h.par, 0);
  const putts = holes.reduce((s, h) => s + h.putts, 0);
  const retees = holes.filter((h) => h.tee_penalty_type === 'retee').length;
  const drops = holes.filter((h) => h.tee_penalty_type === 'drop').length;
  return {
    holes: holes.length,
    strokes,
    par,
    toPar: strokes - par,
    putts,
    puttsPerHole: holes.length ? putts / holes.length : 0,
    threePutts: holes.filter((h) => h.putts >= 3).length,
    retees,
    drops,
    penalties: retees + drops,
  };
}

/** Front/back split for 18-hole rounds. */
export function nines(holes: Hole[]): { front: Totals; back: Totals } {
  return {
    front: totals(holes.filter((h) => h.hole_number <= 9)),
    back: totals(holes.filter((h) => h.hole_number > 9)),
  };
}

export const formatToPar = (n: number) => (n === 0 ? 'E' : n > 0 ? `+${n}` : `−${Math.abs(n)}`);

export const round1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

export interface CompletedRound {
  round: Round;
  holes: Hole[];
  totals: Totals;
}

export interface Aggregate {
  rounds: number;
  avgScore: number;
  bestScore: number;
  avgToPar: number;
  avgPuttsPerHole: number;
  avgPuttsPerRound: number;
  threePuttsPerRound: number;
  avgRetees: number;
  avgDrops: number;
  totalPenalties: number;
}

/** Aggregate over rounds of one length only; 9- and 18-hole rounds are never mixed. */
export function aggregate(list: CompletedRound[]): Aggregate | null {
  if (list.length === 0) return null;
  const n = list.length;
  const sum = (f: (t: Totals) => number) => list.reduce((s, r) => s + f(r.totals), 0);
  return {
    rounds: n,
    avgScore: sum((t) => t.strokes) / n,
    bestScore: Math.min(...list.map((r) => r.totals.strokes)),
    avgToPar: sum((t) => t.toPar) / n,
    avgPuttsPerHole: sum((t) => t.putts) / sum((t) => t.holes),
    avgPuttsPerRound: sum((t) => t.putts) / n,
    threePuttsPerRound: sum((t) => t.threePutts) / n,
    avgRetees: sum((t) => t.retees) / n,
    avgDrops: sum((t) => t.drops) / n,
    totalPenalties: sum((t) => t.penalties),
  };
}

export const byRecent = (a: Round, b: Round) =>
  b.round_date.localeCompare(a.round_date) || b.created_at.localeCompare(a.created_at);

export function todayLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

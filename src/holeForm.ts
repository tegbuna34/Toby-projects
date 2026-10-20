import type { Draft, Hole, PenaltyType } from './types';

export interface FormState {
  par: number | null;
  distance: string;
  strokes: number | null;
  strokesTouched: boolean;
  putts: number;
  puttsTouched: boolean;
  penalty: PenaltyType;
  note: string;
}

export const emptyForm: FormState = {
  par: null, distance: '', strokes: null, strokesTouched: false, putts: 2, puttsTouched: false, penalty: 'none', note: '',
};

export const MAX_PUTTS = 10;
export function fromHole(hole: Hole): FormState {
  return {
    par: hole.par, distance: hole.distance_yards === null ? '' : String(hole.distance_yards),
    strokes: hole.strokes, strokesTouched: true, putts: hole.putts, puttsTouched: true,
    penalty: hole.tee_penalty_type, note: hole.note ?? '',
  };
}
export const puttsMax = (f: FormState) => Math.min(MAX_PUTTS, f.strokes ?? MAX_PUTTS);

export function setPar(f: FormState, par: number): FormState {
  if (f.strokes !== null && f.strokesTouched) return { ...f, par };
  // Strokes follow par until the golfer edits them by hand.
  return { ...f, par, strokes: par, putts: f.puttsTouched ? Math.min(f.putts, par) : Math.min(2, par) };
}

export function setStrokes(f: FormState, n: number): FormState {
  const strokes = Math.max(1, n);
  const putts = f.puttsTouched ? Math.min(f.putts, strokes) : Math.min(2, strokes);
  return { ...f, strokes, strokesTouched: true, putts };
}

export function setPutts(f: FormState, n: number): FormState {
  return { ...f, putts: Math.max(0, Math.min(n, puttsMax(f))), puttsTouched: true };
}

export function validate(f: FormState): string | null {
  if (f.par === null) return 'Select the par for this hole.';
  if (f.strokes === null || f.strokes < 1) return 'Enter at least 1 stroke.';
  if (f.putts > f.strokes) return 'Putts cannot exceed strokes.';
  if (f.distance !== '' && !/^\d{1,4}$/.test(f.distance)) return 'Distance must be a whole number of yards.';
  return null;
}

export function toHoleInput(roundId: string, holeNumber: number, f: FormState): Omit<Hole, 'hole_id' | 'updated_at'> {
  return {
    round_id: roundId,
    hole_number: holeNumber,
    par: f.par!,
    distance_yards: f.distance === '' ? null : Number(f.distance),
    strokes: f.strokes!,
    putts: f.putts,
    tee_penalty_type: f.penalty,
    note: f.note.trim(),
  };
}

export const toDraft = (roundId: string, holeNumber: number, f: FormState): Draft => ({
  round_id: roundId, hole_number: holeNumber, ...f,
});

export function fromDraft(d: Draft | undefined, holeNumber: number): FormState {
  if (!d || d.hole_number !== holeNumber) return emptyForm;
  const { par, distance, strokes, strokesTouched, putts, puttsTouched, penalty, note } = d;
  return { par, distance, strokes, strokesTouched, putts, puttsTouched, penalty, note: note ?? '' };
}

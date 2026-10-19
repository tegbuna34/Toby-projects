import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  ackOutbox, allCompleted, holesForRound, completedHoleNumbers, createRound, getActiveRound, mergeRemote, outbox, saveHole,
  loadDraft, saveDraft,
} from './db';
import { emptyForm, toDraft } from './holeForm';

const input = (round_id: string, hole_number: number, strokes: number) => ({
  round_id, hole_number, par: 4, distance_yards: null, strokes, putts: 2, tee_penalty_type: 'none' as const,
});

describe('local store', () => {
  it('preserves the current-hole draft during a blind correction and clears it when that hole is saved', async () => {
    const r = await createRound({ course_name: 'Draft GC', round_date: '2026-04-01', hole_count: 9, starting_nine: 'front' });
    await saveHole(input(r.round_id, 1, 4));
    const draft = toDraft(r.round_id, 2, { ...emptyForm, par: 4, strokes: 5, note: 'Keep a smooth tempo' });
    await saveDraft(draft);
    await saveHole(input(r.round_id, 1, 6));
    expect(await loadDraft(r.round_id)).toEqual(draft);
    await saveHole(input(r.round_id, 2, 5));
    expect(await loadDraft(r.round_id)).toBeUndefined();
  });

  it('keeps one record per hole, replaces edits, and completes only when all holes exist', async () => {
    const r = await createRound({ course_name: 'Test GC', round_date: '2026-01-01', hole_count: 9, starting_nine: 'back' });
    for (let n = 10; n <= 17; n++) await saveHole(input(r.round_id, n, 5), { complete: true });
    expect((await getActiveRound())?.round_id).toBe(r.round_id);
    await saveHole(input(r.round_id, 12, 9)); // replace an earlier hole
    expect(await completedHoleNumbers(r.round_id)).toHaveLength(8);
    const res = await saveHole(input(r.round_id, 18, 4), { complete: true });
    expect(res.completed).toBe(true);
    const [done] = await allCompleted();
    expect(done.holes).toHaveLength(9);
    expect(done.totals.strokes).toBe(5 * 7 + 9 + 4);
  });

  it('abandons the old active round when a new one starts', async () => {
    const a = await createRound({ course_name: 'A', round_date: '2026-02-01', hole_count: 18, starting_nine: 'front' });
    const b = await createRound({ course_name: 'B', round_date: '2026-02-02', hole_count: 18, starting_nine: 'front' });
    expect((await getActiveRound())?.round_id).toBe(b.round_id);
    expect(a.round_id).not.toBe(b.round_id);
  });

  it('outbox ack is idempotent and keeps records changed while in flight; merge skips pending', async () => {
    const r = await createRound({ course_name: 'C', round_date: '2026-03-01', hole_count: 9, starting_nine: 'front' });
    await saveHole(input(r.round_id, 1, 4));
    const sent = await outbox();
    await saveHole(input(r.round_id, 1, 6)); // edited while "in flight"
    await ackOutbox(sent);
    const left = await outbox();
    expect(left.some((o) => o.key === `hole:${r.round_id}_1`)).toBe(true);
    await mergeRemote([], [{ ...input(r.round_id, 1, 99), hole_id: `${r.round_id}_1`, updated_at: '2999-01-01' }]);
    await ackOutbox(await outbox());
    expect(await outbox()).toHaveLength(0);
  });

  it('keeps a hole note when a blind replacement leaves it blank, and overwrites it when given one', async () => {
    const r = await createRound({ course_name: 'N', round_date: '2026-04-01', hole_count: 9, starting_nine: 'front' });
    await saveHole({ ...input(r.round_id, 1, 4), note: 'pulled it left' });
    await saveHole(input(r.round_id, 1, 5)); // replace with no note
    expect((await holesForRound(r.round_id))[0].note).toBe('pulled it left');
    await saveHole({ ...input(r.round_id, 1, 5), note: 'tempo fixed it' });
    expect((await holesForRound(r.round_id))[0].note).toBe('tempo fixed it');
  });
});

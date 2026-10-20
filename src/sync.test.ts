import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  ackOutbox, allCompleted, holesForRound, completedHoleNumbers, createRound, getActiveRound, mergeRemote, outbox, saveHole,
  loadDraft, saveDraft, getHole, getRound, updateRoundSettings, markComplete, readForSync, deleteRound, courseNames,
} from './db';
import { emptyForm, fromHole, toDraft, toHoleInput } from './holeForm';

const input = (round_id: string, hole_number: number, strokes: number) => ({
  round_id, hole_number, par: 4, distance_yards: null, strokes, putts: 2, tee_penalty_type: 'none' as const,
});

describe('local store', () => {
  it('deletes rounds from history and stats and queues a deletion that survives a stale sync pull', async () => {
    const r = await createRound({ course_name: 'Delete QA', round_date: '2026-10-20', hole_count: 9, starting_nine: 'front' });
    for (let n = 1; n <= 9; n++) await saveHole(input(r.round_id, n, 5));
    await markComplete(r.round_id);
    await ackOutbox(await outbox());
    await deleteRound(r.round_id);
    expect((await allCompleted()).some((x) => x.round.round_id === r.round_id)).toBe(false);
    expect((await readForSync(await outbox())).rounds.find((x) => x.round_id === r.round_id)?.status).toBe('deleted');
    await ackOutbox(await outbox());
    await mergeRemote([{ ...r, status: 'completed', updated_at: '2999-01-01' }], []);
    expect((await getRound(r.round_id))?.status).toBe('deleted');
    expect((await outbox()).some((x) => x.id === r.round_id)).toBe(true);
    expect(await courseNames()).not.toContain('Delete QA');
  });

  it('applies deletion from another device even over pending local edits and clears an active draft', async () => {
    const r = await createRound({ course_name: 'Remote delete', round_date: '2026-10-20', hole_count: 9, starting_nine: 'front' });
    await saveDraft(toDraft(r.round_id, 1, emptyForm));
    await mergeRemote([{ ...r, status: 'deleted' }], []);
    expect((await getRound(r.round_id))?.status).toBe('deleted');
    expect(await loadDraft(r.round_id)).toBeUndefined();
    expect((await getActiveRound())?.round_id).not.toBe(r.round_id);
  });

  it('remembers synced course names and deduplicates capitalization and whitespace', async () => {
    const r = await createRound({ course_name: '  Browns Mill  ', round_date: '2026-10-20', hole_count: 9, starting_nine: 'front' });
    await createRound({ course_name: 'browns mill', round_date: '2026-10-20', hole_count: 9, starting_nine: 'front' });
    await mergeRemote([{ ...r, round_id: 'remote-course', course_name: 'East Lake', status: 'completed' }], []);
    const names = await courseNames();
    expect(names.filter((n) => n.toLowerCase() === 'browns mill')).toHaveLength(1);
    expect(names).toContain('East Lake');
  });
  it('corrects an 18-hole setup to nine without losing holes, notes, or the current draft', async () => {
    const r = await createRound({ course_name: 'Wrong setup', round_date: '2026-10-20', hole_count: 18, starting_nine: 'front' });
    await saveHole({ ...input(r.round_id, 1, 5), note: 'Keep this' });
    const draft = toDraft(r.round_id, 2, { ...emptyForm, note: 'Still typing' });
    await saveDraft(draft);
    await updateRoundSettings(r.round_id, { ...r, course_name: 'Correct course', hole_count: 9 });
    expect(await getRound(r.round_id)).toMatchObject({ course_name: 'Correct course', hole_count: 9, status: 'active' });
    expect(await getHole(r.round_id, 1)).toMatchObject({ strokes: 5, note: 'Keep this' });
    expect(await loadDraft(r.round_id)).toEqual(draft);
    const queued = await readForSync(await outbox());
    expect(queued.rounds.find((x) => x.round_id === r.round_id)?.hole_count).toBe(9);
    await updateRoundSettings(r.round_id, { ...r, hole_count: 18 });
    expect((await getRound(r.round_id))?.hole_count).toBe(18);
  });

  it('requires explicit finish after changing a fully recorded nine to nine holes', async () => {
    const r = await createRound({ course_name: 'Nine GC', round_date: '2026-10-20', hole_count: 18, starting_nine: 'front' });
    for (let n = 1; n <= 9; n++) await saveHole(input(r.round_id, n, 5));
    await updateRoundSettings(r.round_id, { ...r, hole_count: 9 });
    expect((await getRound(r.round_id))?.status).toBe('active');
    expect(await markComplete(r.round_id)).toBe(true);
    expect((await getRound(r.round_id))?.status).toBe('completed');
  });

  it('keeps back-nine numbering and rejects changes that would exclude saved holes', async () => {
    const r = await createRound({ course_name: 'Back GC', round_date: '2026-10-20', hole_count: 18, starting_nine: 'front' });
    await saveHole(input(r.round_id, 10, 5));
    await expect(updateRoundSettings(r.round_id, { ...r, hole_count: 9 })).rejects.toThrow('Saved holes');
    expect((await getRound(r.round_id))?.hole_count).toBe(18);
    await updateRoundSettings(r.round_id, { ...r, hole_count: 9, starting_nine: 'back' });
    expect(await getRound(r.round_id)).toMatchObject({ hole_count: 9, starting_nine: 'back' });
    expect(await completedHoleNumbers(r.round_id)).toEqual([10]);
  });

  it('edits notes with saved form values, preserves scoring, and allows clearing a misplaced note', async () => {
    const r = await createRound({ course_name: 'Edit GC', round_date: '2026-10-20', hole_count: 9, starting_nine: 'front' });
    await saveHole({ ...input(r.round_id, 3, 7), putts: 3, distance_yards: 385, tee_penalty_type: 'drop', note: 'Actually hole 4' });
    const original = (await getHole(r.round_id, 3))!;
    const form = fromHole(original);
    expect(form).toMatchObject({ strokes: 7, putts: 3, distance: '385', penalty: 'drop', note: 'Actually hole 4' });
    await saveHole(toHoleInput(r.round_id, 3, { ...form, note: '' }));
    expect(await getHole(r.round_id, 3)).toMatchObject({ strokes: 7, putts: 3, distance_yards: 385, tee_penalty_type: 'drop', note: '' });
    expect(await completedHoleNumbers(r.round_id)).toEqual([3]);
  });

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
    const done = (await allCompleted()).find((x) => x.round.round_id === r.round_id)!;
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

import { holeId, holeNumbers, byRecent, totals, type CompletedRound } from './scoring';
import type { Draft, Hole, OutboxItem, Round } from './types';

type StoreName = 'rounds' | 'holes' | 'drafts' | 'outbox';

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const r = indexedDB.open('blind-score', 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('rounds', { keyPath: 'round_id' });
      db.createObjectStore('holes', { keyPath: 'hole_id' }).createIndex('by_round', 'round_id');
      db.createObjectStore('drafts', { keyPath: 'round_id' });
      db.createObjectStore('outbox', { keyPath: 'key' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}

const wrap = <T>(r: IDBRequest<T>) =>
  new Promise<T>((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });

/** Run fn inside one transaction; resolves once the transaction has committed. */
async function run<T>(
  stores: StoreName[],
  mode: IDBTransactionMode,
  fn: (s: Record<StoreName, IDBObjectStore>) => Promise<T>,
): Promise<T> {
  const db = await open();
  const tx = db.transaction(stores, mode);
  const s = Object.fromEntries(stores.map((n) => [n, tx.objectStore(n)])) as Record<StoreName, IDBObjectStore>;
  const done = new Promise<void>((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  });
  const result = await fn(s);
  await done;
  return result;
}

// ---- change notification (UI) and queue notification (sync) -------------------------------

const listeners = new Set<() => void>();
let version = 0;
export const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
export const getVersion = () => version;
export const emitChange = () => {
  version++;
  listeners.forEach((l) => l());
};
let queuedHook: () => void = () => {};
export const onQueued = (cb: () => void) => {
  queuedHook = cb;
};

const nowIso = () => new Date().toISOString();
const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

function enqueue(s: Record<StoreName, IDBObjectStore>, kind: OutboxItem['kind'], id: string) {
  const item: OutboxItem = { key: `${kind}:${id}`, kind, id, seq: Date.now() + Math.random() };
  s.outbox.put(item);
}

export function requestPersistence() {
  void navigator.storage?.persist?.().catch(() => {});
}

// ---- rounds -------------------------------------------------------------------------------

export const getRound = async (id: string) =>
  run(['rounds'], 'readonly', (s) => wrap<Round | undefined>(s.rounds.get(id)));

export async function updateRoundSettings(roundId: string, input: Pick<Round, 'course_name' | 'round_date' | 'hole_count' | 'starting_nine'>) {
  if (!input.course_name.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(input.round_date)) throw new Error('Enter a course name and date.');
  await run(['rounds', 'holes', 'outbox'], 'readwrite', async (s) => {
    const round = await wrap<Round | undefined>(s.rounds.get(roundId));
    if (!round || round.status !== 'active') throw new Error('Only an active round can be changed.');
    const next: Round = { ...round, ...input, course_name: input.course_name.trim(), starting_nine: input.hole_count === 18 ? 'front' : input.starting_nine, updated_at: nowIso() };
    const allowed = new Set(holeNumbers(next));
    const holes = await wrap<Hole[]>(s.holes.index('by_round').getAll(roundId));
    if (holes.some((h) => !allowed.has(h.hole_number))) {
      throw new Error('Saved holes fall outside that nine. Choose the nine containing your saved holes, or keep 18 holes.');
    }
    s.rounds.put(next);
    enqueue(s, 'round', roundId);
  });
  emitChange();
  queuedHook();
}

export const allRounds = async () =>
  run(['rounds'], 'readonly', (s) => wrap<Round[]>(s.rounds.getAll()));

export async function getActiveRound(): Promise<Round | null> {
  const rounds = await allRounds();
  return rounds.filter((r) => r.status === 'active').sort(byRecent)[0] ?? null;
}

export async function courseNames(): Promise<string[]> {
  const rounds = await allRounds();
  const names = new Map<string, string>();
  for (const r of rounds.filter((r) => r.status !== 'deleted').sort(byRecent)) {
    const name = r.course_name.trim();
    if (name && !names.has(name.toLocaleLowerCase())) names.set(name.toLocaleLowerCase(), name);
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

/** Keep a synced tombstone so a pull or another device cannot resurrect a removed round. */
export async function deleteRound(roundId: string) {
  await run(['rounds', 'drafts', 'outbox'], 'readwrite', async (s) => {
    const round = await wrap<Round | undefined>(s.rounds.get(roundId));
    if (!round || round.status === 'deleted') return;
    s.rounds.put({ ...round, status: 'deleted', updated_at: nowIso() });
    s.drafts.delete(roundId);
    enqueue(s, 'round', roundId);
  });
  emitChange();
  queuedHook();
}

export async function createRound(input: {
  course_name: string;
  round_date: string;
  hole_count: 9 | 18;
  starting_nine: 'front' | 'back';
}): Promise<Round> {
  const ts = nowIso();
  const round: Round = {
    round_id: newId(),
    ...input,
    starting_nine: input.hole_count === 18 ? 'front' : input.starting_nine,
    status: 'active',
    created_at: ts,
    completed_at: null,
    updated_at: ts,
  };
  await run(['rounds', 'outbox'], 'readwrite', async (s) => {
    // Set any unfinished round aside (data kept) so there is only ever one active round.
    const existing = await wrap<Round[]>(s.rounds.getAll());
    for (const r of existing.filter((x) => x.status === 'active')) {
      s.rounds.put({ ...r, status: 'abandoned', updated_at: ts });
      enqueue(s, 'round', r.round_id);
    }
    s.rounds.put(round);
    enqueue(s, 'round', round.round_id);
  });
  emitChange();
  queuedHook();
  return round;
}

// ---- blind-safe progress ------------------------------------------------------------------
// The only read path used while a round is active: it exposes hole numbers, never hole data.

export async function completedHoleNumbers(roundId: string): Promise<number[]> {
  return run(['holes'], 'readonly', async (s) => {
    const holes = await wrap<Hole[]>(s.holes.index('by_round').getAll(roundId));
    return holes.map((h) => h.hole_number).sort((a, b) => a - b);
  });
}

// ---- drafts -------------------------------------------------------------------------------

export const loadDraft = (roundId: string) =>
  run(['drafts'], 'readonly', (s) => wrap<Draft | undefined>(s.drafts.get(roundId)));

export const getHole = (roundId: string, number: number) =>
  run(['holes'], 'readonly', (s) => wrap<Hole | undefined>(s.holes.get(holeId(roundId, number))));

export const saveDraft = (draft: Draft) =>
  run(['drafts'], 'readwrite', async (s) => {
    s.drafts.put(draft);
  });

// ---- holes --------------------------------------------------------------------------------

/**
 * Saves (or replaces) one hole. With `complete`, marks the round completed in the same
 * transaction, but only if every hole of the round now exists.
 */
export async function saveHole(
  input: Omit<Hole, 'hole_id' | 'updated_at'>,
  opts: { complete?: boolean } = {},
): Promise<{ completed: boolean }> {
  const ts = nowIso();
  const hole: Hole = { ...input, hole_id: holeId(input.round_id, input.hole_number), updated_at: ts };
  const completed = await run(['rounds', 'holes', 'drafts', 'outbox'], 'readwrite', async (s) => {
    // Omitted notes are preserved; an explicit empty string clears a note in the editor.
    if (hole.note === undefined) {
      const prev = await wrap<Hole | undefined>(s.holes.get(hole.hole_id));
      hole.note = prev?.note ?? '';
    }
    s.holes.put(hole);
    enqueue(s, 'hole', hole.hole_id);
    const draft = await wrap<Draft | undefined>(s.drafts.get(hole.round_id));
    if (draft?.hole_number === hole.hole_number) s.drafts.delete(hole.round_id);
    if (!opts.complete) return false;
    const round = await wrap<Round | undefined>(s.rounds.get(hole.round_id));
    if (!round) return false;
    const have = new Set(
      (await wrap<Hole[]>(s.holes.index('by_round').getAll(hole.round_id))).map((h) => h.hole_number),
    );
    if (!holeNumbers(round).every((n) => have.has(n))) return false;
    s.rounds.put({ ...round, status: 'completed', completed_at: ts, updated_at: ts });
    enqueue(s, 'round', round.round_id);
    return true;
  });
  emitChange();
  queuedHook();
  return { completed };
}

export const holesForRound = (roundId: string) =>
  run(['holes'], 'readonly', async (s) => {
    const holes = await wrap<Hole[]>(s.holes.index('by_round').getAll(roundId));
    return holes.sort((a, b) => a.hole_number - b.hole_number);
  });

/** Completed rounds with their holes. Never called while a round is active. */
export async function allCompleted(): Promise<CompletedRound[]> {
  return run(['rounds', 'holes'], 'readonly', async (s) => {
    const rounds = (await wrap<Round[]>(s.rounds.getAll())).filter((r) => r.status === 'completed');
    const holes = await wrap<Hole[]>(s.holes.getAll());
    return rounds.sort(byRecent).map((round) => {
      const hs = holes.filter((h) => h.round_id === round.round_id);
      return { round, holes: hs, totals: totals(hs) };
    });
  });
}

// ---- outbox / remote merge ----------------------------------------------------------------

export const outbox = () => run(['outbox'], 'readonly', (s) => wrap<OutboxItem[]>(s.outbox.getAll()));

export async function readForSync(items: OutboxItem[]) {
  return run(['rounds', 'holes'], 'readonly', async (s) => {
    const rounds: Round[] = [];
    const holes: Hole[] = [];
    for (const it of items) {
      if (it.kind === 'round') {
        const r = await wrap<Round | undefined>(s.rounds.get(it.id));
        if (r) rounds.push(r);
      } else {
        const h = await wrap<Hole | undefined>(s.holes.get(it.id));
        if (h) holes.push(h);
      }
    }
    return { rounds, holes };
  });
}

/** Drop queue entries that were sent, unless the record changed again while in flight. */
export async function ackOutbox(sent: OutboxItem[]) {
  await run(['outbox'], 'readwrite', async (s) => {
    for (const it of sent) {
      const cur = await wrap<OutboxItem | undefined>(s.outbox.get(it.key));
      if (cur && cur.seq === it.seq) s.outbox.delete(it.key);
    }
  });
  emitChange();
}

/**
 * Merge Google Sheets data into the local cache. Anything still waiting in the outbox is
 * local-newer by definition and is kept; otherwise the sheet wins when it is not older.
 */
export async function mergeRemote(rounds: Round[], holes: Hole[]) {
  await run(['rounds', 'holes', 'outbox', 'drafts'], 'readwrite', async (s) => {
    const pending = new Set((await wrap<OutboxItem[]>(s.outbox.getAll())).map((o) => o.key));
    for (const r of rounds) {
      const local = await wrap<Round | undefined>(s.rounds.get(r.round_id));
      if (local?.status === 'deleted') {
        if (r.status !== 'deleted') enqueue(s, 'round', r.round_id);
        continue;
      }
      if (r.status === 'deleted') {
        s.rounds.put(r);
        s.drafts.delete(r.round_id);
        s.outbox.delete(`round:${r.round_id}`);
        continue;
      }
      if (pending.has(`round:${r.round_id}`)) continue;
      if (!local || r.updated_at >= local.updated_at) s.rounds.put(r);
    }
    for (const h of holes) {
      if (pending.has(`hole:${h.hole_id}`)) continue;
      const local = await wrap<Hole | undefined>(s.holes.get(h.hole_id));
      if (!local || h.updated_at >= local.updated_at) s.holes.put(h);
    }
  });
  emitChange();
}

/** Explicit "Finish Round" for a round whose holes are all in. Returns false if any is missing. */
export async function markComplete(roundId: string): Promise<boolean> {
  const ts = nowIso();
  const ok = await run(['rounds', 'holes', 'outbox'], 'readwrite', async (s) => {
    const round = await wrap<Round | undefined>(s.rounds.get(roundId));
    if (!round) return false;
    const have = new Set((await wrap<Hole[]>(s.holes.index('by_round').getAll(roundId))).map((h) => h.hole_number));
    if (!holeNumbers(round).every((n) => have.has(n))) return false;
    s.rounds.put({ ...round, status: 'completed', completed_at: ts, updated_at: ts });
    enqueue(s, 'round', roundId);
    return true;
  });
  emitChange();
  queuedHook();
  return ok;
}

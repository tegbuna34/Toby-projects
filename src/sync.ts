import { useSyncExternalStore } from 'react';
import { ackOutbox, mergeRemote, onQueued, outbox, readForSync } from './db';
import type { Hole, Round } from './types';

export interface SyncConfig {
  url: string;
  token: string;
}
export interface SyncStatus {
  state: 'unconfigured' | 'idle' | 'syncing' | 'offline' | 'error';
  pending: number;
  lastSync: number | null;
  error?: string;
}

const CONFIG_KEY = 'blind-score-sync';

export function getConfig(): SyncConfig | null {
  try {
    const c = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? 'null');
    return c?.url && c?.token ? c : null;
  } catch {
    return null;
  }
}
export function setConfig(c: SyncConfig | null) {
  try {
    if (c) localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
    else localStorage.removeItem(CONFIG_KEY);
  } catch {
    /* storage unavailable: sync simply stays unconfigured */
  }
  void syncNow();
}

let status: SyncStatus = { state: 'idle', pending: 0, lastSync: null };
const listeners = new Set<() => void>();
const setStatus = (patch: Partial<SyncStatus>) => {
  status = { ...status, ...patch };
  listeners.forEach((l) => l());
};
export const useSyncStatus = () =>
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => status,
  );

async function call<T>(cfg: SyncConfig, body: Record<string, unknown>): Promise<T> {
  // text/plain keeps this a "simple" request, so the browser skips the CORS preflight that
  // Apps Script web apps cannot answer.
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ token: cfg.token, ...body }),
    redirect: 'follow',
  });
  const json = await res.json();
  if (!json?.ok) throw new Error(json?.error ?? 'Sync failed');
  return json as T;
}

let running: Promise<void> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let failures = 0;

/** Push the retry queue, then pull what the sheet has. Safe to call at any time. */
export function syncNow(): Promise<void> {
  running ??= doSync().finally(() => {
    running = null;
    if (status.state === 'idle' && status.pending > 0) retryTimer = setTimeout(() => void syncNow(), 0);
  });
  return running;
}

async function doSync() {
  clearTimeout(retryTimer);
  const cfg = getConfig();
  const items = await outbox();
  if (!cfg) return setStatus({ state: 'unconfigured', pending: items.length });
  if (!navigator.onLine) return setStatus({ state: 'offline', pending: items.length });
  setStatus({ state: 'syncing', pending: items.length });
  try {
    // Learn about deletions on another device before sending an older local round.
    if (items.length) {
      const latest = await call<{ rounds: Round[]; holes: Hole[] }>(cfg, { action: 'pull' });
      await mergeRemote(latest.rounds, latest.holes);
    }
    if (items.length) {
      const { rounds, holes } = await readForSync(items);
      await call(cfg, { action: 'upsert', rounds, holes });
      await ackOutbox(items);
    }
    const remote = await call<{ rounds: Round[]; holes: Hole[] }>(cfg, { action: 'pull' });
    await mergeRemote(remote.rounds, remote.holes);
    failures = 0;
    setStatus({ state: 'idle', pending: (await outbox()).length, lastSync: Date.now(), error: undefined });
  } catch (e) {
    failures++;
    setStatus({
      state: navigator.onLine ? 'error' : 'offline',
      pending: (await outbox()).length,
      error: e instanceof Error ? e.message : String(e),
    });
    retryTimer = setTimeout(() => void syncNow(), Math.min(60_000, 3_000 * 2 ** failures));
  }
}

export function initSync() {
  onQueued(() => void syncNow());
  addEventListener('online', () => void syncNow());
  addEventListener('offline', () => void syncNow());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow();
  });
  void syncNow();
}

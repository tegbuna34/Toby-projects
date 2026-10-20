import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  allCompleted, completedHoleNumbers, courseNames, createRound, getRound, getVersion, holesForRound, markComplete, subscribe, updateRoundSettings,
} from './db';
import { HoleEntry } from './HoleEntry';
import {
  aggregate, formatDate, formatToPar, holeNumbers, nines, round1, todayLocal, totals, type CompletedRound, type Totals,
} from './scoring';
import { getConfig, setConfig, syncNow, useSyncStatus } from './sync';
import type { Hole, Round } from './types';
import { Confirm, LineChart, Screen, Seg, SyncBadge } from './ui';

export type Route =
  | { name: 'home' }
  | { name: 'start' }
  | { name: 'active' }
  | { name: 'edit' }
  | { name: 'round-settings' }
  | { name: 'results'; id: string; fresh?: boolean }
  | { name: 'history' }
  | { name: 'stats' }
  | { name: 'settings' };

export type Go = (r: Route) => void;

export const useDataVersion = () => useSyncExternalStore(subscribe, getVersion);

// ---- Home ---------------------------------------------------------------------------------

export function Home({ active, go }: { active: Round | null; go: Go }) {
  const [confirming, setConfirming] = useState(false);
  const v = useDataVersion();
  const [current, setCurrent] = useState<number | null>(null);
  useEffect(() => {
    if (!active) return setCurrent(null);
    void completedHoleNumbers(active.round_id).then((done) => {
      setCurrent(holeNumbers(active).find((n) => !done.includes(n)) ?? null);
    });
  }, [active, v]);

  return (
    <Screen>
      <div className="grow" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <header style={{ marginBottom: 40 }}>
          <h1 className="title">Blind Score</h1>
          <p className="sub">Play the hole. Forget the score.</p>
        </header>

        {active ? (
          <div className="stack">
            <div className="card">
              <p className="eyebrow">Unfinished round</p>
              <p className="big">{active.course_name}</p>
              <p className="eyebrow">Started {formatDate(active.round_date)}{current ? ` · Hole ${current}` : ''}</p>
            </div>
            <button className="btn" onClick={() => go({ name: 'active' })}>Resume Round</button>
            <button className="btn secondary" onClick={() => go({ name: 'round-settings' })}>Round Settings</button>
            <button className="btn secondary" onClick={() => setConfirming(true)}>Start New Round</button>
          </div>
        ) : (
          <div className="stack">
            <button className="btn" onClick={() => go({ name: 'start' })}>Start New Round</button>
            <div className="row">
              <button className="btn secondary" onClick={() => go({ name: 'history' })}>Round History</button>
              <button className="btn secondary" onClick={() => go({ name: 'stats' })}>Stats</button>
            </div>
          </div>
        )}
      </div>
      <footer style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 24 }}>
        <SyncBadge />
        <button className="link quiet" onClick={() => go({ name: 'settings' })}>Sync settings</button>
      </footer>

      {confirming && active && (
        <Confirm
          title="Set this round aside?"
          body={`Your unfinished round at ${active.course_name} can't be resumed once you start a new one. Its saved holes are kept but won't appear in history.`}
          confirmLabel="Continue to New Round"
          onConfirm={() => go({ name: 'start' })}
          onCancel={() => setConfirming(false)}
        />
      )}
    </Screen>
  );
}

// ---- Start round --------------------------------------------------------------------------

export function StartRound({ go }: { go: Go }) {
  const [course, setCourse] = useState('');
  const [count, setCount] = useState<9 | 18>(18);
  const [nine, setNine] = useState<'front' | 'back'>('front');
  const [names, setNames] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void courseNames().then(setNames); }, []);
  const date = todayLocal();
  const valid = course.trim().length > 0;

  const start = async () => {
    if (!valid || busy) return;
    setBusy(true);
    await createRound({ course_name: course.trim(), round_date: date, hole_count: count, starting_nine: nine });
    go({ name: 'active' });
  };

  return (
    <Screen top={<div className="topbar"><button className="link" onClick={() => go({ name: 'home' })}>‹ Home</button></div>}>
      <h1 className="h2" style={{ margin: '8px 0 24px' }}>New round</h1>
      <div className="grow stack-lg">
        <section>
          <label className="label" htmlFor="course">Course name</label>
          <input id="course" className="input" list="courses" autoComplete="off" autoCapitalize="words" value={course} onChange={(e) => setCourse(e.target.value)} />
          <datalist id="courses">{names.map((n) => <option key={n} value={n} />)}</datalist>
        </section>
        <section>
          <span className="label">Round length</span>
          <Seg label="Round length" value={count} onChange={setCount} options={[{ value: 9, label: '9 Holes' }, { value: 18, label: '18 Holes' }]} />
        </section>
        {count === 9 && (
          <section>
            <span className="label">Starting nine</span>
            <Seg label="Starting nine" value={nine} onChange={setNine} options={[{ value: 'front', label: 'Front (1–9)' }, { value: 'back', label: 'Back (10–18)' }]} />
          </section>
        )}
        <section>
          <span className="label">Date</span>
          <p style={{ fontSize: 18 }}>{formatDate(date)}</p>
        </section>
      </div>
      <div className="footer-bar" style={{ marginTop: 20 }}>
        <button className="btn" disabled={!valid || busy} onClick={() => void start()}>Start Round</button>
      </div>
    </Screen>
  );
}

// ---- Active round -------------------------------------------------------------------------

export function RoundSettings({ round, go }: { round: Round; go: Go }) {
  const [course, setCourse] = useState(round.course_name);
  const [date, setDate] = useState(round.round_date);
  const [count, setCount] = useState<9 | 18>(round.hole_count);
  const [nine, setNine] = useState<'front' | 'back'>(round.starting_nine);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await updateRoundSettings(round.round_id, { course_name: course, round_date: date, hole_count: count, starting_nine: nine });
      go({ name: 'active' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save round settings. Please try again.');
    } finally { setBusy(false); }
  };
  return (
    <Screen top={<div className="topbar"><button className="link" onClick={() => go({ name: 'active' })}>‹ Back to Round</button></div>}>
      <h1 className="h2" style={{ margin: '8px 0 16px' }}>Round Settings</h1>
      <p className="sub" style={{ marginBottom: 24 }}>Update your setup. Saved holes and notes stay with this round.</p>
      <div className="grow stack-lg">
        <section><label className="label" htmlFor="round-course">Course name</label><input id="round-course" className="input" value={course} onChange={(e) => setCourse(e.target.value)} /></section>
        <section><label className="label" htmlFor="round-date">Date</label><input id="round-date" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></section>
        <section><span className="label">Round length</span><Seg label="Round length" value={count} onChange={setCount} options={[{ value: 9, label: '9 Holes' }, { value: 18, label: '18 Holes' }]} /></section>
        {count === 9 && <section><span className="label">Starting nine</span><Seg label="Starting nine" value={nine} onChange={setNine} options={[{ value: 'front', label: 'Front (1–9)' }, { value: 'back', label: 'Back (10–18)' }]} /></section>}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
      <div className="footer-bar"><button className="btn" disabled={busy || !course.trim() || !date} onClick={() => void save()}>Save Settings</button></div>
    </Screen>
  );
}

function useCompleted(roundId: string) {
  const v = useDataVersion();
  const [done, setDone] = useState<number[] | null>(null);
  useEffect(() => {
    let live = true;
    void completedHoleNumbers(roundId).then((d) => live && setDone(d));
    return () => { live = false; };
  }, [roundId, v]);
  return done;
}

export function ActiveRound({ round, go }: { round: Round; go: Go }) {
  const done = useCompleted(round.round_id);
  if (!done) return null;
  const all = holeNumbers(round);
  const remaining = all.filter((n) => !done.includes(n));
  const current = remaining[0];
  if (current === undefined) {
    // Every hole is in but the round was never explicitly finished (e.g. interrupted) —
    // the golfer still has to tap Finish Round, which re-saves nothing and reveals nothing yet.
    return <FinishPending round={round} go={go} />;
  }
  const isFinal = remaining.length === 1;

  return (
    <Screen
      top={
        <div className="topbar">
          <button className="link" onClick={() => go({ name: 'home' })}>‹ Home</button>
          <SyncBadge />
          {done.length > 0 ? <button className="link quiet" onClick={() => go({ name: 'edit' })}>Edit Previous Hole</button> : <span />}
        </div>
      }
    >
      <div key={current} className="fade" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
        <button className="link quiet" style={{ alignSelf: 'flex-end' }} onClick={() => go({ name: 'round-settings' })}>Round Settings</button>
        <header style={{ marginTop: 8 }}>
          <p className="eyebrow">{round.course_name}</p>
          <h1 className="title">Hole {current}</h1>
          <p className="eyebrow" style={{ marginTop: 4 }}>Hole {done.length + 1} of {round.hole_count}</p>
          <div className="progress" aria-hidden="true"><i style={{ width: `${(done.length / round.hole_count) * 100}%` }} /></div>
        </header>
        <HoleEntry
          roundId={round.round_id}
          holeNumber={current}
          mode="new"
          isFinal={isFinal}
          onSaved={(completed) => completed && go({ name: 'results', id: round.round_id, fresh: true })}
        />
      </div>
    </Screen>
  );
}

function FinishPending({ round, go }: { round: Round; go: Go }) {
  return (
    <Screen top={<div className="topbar"><button className="link" onClick={() => go({ name: 'home' })}>‹ Home</button></div>}>
      <div className="grow" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <p className="eyebrow">{round.course_name}</p>
        <h1 className="title">All holes recorded</h1>
        <button className="link" onClick={() => go({ name: 'round-settings' })}>Round Settings</button>
        <button className="link" onClick={() => go({ name: 'edit' })}>Edit Previous Hole</button>
      </div>
      <FinishButton round={round} go={go} />
    </Screen>
  );
}

function FinishButton({ round, go }: { round: Round; go: Go }) {
  const finish = async () => {
    if (await markComplete(round.round_id)) go({ name: 'results', id: round.round_id, fresh: true });
  };
  return <button className="btn" onClick={() => void finish()}>Finish Round</button>;
}

// ---- Edit previous hole (blind) -----------------------------------------------------------

export function EditHole({ round, go }: { round: Round; go: Go }) {
  const done = useCompleted(round.round_id);
  const [picked, setPicked] = useState<number | null>(null);
  if (!done) return null;

  if (picked !== null) {
    return (
      <Screen top={<div className="topbar"><button className="link" onClick={() => setPicked(null)}>‹ Back</button></div>}>
        <header style={{ marginTop: 8 }}>
          <p className="eyebrow">{round.course_name}</p>
          <h1 className="title">Hole {picked}</h1>
          <p className="eyebrow" style={{ marginTop: 4 }}>Edit saved entry</p>
        </header>
        <HoleEntry key={picked} roundId={round.round_id} holeNumber={picked} mode="replace" onSaved={() => go({ name: 'active' })} onCancel={() => setPicked(null)} />
      </Screen>
    );
  }

  return (
    <Screen top={<div className="topbar"><button className="link" onClick={() => go({ name: 'active' })}>‹ Back</button></div>}>
      <h1 className="h2" style={{ margin: '8px 0 4px' }}>Edit Previous Hole</h1>
      <p className="sub" style={{ marginBottom: 24 }}>Choose a hole to edit. Its saved details will be shown so you can change only what you need.</p>
      <div className="chip-grid">
        {done.map((n) => (
          <button key={n} className="choice" style={{ minHeight: 64, fontSize: 20 }} onClick={() => setPicked(n)} aria-label={`Hole ${n}`}>
            {n}
          </button>
        ))}
      </div>
    </Screen>
  );
}

// ---- Results ------------------------------------------------------------------------------

function toParText(t: Totals) {
  return formatToPar(t.toPar);
}

export function Results({ id, fresh, go }: { id: string; fresh?: boolean; go: Go }) {
  const [data, setData] = useState<{ round: Round; holes: Hole[] } | null | undefined>(undefined);
  useEffect(() => {
    void (async () => {
      const round = await getRound(id);
      setData(round && round.status === 'completed' ? { round, holes: await holesForRound(id) } : null);
    })();
  }, [id]);
  useEffect(() => { if (data === null) go({ name: 'home' }); }, [data, go]);
  if (!data) return null;
  const { round, holes } = data;
  const t = totals(holes);
  const split = round.hole_count === 18 ? nines(holes) : null;
  const notes = holes.filter((h) => h.note);

  return (
    <Screen>
      <div className="hero">
        <p className="eyebrow">{fresh ? 'Round Complete' : 'Round'}</p>
        <p style={{ fontSize: 22, fontWeight: 600, marginTop: 4 }}>{round.course_name}</p>
        <p className="eyebrow" style={{ marginBottom: 24 }}>{formatDate(round.round_date)} · {round.hole_count} holes{round.hole_count === 9 ? (round.starting_nine === 'front' ? ' (front)' : ' (back)') : ''}</p>
        <p className="score">{t.strokes}</p>
        <p className="topar">{toParText(t)}</p>
      </div>

      <div className="stack-lg" style={{ marginTop: 24 }}>
        <section className="card">
          <div className="kv"><span>Total score</span><span>{t.strokes}</span></div>
          <div className="kv"><span>Course par</span><span>{t.par}</span></div>
          <div className="kv"><span>Total putts</span><span>{t.putts}</span></div>
          <div className="kv"><span>Putts per hole</span><span>{round1(t.puttsPerHole)}</span></div>
          <div className="kv"><span>Three-putts</span><span>{t.threePutts}</span></div>
          <div className="kv"><span>Tee-shot re-tees</span><span>{t.retees}</span></div>
          <div className="kv"><span>Tee-shot penalty drops</span><span>{t.drops}</span></div>
        </section>

        {split && (
          <section className="grid2">
            <div className="card"><p className="eyebrow">Front nine</p><p className="big">{split.front.strokes}</p><p className="eyebrow">{toParText(split.front)}</p></div>
            <div className="card"><p className="eyebrow">Back nine</p><p className="big">{split.back.strokes}</p><p className="eyebrow">{toParText(split.back)}</p></div>
          </section>
        )}

        <details className="card">
          <summary>Full scorecard</summary>
          <table>
            <thead><tr><th>Hole</th><th>Par</th><th>Yds</th><th>Strokes</th><th>+/−</th><th>Putts</th><th>Penalty</th></tr></thead>
            <tbody>
              {holes.map((h) => (
                <tr key={h.hole_id}>
                  <td>{h.hole_number}</td><td>{h.par}</td><td>{h.distance_yards ?? '–'}</td><td>{h.strokes}</td>
                  <td>{formatToPar(h.strokes - h.par)}</td><td>{h.putts}</td>
                  <td>{h.tee_penalty_type === 'none' ? '–' : h.tee_penalty_type === 'retee' ? 'Re-tee' : 'Drop'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>

        {notes.length > 0 && (
          <section className="card">
            <span className="label">Hole notes</span>
            {notes.map((h) => (
              <div key={h.hole_id} className="kv note-row">
                <span>Hole {h.hole_number}</span>
                <span>{h.note}</span>
              </div>
            ))}
          </section>
        )}

        <div className="stack">
          <button className="btn" onClick={() => go({ name: 'home' })}>Return Home</button>
          <button className="btn secondary" onClick={() => go({ name: 'history' })}>View Round History</button>
        </div>
      </div>
    </Screen>
  );
}

// ---- History ------------------------------------------------------------------------------

function useCompletedRounds() {
  const v = useDataVersion();
  const [list, setList] = useState<CompletedRound[] | null>(null);
  useEffect(() => {
    let live = true;
    void allCompleted().then((l) => live && setList(l));
    return () => { live = false; };
  }, [v]);
  return list;
}

export function History({ go }: { go: Go }) {
  const list = useCompletedRounds();
  const [len, setLen] = useState<'all' | 9 | 18>('all');
  const [course, setCourse] = useState('');
  const courses = useMemo(() => [...new Set((list ?? []).map((r) => r.round.course_name))].sort(), [list]);
  if (!list) return null;
  const shown = list.filter((r) => (len === 'all' || r.round.hole_count === len) && (!course || r.round.course_name === course));

  return (
    <Screen top={<div className="topbar"><button className="link" onClick={() => go({ name: 'home' })}>‹ Home</button></div>}>
      <h1 className="h2" style={{ margin: '8px 0 16px' }}>Round History</h1>
      <div className="stack">
        <Seg label="Filter by length" value={len} onChange={setLen} options={[{ value: 'all', label: 'All Rounds' }, { value: 9, label: '9 Holes' }, { value: 18, label: '18 Holes' }]} />
        {courses.length > 1 && (
          <select className="input" aria-label="Filter by course" value={course} onChange={(e) => setCourse(e.target.value)}>
            <option value="">All courses</option>
            {courses.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>
      <div className="stack" style={{ marginTop: 16 }}>
        {shown.length === 0 && <p className="sub">No completed rounds{list.length ? ' match this filter' : ' yet'}.</p>}
        {shown.map((r) => (
          <button key={r.round.round_id} className="card round-card" onClick={() => go({ name: 'results', id: r.round.round_id })}>
            <div>
              <p style={{ fontWeight: 600 }}>{r.round.course_name}</p>
              <p className="eyebrow">{formatDate(r.round.round_date)} · {r.round.hole_count} holes</p>
            </div>
            <div className="right">
              <p className="big">{r.totals.strokes}</p>
              <p className="eyebrow">{formatToPar(r.totals.toPar)}</p>
            </div>
          </button>
        ))}
      </div>
    </Screen>
  );
}

// ---- Stats --------------------------------------------------------------------------------

export function Stats({ go }: { go: Go }) {
  const list = useCompletedRounds();
  const [len, setLen] = useState<9 | 18 | null>(null);
  if (!list) return null;
  const sel = len ?? (list.some((r) => r.round.hole_count === 18) ? 18 : 9);
  const rounds = list.filter((r) => r.round.hole_count === sel);
  const a = aggregate(rounds);
  const chrono = [...rounds].reverse();
  const label = (r: CompletedRound) => formatDate(r.round.round_date).replace(/, \d{4}$/, '');

  const Row = (p: { k: string; v: string }) => <div className="kv"><span>{p.k}</span><span>{p.v}</span></div>;

  return (
    <Screen top={<div className="topbar"><button className="link" onClick={() => go({ name: 'home' })}>‹ Home</button></div>}>
      <h1 className="h2" style={{ margin: '8px 0 16px' }}>Stats</h1>
      <Seg label="Round length" value={sel} onChange={setLen} options={[{ value: 9, label: '9 Holes' }, { value: 18, label: '18 Holes' }]} />
      {!a ? (
        <p className="sub" style={{ marginTop: 24 }}>No completed {sel}-hole rounds yet.</p>
      ) : (
        <div className="stack-lg" style={{ marginTop: 20 }}>
          <section>
            <span className="label">Scoring</span>
            <div className="card">
              <Row k="Completed rounds" v={String(a.rounds)} />
              <Row k="Average total score" v={round1(a.avgScore)} />
              <Row k="Best total score" v={String(a.bestScore)} />
              <Row k="Average strokes over par" v={a.avgToPar > 0 ? `+${round1(a.avgToPar)}` : round1(a.avgToPar)} />
            </div>
          </section>
          <section>
            <span className="label">Putting</span>
            <div className="card">
              <Row k="Average putts per hole" v={round1(a.avgPuttsPerHole)} />
              <Row k="Average putts per round" v={round1(a.avgPuttsPerRound)} />
              <Row k="Three-putts per round" v={round1(a.threePuttsPerRound)} />
            </div>
          </section>
          <section>
            <span className="label">Tee-shot penalties</span>
            <div className="card">
              <Row k="Average re-tees per round" v={round1(a.avgRetees)} />
              <Row k="Average penalty drops per round" v={round1(a.avgDrops)} />
              <Row k="Total tee-shot penalties" v={String(a.totalPenalties)} />
            </div>
          </section>
          <section>
            <span className="label">Score relative to par</span>
            <div className="card"><LineChart title="Score relative to par over time" zeroLine format={formatToPar} points={chrono.map((r) => ({ label: label(r), value: r.totals.toPar }))} /></div>
          </section>
          <section>
            <span className="label">Total putts per round</span>
            <div className="card"><LineChart title="Total putts per round over time" points={chrono.map((r) => ({ label: label(r), value: r.totals.putts }))} /></div>
          </section>
        </div>
      )}
    </Screen>
  );
}

// ---- Settings -----------------------------------------------------------------------------

export function Settings({ go }: { go: Go }) {
  const cfg = getConfig();
  const [url, setUrl] = useState(cfg?.url ?? '');
  const [token, setToken] = useState(cfg?.token ?? '');
  const s = useSyncStatus();

  return (
    <Screen top={<div className="topbar"><button className="link" onClick={() => go({ name: 'home' })}>‹ Home</button></div>}>
      <h1 className="h2" style={{ margin: '8px 0 8px' }}>Sync settings</h1>
      <p className="sub" style={{ marginBottom: 24 }}>Connect your Google Apps Script web app. These stay on this device only.</p>
      <div className="stack-lg grow">
        <section>
          <label className="label" htmlFor="url">Web app URL</label>
          <input id="url" className="input" type="url" autoCapitalize="none" autoCorrect="off" placeholder="https://script.google.com/macros/s/…/exec" value={url} onChange={(e) => setUrl(e.target.value)} />
        </section>
        <section>
          <label className="label" htmlFor="tok">Access token</label>
          <input id="tok" className="input" type="password" autoCapitalize="none" autoCorrect="off" value={token} onChange={(e) => setToken(e.target.value)} />
        </section>
        <section className="stack">
          <button className="btn" disabled={!url.trim() || !token.trim()} onClick={() => setConfig({ url: url.trim(), token: token.trim() })}>Save &amp; Sync</button>
          <button className="btn secondary" onClick={() => void syncNow()}>Sync now</button>
          {cfg && <button className="btn danger" onClick={() => { setConfig(null); setUrl(''); setToken(''); }}>Disconnect</button>}
        </section>
        <section>
          <SyncBadge />
          {s.error && s.state === 'error' && <p className="error">{s.error}</p>}
          {s.lastSync && <p className="eyebrow" style={{ marginTop: 6 }}>Last synced {new Date(s.lastSync).toLocaleTimeString()}</p>}
        </section>
      </div>
    </Screen>
  );
}

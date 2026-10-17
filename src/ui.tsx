import type { ReactNode } from 'react';
import { useSyncStatus } from './sync';

export function Seg<T extends string | number>(props: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div className="seg" role="group" aria-label={props.label}>
      {props.options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={props.value === o.value} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stepper(props: {
  value: number | null;
  min: number;
  max?: number;
  onChange: (n: number) => void;
  label: string;
  disabled?: boolean;
  small?: boolean;
}) {
  const { value, min, max, onChange, disabled } = props;
  const v = value ?? min;
  return (
    <div className={`stepper${props.small ? ' small' : ''}${value === null ? ' dim' : ''}`}>
      <button type="button" aria-label={`Decrease ${props.label}`} disabled={disabled || v <= min} onClick={() => onChange(v - 1)}>
        −
      </button>
      <output aria-label={props.label}>{value === null ? '–' : value}</output>
      <button type="button" aria-label={`Increase ${props.label}`} disabled={disabled || (max !== undefined && v >= max)} onClick={() => onChange(v + 1)}>
        +
      </button>
    </div>
  );
}

export function Confirm(props: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="scrim" role="alertdialog" aria-modal="true" aria-label={props.title}>
      <div className="sheet fade">
        <h3>{props.title}</h3>
        <p>{props.body}</p>
        <div className="stack">
          <button className="btn" onClick={props.onConfirm}>{props.confirmLabel}</button>
          <button className="btn secondary" onClick={props.onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export function SyncBadge() {
  const s = useSyncStatus();
  let text: string;
  let cls = '';
  switch (s.state) {
    case 'unconfigured': text = 'Saved on this device'; break;
    case 'offline': text = s.pending ? `Offline · ${s.pending} waiting to sync` : 'Offline · saved on device'; cls = 'bad'; break;
    case 'syncing': text = 'Syncing…'; break;
    case 'error': text = `Sync paused · ${s.pending} waiting, will retry`; cls = 'bad'; break;
    default: text = s.pending ? `${s.pending} waiting to sync` : 'Synced'; cls = s.pending ? '' : 'ok';
  }
  return <span className={`sync ${cls}`} role="status">{text}</span>;
}

export function Screen(props: { children: ReactNode; top?: ReactNode }) {
  return (
    <main className="screen fade">
      {props.top}
      {props.children}
    </main>
  );
}

export function LineChart(props: { points: { label: string; value: number }[]; zeroLine?: boolean; format?: (n: number) => string; title: string }) {
  const { points, zeroLine, title } = props;
  const fmt = props.format ?? String;
  const W = 320, H = 150, L = 34, R = 10, T = 12, B = 22;
  if (points.length === 0) return <p className="eyebrow">No completed rounds yet.</p>;
  let lo = Math.min(...points.map((p) => p.value));
  let hi = Math.max(...points.map((p) => p.value));
  if (zeroLine) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  if (hi === lo) { hi += 1; lo -= 1; }
  const x = (i: number) => (points.length === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (points.length - 1));
  const y = (v: number) => T + ((hi - v) * (H - T - B)) / (hi - lo);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={title}>
      <line x1={L} x2={W - R} y1={y(hi)} y2={y(hi)} stroke="var(--border)" />
      <line x1={L} x2={W - R} y1={y(lo)} y2={y(lo)} stroke="var(--border)" />
      {zeroLine && <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="var(--muted)" strokeDasharray="3 3" />}
      <text x={L - 6} y={y(hi) + 3} textAnchor="end">{fmt(hi)}</text>
      <text x={L - 6} y={y(lo) + 3} textAnchor="end">{fmt(lo)}</text>
      {points.length > 1 && (
        <polyline fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')} />
      )}
      {points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.value)} r="3.5" fill="var(--accent)" />)}
      <text x={L} y={H - 6}>{points[0].label}</text>
      {points.length > 1 && <text x={W - R} y={H - 6} textAnchor="end">{points[points.length - 1].label}</text>}
    </svg>
  );
}

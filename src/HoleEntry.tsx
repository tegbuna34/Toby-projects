import { useEffect, useState } from 'react';
import { getHole, loadDraft, saveDraft, saveHole } from './db';
import {
  fromHole, fromDraft, puttsMax, setPar, setPutts, setStrokes, toDraft, toHoleInput, validate, type FormState,
} from './holeForm';
import { Confirm, Stepper } from './ui';
import type { PenaltyType } from './types';

const PENALTIES: { value: PenaltyType; label: string; hint?: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'retee', label: 'Re-tee', hint: 'OB / lost ball' },
  { value: 'drop', label: 'Penalty Drop', hint: 'water / hazard / other' },
];

/**
 * One hole's input form. `new` mode autosaves a draft and completes the hole;
 * `replace` mode loads the selected saved hole so individual fields can be edited.
 */
export function HoleEntry(props: {
  roundId: string;
  holeNumber: number;
  mode: 'new' | 'replace';
  isFinal?: boolean;
  onSaved: (completedRound: boolean) => void;
  onCancel?: () => void;
}) {
  const { roundId, holeNumber, mode } = props;
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    if (mode === 'new') void loadDraft(roundId).then((d) => live && setForm(fromDraft(d, holeNumber)));
    else void getHole(roundId, holeNumber).then((h) => {
      if (live && h) setForm(fromHole(h));
    });
    return () => { live = false; };
  }, [roundId, holeNumber, mode]);

  const update = (next: FormState) => {
    setForm(next);
    setError(null);
    if (mode === 'new') void saveDraft(toDraft(roundId, holeNumber, next));
  };

  if (!form) return null;
  const hasPar = form.par !== null;

  const commit = async () => {
    const problem = validate(form);
    if (problem) { setConfirming(false); return setError(problem); }
    setSaving(true);
    try {
      const { completed } = await saveHole(toHoleInput(roundId, holeNumber, form), {
        complete: mode === 'new' && !!props.isFinal,
      });
      setForm(null);
      props.onSaved(completed);
    } catch {
      setSaving(false);
      setConfirming(false);
      setError('Could not save this hole. Your entries are still here. Please try again.');
    }
  };

  const submit = () => {
    const problem = validate(form);
    if (problem) return setError(problem);
    if (mode === 'replace') setConfirming(true);
    else void commit();
  };

  const label = mode === 'replace' ? 'Save Changes' : props.isFinal ? 'Finish Round' : 'Complete Hole';

  return (
    <>
      <div className="grow stack-lg" style={{ paddingTop: 20 }}>
        <section>
          <span className="label" id="par-l">Hole par</span>
          <div className="choices" role="group" aria-labelledby="par-l">
            {[3, 4, 5].map((p) => (
              <button key={p} type="button" className="choice" aria-pressed={form.par === p} onClick={() => update(setPar(form, p))}>
                Par {p}
              </button>
            ))}
          </div>
        </section>

        <section>
          <label className="label" htmlFor="dist">Distance (yards, optional)</label>
          <input
            id="dist" className="input" type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off"
            placeholder="e.g. 385" value={form.distance}
            onChange={(e) => update({ ...form, distance: e.target.value.replace(/\D/g, '').slice(0, 4) })}
          />
        </section>

        <section>
          <span className="label">Strokes</span>
          <Stepper label="strokes" value={form.strokes} min={1} disabled={!hasPar} onChange={(n) => update(setStrokes(form, n))} />
        </section>

        <section>
          <span className="label">Putts</span>
          <Stepper label="putts" small value={hasPar ? form.putts : null} min={0} max={puttsMax(form)} disabled={!hasPar} onChange={(n) => update(setPutts(form, n))} />
        </section>

        <section>
          <span className="label" id="pen-l">Tee-shot penalty</span>
          <div className="choices col" role="radiogroup" aria-labelledby="pen-l">
            {PENALTIES.map((p) => (
              <button key={p.value} type="button" role="radio" className="choice" aria-checked={form.penalty === p.value} onClick={() => update({ ...form, penalty: p.value })}>
                {p.label}
                {p.hint && <small>{p.hint}</small>}
              </button>
            ))}
          </div>
        </section>

        <section>
          <label className="label" htmlFor="note">
            Note (optional)
          </label>
          <textarea
            id="note" className="input note" rows={3} maxLength={1000} placeholder="Anything to remember about this hole"
            value={form.note} onChange={(e) => update({ ...form, note: e.target.value })}
          />
        </section>
      </div>

      <div className="footer-bar" style={{ marginTop: 20 }}>
        {error && <p className="error" role="alert" style={{ marginBottom: 8 }}>{error}</p>}
        <div className="stack">
          <button className="btn" disabled={saving} onClick={submit}>{label}</button>
          {props.onCancel && <button className="btn secondary" onClick={props.onCancel}>Cancel</button>}
        </div>
      </div>

      {confirming && (
        <Confirm
          title={`Save changes to hole ${holeNumber}?`}
          body="Your updated entry will be saved. All unchanged fields will be kept."
          confirmLabel="Save Changes"
          onConfirm={() => void commit()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}

import { useState } from 'preact/hooks';
import { THEMES, type Me, type Profile, type Theme } from '../../shared/types.ts';
import { Sheet } from './Sheet.tsx';
import { SlideToConfirm } from './SlideToConfirm.tsx';
import { THEME_INFO, applyTheme } from './theme.ts';
import { api } from './api.ts';
import { logOut } from './firebase.ts';

const LB = 2.20462;
const IN = 2.54;

export function Settings({ me, onSaved, onClose }: { me: Me; onSaved: (m: Me) => void; onClose: () => void }) {
  const p = me.profile;
  const [units, setUnits] = useState(p.units);
  const imp = units === 'imperial';
  const [age, setAge] = useState(p.age?.toString() ?? '');
  const [sex, setSex] = useState(p.sex ?? '');
  const goal = p.goal ?? '';
  const [weight, setWeight] = useState(p.weightKg ? (imp ? Math.round(p.weightKg * LB) : p.weightKg).toString() : '');
  const totalIn = p.heightCm ? p.heightCm / IN : 0;
  const [cm, setCm] = useState(p.heightCm?.toString() ?? '');
  const [ft, setFt] = useState(totalIn ? Math.floor(totalIn / 12).toString() : '');
  const [inch, setInch] = useState(totalIn ? Math.round(totalIn % 12).toString() : '');
  const [status, setStatus] = useState('');

  function switchUnits(u: Profile['units']) {
    if (u === units) return;
    const w = Number(weight);
    if (w) setWeight((u === 'imperial' ? Math.round(w * LB) : Math.round((w / LB) * 10) / 10).toString());
    if (u === 'imperial' && Number(cm)) {
      const t = Number(cm) / IN;
      setFt(Math.floor(t / 12).toString());
      setInch(Math.round(t % 12).toString());
    }
    if (u === 'metric' && (Number(ft) || Number(inch))) setCm(Math.round((Number(ft) * 12 + Number(inch)) * IN).toString());
    setUnits(u);
  }

  async function save(e: Event) {
    e.preventDefault();
    const w = Number(weight);
    const heightCm = imp ? (Number(ft) * 12 + Number(inch)) * IN : Number(cm);
    const body: Partial<Profile> = {
      units,
      age: Number(age) || undefined,
      sex: sex === 'male' || sex === 'female' ? sex : null,
      goal: goal === 'lose' || goal === 'maintain' || goal === 'gain' ? goal : undefined,
      weightKg: w ? Math.round((imp ? w / LB : w) * 10) / 10 : undefined,
      heightCm: heightCm ? Math.round(heightCm) : undefined,
    };
    try {
      onSaved(await api<Me>('/me/profile', { method: 'PUT', body: JSON.stringify(body) }));
      setStatus('Saved');
    } catch (err) {
      setStatus(`Couldn’t save: ${(err as Error).message}`);
    }
  }

  // Themes apply instantly and save in the background.
  const [theme, setTheme] = useState<Theme>(p.theme);
  async function pickTheme(t: Theme) {
    setTheme(t);
    applyTheme(t);
    try {
      onSaved(await api<Me>('/me/profile', { method: 'PUT', body: JSON.stringify({ theme: t }) }));
    } catch {
      setTheme(p.theme);
      applyTheme(p.theme);
    }
  }

  const t = me.targets;
  const own = me.profile.customTargets ?? {};

  const [deleting, setDeleting] = useState(false);

  async function deleteData() {
    await api('/me', { method: 'DELETE' });
    await logOut();
  }

  const seg = <T extends string>(value: string, set: (v: T) => void, options: [T, string][]) => (
    <div class="seg-chips">
      {options.map(([v, label]) => (
        <button type="button" key={v} class={value === v ? 'on' : ''} onClick={() => set(v)}>
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <Sheet onClose={onClose} class="settings-sheet">
      {(close) => (
        <>
          <div class="grabber" />
          <header class="settings-head">
            <div class="who">
              <h2>Settings</h2>
              <small>
                {me.name ? `${me.name} · ` : ''}
                {me.email}
              </small>
            </div>
            <button class="icon glass" onClick={close} aria-label="Close settings">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </header>

          {t && (
            <>
              <h3 class="sec-h">Daily goals</h3>
              <div class="goals">
                <div class={own.calories ? 'own' : ''}>
                  <b>{t.calories}</b>
                  <span>kcal</span>
                </div>
                <div class={own.protein ? 'own' : ''}>
                  <b>{t.protein}g</b>
                  <span>protein</span>
                </div>
                <div class={own.fiber ? 'own' : ''}>
                  <b>{t.fiber}g</b>
                  <span>fiber</span>
                </div>
                <div class={own.carbsMin || own.carbsMax ? 'own' : ''}>
                  <b>
                    {t.carbsMin}–{t.carbsMax}g
                  </b>
                  <span>carbs</span>
                </div>
              </div>
              <p class="goals-note">
                {Object.keys(own).length ? 'Marked ones are goals you set. ' : 'Worked out from your profile. '}
                To change them, tell the chat, e.g. “120 g protein a day”.
              </p>
            </>
          )}

          {me.profile.routine && me.profile.routine !== 'skipped' && (
            <>
              <h3 class="sec-h">Your routine</h3>
              <div class="routine">{me.profile.routine}</div>
              <p class="goals-note">Your coach uses this to time tips. Tell the chat if your day changes.</p>
            </>
          )}

          {me.memories.length > 0 && (
            <>
              <h3 class="sec-h">What your coach remembers</h3>
              <div class="memories">
                {me.memories.map((m) => (
                  <div key={m.id} class="memory">
                    <span>{m.text}</span>
                    <button
                      type="button"
                      aria-label={`Forget “${m.text}”`}
                      onClick={() =>
                        api<Me>(`/me/memories/${m.id}`, { method: 'DELETE' })
                          .then(onSaved)
                          .catch(() => {})
                      }
                    >
                      <svg
                        viewBox="0 0 24 24"
                        width="13"
                        height="13"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.4"
                        stroke-linecap="round"
                      >
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
              <p class="goals-note">Tell the chat things like “I’m vegetarian” and it keeps them in mind.</p>
            </>
          )}

          <h3 class="sec-h">Theme</h3>
          <div class="themes" role="radiogroup" aria-label="Theme">
            {THEMES.map((k) => {
              const [, a, b] = THEME_INFO[k].swatch;
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={theme === k}
                  class={`theme-dot ${theme === k ? 'on' : ''}`}
                  onClick={() => pickTheme(k)}
                >
                  <span style={{ background: `radial-gradient(circle at 32% 28%, #fff 0%, ${a} 38%, ${b} 100%)` }} />
                  {THEME_INFO[k].name}
                </button>
              );
            })}
          </div>

          <form class="settings" onSubmit={save}>
            <h3>Profile</h3>
            <div class="group">
              <label class="row">
                <span>Age</span>
                <input inputMode="numeric" value={age} placeholder="—" onInput={(e) => setAge(e.currentTarget.value)} />
              </label>
              <label class="row">
                <span>Weight</span>
                <span class="unit-input">
                  <input inputMode="decimal" value={weight} placeholder="—" onInput={(e) => setWeight(e.currentTarget.value)} />
                  <em>{imp ? 'lb' : 'kg'}</em>
                </span>
              </label>
              {imp ? (
                <label class="row">
                  <span>Height</span>
                  <span class="unit-input">
                    <input inputMode="numeric" value={ft} onInput={(e) => setFt(e.currentTarget.value)} aria-label="feet" />
                    <em>ft</em>
                    <input inputMode="numeric" value={inch} onInput={(e) => setInch(e.currentTarget.value)} aria-label="inches" />
                    <em>in</em>
                  </span>
                </label>
              ) : (
                <label class="row">
                  <span>Height</span>
                  <span class="unit-input">
                    <input inputMode="numeric" value={cm} placeholder="—" onInput={(e) => setCm(e.currentTarget.value)} />
                    <em>cm</em>
                  </span>
                </label>
              )}
            </div>

            <h3>Energy formula</h3>
            {seg(sex, setSex, [
              ['female', 'Female'],
              ['male', 'Male'],
              ['', 'Neutral'],
            ])}

            <h3>Units</h3>
            {seg(units, switchUnits, [
              ['metric', 'kg · cm'],
              ['imperial', 'lb · ft'],
            ])}

            <button class="primary save">Save changes</button>
            {status && <span class="status">{status}</span>}
          </form>

          <h3 class="sec-h">Account</h3>
          <div class="group">
            <button class="row action" onClick={logOut}>
              <span>Sign out</span>
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />
              </svg>
            </button>
            <button class="row action red" onClick={() => setDeleting(!deleting)} aria-expanded={deleting}>
              <span>Delete my data</span>
            </button>
          </div>
          {deleting && (
            <div class="delete-confirm">
              <p class="danger-note">This removes your meals, chats, photos and profile for good.</p>
              <SlideToConfirm label="Slide to confirm" doneLabel="Deleting…" onConfirm={deleteData} />
              <button class="cancel-delete" onClick={() => setDeleting(false)}>
                Cancel
              </button>
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}

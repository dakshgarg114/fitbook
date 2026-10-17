// Details of one logged meal, opened by tapping it on the canvas: the doodle, totals against the daily goals,
// and each food with its portion, nutrition and where the numbers came from. Changes go through the chat.
import { DOODLE_H, DOODLE_W, type DayView, type LogEntry, type Meal, type Targets } from '../../shared/types.ts';
import { Sheet } from './Sheet.tsx';

const time12 = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};
const r = (n: number) => Math.round(n);
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return 'source';
  }
};
const r1 = (n: number) => (n < 10 ? Math.round(n * 10) / 10 : Math.round(n));

function sourceLine(f: LogEntry): { label: string; detail?: string; url?: string } {
  switch (f.source) {
    case 'usda':
      return { label: 'USDA', detail: f.usdaDescription ?? undefined };
    case 'ifct':
      return { label: 'IFCT 2017', detail: f.usdaDescription?.replace(/ \(raw, IFCT\)$/, '') ?? undefined };
    case 'recipe':
      return { label: 'Your recipe' };
    case 'web':
      return { label: 'From the web', url: f.sourceUrl ?? undefined };
    default:
      return { label: 'Coach’s estimate' };
  }
}

// One macro: grams, and how much of today's goal this meal covers (when there is a goal).
function Macro({ label, grams, goal }: { label: string; grams: number; goal?: number }) {
  const pct = goal ? Math.min(100, Math.round((grams / goal) * 100)) : null;
  return (
    <div class="macro">
      <b>{r1(grams)}g</b>
      <span>{label}</span>
      {pct !== null && (
        <>
          <i class="macro-bar">
            <i style={{ width: `${Math.max(pct, 3)}%` }} />
          </i>
          <small>{pct}% of goal</small>
        </>
      )}
    </div>
  );
}

export function MealSheet(props: { meal: Meal; day: DayView; targets: Targets | null; onClose: () => void; onAsk: (meal: Meal) => void }) {
  const { meal, day, targets } = props;
  const t = meal.totals;
  const doodle = day.canvas.items.find((i) => i.id === `m${meal.id}-doodle`);
  return (
    <Sheet onClose={props.onClose} class="meal-sheet">
      {(close) => (
        <>
          <div class="grabber" />
          <header class="settings-head">
            <div class="who">
              <small>{time12(meal.time)}</small>
              <h2>{meal.heading}</h2>
            </div>
            <button class="icon glass" onClick={close} aria-label="Close">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </header>

          {doodle?.type === 'doodle' && (
            <svg class="meal-doodle" viewBox={`0 0 ${DOODLE_W} ${DOODLE_H}`} aria-hidden="true">
              <defs>
                <filter id="wobble-sheet" x="-5%" y="-5%" width="110%" height="110%">
                  <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves={2} seed={7} />
                  <feDisplacementMap in="SourceGraphic" scale={2.6} />
                </filter>
              </defs>
              {/* Same markup as on the canvas: our library or the server's sanitised drawing. */}
              <g dangerouslySetInnerHTML={{ __html: doodle.svg.replaceAll('url(#wobble)', 'url(#wobble-sheet)') }} />
            </svg>
          )}

          <div class="meal-kcal">
            <b>{r(t.calories)}</b>
            <span>kcal{targets ? ` · ${r((t.calories / targets.calories) * 100)}% of your ${targets.calories} kcal day` : ''}</span>
          </div>

          <div class="macros">
            <Macro label="Protein" grams={t.protein} goal={targets?.protein} />
            <Macro label="Carbs" grams={t.carbs} goal={targets?.carbsMax} />
            <Macro label="Fiber" grams={t.fiber} goal={targets?.fiber} />
            <Macro label="Fat" grams={t.fat} />
            <Macro label="Sugar" grams={t.sugar} />
          </div>
          {meal.note && <p class="meal-note">“{meal.note}”</p>}

          <h3 class="sec-h">
            {meal.foods.length} {meal.foods.length === 1 ? 'item' : 'items'}
          </h3>
          <div class="foods">
            {meal.foods.map((f) => {
              const src = sourceLine(f);
              return (
                <div key={f.id} class="food">
                  <div class="food-top">
                    <strong>{f.name}</strong>
                    <span class="food-kcal">{r(f.calories)} kcal</span>
                  </div>
                  <div class="food-macros">
                    {r(f.grams)} g · P {r1(f.protein)} · C {r1(f.carbs)} · F {r1(f.fat)} · Fib {r1(f.fiber)} · Sugar {r1(f.sugar)}
                  </div>
                  {f.ingredients && (
                    <ul class="ingredients">
                      {f.ingredients.map((i) => (
                        <li key={i.name}>
                          <span>{i.name.replace(/ \(raw, IFCT\)$/, '')}</span>
                          <em>{r(i.grams)} g</em>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div class="food-src">
                    <span class={`src-chip ${f.source}`}>{src.label}</span>
                    {src.detail && <span class="src-detail">{src.detail}</span>}
                    {src.url && (
                      <a class="src-detail" href={src.url} target="_blank" rel="noopener noreferrer">
                        {hostOf(src.url)}
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <button
            class="primary ask-coach"
            onClick={() => {
              close();
              setTimeout(() => props.onAsk(meal), 280);
            }}
          >
            Change this in chat
          </button>
          <p class="goals-note center">Numbers are per portion. Tell the chat if the portion or anything else is off.</p>
        </>
      )}
    </Sheet>
  );
}

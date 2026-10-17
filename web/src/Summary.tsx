import { useEffect, useState } from 'preact/hooks';
import type { AgentStage, DayView, Me } from '../../shared/types.ts';
import { api } from './api.ts';
import { AgentOrb, STAGE_WORDS, ThinkingOrb } from './Orb.tsx';

const LABELS = [
  ['carbs', 'Carbs'],
  ['fiber', 'Fiber'],
  ['protein', 'Protein'],
  ['antioxidants', 'Antiox'],
  ['overall', 'Overall'],
] as const;

const GRADIENTS = { good: ['#7fd39a', '#2f8f57'], mid: ['#f6cf6b', '#e09a2c'], low: ['#f39a86', '#d0473a'] };
const tone = (v: number): keyof typeof GRADIENTS => (v >= 7 ? 'good' : v >= 4 ? 'mid' : 'low');

function Ring({ value, label }: { value: number; label: string }) {
  const r = 24;
  const c = 2 * Math.PI * r;
  const id = `ring-${label}`;
  const [from, to] = GRADIENTS[tone(value)];
  return (
    <div class="ring">
      <svg viewBox="0 0 60 60" role="img" aria-label={`${label} ${value} out of 10`}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color={from} />
            <stop offset="1" stop-color={to} />
          </linearGradient>
        </defs>
        <circle cx="30" cy="30" r={r} fill="none" class="track" stroke-width="5.5" />
        <circle
          class="arc"
          cx="30"
          cy="30"
          r={r}
          fill="none"
          stroke={`url(#${id})`}
          stroke-width="5.5"
          stroke-linecap="round"
          stroke-dasharray={`${Math.max(0.01, (c * value) / 10)} ${c}`}
          transform="rotate(-90 30 30)"
        />
        <text x="30" y="35.5" text-anchor="middle">
          {Math.round(value)}
        </text>
      </svg>
      <span>{label}</span>
    </div>
  );
}

// stage: the agent is working on the last message; the Log button shows what it's doing.
export function Summary({ day, me, stage, onLog }: { day: DayView; me: Me; stage: AgentStage | null; onLog?: () => void }) {
  const [open, setOpen] = useState(false);
  const [tips, setTips] = useState<string | null>(day.tips);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setTips(day.tips);
    setOpen(false);
  }, [day.date, day.version]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !tips && !loading) {
      setLoading(true);
      try {
        setTips((await api<{ tips: string }>(`/day/${day.date}/tips`, { method: 'POST' })).tips);
      } catch (e) {
        setTips(`Couldn’t get tips: ${(e as Error).message}`);
      } finally {
        setLoading(false);
      }
    }
  }

  const t = day.totals;
  // A glass dock floating over the bottom of the canvas.
  return (
    <section class="dock">
      {open && (
        <div class="tips-panel">
          <div class="tips-panel-head">
            <strong>Tips for today</strong>
            <button class="icon" onClick={() => setOpen(false)} aria-label="Close tips">
              ✕
            </button>
          </div>
          <div class="tips-body">{loading ? <ThinkingOrb label="Thinking about your day" state="solving" /> : tips}</div>
        </div>
      )}
      <div class="dock-card">
        <div class="dock-top">
          <span class="kcal">
            {Math.round(t.calories)}
            <small>{me.targets ? `/${me.targets.calories}` : ''} kcal</small>
          </span>
          {day.scores && (
            <button class={`tips-btn ${open ? 'on' : ''}`} onClick={toggle} aria-expanded={open}>
              <span class="spark">✦</span> Tips
            </button>
          )}
          {onLog && (
            <button class={`log-btn ${stage ? 'working' : ''}`} onClick={onLog}>
              <span class="orb-chip">
                <AgentOrb state={stage ? 'working' : 'breathing'} label="Open chat" />
              </span>
              {stage ? (
                <span key={stage} class="status-word">
                  {STAGE_WORDS[stage]}…
                </span>
              ) : (
                'Log'
              )}
            </button>
          )}
        </div>
        {day.scores ? (
          <div class="rings">
            {LABELS.map(([k, label]) => (
              <Ring key={k} value={day.scores![k]} label={label} />
            ))}
          </div>
        ) : (
          <p class="hint">Scores appear once you’ve answered a few questions in the chat.</p>
        )}
      </div>
    </section>
  );
}

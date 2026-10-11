// Agent activity indicators built on the thinking-orbs library (dotted canvas orbs).
import { useEffect, useState } from 'preact/hooks';
import { ThinkingOrb as Orb } from 'thinking-orbs';
import { THEME_INFO, currentTheme } from './theme.ts';

type OrbState = 'working' | 'searching' | 'solving' | 'listening' | 'connecting' | 'weaving' | 'composing' | 'breathing' | 'shaping';

export function AgentOrb(props: { state?: OrbState; size?: 20 | 64; label?: string; theme?: 'light' | 'dark' }) {
  const { state = 'breathing', size = 20, label, theme = THEME_INFO[currentTheme()].dark ? 'dark' : 'light' } = props;
  return <Orb state={state} size={size} theme={theme} aria-label={label} />;
}

// A single orb with a label, e.g. while tips load.
export function ThinkingOrb({ label, state = 'working' }: { label: string; state?: OrbState }) {
  return (
    <div class="orb-row" role="status">
      <AgentOrb state={state} label={label} />
      <span class="orb-label">{label}</span>
    </div>
  );
}

// What the agent is doing while a chat message is processed. The server does these
// steps in order; we advance the label on a timer and hold on the last one.
const STEPS: { label: string; state: OrbState }[] = [
  { label: 'Reading your message', state: 'working' },
  { label: 'Looking up nutrition', state: 'searching' },
  { label: 'Sketching your meal', state: 'composing' },
  { label: 'Updating your canvas', state: 'weaving' },
];

export function AgentSteps({ photo }: { photo: boolean }) {
  const steps = photo ? [{ label: 'Looking at your photo', state: 'searching' as OrbState }, ...STEPS.slice(1)] : STEPS;
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => Math.min(n + 1, steps.length - 1)), photo ? 3500 : 2200);
    return () => clearInterval(t);
  }, [photo]);
  return (
    <div class="agent-steps" role="status" aria-live="polite">
      <AgentOrb state={steps[i].state} label={steps[i].label} />
      <div class="steps">
        {steps.slice(0, i + 1).map((s, n) => (
          <span key={s.label} class={n === i ? 'step now' : 'step done'}>
            {n < i ? '✓ ' : ''}
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

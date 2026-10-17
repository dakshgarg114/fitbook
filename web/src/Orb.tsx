// Agent activity indicators built on the thinking-orbs library (dotted canvas orbs).
import { ThinkingOrb as Orb } from 'thinking-orbs';
import { THEME_INFO, currentTheme } from './theme.ts';
import type { AgentStage } from '../../shared/types.ts';

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

export const STAGE_WORDS: Record<AgentStage, string> = {
  analysing: 'Analysing',
  wiggling: 'Wiggling',
  fabricating: 'Fabricating',
  doodling: 'Doodling',
};

// What the agent is doing with a chat message: one orb and one line whose word follows the server's stage.
export function AgentStatus({ stage }: { stage: AgentStage }) {
  return (
    <div class="agent-status" role="status" aria-live="polite">
      <AgentOrb state="working" label={STAGE_WORDS[stage]} />
      <span key={stage} class="status-word">
        {STAGE_WORDS[stage]}…
      </span>
    </div>
  );
}

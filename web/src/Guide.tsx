// A short guided tour. Each step dims the app, cuts a spotlight around a few
// controls, and "draws" a hand-made loop, arrow and label to each of them, live.
// A card in the middle moves through the steps or skips the tour.
import { useEffect, useLayoutEffect, useState } from 'preact/hooks';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
// dx shifts the label sideways; gap sets how far it sits from the control.
interface Target {
  find: () => Box | null;
  label: string;
  side: 'below' | 'above';
  dx?: number;
  gap?: number;
}
interface Step {
  title: string;
  text: string;
  targets: Target[];
  card: 'top' | 'bottom';
}

const rectOf = (sel: string) => (): Box | null => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
};

const STEPS: Step[] = [
  {
    title: 'Welcome to Fitbook',
    text: 'A quick tour of the basics.',
    card: 'bottom',
    targets: [
      { find: rectOf('.settings-btn'), label: 'Settings', side: 'below', dx: -40, gap: 70 },
      { find: rectOf('.date-pill'), label: 'Tap for the calendar', side: 'below', dx: 0, gap: 125 },
      { find: rectOf('.brand'), label: 'Tap here for the guide', side: 'below', dx: -60, gap: 180 },
    ],
  },
  {
    title: 'Log by just talking',
    text: 'Tell the chat what you ate, send a photo, or ask your coach.',
    card: 'top',
    targets: [
      { find: rectOf('.log-btn'), label: 'Log a meal here', side: 'above', dx: 80, gap: 52 },
      { find: rectOf('.tips-btn'), label: 'Tips for today', side: 'above', dx: -60, gap: 92 },
      { find: rectOf('.dock .rings'), label: 'Your scores', side: 'above', dx: -400, gap: 150 },
    ],
  },
  {
    title: 'Your daily canvas',
    text: 'Change it through the chat. Pull the page down to see yesterday.',
    card: 'bottom',
    targets: [
      {
        find: () => {
          const r = rectOf('.scroll')();
          return r ? { x: r.x + 20, y: r.y + 70, w: r.w - 40, h: 150 } : null;
        },
        label: 'Your meals get sketched here',
        side: 'below',
        dx: 10,
      },
    ],
  },
];

// A loop drawn around a box: a little more than one turn, slightly wobbly.
function loopPath(b: Box, seed: number): { d: string; cx: number; cy: number; rx: number; ry: number } {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const rx = b.w / 2 + 12;
  const ry = b.h / 2 + 10;
  const a0 = -2.3 + seed;
  const pts: string[] = [];
  for (let i = 0; i <= 44; i++) {
    const a = a0 + (i / 44) * Math.PI * 2.12;
    const wob = 1 + 0.05 * Math.sin(a * 3 + seed * 5) + i * 0.0018;
    pts.push(`${(cx + Math.cos(a) * rx * wob).toFixed(1)},${(cy + Math.sin(a) * ry * wob).toFixed(1)}`);
  }
  return { d: `M${pts.join(' L')}`, cx, cy, rx, ry };
}

// A curved arrow from the label towards the loop, with a two-stroke head.
function arrowPaths(from: [number, number], loop: { cx: number; cy: number; rx: number; ry: number }) {
  const [fx, fy] = from;
  const ang = Math.atan2(fy - loop.cy, fx - loop.cx);
  const tx = loop.cx + Math.cos(ang) * (loop.rx + 6);
  const ty = loop.cy + Math.sin(ang) * (loop.ry + 6);
  const mx = (fx + tx) / 2 + (ty - fy) * 0.25;
  const my = (fy + ty) / 2 - (tx - fx) * 0.25;
  const end = Math.atan2(ty - my, tx - mx);
  const head = (da: number) =>
    `M${tx.toFixed(1)},${ty.toFixed(1)} l${(-Math.cos(end + da) * 11).toFixed(1)},${(-Math.sin(end + da) * 11).toFixed(1)}`;
  return {
    shaft: `M${fx.toFixed(1)},${fy.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${tx.toFixed(1)},${ty.toFixed(1)}`,
    heads: [head(0.5), head(-0.5)],
  };
}

// setup: the person still needs to fill in their profile; the tour ends by handing over to the chat.
export function Guide({ onDone, setup }: { onDone: () => void; setup?: boolean }) {
  const [step, setStep] = useState(0);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [leaving, setLeaving] = useState(false);
  const [, force] = useState(0);

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  // Measure again once the dock and fonts have settled.
  useLayoutEffect(() => {
    const t = setTimeout(() => force((n) => n + 1), 60);
    return () => clearTimeout(t);
  }, [step]);

  const close = () => {
    setLeaving(true);
    setTimeout(onDone, 260);
  };
  const s = STEPS[step];
  const last = step === STEPS.length - 1;
  const text = last && setup ? 'Next, a few quick questions in the chat to set your daily goals.' : s.text;

  const drawn = s.targets
    .map((t) => ({ t, b: t.find() }))
    .filter((x): x is { t: Target; b: Box } => !!x.b)
    .map(({ t, b }, i) => {
      const loop = loopPath(b, i * 0.9);
      const labelY = t.side === 'below' ? b.y + b.h + (t.gap ?? 78 + i * 36) : b.y - (t.gap ?? 70 + i * 44);
      const labelX = Math.min(size.w - 16, Math.max(16, b.x + b.w / 2 + (t.dx ?? 0)));
      const anchorY = t.side === 'below' ? labelY - 26 : labelY + 10;
      // Start the arrow under the middle of the words, not at their edge.
      const anchorX = labelX < 90 ? labelX + 45 : labelX > size.w - 90 ? labelX - 45 : labelX;
      return { t, loop, labelX, labelY, arrow: arrowPaths([anchorX, anchorY], loop), delay: i * 0.75 };
    });

  return (
    <div class={`guide ${leaving ? 'leave' : ''}`} role="dialog" aria-label="How to use Fitbook">
      <svg class="guide-ink" key={step} width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`}>
        <defs>
          <filter id="guide-wobble" x="-10%" y="-10%" width="120%" height="120%">
            <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves={2} seed={3} />
            <feDisplacementMap in="SourceGraphic" scale={2.2} />
          </filter>
          <mask id="guide-holes">
            <rect width={size.w} height={size.h} fill="#fff" />
            {drawn.map((d, i) => (
              <ellipse key={i} cx={d.loop.cx} cy={d.loop.cy} rx={d.loop.rx} ry={d.loop.ry} fill="#000" />
            ))}
          </mask>
        </defs>
        <rect class="guide-scrim" width={size.w} height={size.h} mask="url(#guide-holes)" />
        {drawn.map((d, i) => (
          <g key={i} style={{ '--d': `${d.delay}s` } as Record<string, string>}>
            <path class="g-loop" d={d.loop.d} pathLength={1} />
            <path class="g-arrow" d={d.arrow.shaft} pathLength={1} />
            {d.arrow.heads.map((h, n) => (
              <path key={n} class="g-head" d={h} pathLength={1} />
            ))}
            <text
              class="g-label"
              x={d.labelX}
              y={d.labelY}
              text-anchor={d.labelX < 90 ? 'start' : d.labelX > size.w - 90 ? 'end' : 'middle'}
            >
              {d.t.label}
            </text>
          </g>
        ))}
      </svg>

      <div class={`guide-card ${s.card}`} key={`card${step}`}>
        <strong>{s.title}</strong>
        <p>{text}</p>
        <div class="guide-foot">
          <div class="guide-dots">
            {STEPS.map((_, i) => (
              <span key={i} class={i === step ? 'on' : ''} />
            ))}
          </div>
          {!last && (
            <button class="g-skip" onClick={close}>
              Skip
            </button>
          )}
          <button class="g-next" onClick={() => (last ? close() : setStep(step + 1))}>
            {last ? (setup ? 'Set me up' : 'Done') : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}

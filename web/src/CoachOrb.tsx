// The coach orb: a sphere of glowing dots that slowly turns, in the
// thinking-orbs style. Dots are tinted from --orb-a → --orb-b → --orb-c by height,
// and sized and faded by depth so it reads as a 3D ball.
import { useEffect, useRef } from 'preact/hooks';

const N = 90;
// Evenly spread points on a unit sphere (Fibonacci lattice).
const POINTS = Array.from({ length: N }, (_, i) => {
  const y = 1 - (2 * (i + 0.5)) / N;
  const r = Math.sqrt(1 - y * y);
  const t = i * Math.PI * (3 - Math.sqrt(5));
  return [Math.cos(t) * r, y, Math.sin(t) * r] as const;
});

function hex(c: string): [number, number, number] {
  const m = c.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return [128, 128, 200];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const mix = (a: number[], b: number[], k: number) => a.map((v, i) => Math.round(v + (b[i] - v) * k));

export function CoachOrb({ size = 34 }: { size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = canvas.height = size * dpr;
    const ctx = canvas.getContext('2d')!;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let colors: number[][] = [];
    let colorsAt = -1e9;
    let raf = 0;
    const start = performance.now();

    const draw = (now: number) => {
      if (now - colorsAt > 1000) {
        const s = getComputedStyle(canvas);
        colors = ['--orb-a', '--orb-b', '--orb-c'].map((v) => hex(s.getPropertyValue(v)));
        colorsAt = now;
      }
      const t = (now - start) / 1000;
      const spin = t * 0.5;
      const tilt = -0.42;
      const breathe = 1 + Math.sin(t * 1.6) * 0.035;
      const R = (size / 2 - 2.5) * breathe * dpr;
      const c = (size / 2) * dpr;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const pts = POINTS.map(([x, y, z]) => {
        const x1 = x * Math.cos(spin) + z * Math.sin(spin);
        const z1 = -x * Math.sin(spin) + z * Math.cos(spin);
        const y2 = y * Math.cos(tilt) - z1 * Math.sin(tilt);
        const z2 = y * Math.sin(tilt) + z1 * Math.cos(tilt);
        return { x: x1, y: y2, z: z2, h: y };
      }).sort((a, b) => a.z - b.z);

      for (const p of pts) {
        const depth = (p.z + 1) / 2; // 0 back … 1 front
        const k = (1 - p.h) / 2;
        const col = k < 0.5 ? mix(colors[0], colors[1], k * 2) : mix(colors[1], colors[2], (k - 0.5) * 2);
        // A soft wave of light travels over the surface.
        const wave = 0.5 + 0.5 * Math.sin(p.h * 4 - t * 2.4);
        ctx.globalAlpha = 0.18 + 0.82 * depth * (0.7 + 0.3 * wave);
        ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
        ctx.beginPath();
        ctx.arc(c + p.x * R, c - p.y * R, (0.55 + 1.15 * depth) * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (!reduce) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size]);
  return <canvas ref={ref} class="settings-orb" style={{ width: size, height: size }} aria-hidden="true" />;
}

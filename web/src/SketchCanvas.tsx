import { useRef } from 'preact/hooks';
import { getStroke } from 'perfect-freehand';
import { DOODLE_H, DOODLE_W, type Canvas, type Point } from '../../shared/types.ts';

// Turns perfect-freehand's outline points into a smooth closed SVG path.
function outlineToPath(outline: number[][]): string {
  if (outline.length < 2) return '';
  const avg = (a: number, b: number) => ((a + b) / 2).toFixed(1);
  let d = `M${outline[0][0].toFixed(1)},${outline[0][1].toFixed(1)} Q`;
  for (let i = 0; i < outline.length; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % outline.length];
    d += `${x0.toFixed(1)},${y0.toFixed(1)} ${avg(x0, x1)},${avg(y0, y1)} `;
  }
  return `${d}Z`;
}

function strokePath(points: Point[], size: number): string {
  return outlineToPath(getStroke(points, { size: size * 1.4, thinning: 0.55, smoothing: 0.6, streamline: 0.4, simulatePressure: true }));
}

// onPick: tapping a meal's row opens its details.
export function SketchCanvas({ canvas, onPick }: { canvas: Canvas; onPick?: (mealId: number) => void }) {
  // Items already shown appear instantly; new ones "draw in" one after another.
  const seen = useRef<Set<string> | null>(null);
  const firstRender = seen.current === null;
  const prev = seen.current ?? new Set<string>();
  let order = 0;

  const nodes = canvas.items.map((item) => {
    const isNew = !firstRender && !prev.has(item.id);
    const style = isNew ? { animationDelay: `${order++ * 90}ms` } : undefined;
    const cls = isNew ? 'ink new' : 'ink';
    if (item.type === 'doodle') {
      // Doodle markup comes from our library or the server's sanitised fallback drawing.
      return (
        <svg
          key={item.id}
          class={cls}
          style={style}
          x={item.x}
          y={item.y}
          width={item.width}
          height={item.height}
          viewBox={`0 0 ${DOODLE_W} ${DOODLE_H}`}
          dangerouslySetInnerHTML={{ __html: item.svg }}
        />
      );
    }
    if (item.type === 'stroke') {
      return <path key={item.id} class={cls} style={style} d={strokePath(item.points, item.size)} fill={item.color} />;
    }
    return (
      <text key={item.id} class={cls} style={style} x={item.x} y={item.y} font-size={item.size} fill={item.color}>
        {item.text}
      </text>
    );
  });
  seen.current = new Set(canvas.items.map((i) => i.id));

  return (
    <svg class="sketch" viewBox={`0 0 ${canvas.width} ${canvas.height}`} role="img" aria-label="Today's food canvas">
      <defs>
        {/* Shared hand-drawn wobble for doodle outlines (same as server/src/doodle/parts.ts). */}
        <filter id="wobble" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves={2} seed={7} />
          <feDisplacementMap in="SourceGraphic" scale={2.6} />
        </filter>
      </defs>
      {nodes}
      {onPick &&
        canvas.rows?.map((r) => (
          <rect
            key={`hit-${r.mealId}`}
            class="meal-hit"
            x={4}
            y={r.y}
            width={canvas.width - 8}
            height={r.height}
            rx={16}
            role="button"
            aria-label="Show meal details"
            onClick={() => onPick(r.mealId)}
          />
        ))}
    </svg>
  );
}

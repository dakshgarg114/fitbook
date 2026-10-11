// A slider that must be dragged all the way across to confirm something that can't be undone.
import { useRef, useState } from 'preact/hooks';

export function SlideToConfirm({ label, doneLabel, onConfirm }: { label: string; doneLabel: string; onConfirm: () => void }) {
  const track = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; max: number } | null>(null);
  const [x, setXState] = useState(0);
  // Read on release, so a fast swipe isn't judged by a stale render.
  const xNow = useRef(0);
  const setX = (v: number) => {
    xNow.current = v;
    setXState(v);
  };
  const [done, setDone] = useState(false);
  const [dragging, setDragging] = useState(false);

  const down = (e: PointerEvent) => {
    if (done) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const t = track.current!;
    start.current = { x: e.clientX - xNow.current, max: t.clientWidth - 48 };
    setDragging(true);
  };
  const move = (e: PointerEvent) => {
    const s = start.current;
    if (s) setX(Math.max(0, Math.min(s.max, e.clientX - s.x)));
  };
  const up = () => {
    const s = start.current;
    start.current = null;
    setDragging(false);
    if (!s) return;
    if (xNow.current >= s.max * 0.92) {
      setX(s.max);
      setDone(true);
      onConfirm();
    } else {
      setX(0);
    }
  };
  const max = track.current ? track.current.clientWidth - 48 : 1;

  return (
    <div class={`slide-confirm ${done ? 'done' : ''} ${dragging ? 'dragging' : ''}`} ref={track} role="group" aria-label={label}>
      <div class="slide-fill" style={{ width: `${x + 46}px` }} />
      <span class="slide-label" style={{ opacity: done ? 1 : Math.max(0, 1 - (x / max) * 1.6) }}>
        {done ? doneLabel : label}
      </span>
      <button
        type="button"
        class="slide-thumb"
        style={{ transform: `translateX(${x}px)` }}
        aria-label={label}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          stroke-width="2.4"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          {done ? <path d="M5 12.5l4.5 4.5L19 7" /> : <path d="M9 6l6 6-6 6" />}
        </svg>
      </button>
    </div>
  );
}

// Bottom sheet that springs up over a fading, blurred backdrop and animates out
// before it unmounts. Tap outside it, or pull it down from the top, to close it.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

const DISMISS = 90; // px pulled down before letting go closes the sheet

export function Sheet(props: { onClose: () => void; class?: string; children: (close: () => void) => ComponentChildren }) {
  const [state, setState] = useState<'enter' | 'open' | 'leave'>('enter');
  const [drag, setDrag] = useState(0);
  const modal = useRef<HTMLDivElement>(null);
  const closing = useRef(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setState('open')));
    return () => cancelAnimationFrame(raf);
  }, []);
  const close = () => {
    if (closing.current) return;
    closing.current = true;
    setDrag(0);
    setState('leave');
    setTimeout(props.onClose, 280);
  };

  // Pull-down to dismiss: only when the sheet is scrolled to its top.
  // Native listeners so we can stop the page from scrolling while dragging.
  useEffect(() => {
    const el = modal.current!;
    let startY = 0;
    let pulling = false;
    let dy = 0;
    const start = (e: TouchEvent) => {
      startY = e.touches[0].clientY;
      pulling = el.scrollTop <= 0;
      dy = 0;
    };
    const move = (e: TouchEvent) => {
      if (!pulling) return;
      dy = e.touches[0].clientY - startY;
      if (dy > 0) {
        e.preventDefault();
        setDrag(dy);
      } else {
        pulling = false;
        setDrag(0);
      }
    };
    const end = () => {
      if (pulling && dy > DISMISS) close();
      else setDrag(0);
      pulling = false;
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
  }, []);

  return (
    <div class={`sheet-backdrop ${state}`} onClick={close}>
      <div
        ref={modal}
        class={`modal ${props.class ?? ''} ${drag ? 'dragging' : ''}`}
        style={drag ? { transform: `translate3d(0, ${drag}px, 0)` } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        {props.children(close)}
      </div>
    </div>
  );
}

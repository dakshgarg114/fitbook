// Builds the day's canvas: one row per meal, the doodle alternating left and
// right, with the heading, time, nutrition and a one-liner on the other side.
import { DOODLE_H, DOODLE_W, type Canvas, type CanvasItem, type Point } from '../../shared/types.ts';
import type { MealRow } from './db.ts';

const WIDTH = 400;
const DOODLE_BOX_W = 190;
const DOODLE_BOX_H = Math.round((DOODLE_BOX_W * DOODLE_H) / DOODLE_W);
const TEXT_W = WIDTH - DOODLE_BOX_W - 28;
const ROW_GAP = 18;
const INK = '#2b2b2b';

export function time12(t: string): string {
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

// Caveat is narrow: roughly 0.42 × font size per character.
function wrap(text: string, size: number, maxLines: number): string[] {
  const max = Math.floor(TEXT_W / (size * 0.42));
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if ((line ? `${line} ${word}` : word).length <= max) line = line ? `${line} ${word}` : word;
    else {
      if (line) lines.push(line);
      line = word.slice(0, max);
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, max - 1)}…`;
  }
  return lines;
}

function rule(y: number): Point[] {
  const pts: Point[] = [];
  for (let x = 24; x <= WIDTH - 24; x += 14) pts.push([x, y + Math.round(Math.sin(x / 41) * 1.5)]);
  return pts;
}

export function buildCanvas(meals: MealRow[]): Canvas {
  const items: CanvasItem[] = [];
  let y = 12;

  if (meals.length === 0) {
    items.push({ type: 'text', id: 'empty', x: 24, y: 60, text: 'Nothing logged yet.', size: 28, color: '#8a8577' });
    items.push({ type: 'text', id: 'empty2', x: 24, y: 92, text: 'Tap the chat and tell me what you ate!', size: 22, color: '#8a8577' });
    return { width: WIDTH, height: 130, items };
  }

  meals.forEach((m, i) => {
    const left = i % 2 === 0;
    const dx = left ? 6 : WIDTH - DOODLE_BOX_W - 6;
    const tx = left ? DOODLE_BOX_W + 18 : 16;
    const id = `m${m.id}`;

    if (Array.isArray(m.doodle)) {
      // v1 pen sketches were drawn in a 200 × 160 box.
      const k = DOODLE_BOX_H / 160;
      for (const s of m.doodle) {
        items.push({
          ...s,
          id: `${id}-${s.id}`,
          points: s.points.map(([x, py]): Point => [Math.round(dx + 10 + x * k), Math.round(y + py * k)]),
        });
      }
    } else if (m.doodle.svg) {
      items.push({ type: 'doodle', id: `${id}-doodle`, x: dx, y, width: DOODLE_BOX_W, height: DOODLE_BOX_H, svg: m.doodle.svg });
    }

    let ty = y + 34;
    const text = (key: string, t: string, size: number, color: string, gap: number) => {
      items.push({ type: 'text', id: `${id}-${key}`, x: tx, y: ty, text: t, size, color });
      ty += gap;
    };
    wrap(m.heading, 27, 2).forEach((l, n) => text(`h${n}`, l, 27, INK, 28));
    ty += 2;
    const t = m.totals;
    text('kcal', `${time12(m.time)} · ${Math.round(t.calories)} kcal`, 20, '#c0392b', 21);
    text('pc', `P ${Math.round(t.protein)}g · C ${Math.round(t.carbs)}g`, 17, '#6b665a', 18);
    text('ff', `F ${Math.round(t.fat)}g · Fib ${Math.round(t.fiber)}g`, 17, '#6b665a', 22);
    if (m.note) wrap(m.note, 19, 2).forEach((l, n) => text(`n${n}`, l, 19, '#4a4538', 20));

    y = Math.max(y + DOODLE_BOX_H, ty - 10) + ROW_GAP;
    if (i < meals.length - 1) items.push({ type: 'stroke', id: `${id}-rule`, points: rule(y - ROW_GAP / 2), size: 1.4, color: '#d9d0bb' });
  });

  return { width: WIDTH, height: y, items };
}

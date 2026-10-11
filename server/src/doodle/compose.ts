// Turns a scene description from the model into an SVG using the doodle library.
import { PARTS, bowl, plate } from './parts.ts';

export interface Scene {
  groups: { container: 'plate' | 'bowl' | 'none'; foods: { id: string; count?: number }[]; label?: string }[];
}

export const W = 360;
export const H = 270;

const at = (x: number, y: number, s: number, svg: string) => `<g transform="translate(${x} ${y}) scale(${s})">${svg}</g>`;

const SLOTS: [number, number][][] = [
  [[0, 0]],
  [
    [-44, 2],
    [44, 2],
  ],
  [
    [-48, 8],
    [34, -14],
    [40, 20],
  ],
  [
    [-46, -12],
    [46, -12],
    [-40, 18],
    [40, 18],
  ],
];

function plateFoods(foods: Scene['groups'][0]['foods'], missing: string[]): string {
  // Each stack of pile-able pieces (parathas, rotis, toast) is one unit; others are one unit per piece.
  const units: string[] = [];
  for (const f of foods) {
    const part = PARTS[f.id];
    if (!part) {
      missing.push(f.id);
      continue;
    }
    const n = Math.max(1, Math.min(4, f.count ?? 1));
    if (part.stack || part.kind === 'mound' || n === 1) {
      const k = part.stack ? n : 1;
      let pile = '';
      for (let i = 0; i < k; i++) pile += part.draw(-i * 16, -i * 11);
      units.push(pile);
    } else {
      for (let i = 0; i < n; i++) units.push(part.draw(0, 0));
    }
  }
  const slots = SLOTS[Math.min(units.length, 4) - 1] ?? [];
  const s = [1.35, 1.0, 0.85, 0.8][Math.min(units.length, 4) - 1] ?? 1;
  return units
    .slice(0, 4)
    .map((u, i) => at(slots[i][0], slots[i][1], s, u))
    .join('');
}

function bowlContents(foods: Scene['groups'][0]['foods'], missing: string[]): { inside: string; top: string } {
  const known = foods.filter((f) => PARTS[f.id] || (missing.push(f.id), false));
  const fill = known.find((f) => PARTS[f.id].kind === 'fill');
  const pieces = known.filter((f) => PARTS[f.id].kind !== 'fill');
  let inside = fill ? PARTS[fill.id].draw(0, 0) : '';
  let top = '';
  const xs = [-18, 18, 0];
  if (fill) {
    // Toppings sit small on the surface.
    pieces.slice(0, 3).forEach((f, i) => (inside += at(xs[i], -1, 0.7, PARTS[f.id].draw(0, 0))));
  } else {
    // A bowl of whole pieces (fruit bowl): they pile up above the rim.
    inside = `<ellipse cx="0" cy="0" rx="40" ry="10" fill="#e9dcc4"/>`;
    pieces.slice(0, 3).forEach((f, i) => (top += at([-30, 30, 0][i], i === 2 ? -34 : -16, 0.9, PARTS[f.id].draw(0, 0))));
  }
  return { inside, top };
}

// Keeps labels inside the canvas: long ones get smaller, anchors are clamped.
const label = (x: number, y: number, text?: string) => {
  if (!text) return '';
  const t = text.replace(/[<&]/g, '').slice(0, 30);
  const size = t.length > 20 ? 14 : 17;
  const half = (t.length * size * 0.42) / 2;
  const cx = Math.max(half + 4, Math.min(W - half - 4, x));
  return `<text x="${cx}" y="${y}" text-anchor="middle" font-family="Caveat, cursive" font-size="${size}" fill="#2b2b2b">${t}</text>`;
};

export function compose(scene: Scene): { svg: string; missing: string[] } {
  const missing: string[] = [];
  const plates = scene.groups.filter((g) => g.container !== 'bowl');
  const bowls = scene.groups.filter((g) => g.container === 'bowl').slice(0, 2);
  let art = '';
  let text = '';

  const plateG = plates[0];
  if (plateG) {
    const foods = plates.flatMap((g) => g.foods);
    const [x, y, s] = bowls.length ? [128, 140, 0.9] : [180, 130, 1.1];
    const body = (plateG.container === 'plate' ? plate(0, 0) : '') + plateFoods(foods, missing);
    art += at(x, y, s, body);
    text += label(
      x,
      y + 62 * s + 26,
      plates
        .map((g) => g.label)
        .filter(Boolean)
        .join(', '),
    );
  }

  if (bowls.length) {
    const pos: [number, number, number][] = plateG
      ? bowls.length === 1
        ? [[292, 112, 1.1]]
        : [
            [296, 58, 0.9],
            [296, 166, 0.9],
          ]
      : bowls.length === 1
        ? [[180, 110, 1.6]]
        : [
            [100, 120, 1.2],
            [260, 120, 1.2],
          ];
    bowls.forEach((g, i) => {
      const [x, y, s] = pos[i];
      const { inside, top } = bowlContents(g.foods, missing);
      art += at(x, y, s, bowl(0, 0, inside, top));
      text += label(x, y + 50 * s + 20, g.label);
    });
  }
  return { svg: `<g filter="url(#wobble)">${art}</g>${text}`, missing };
}

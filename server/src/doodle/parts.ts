// Approach A: a small library of coloured doodle parts, drawn by hand in one style
// (flat fills, ink outlines). The scene composer places them; a shared SVG filter
// adds the wobbly hand-drawn edge.

export const INK = '#2b2b2b';
const o = `stroke="${INK}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"`;

export type Kind = 'piece' | 'fill' | 'mound';
export interface Part {
  kind: Kind; // piece: solid item on a plate; fill: goes inside a bowl; mound: heap on a plate
  label: string;
  draw: (x: number, y: number, s?: number) => string; // centred at x,y
  stack?: boolean; // several pieces overlap in a pile (parathas, rotis)
}

const spots = (x: number, y: number, pts: [number, number, number][], color: string) =>
  pts.map(([dx, dy, r]) => `<ellipse cx="${x + dx}" cy="${y + dy}" rx="${r}" ry="${r * 0.6}" fill="${color}"/>`).join('');

export const PARTS: Record<string, Part> = {
  paratha: {
    kind: 'piece',
    label: 'paratha',
    stack: true,
    draw: (x, y) =>
      `<ellipse cx="${x}" cy="${y}" rx="44" ry="25" fill="#e3a75a" ${o}/>` +
      `<ellipse cx="${x}" cy="${y}" rx="30" ry="16" fill="none" stroke="#b97a35" stroke-width="1.6" stroke-dasharray="6 5"/>` +
      spots(
        x,
        y,
        [
          [-22, -6, 4],
          [14, -10, 3.5],
          [20, 8, 4.5],
          [-8, 10, 3],
          [2, -2, 3],
        ],
        '#9c5a22',
      ) +
      `<path d="M${x - 26} ${y - 12} q10 -6 22 -4" fill="none" stroke="#fff3c9" stroke-width="2.4" stroke-linecap="round"/>`,
  },
  roti: {
    kind: 'piece',
    label: 'roti',
    stack: true,
    draw: (x, y) =>
      `<ellipse cx="${x}" cy="${y}" rx="42" ry="24" fill="#ecc98f" ${o}/>` +
      spots(
        x,
        y,
        [
          [-20, -6, 5],
          [12, -10, 4],
          [22, 6, 5],
          [-6, 9, 4],
          [4, -1, 2.5],
          [-28, 6, 3],
        ],
        '#a8682c',
      ),
  },
  dosa: {
    kind: 'piece',
    label: 'dosa',
    draw: (x, y) =>
      `<path d="M${x - 78} ${y + 12} Q${x - 70} ${y - 22} ${x + 70} ${y - 16} Q${x + 84} ${y} ${x + 70} ${y + 16} Q${x - 60} ${y + 26} ${x - 78} ${y + 12} Z" fill="#d99440" ${o}/>` +
      `<path d="M${x - 60} ${y + 2} Q${x} ${y - 10} ${x + 66} ${y - 6}" fill="none" stroke="#a8621f" stroke-width="1.8"/>` +
      `<path d="M${x - 50} ${y + 12} Q${x} ${y + 4} ${x + 60} ${y + 8}" fill="none" stroke="#a8621f" stroke-width="1.8"/>` +
      `<ellipse cx="${x + 72}" cy="${y}" rx="10" ry="15" fill="#f2c443" ${o}/>` +
      spots(
        x + 72,
        y,
        [
          [-2, -4, 2],
          [3, 5, 2],
        ],
        '#e08a2a',
      ),
  },
  sandwich: {
    kind: 'piece',
    label: 'sandwich',
    // Front view of a stacked sandwich: bread, lettuce, chicken, tomato, bread.
    draw: (x, y) =>
      `<path d="M${x - 42} ${y + 14} L${x + 42} ${y + 14} Q${x + 46} ${y + 26} ${x + 38} ${y + 26} L${x - 38} ${y + 26} Q${x - 46} ${y + 26} ${x - 42} ${y + 14} Z" fill="#e8b46a" ${o}/>` +
      `<path d="M${x - 46} ${y + 12} q8 -8 15 0 t15 0 t15 0 t15 0 t15 0 t16 0" fill="#7cc04b" ${o}/>` +
      `<rect x="${x - 40}" y="${y - 2}" width="80" height="12" rx="4" fill="#f1d3b0" ${o}/>` +
      `<path d="M${x - 36} ${y - 2} q9 -8 18 0 q9 -8 18 0 q9 -8 18 0 q9 -8 18 0 Z" fill="#e5483d" ${o}/>` +
      `<rect x="${x - 44}" y="${y - 16}" width="88" height="13" rx="3" fill="#e8b46a" ${o}/>` +
      `<path d="M${x - 40} ${y - 12} L${x + 40} ${y - 12}" stroke="#f6dca8" stroke-width="3" stroke-linecap="round"/>`,
  },
  toast: {
    kind: 'piece',
    label: 'toast',
    stack: true,
    draw: (x, y) =>
      `<path d="M${x - 30} ${y + 24} L${x - 30} ${y - 10} Q${x - 34} ${y - 30} ${x - 14} ${y - 30} Q${x} ${y - 38} ${x + 14} ${y - 30} Q${x + 34} ${y - 30} ${x + 30} ${y - 10} L${x + 30} ${y + 24} Z" fill="#b8702e" ${o}/>` +
      `<path d="M${x - 24} ${y + 19} L${x - 24} ${y - 8} Q${x - 26} ${y - 24} ${x - 12} ${y - 24} Q${x} ${y - 31} ${x + 12} ${y - 24} Q${x + 26} ${y - 24} ${x + 24} ${y - 8} L${x + 24} ${y + 19} Z" fill="#e9b66a"/>`,
  },
  boiled_egg: {
    kind: 'piece',
    label: 'boiled egg',
    draw: (x, y) =>
      `<ellipse cx="${x}" cy="${y}" rx="22" ry="16" fill="#fffdf6" ${o}/>` +
      `<circle cx="${x + 1}" cy="${y}" r="9" fill="#f6b928" stroke="#d9951c" stroke-width="1.6"/>`,
  },
  banana: {
    kind: 'piece',
    label: 'banana',
    draw: (x, y) =>
      `<path d="M${x - 44} ${y - 14} Q${x - 30} ${y + 22} ${x + 6} ${y + 20} Q${x + 34} ${y + 16} ${x + 44} ${y - 12} Q${x + 30} ${y + 2} ${x + 4} ${y + 4} Q${x - 24} ${y + 4} ${x - 44} ${y - 14} Z" fill="#f7d348" ${o}/>` +
      `<path d="M${x - 44} ${y - 14} l-4 -6" ${o}/><circle cx="${x + 44}" cy="${y - 12}" r="3" fill="#5a3a1a"/>` +
      `<path d="M${x - 30} ${y + 4} Q${x} ${y + 18} ${x + 32} ${y + 2}" fill="none" stroke="#d9a92a" stroke-width="1.8"/>`,
  },
  apple: {
    kind: 'piece',
    label: 'apple',
    draw: (x, y) =>
      `<path d="M${x} ${y - 14} C${x - 30} ${y - 30} ${x - 34} ${y + 10} ${x - 14} ${y + 22} C${x - 6} ${y + 26} ${x + 6} ${y + 26} ${x + 14} ${y + 22} C${x + 34} ${y + 10} ${x + 30} ${y - 30} ${x} ${y - 14} Z" fill="#e0453a" ${o}/>` +
      `<path d="M${x} ${y - 14} q1 -10 5 -14" fill="none" ${o}/>` +
      `<path d="M${x + 4} ${y - 22} q12 -10 18 -2 q-10 6 -18 2 Z" fill="#6cb44a" ${o}/>` +
      `<path d="M${x - 16} ${y - 8} q-4 8 -2 14" fill="none" stroke="#ffb3a8" stroke-width="3" stroke-linecap="round"/>`,
  },
  pomegranate: {
    kind: 'piece',
    label: 'pomegranate',
    draw: (x, y) =>
      `<circle cx="${x}" cy="${y}" r="24" fill="#c4283a" ${o}/>` +
      `<path d="M${x - 7} ${y - 22} l2 -9 l5 5 l5 -5 l2 9" fill="#c4283a" ${o}/>` +
      `<path d="M${x - 14} ${y - 8} q-4 8 0 16" fill="none" stroke="#f08a96" stroke-width="3" stroke-linecap="round"/>`,
  },
  almonds: {
    kind: 'piece',
    label: 'almonds',
    draw: (x, y) =>
      [
        [-10, 0, -20],
        [6, -4, 15],
        [2, 8, 40],
      ]
        .map(
          ([dx, dy, r]) =>
            `<ellipse cx="${x + dx}" cy="${y + dy}" rx="8" ry="4.5" transform="rotate(${r} ${x + dx} ${y + dy})" fill="#b06a35" ${o}/>`,
        )
        .join(''),
  },
  banana_slices: {
    kind: 'piece',
    label: 'banana slices',
    draw: (x, y) =>
      [
        [-14, 0],
        [2, -4],
        [16, 2],
      ]
        .map(
          ([dx, dy]) =>
            `<ellipse cx="${x + dx}" cy="${y + dy}" rx="8" ry="6" fill="#fbf0b8" ${o}/><circle cx="${x + dx}" cy="${y + dy}" r="1.6" fill="#b08a3a"/>`,
        )
        .join(''),
  },
  rice: {
    kind: 'mound',
    label: 'rice',
    draw: (x, y) =>
      `<path d="M${x - 48} ${y + 14} Q${x - 46} ${y - 26} ${x} ${y - 28} Q${x + 46} ${y - 26} ${x + 48} ${y + 14} Q${x} ${y + 24} ${x - 48} ${y + 14} Z" fill="#fffcf2" ${o}/>` +
      [
        [-24, -6],
        [-8, -16],
        [10, -10],
        [26, -2],
        [-14, 6],
        [6, 4],
        [-30, 8],
        [22, 10],
        [0, -22],
      ]
        .map(([dx, dy]) => `<path d="M${x + dx} ${y + dy} l5 -2" stroke="#d9d0bb" stroke-width="2" stroke-linecap="round"/>`)
        .join(''),
  },
  poha: {
    kind: 'mound',
    label: 'poha',
    draw: (x, y) =>
      `<path d="M${x - 52} ${y + 14} Q${x - 50} ${y - 24} ${x} ${y - 26} Q${x + 50} ${y - 24} ${x + 52} ${y + 14} Q${x} ${y + 24} ${x - 52} ${y + 14} Z" fill="#f4cf48" ${o}/>` +
      spots(
        x,
        y,
        [
          [-26, -2, 4],
          [-6, -14, 4],
          [14, -6, 4],
          [30, 4, 4],
          [-14, 8, 4],
        ],
        '#7cc04b',
      ) +
      spots(
        x,
        y,
        [
          [-34, 6, 4],
          [4, 6, 4.5],
          [22, -14, 4],
        ],
        '#c98a45',
      ) +
      `<path d="M${x - 8} ${y - 4} q8 -10 16 0 q-8 6 -16 0 Z" fill="#3f8f3a"/>` +
      `<path d="M${x + 36} ${y - 12} l14 -6 l2 14 Z" fill="#f7e66a" ${o}/>`,
  },
  // Bowl contents: drawn as the visible surface inside a bowl rim of rx 46, ry 13.
  curd: {
    kind: 'fill',
    label: 'curd',
    draw: (x, y) => surface(x, y, '#fdfcf7') + `<path d="M${x - 14} ${y} q8 -6 16 0 t14 0" fill="none" stroke="#e3ded0" stroke-width="2"/>`,
  },
  dal: {
    kind: 'fill',
    label: 'dal',
    draw: (x, y) =>
      surface(x, y, '#eab437') +
      spots(
        x,
        y,
        [
          [-16, -2, 2],
          [6, 3, 2],
          [18, -3, 2],
          [-4, -5, 1.6],
        ],
        '#7a4a1c',
      ) +
      `<path d="M${x - 6} ${y - 2} q4 -4 8 0" stroke="#c0392b" stroke-width="2" fill="none"/>`,
  },
  sambar: {
    kind: 'fill',
    label: 'sambar',
    draw: (x, y) =>
      surface(x, y, '#cf7a2e') +
      `<rect x="${x - 18}" y="${y - 4}" width="16" height="5" rx="2" fill="#6f9e3a"/>` +
      spots(
        x,
        y,
        [
          [12, 0, 4],
          [-28, 2, 3],
        ],
        '#f0b35a',
      ),
  },
  coconut_chutney: {
    kind: 'fill',
    label: 'coconut chutney',
    draw: (x, y) =>
      surface(x, y, '#f4f0df') +
      spots(
        x,
        y,
        [
          [-14, -2, 2],
          [4, 3, 2],
          [16, -3, 2],
        ],
        '#2b2b2b',
      ) +
      spots(
        x,
        y,
        [
          [-4, -4, 3],
          [10, 1, 2.6],
        ],
        '#4fa34a',
      ),
  },
  rajma: {
    kind: 'fill',
    label: 'rajma',
    draw: (x, y) =>
      surface(x, y, '#9a3a22') +
      [
        [-18, -1],
        [-2, 3],
        [14, -3],
        [26, 2],
        [4, -5],
      ]
        .map(([dx, dy]) => `<ellipse cx="${x + dx}" cy="${y + dy}" rx="6" ry="3.6" fill="#5c1712" stroke="#3a0d0a" stroke-width="1"/>`)
        .join(''),
  },
  paneer_sabzi: {
    kind: 'fill',
    label: 'paneer sabzi',
    draw: (x, y) =>
      surface(x, y, '#e2762b') +
      [
        [-18, -3],
        [0, 2],
        [16, -4],
      ]
        .map(
          ([dx, dy]) =>
            `<rect x="${x + dx - 6}" y="${y + dy - 5}" width="12" height="9" rx="1.5" fill="#fffbe9" ${o.replace('2.4', '1.4')}/>`,
        )
        .join('') +
      spots(
        x,
        y,
        [
          [-28, 2, 2.6],
          [26, 3, 2.6],
        ],
        '#3f8f3a',
      ),
  },
  oats: {
    kind: 'fill',
    label: 'oats',
    draw: (x, y) =>
      surface(x, y, '#ead8ad') +
      spots(
        x,
        y,
        [
          [-22, 0, 2],
          [-4, 4, 2],
          [24, -2, 2],
        ],
        '#c9b07a',
      ),
  },
};

function surface(x: number, y: number, color: string) {
  return `<ellipse cx="${x}" cy="${y}" rx="40" ry="10" fill="${color}" stroke="${INK}" stroke-width="1.6"/>`;
}

// Containers ----------------------------------------------------------------

export function plate(x: number, y: number) {
  return (
    `<ellipse cx="${x}" cy="${y + 6}" rx="118" ry="62" fill="#e6dccb"/>` +
    `<ellipse cx="${x}" cy="${y}" rx="118" ry="60" fill="#fbfaf6" ${o}/>` +
    `<ellipse cx="${x}" cy="${y}" rx="92" ry="44" fill="none" stroke="#c9d7e6" stroke-width="2"/>`
  );
}

// A katori/bowl seen from slightly above; `inside` is the contents surface.
export function bowl(x: number, y: number, inside: string, rimTop = '') {
  return (
    `<path d="M${x - 50} ${y} Q${x - 46} ${y + 48} ${x} ${y + 50} Q${x + 46} ${y + 48} ${x + 50} ${y} Z" fill="#7fb2d9" ${o}/>` +
    `<path d="M${x - 44} ${y + 22} Q${x} ${y + 34} ${x + 44} ${y + 22}" fill="none" stroke="#f7f3ea" stroke-width="4"/>` +
    `<ellipse cx="${x}" cy="${y}" rx="50" ry="14" fill="#f7f3ea" ${o}/>` +
    inside +
    rimTop
  );
}

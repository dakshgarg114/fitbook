// Indian Food Composition Tables 2017 (NIN, ICMR): 542 raw ingredients, values per 100 g edible portion.
// Read from @ifct2017/compositions, pinned at 2.0.9 because later ifct2017 releases moved to AGPL.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Macros } from '../../shared/types.ts';

export interface IfctFood {
  code: string;
  name: string;
  group: string;
  per100g: Macros;
}

interface Row extends IfctFood {
  main: Set<string>; // words from the English name, and the English and Hindi local names
  other: Set<string>; // words from the other Indian-language names
}

// Minimal CSV parser: quoted fields, "" escapes, no newlines inside fields.
function parseLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

// "rotis" → "roti", "tomatoes" → "tomato", so plurals still match.
const stem = (w: string) => (w.endsWith('oes') ? w.slice(0, -2) : w.length > 3 && /[^s]s$/.test(w) ? w.slice(0, -1) : w);
const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length > 1)
    .map(stem);

let rows: Row[] | null = null;

function load(): Row[] {
  if (rows) return rows;
  const file = createRequire(import.meta.url).resolve('@ifct2017/compositions/index.csv');
  const [head, ...lines] = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  // Headers look like "Food Name; name": the short code after the semicolon names the column.
  const col = Object.fromEntries(parseLine(head).map((h, i) => [h.slice(h.lastIndexOf(';') + 1).trim(), i]));
  const num = (r: string[], k: string) => Number(r[col[k]]) || 0;
  rows = lines.map((line) => {
    const r = parseLine(line);
    const main = new Set(words(r[col.name]));
    const other = new Set<string>();
    for (const part of r[col.lang].split(';')) {
      const m = part.trim().match(/^([A-Za-z., ]+?)\.\s+(.*)$/);
      if (!m) continue;
      const target = /(^|[ ,])(E|H)$/.test(m[1]) ? main : other;
      for (const w of words(m[2])) target.add(w);
    }
    const m = {
      protein: num(r, 'protcnt'),
      carbs: num(r, 'choavldf'),
      fat: num(r, 'fatce'),
      fiber: num(r, 'fibtg'),
      sugar: num(r, 'fsugar'),
    };
    // Energy is in kJ; a few rows (ghee, oils) leave it blank, so fall back to Atwater factors.
    const kj = num(r, 'enerc');
    const calories = kj ? kj / 4.184 : 4 * m.protein + 4 * m.carbs + 9 * m.fat + 2 * m.fiber;
    return {
      code: r[col.code],
      name: r[col.name],
      group: r[col.grup],
      per100g: { calories, ...m },
      main,
      other,
    };
  });
  return rows;
}

export function ifctByCode(code: string): IfctFood | null {
  const r = load().find((x) => x.code === code);
  return r ? { code: r.code, name: r.name, group: r.group, per100g: r.per100g } : null;
}

// Best matches for a query, by how many of its words appear in each food's names.
export function searchIfct(query: string, limit = 5): IfctFood[] {
  const q = words(query);
  if (!q.length) return [];
  return load()
    .map((r) => {
      let score = 0;
      for (const w of q) score += r.main.has(w) ? 3 : r.other.has(w) ? 1 : 0;
      // Prefer foods whose name starts with the query's first word ("Rice, raw" for "rice").
      if (words(r.name)[0] === q[0]) score += 1;
      return { r, score };
    })
    .filter((x) => x.score >= 3 || (q.length === 1 && x.score > 0))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ r }) => ({ code: r.code, name: r.name, group: r.group, per100g: r.per100g }));
}

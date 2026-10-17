// Nutrition lookups for the agent: USDA for cooked dishes, IFCT 2017 for Indian raw ingredients.
// Every candidate gets a ref ("usda:2345678", "ifct:B001") the agent passes back when saving a food,
// so the numbers always come from the table, never from the model.
import type { Macros } from '../../shared/types.ts';
import { searchFoods } from './usda.ts';
import { ifctByCode, searchIfct } from './ifct.ts';

export interface Candidate {
  ref: string;
  name: string;
  per100g: Macros;
}

export type Source = 'usda' | 'ifct';

const round1 = (n: number) => Math.round(n * 10) / 10;
const rounded = (m: Macros): Macros => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, round1(v)])) as unknown as Macros;

// One per agent run: remembers every candidate shown, so save_meals can resolve its refs.
export class NutritionCache {
  private seen = new Map<string, Candidate>();

  async lookup(query: string, kind: 'dish' | 'ingredient'): Promise<Candidate[]> {
    const [usda, ifct] = await Promise.all([
      searchFoods(query, kind === 'dish' ? 4 : 2).catch(() => []),
      Promise.resolve(searchIfct(query, kind === 'dish' ? 2 : 4)),
    ]);
    const fromUsda = usda.map((u) => ({ ref: `usda:${u.fdcId}`, name: u.description, per100g: rounded(u.per100g) }));
    const fromIfct = ifct.map((f) => ({ ref: `ifct:${f.code}`, name: `${f.name} (raw, IFCT)`, per100g: rounded(f.per100g) }));
    const out = kind === 'dish' ? [...fromUsda, ...fromIfct] : [...fromIfct, ...fromUsda];
    for (const c of out) this.seen.set(c.ref, c);
    return out;
  }

  // IFCT refs always resolve (the table is local); USDA refs only if this run looked them up.
  resolve(ref: string): (Candidate & { source: Source }) | null {
    const hit = this.seen.get(ref);
    if (hit) return { ...hit, source: ref.startsWith('ifct:') ? 'ifct' : 'usda' };
    if (ref.startsWith('ifct:')) {
      const f = ifctByCode(ref.slice(5));
      if (f) return { ref, name: f.name, per100g: f.per100g, source: 'ifct' };
    }
    return null;
  }
}

export const scale = (per100g: Macros, grams: number): Macros =>
  Object.fromEntries(Object.entries(per100g).map(([k, v]) => [k, (v * grams) / 100])) as unknown as Macros;

// Daily targets and the five scores. Computed in code, never by the model.
import type { FoodGroup, Macros, Meal, Profile, Scores, Targets } from '../../shared/types.ts';

export function profileComplete(p: Profile): boolean {
  return !!(p.age && p.weightKg && p.heightCm && p.goal);
}

// Protein is set per kg of lean-ish body weight. Above a BMI of 25, extra weight is mostly
// fat, so we use the weight at BMI 25 for their height instead of their actual weight.
function proteinWeight(weightKg: number, heightCm: number): number {
  const m = heightCm / 100;
  return Math.min(weightKg, 25 * m * m);
}

export function targetsFor(p: Profile): Targets | null {
  if (!profileComplete(p)) return null;
  const w = p.weightKg!,
    h = p.heightCm!,
    a = p.age!;
  // Mifflin-St Jeor; without a sex, use the midpoint of the two constants.
  const sexConst = p.sex === 'male' ? 5 : p.sex === 'female' ? -161 : -78;
  const tdee = (10 * w + 6.25 * h - 5 * a + sexConst) * 1.375;
  const c = p.customTargets ?? {};
  // A calorie goal the user set also moves fiber and carbs, unless they set those too.
  const calories = c.calories ?? Math.round((tdee + (p.goal === 'lose' ? -400 : p.goal === 'gain' ? 300 : 0)) / 10) * 10;
  return {
    calories,
    protein: c.protein ?? Math.round(proteinWeight(w, h) * (p.goal === 'maintain' ? 1.2 : 1.6)),
    fiber: c.fiber ?? Math.round((calories / 1000) * 14),
    carbsMin: c.carbsMin ?? Math.round((calories * 0.45) / 4),
    carbsMax: c.carbsMax ?? Math.round((calories * 0.65) / 4),
  };
}

// Antioxidant points per 100 g by food group: our own rough estimate, not a lab value.
const ANTIOXIDANT_POINTS: Record<FoodGroup, number> = {
  berries: 6,
  spices_herbs: 6,
  dark_chocolate: 5,
  tea_coffee: 4,
  nuts_seeds: 4,
  leafy_greens: 4,
  legumes: 3,
  vegetables: 3,
  fruits: 3,
  whole_grains: 2,
  dairy: 0.3,
  meat_fish_egg: 0.3,
  refined_grains: 0.3,
  sweets: 0.2,
  fried: 0.2,
  other: 0.5,
};
const ANTIOXIDANT_TARGET = 20;

const clamp10 = (n: number) => Math.max(0, Math.min(10, Math.round(n * 10) / 10));

export function scoreDay(meals: Meal[], totals: Macros, t: Targets): Scores {
  const protein = clamp10((10 * totals.protein) / t.protein);
  const fiber = clamp10((10 * totals.fiber) / t.fiber);

  // Carbs: fill up towards the healthy range; lose points above it and for lots of sugar.
  let carbs = totals.carbs <= t.carbsMax ? (10 * totals.carbs) / t.carbsMin : 10 - (10 * (totals.carbs - t.carbsMax)) / t.carbsMax;
  if (totals.sugar > 50) carbs -= (totals.sugar - 50) / 10;
  carbs = clamp10(carbs);

  let points = 0;
  for (const m of meals) for (const f of m.foods) points += (ANTIOXIDANT_POINTS[f.foodGroup] ?? 0.5) * (f.grams / 100);
  const antioxidants = clamp10((10 * points) / ANTIOXIDANT_TARGET);

  // Overall: the four together, scaled down when calories overshoot the target.
  let overall = (carbs + fiber + protein + antioxidants) / 4;
  const over = totals.calories / t.calories - 1.1;
  if (over > 0) overall *= Math.max(0, 1 - over * 2);
  return { carbs, fiber, protein, antioxidants, overall: clamp10(overall) };
}

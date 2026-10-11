// USDA FoodData Central lookup. Values in search results are per 100 g.
import type { Macros } from '../../shared/types.ts';

export interface UsdaMatch {
  fdcId: number;
  description: string;
  per100g: Macros;
}

const NUTRIENT = { calories: [1008, 2047, 2048], protein: [1003], fat: [1004], carbs: [1005], fiber: [1079], sugar: [2000, 1063] };

export async function searchFood(query: string): Promise<UsdaMatch | null> {
  const res = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${process.env.USDA_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, pageSize: 8, dataType: ['Survey (FNDDS)', 'Foundation', 'SR Legacy'] }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    console.warn(`USDA search failed ${res.status} for "${query}"`);
    return null;
  }
  const data = (await res.json()) as {
    foods?: { fdcId: number; description: string; foodNutrients: { nutrientId: number; value: number }[] }[];
  };
  for (const food of data.foods ?? []) {
    const get = (ids: number[]) => food.foodNutrients.find((n) => ids.includes(n.nutrientId))?.value;
    const calories = get(NUTRIENT.calories);
    if (calories == null) continue;
    return {
      fdcId: food.fdcId,
      description: food.description,
      per100g: {
        calories,
        protein: get(NUTRIENT.protein) ?? 0,
        carbs: get(NUTRIENT.carbs) ?? 0,
        fat: get(NUTRIENT.fat) ?? 0,
        fiber: get(NUTRIENT.fiber) ?? 0,
        sugar: get(NUTRIENT.sugar) ?? 0,
      },
    };
  }
  return null;
}

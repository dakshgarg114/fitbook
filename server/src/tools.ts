// The agent's tools. Reads run straight away; writes are staged during the loop and applied
// together at the end (one transaction), so a failed run never leaves half a change behind.
import {
  addMemory,
  db,
  findDay,
  forgetMemory,
  getOrCreateDay,
  listMeals,
  listMemories,
  saveCanvas,
  setCustomTargets,
  sumMacros,
  updateProfile,
  type UserRow,
} from './db.ts';
import type { ToolDef } from './deepseek.ts';
import { NutritionCache, scale } from './nutrition.ts';
import { webSearch, webSearchEnabled } from './websearch.ts';
import { PARTS } from './doodle/parts.ts';
import { compose, type Scene } from './doodle/compose.ts';
import { drawDoodle } from './doodle/draw.ts';
import { buildCanvas } from './layout.ts';
import { profileComplete, scoreDay, targetsFor } from './scores.ts';
import { FOOD_GROUPS, type FoodGroup, type LogEntry, type Macros, type Profile, type Targets } from '../../shared/types.ts';

// --- schemas -------------------------------------------------------------------------

const MACROS = {
  type: 'object',
  properties: Object.fromEntries(['calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar'].map((k) => [k, { type: 'number' }])),
  required: ['calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar'],
};

const FOOD = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'What the user would call it, e.g. "paratha", "masala chai"' },
    grams: { type: 'number', description: 'Portion eaten, in grams (cooked weight for dishes)' },
    food_group: { type: 'string', enum: FOOD_GROUPS },
    ref: { type: 'string', description: 'ref of the lookup_nutrition candidate that matches this food' },
    ingredients: {
      type: 'array',
      description: 'Home recipe instead of ref: raw ingredients (refs from lookup_nutrition) with the grams in this portion',
      items: { type: 'object', properties: { ref: { type: 'string' }, grams: { type: 'number' } }, required: ['ref', 'grams'] },
    },
    estimate: { ...MACROS, description: 'Only when no candidate fits: your best guess for this portion' },
    source_url: { type: 'string', description: 'The web_search result the estimate came from, if any' },
  },
  required: ['name', 'grams', 'food_group'],
};

const SCENE = {
  type: 'object',
  description: 'The doodle, picked from the library in the system prompt',
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          container: { type: 'string', enum: ['plate', 'bowl', 'none'] },
          foods: {
            type: 'array',
            items: { type: 'object', properties: { id: { type: 'string' }, count: { type: 'number' } }, required: ['id'] },
          },
        },
        required: ['container', 'foods'],
      },
    },
  },
  required: ['groups'],
};

const fn = (name: string, description: string, properties: object, required: string[] = []): ToolDef => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
});

const DATE = { type: 'string', description: 'YYYY-MM-DD' };
const MEAL_ID = { type: 'number', description: 'Meal id from the day data' };
const FOOD_ID = { type: 'number', description: 'Food id from the day data' };

export function toolDefs(): ToolDef[] {
  const defs = [
    fn('get_days', 'Read logged meals (with ids), totals and scores for a date range, up to 14 days.', { from: DATE, to: DATE }, [
      'from',
      'to',
    ]),
    fn(
      'lookup_nutrition',
      'Nutrition candidates per 100 g. kind=dish searches cooked dishes first (USDA); kind=ingredient searches Indian raw ingredients first (IFCT 2017). Call once per food, all in the same turn.',
      {
        query: { type: 'string', description: 'Plain English food name, e.g. "paratha", "red gram dal"' },
        kind: { type: 'string', enum: ['dish', 'ingredient'] },
      },
      ['query', 'kind'],
    ),
    fn(
      'add_meal',
      'Log a new meal on a day: everything eaten together, one food per distinct item. Returns its kcal, or errors to fix.',
      {
        date: DATE,
        heading: { type: 'string', description: 'Dish name, e.g. "2 parathas & curd"; for a big mixed meal a label like "Mini lunch"' },
        time: { type: 'string', description: 'HH:MM 24h' },
        note: { type: 'string', description: 'Optional one-liner under 45 characters' },
        foods: { type: 'array', items: FOOD },
        doodle: SCENE,
      },
      ['date', 'heading', 'foods', 'doodle'],
    ),
    fn(
      'update_meal',
      "Change a logged meal's heading, time, note or doodle. Send a new doodle whenever its foods change.",
      {
        date: DATE,
        id: MEAL_ID,
        heading: { type: 'string' },
        time: { type: 'string', description: 'HH:MM 24h' },
        note: { type: 'string' },
        doodle: SCENE,
      },
      ['date', 'id'],
    ),
    fn(
      'remove_meal',
      'Remove a whole logged meal.',
      {
        date: DATE,
        id: MEAL_ID,
        confirmed: {
          type: 'boolean',
          description: 'For a day other than the viewed page: true only if the user named that day or just confirmed',
        },
      },
      ['date', 'id'],
    ),
    fn('add_food', 'Add a food to a logged meal.', { date: DATE, meal_id: MEAL_ID, ...FOOD.properties }, [
      'date',
      'meal_id',
      ...FOOD.required,
    ]),
    fn(
      'update_food',
      'Change the portion of a logged food ("it was 3 rotis, not 2"); its nutrition scales with it.',
      { date: DATE, id: FOOD_ID, grams: { type: 'number', description: 'The new total grams' } },
      ['date', 'id', 'grams'],
    ),
    fn('remove_food', 'Remove one food from a logged meal.', { date: DATE, id: FOOD_ID }, ['date', 'id']),
    fn('update_profile', 'Save profile facts the user just told you. Convert to kg and cm.', {
      age: { type: 'number' },
      sex: { type: 'string', enum: ['male', 'female'] },
      weight_kg: { type: 'number' },
      height_cm: { type: 'number' },
      goal: { type: 'string', enum: ['lose', 'maintain', 'gain'] },
      units: { type: 'string', enum: ['metric', 'imperial'] },
      routine: { type: 'string', description: 'Short summary of their usual day, or "skipped"' },
    }),
    fn(
      'set_targets',
      'Set the daily goals the user asked for (kcal or grams a day). null puts a field back to automatic.',
      Object.fromEntries(['calories', 'protein', 'fiber', 'carbs_min', 'carbs_max'].map((k) => [k, { type: ['number', 'null'] }])),
    ),
    fn(
      'remember',
      'Keep a lasting fact that should shape advice (diet, allergy, injury, event they train for).',
      {
        text: { type: 'string', description: 'Under 120 characters, e.g. "Vegetarian, eats eggs"' },
      },
      ['text'],
    ),
    fn('forget', 'Remove a memory that is no longer true.', { id: { type: 'number' } }, ['id']),
    fn(
      'finish',
      'End your turn with the reply to the user. Always call this last.',
      {
        reply: { type: 'string', description: 'One or two short, warm sentences' },
        suggestions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Up to 3 quick replies written as the user, under 32 characters',
        },
      },
      ['reply'],
    ),
  ];
  if (webSearchEnabled()) {
    defs.splice(
      2,
      0,
      fn(
        'web_search',
        'Search the web for a branded or restaurant food with no good lookup match. At most 2 per message.',
        {
          query: { type: 'string' },
        },
        ['query'],
      ),
    );
  }
  return defs;
}

export const FINISH_ONLY = () => toolDefs().filter((t) => t.function.name === 'finish');

// --- day data ------------------------------------------------------------------------

export function prettyDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function dayData(user: UserRow, date: string) {
  const dayId = findDay(user.id, date);
  const meals = dayId ? listMeals(dayId) : [];
  const r = (n: number) => Math.round(n);
  const totals = sumMacros(meals.map((m) => m.totals));
  const targets = targetsFor(user.profile);
  return {
    date,
    meals: meals.map((m) => ({
      id: m.id,
      heading: m.heading,
      time: m.time,
      foods: m.foods.map((f) => ({ id: f.id, name: f.name, grams: Math.round(f.grams), kcal: r(f.calories) })),
    })),
    ...(meals.length
      ? {
          totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, r(v)])),
          scores: targets ? scoreDay(meals, totals, targets) : undefined,
        }
      : {}),
  };
}

// --- staging ---------------------------------------------------------------------------

interface ResolvedFood {
  name: string;
  grams: number;
  group: FoodGroup;
  macros: Macros;
  source: LogEntry['source'];
  ref: string | null;
  description: string | null;
  ingredients: { ref: string; name: string; grams: number }[] | null;
  sourceUrl: string | null;
}

interface Staged {
  addMeals: { heading: string; time: string; note: string; foods: ResolvedFood[]; doodle?: Scene }[];
  updateMeals: { id: number; heading?: string; time?: string; note?: string; doodle?: Scene }[];
  removeMeals: number[];
  addFoods: (ResolvedFood & { mealId: number })[];
  updateFoods: { id: number; grams: number }[];
  removeFoods: number[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Args = Record<string, any>;

const round1 = (n: number) => Math.round(n * 10) / 10;
const isTime = (t: unknown): t is string => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
const isDate = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
const group = (g: unknown): FoodGroup => ((FOOD_GROUPS as readonly string[]).includes(g as string) ? (g as FoodGroup) : 'other');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export class AgentRun {
  readonly cache = new NutritionCache();
  private saves = new Map<string, Staged>();
  private profile: Args = {};
  private targets: Args | null = null;
  private remembers: string[] = [];
  private forgets: number[] = [];
  private searches = 0;
  finished: { reply: string; suggestions: string[] } | null = null;

  readonly user: UserRow;
  readonly viewedDate: string;
  readonly today: string;
  readonly now: string;
  readonly photoTimes: string[]; // HH:MM of photos taken today

  constructor(user: UserRow, viewedDate: string, today: string, now: string, photoTimes: string[]) {
    this.user = user;
    this.viewedDate = viewedDate;
    this.today = today;
    this.now = now;
    this.photoTimes = photoTimes;
  }

  private get firstDay() {
    return this.user.createdAt.slice(0, 10);
  }

  // Runs one tool call; the result goes back to the model as JSON.
  async call(name: string, args: Args): Promise<unknown> {
    switch (name) {
      case 'get_days':
        return this.getDays(args);
      case 'lookup_nutrition': {
        const query = String(args.query ?? '').slice(0, 80);
        if (!query) return { error: 'query is empty' };
        const candidates = await this.cache.lookup(query, args.kind === 'ingredient' ? 'ingredient' : 'dish');
        return candidates.length ? { candidates } : { candidates: [], hint: 'No match. Try another name, or use an estimate.' };
      }
      case 'web_search':
        if (!webSearchEnabled()) return { error: 'web search is not available' };
        if (++this.searches > 2) return { error: 'search limit reached for this message; use an estimate' };
        return { results: await webSearch(String(args.query ?? '').slice(0, 120)) };
      case 'add_meal':
        return this.saveMeals(args.date, { add_meals: [args] });
      case 'update_meal':
        return this.saveMeals(args.date, { update_meals: [args] });
      case 'remove_meal':
        return this.saveMeals(args.date, { remove_meals: [args.id], confirmed: args.confirmed });
      case 'add_food':
        return this.saveMeals(args.date, { add_foods: [args] });
      case 'update_food':
        return this.saveMeals(args.date, { update_foods: [args] });
      case 'remove_food':
        return this.saveMeals(args.date, { remove_foods: [args.id] });
      case 'update_profile':
        Object.assign(this.profile, args);
        return { ok: true };
      case 'set_targets':
        this.targets = { ...this.targets, ...args };
        return { ok: true };
      case 'remember': {
        const text = String(args.text ?? '')
          .trim()
          .slice(0, 120);
        if (!text) return { error: 'text is empty' };
        if (listMemories(this.user.id).length + this.remembers.length >= 30) return { error: 'memory is full; forget something first' };
        this.remembers.push(text);
        return { ok: true };
      }
      case 'forget':
        this.forgets.push(Number(args.id));
        return { ok: true };
      case 'finish':
        this.finished = {
          reply: String(args.reply ?? '').trim(),
          suggestions: (Array.isArray(args.suggestions) ? args.suggestions : [])
            .filter((x: unknown): x is string => typeof x === 'string' && !!x.trim())
            .map((x: string) => x.trim().slice(0, 40))
            .slice(0, 4),
        };
        return { ok: true };
      default:
        return {
          error: /^(add|update|remove)_(meal|food)s$/.test(name)
            ? `unknown tool ${name}; use ${name.slice(0, -1)}, once per item`
            : `unknown tool ${name}`,
        };
    }
  }

  private checkDate(date: unknown): string | null {
    if (!isDate(date)) return 'date must be YYYY-MM-DD';
    if (date > this.today) return `can't change a future date (today is ${this.today})`;
    if (date < this.firstDay) return `their diary starts on ${this.firstDay}; you can't log before that`;
    return null;
  }

  private getDays(args: Args) {
    const { from, to } = args;
    if (!isDate(from) || !isDate(to) || from > to) return { error: 'from and to must be YYYY-MM-DD, from <= to' };
    const days = [];
    for (let d = new Date(`${from}T12:00:00`); ; d.setDate(d.getDate() + 1)) {
      const date = d.toLocaleDateString('en-CA');
      if (date > to || date > this.today || days.length >= 14) break;
      if (date >= this.firstDay) days.push(dayData(this.user, date));
    }
    return { days };
  }

  private resolveFood(f: Args): ResolvedFood | string {
    const name = String(f.name ?? '')
      .trim()
      .slice(0, 60);
    if (!name) return 'a food has no name';
    let grams = num(f.grams);
    const base = { name, group: group(f.food_group), sourceUrl: null, ingredients: null, ref: null, description: null };

    if (Array.isArray(f.ingredients) && f.ingredients.length) {
      const parts: { ref: string; name: string; grams: number; macros: Macros }[] = [];
      for (const ing of f.ingredients) {
        const hit = this.cache.resolve(String(ing?.ref));
        if (!hit) return `${name}: unknown ingredient ref ${ing?.ref}; look it up first`;
        const g = num(ing.grams);
        if (g <= 0) return `${name}: ingredient ${hit.name} needs grams`;
        parts.push({ ref: hit.ref, name: hit.name, grams: g, macros: scale(hit.per100g, g) });
      }
      // Never lighter than its ingredients (a guessed "1 cup" weight often is).
      grams = Math.max(
        grams,
        parts.reduce((s, p) => s + p.grams, 0),
      );
      return {
        ...base,
        grams,
        macros: sumMacros(parts.map((p) => p.macros)),
        source: 'recipe',
        ingredients: parts.map(({ ref, name, grams }) => ({ ref, name, grams })),
      };
    }
    if (grams <= 0) return `${name}: grams must be more than 0`;
    if (f.ref) {
      const hit = this.cache.resolve(String(f.ref));
      if (hit) return { ...base, grams, macros: scale(hit.per100g, grams), source: hit.source, ref: hit.ref, description: hit.name };
      if (!f.estimate) return `${name}: unknown ref ${f.ref}; use a ref from lookup_nutrition or give an estimate`;
    }
    if (f.estimate && typeof f.estimate === 'object') {
      const e = f.estimate;
      const macros = {
        calories: num(e.calories),
        protein: num(e.protein),
        carbs: num(e.carbs),
        fat: num(e.fat),
        fiber: num(e.fiber),
        sugar: num(e.sugar),
      };
      const url = typeof f.source_url === 'string' && /^https?:\/\//.test(f.source_url) ? f.source_url.slice(0, 300) : null;
      return { ...base, grams, macros, source: url ? 'web' : 'estimate', sourceUrl: url };
    }
    return `${name}: needs a ref from lookup_nutrition, ingredients, or an estimate`;
  }

  // Stages changes to one day; the add_*/update_*/remove_* tools each pass one item.
  private saveMeals(day: unknown, args: Args) {
    const bad = this.checkDate(day);
    if (bad) return { error: bad };
    const date = day as string;
    const dayId = findDay(this.user.id, date);
    const meals = dayId ? listMeals(dayId) : [];
    const mealIds = new Set(meals.map((m) => m.id));
    const foodIds = new Set(meals.flatMap((m) => m.foods.map((f) => f.id)));
    const s: Staged = this.saves.get(date) ?? {
      addMeals: [],
      updateMeals: [],
      removeMeals: [],
      addFoods: [],
      updateFoods: [],
      removeFoods: [],
    };
    const errors: string[] = [];
    const preview: { meal: string; kcal: number }[] = [];
    const list = (v: unknown): Args[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
    const ids = (v: unknown): number[] => (Array.isArray(v) ? v.map(Number).filter(Number.isFinite) : []);

    const removing = ids(args.remove_meals);
    if (removing.length && date !== this.viewedDate && !args.confirmed) {
      errors.push(
        `Removing a whole meal from ${prettyDate(date)} (not the page they're on) needs their OK. Ask them, and offer a quick reply like "Yes, remove it".`,
      );
    } else {
      for (const id of removing) {
        if (mealIds.has(id)) s.removeMeals.push(id);
        else errors.push(`meal ${id} is not on ${date}`);
      }
    }
    for (const id of ids(args.remove_foods)) {
      if (foodIds.has(id)) s.removeFoods.push(id);
      else errors.push(`food ${id} is not on ${date}`);
    }
    for (const u of list(args.update_foods)) {
      const id = Number(u.id);
      const food = meals.flatMap((m) => m.foods).find((f) => f.id === id);
      if (!food || num(u.grams) <= 0) {
        errors.push(`food ${u.id} is not on ${date}, or grams is missing`);
        continue;
      }
      // The same food changed twice in one message: the last change wins.
      s.updateFoods = [...s.updateFoods.filter((x) => x.id !== id), { id, grams: num(u.grams) }];
      preview.push({ meal: `${food.name} → ${Math.round(num(u.grams))} g`, kcal: Math.round((food.calories * num(u.grams)) / food.grams) });
    }
    for (const u of list(args.update_meals)) {
      if (!mealIds.has(Number(u.id))) {
        errors.push(`meal ${u.id} is not on ${date}`);
        continue;
      }
      const id = Number(u.id);
      const prev = s.updateMeals.find((x) => x.id === id);
      const next = {
        id,
        heading: typeof u.heading === 'string' && u.heading.trim() ? u.heading.trim().slice(0, 40) : prev?.heading,
        time: isTime(u.time) ? u.time : prev?.time,
        note: typeof u.note === 'string' ? u.note.slice(0, 60) : prev?.note,
        doodle: u.doodle?.groups ? u.doodle : prev?.doodle,
      };
      s.updateMeals = [...s.updateMeals.filter((x) => x.id !== id), next];
      preview.push({ meal: `${meals.find((m) => m.id === id)!.heading} updated`, kcal: 0 });
    }
    for (const f of list(args.add_foods)) {
      const meal = meals.find((m) => m.id === Number(f.meal_id));
      if (!meal) {
        errors.push(`add_foods: meal ${f.meal_id} is not on ${date}`);
        continue;
      }
      const r = this.resolveFood(f);
      if (typeof r === 'string') errors.push(r);
      else {
        s.addFoods.push({ ...r, mealId: meal.id });
        preview.push({ meal: `${r.name} → ${meal.heading}`, kcal: Math.round(r.macros.calories) });
      }
    }
    for (const m of list(args.add_meals)) {
      const foods: ResolvedFood[] = [];
      for (const f of list(m.foods)) {
        const r = this.resolveFood(f);
        if (typeof r === 'string') errors.push(r);
        else foods.push(r);
      }
      if (!foods.length) continue;
      const fallbackTime = date === this.today ? (this.photoTimes[0] ?? this.now) : '13:00';
      const heading = String(m.heading || foods[0].name).slice(0, 40);
      const time = isTime(m.time) ? m.time : fallbackTime;
      if (s.addMeals.some((x) => x.heading === heading && x.time === time)) {
        errors.push(`${heading} at ${time} is already staged; don't add it twice`);
        continue;
      }
      s.addMeals.push({
        heading,
        time,
        note: typeof m.note === 'string' ? m.note.slice(0, 60) : '',
        foods,
        doodle: m.doodle?.groups ? m.doodle : undefined,
      });
      preview.push({ meal: heading, kcal: Math.round(sumMacros(foods.map((f) => f.macros)).calories) });
    }
    this.saves.set(date, s);
    return { ok: errors.length === 0, staged: preview, ...(errors.length ? { errors } : {}) };
  }

  get hasChanges() {
    return (
      this.saves.size > 0 || Object.keys(this.profile).length > 0 || !!this.targets || this.remembers.length > 0 || this.forgets.length > 0
    );
  }

  // Applies everything staged. Returns one receipt line per change and the dates whose canvas changed.
  async apply(onDrawing?: () => void): Promise<{ notes: string[]; dates: string[] }> {
    const notes: string[] = [];
    const draw: { mealId: number; heading: string; foods: { name: string }[]; doodle?: Scene }[] = [];
    const touched = new Map<string, number>();

    db.exec('BEGIN');
    try {
      for (const [date, s] of this.saves) {
        const dayId = getOrCreateDay(this.user.id, date);
        const meals = listMeals(dayId);
        const foods = new Map(meals.flatMap((m) => m.foods.map((f) => [f.id, f] as const)));
        const on = date === this.viewedDate ? '' : ` on ${prettyDate(date)}`;
        let changed = false;

        for (const id of new Set(s.removeMeals)) {
          db.prepare("UPDATE meals SET deleted_at = datetime('now') WHERE id = ?").run(id);
          db.prepare("UPDATE log_entries SET deleted_at = datetime('now') WHERE meal_id = ?").run(id);
          notes.push(`Removed ${meals.find((m) => m.id === id)?.heading ?? 'a meal'}${on}.`);
          changed = true;
        }
        for (const u of s.updateMeals) {
          const m = meals.find((x) => x.id === u.id)!;
          if (u.heading) db.prepare('UPDATE meals SET heading = ? WHERE id = ?').run(u.heading, u.id);
          if (u.time) db.prepare('UPDATE meals SET eaten_at = ? WHERE id = ?').run(u.time, u.id);
          if (u.note !== undefined) db.prepare('UPDATE meals SET note = ? WHERE id = ?').run(u.note, u.id);
          if (u.doodle) draw.push({ mealId: u.id, heading: u.heading ?? m.heading, foods: m.foods, doodle: u.doodle });
          changed = true;
        }
        for (const id of new Set(s.removeFoods)) {
          db.prepare("UPDATE log_entries SET deleted_at = datetime('now') WHERE id = ?").run(id);
          notes.push(`Removed ${foods.get(id)!.name}${on}.`);
          changed = true;
        }
        for (const u of s.updateFoods) {
          const e = foods.get(u.id)!;
          const k = u.grams / e.grams;
          db.prepare(
            'UPDATE log_entries SET grams = ?, calories = ?, protein = ?, carbs = ?, fat = ?, fiber = ?, sugar = ? WHERE id = ?',
          ).run(u.grams, e.calories * k, e.protein * k, e.carbs * k, e.fat * k, e.fiber * k, e.sugar * k, e.id);
          notes.push(`Updated ${e.name} to ${Math.round(u.grams)} g (${Math.round(e.calories * k)} kcal).`);
          changed = true;
        }
        for (const f of s.addFoods) {
          insertFood(dayId, f.mealId, f);
          notes.push(`Added ${f.name} (${Math.round(f.macros.calories)} kcal) to ${meals.find((m) => m.id === f.mealId)!.heading}${on}.`);
          changed = true;
        }
        for (const m of s.addMeals) {
          const { lastInsertRowid } = db
            .prepare('INSERT INTO meals (day_id, heading, eaten_at, note, doodle_json) VALUES (?, ?, ?, ?, ?)')
            .run(dayId, m.heading, m.time, m.note, JSON.stringify({ svg: '' }));
          for (const f of m.foods) insertFood(dayId, Number(lastInsertRowid), f);
          draw.push({ mealId: Number(lastInsertRowid), heading: m.heading, foods: m.foods, doodle: m.doodle });
          notes.push(`Logged ${m.heading}${on} at ${m.time}, ${Math.round(sumMacros(m.foods.map((f) => f.macros)).calories)} kcal.`);
          changed = true;
        }
        if (changed) touched.set(date, dayId);
      }

      applyProfileAndTargets(this.user, this.profile, this.targets, notes);

      for (const id of new Set(this.forgets)) {
        const text = forgetMemory(this.user.id, id);
        if (text) notes.push(`Forgot: ${text}.`);
      }
      for (const text of this.remembers) {
        addMemory(this.user.id, text);
        notes.push(`Remembered: ${text.replace(/\.$/, '')}.`);
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    // Doodles after the commit: a slow or failed drawing never loses the log itself.
    if (draw.length) onDrawing?.();
    await Promise.all(
      draw.map(async (d) => {
        const svg = await drawMeal(d.heading, d.foods, d.doodle).catch((err) => {
          console.warn('drawing failed', err);
          return null;
        });
        if (svg) db.prepare('UPDATE meals SET doodle_json = ? WHERE id = ?').run(JSON.stringify(svg), d.mealId);
      }),
    );
    for (const dayId of touched.values()) saveCanvas(dayId, buildCanvas(listMeals(dayId)));
    return { notes, dates: [...touched.keys()] };
  }
}

function insertFood(dayId: number, mealId: number, f: ResolvedFood) {
  const m = f.macros;
  db.prepare(
    `INSERT INTO log_entries (day_id, meal_id, name, grams, calories, protein, carbs, fat, fiber, sugar, food_group,
       source, usda_fdc_id, usda_description, ref, ingredients_json, source_url, sketch_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]')`,
  ).run(
    dayId,
    mealId,
    f.name,
    f.grams,
    round1(m.calories),
    round1(m.protein),
    round1(m.carbs),
    round1(m.fat),
    round1(m.fiber),
    round1(m.sugar),
    f.group,
    f.source,
    f.ref?.startsWith('usda:') ? Number(f.ref.slice(5)) : null,
    f.description,
    f.ref,
    f.ingredients ? JSON.stringify(f.ingredients) : null,
    f.sourceUrl,
  );
}

// Library doodles when every food is in the library; otherwise the model draws it.
async function drawMeal(heading: string, foods: { name: string }[], doodle: Scene | undefined): Promise<{ svg: string }> {
  const groups = (doodle?.groups ?? []).filter((g) => g.foods?.length);
  if (groups.length && groups.every((g) => g.foods.every((f) => PARTS[f.id]))) {
    return { svg: compose({ groups: groups.map(({ container, foods }) => ({ container, foods })) }).svg };
  }
  return { svg: await drawDoodle(`${heading}: ${foods.map((f) => f.name).join(', ')}`) };
}

// Saves profile facts and the user's own daily targets; adds a receipt line for each change.
function applyProfileAndTargets(user: UserRow, p: Args, targets: Args | null, notes: string[]) {
  const update: Partial<Profile> = {};
  if (p.age && p.age > 5 && p.age < 120) update.age = Math.round(p.age);
  if (p.sex === 'male' || p.sex === 'female') update.sex = p.sex;
  if (p.weight_kg && p.weight_kg > 20 && p.weight_kg < 400) update.weightKg = round1(p.weight_kg);
  if (p.height_cm && p.height_cm > 80 && p.height_cm < 250) update.heightCm = Math.round(p.height_cm);
  if (p.goal === 'lose' || p.goal === 'maintain' || p.goal === 'gain') update.goal = p.goal;
  if (p.units === 'metric' || p.units === 'imperial') update.units = p.units;
  if (typeof p.routine === 'string' && p.routine.trim()) update.routine = p.routine.trim().slice(0, 300);
  if (Object.keys(update).length) {
    updateProfile(user.id, update);
    const merged = { ...user.profile, ...update };
    const said: string[] = [];
    if (update.weightKg && update.weightKg !== user.profile.weightKg) said.push(`weight ${update.weightKg} kg`);
    if (update.heightCm && update.heightCm !== user.profile.heightCm) said.push(`height ${update.heightCm} cm`);
    if (update.age && update.age !== user.profile.age) said.push(`age ${update.age}`);
    if (update.goal && update.goal !== user.profile.goal) said.push(`goal: ${update.goal} weight`);
    if (said.length && profileComplete(user.profile)) notes.push(`Updated your profile: ${said.join(', ')}.`);
    if (update.routine && update.routine !== 'skipped' && update.routine !== user.profile.routine)
      notes.push(`Updated your routine: ${update.routine}.`);
    if (!profileComplete(user.profile) && profileComplete(merged)) {
      const t = targetsFor(merged)!;
      notes.push(
        `Your daily targets: ${t.calories} kcal, protein ${t.protein} g, fiber ${t.fiber} g, carbs ${t.carbsMin}–${t.carbsMax} g. Ask me anytime to change them.`,
      );
    }
  }

  if (targets) {
    const keys = { calories: 'calories', protein: 'protein', fiber: 'fiber', carbs_min: 'carbsMin', carbs_max: 'carbsMax' } as const;
    const limits = { calories: [800, 6000], protein: [10, 400], fiber: [5, 120], carbsMin: [0, 900], carbsMax: [20, 1000] } as const;
    const custom: Partial<Targets> = { ...user.profile.customTargets };
    const changed: string[] = [];
    for (const [from, to] of Object.entries(keys)) {
      if (!(from in targets)) continue;
      const v = targets[from];
      const unit = to === 'calories' ? ' kcal' : ' g';
      const name = to === 'carbsMin' ? 'minimum carbs' : to === 'carbsMax' ? 'maximum carbs' : to;
      if (v === null) {
        if (to in custom) {
          delete custom[to];
          changed.push(`${name} back to automatic`);
        }
      } else if (typeof v === 'number' && v >= limits[to][0] && v <= limits[to][1]) {
        custom[to] = Math.round(v);
        changed.push(`${name} to ${Math.round(v)}${unit} a day`);
      }
    }
    if (changed.length) {
      setCustomTargets(user.id, custom);
      notes.push(`Updated your target: ${changed.join(', ')}.`);
    }
  }
}

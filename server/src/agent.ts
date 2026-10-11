// The Fitbook agent: turns a chat message (and optional photo) into meal changes,
// profile updates and doodles. The canvas is rebuilt from the database afterwards.
import { db, listMeals, listMessages, setCustomTargets, sumMacros, updateProfile, type UserRow } from './db.ts';
import { chatJson, chatText, MODEL } from './deepseek.ts';
import { searchFood } from './usda.ts';
import { PARTS } from './doodle/parts.ts';
import { compose, type Scene } from './doodle/compose.ts';
import { drawDoodle } from './doodle/draw.ts';
import { profileComplete, scoreDay, targetsFor } from './scores.ts';
import { FOOD_GROUPS, type FoodGroup, type Macros, type Profile, type Targets } from '../../shared/types.ts';

interface PlannedFood {
  name: string;
  usda_query?: string;
  grams: number;
  food_group?: string;
  estimate?: Partial<Macros>;
}

interface Plan {
  reply: string;
  suggestions?: string[];
  profile?: { age?: number; sex?: string; weight_kg?: number; height_cm?: number; goal?: string; units?: string; routine?: string };
  targets?: {
    calories?: number | null;
    protein?: number | null;
    fiber?: number | null;
    carbs_min?: number | null;
    carbs_max?: number | null;
  };
  add_meals?: { heading: string; time?: string; note?: string; foods: PlannedFood[]; doodle?: Scene }[];
  update_meals?: { id: number; heading?: string; time?: string; note?: string; doodle?: Scene }[];
  add_foods?: (PlannedFood & { meal_id: number })[];
  remove_meals?: number[];
  update_foods?: { id: number; grams: number }[];
  remove_foods?: number[];
}

const LIBRARY = Object.entries(PARTS)
  .map(([id, p]) => `${id} (${p.kind === 'fill' ? 'bowl contents' : p.kind})`)
  .join(', ');

const PLANNER_PROMPT = `You are Fitbook, a friendly food-logging assistant and a light nutrition coach. The user tells you
what they ate, or sends a photo (you get a text description of it). You keep the day's log as meals, each made of foods.
They can also ask you how their day is going, what to eat next, or to change their goals.

Respond with JSON only:
{
  "reply": "one or two short, warm sentences. When logging, do NOT include calorie or macro numbers (the app shows them).",
  "suggestions": ["optional: up to 3 short quick replies the user might tap next, written as them, under 32 characters"],
  "profile": {"age": 30, "sex": "male" | "female", "weight_kg": 70, "height_cm": 175, "goal": "lose" | "maintain" | "gain", "units": "metric" | "imperial", "routine": "short summary of their usual day"},
  "targets": {"calories": 2200, "protein": 120, "fiber": 30, "carbs_min": 250, "carbs_max": 320},
  "add_meals": [{
    "heading": "dish name, e.g. Chicken sandwich or 2 parathas & curd; for a big mixed meal a label like Mini lunch or Large dessert",
    "time": "HH:MM 24h",
    "note": "optional one-liner under 45 characters, e.g. Good protein, light on veggies",
    "foods": [{"name": "paratha", "usda_query": "paratha", "grams": 160, "food_group": "one of ${FOOD_GROUPS.join(', ')}",
               "estimate": {"calories": 0, "protein": 0, "carbs": 0, "fat": 0, "fiber": 0, "sugar": 0}}],
    "doodle": {"groups": [{"container": "plate", "foods": [{"id": "paratha", "count": 2}]}, {"container": "bowl", "foods": [{"id": "curd"}]}]}
  }],
  "update_meals": [{"id": 1, "heading": "...", "time": "HH:MM", "note": "...", "doodle": {"groups": [{"container": "plate", "foods": [{"id": "rice"}]}]}}],
  "remove_meals": [meal ids],
  "add_foods": [{"meal_id": 1, "name": "...", "usda_query": "...", "grams": 100, "food_group": "tea_coffee", "estimate": {"calories": 5, "protein": 0, "carbs": 1, "fat": 0, "fiber": 0, "sugar": 0}}],
  "update_foods": [{"id": 1, "grams": 120}],
  "remove_foods": [food ids]
}

Rules:
- Everything eaten together is ONE meal with one food per distinct item. Use realistic portions in grams if none are given.
- "estimate" is your best guess of the nutrition for that portion, used only if the database has no match.
- "time": the time the user mentions; else the photo time if given; else the current time.
- The user often refers to a logged meal by its name, a food in it, its time ("the 1pm one") or the time of day
  (breakfast is before 11:00, lunch 11:00-16:00, snacks in between, dinner after 18:00), or as "last"/"that".
  Match it to the right id in today's log and use update_meals, add_foods, update_foods, remove_foods or remove_meals.
  "Add a coffee to my breakfast" → add_foods into that meal; "it was 2 rotis not 3" → update_foods grams;
  "move lunch to 2pm" → update_meals time; "rename it" → update_meals heading.
  Whenever the foods of a meal change, also send an updated "doodle" for that meal in update_meals.
- Ask before guessing when it matters: if the user is vague ("had lunch", "some snacks", "a drink") and there is no photo,
  or when a reference to a logged meal is ambiguous, ask ONE short, friendly follow-up question in "reply"
  (e.g. "Nice! What did lunch have in it?") and leave the arrays empty. If the food is clear but the portion is not, log a
  typical portion and mention you assumed it. Don't ask more than once in a row about the same thing.
- "doodle" picks pictures from this library: ${LIBRARY}.
  At most one plate and two bowls. Solid foods go on the plate; curries, dals, curd, chutneys and porridge go in a bowl
  (toppings like fruit slices or nuts can share the bowl; whole fruits can share a bowl). Only key ingredients.
  If a food has no matching doodle, use the id "other".
- "routine": when they describe their usual day (wake, meal, workout, work or sleep times), save a short summary in their
  words, e.g. "Up 6:30, gym Mon/Wed/Fri 7am, office 10-7, lunch ~1:30, dinner ~9, sleep 11:30". If they skip it, save "skipped".
  Use their routine to read meal times ("lunch" means their usual lunch time) and to time suggestions.
- "profile": include only fields the user just told you, converted to kg and cm exactly
  (1 ft = 30.48 cm, 1 in = 2.54 cm, so 5 ft 4 in = 163 cm; 1 lb = 0.4536 kg).
- "targets": only when the user sets their own DAILY goal for calories, protein, fiber or carbs ("I want 120 g protein a day",
  "set my calories to 2000"). Include only the fields they named, as daily numbers in kcal or grams. Use null for a field to
  go back to the automatic value ("use the normal protein target"). Saving it is what changes their goal, so don't just promise to remember it.
- Light coaching: when they ask how they're doing or what to eat, answer from today's totals, scores and targets, with real
  numbers and one concrete food idea. After logging a meal, add at most ONE short tip, and only when something is clearly off
  (e.g. very low protein so far). Most of the time just confirm the log. Never lecture, never message first.
- "suggestions": use them during setup (the likely answers) and when a quick follow-up is natural; otherwise leave empty.
- If the message is not about food, answer it in "reply" and leave the arrays empty. Stay on food, fitness and health.`;

const SETUP = `Their profile is not set up yet. Alongside logging any food they mention, set it up as a friendly chat:
ONE question per message, in this order, skipping anything already known: units they prefer (kg · cm or lb · ft),
age, height, weight, which formula to use for energy needs (female or male; they can skip), goal (lose, maintain or gain weight).
Put the likely answers in "suggestions" (e.g. ["kg · cm", "lb · ft"] or ["Lose weight", "Maintain", "Gain weight"]).
Units come first unless they already answered in the chat. Accept answers in any format and convert them.
If they skip something optional, move on. When the goal (the last required piece) arrives, say their targets are ready (don't state numbers; the app adds them),
then ask ONE optional question: their usual daily routine (wake and sleep time, meal times, workout days, work hours), so
you can fit tips around their day. Make it clearly optional, with suggestions like ["Skip for now", "Up 7, office 9-6, gym evenings"].
After they answer or skip, welcome them and say they can now tell you what they ate.`;

export async function describePhoto(dataUrl: string): Promise<string> {
  return chatText(MODEL, [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'List each food or drink in this photo with an estimated portion in grams, one per line, e.g. "chicken sandwich on white bread, about 200 g". If there is no food, say what the photo shows.',
        },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    },
  ]);
}

// Library doodles when every food is in the library; otherwise the model draws it.
async function drawMeal(heading: string, foods: PlannedFood[], doodle: Scene | undefined): Promise<{ svg: string }> {
  const groups = (doodle?.groups ?? []).filter((g) => g.foods?.length);
  if (groups.length && groups.every((g) => g.foods.every((f) => PARTS[f.id]))) {
    return { svg: compose({ groups: groups.map(({ container, foods }) => ({ container, foods })) }).svg };
  }
  return { svg: await drawDoodle(`${heading}: ${foods.map((f) => f.name).join(', ')}`) };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const isTime = (t: unknown): t is string => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
const group = (g: unknown): FoodGroup => ((FOOD_GROUPS as readonly string[]).includes(g as string) ? (g as FoodGroup) : 'other');

async function nutritionFor(f: PlannedFood) {
  const grams = f.grams > 0 ? f.grams : 100;
  const match = await searchFood(f.usda_query || f.name).catch(() => null);
  const est = f.estimate ?? {};
  const macros: Macros = match
    ? (Object.fromEntries(Object.entries(match.per100g).map(([k, v]) => [k, (v * grams) / 100])) as unknown as Macros)
    : {
        calories: est.calories ?? 0,
        protein: est.protein ?? 0,
        carbs: est.carbs ?? 0,
        fat: est.fat ?? 0,
        fiber: est.fiber ?? 0,
        sugar: est.sugar ?? 0,
      };
  return { f, grams, match, macros };
}

function insertFood(dayId: number, mealId: number, { f, grams, match, macros }: Awaited<ReturnType<typeof nutritionFor>>) {
  db.prepare(
    `INSERT INTO log_entries (day_id, meal_id, name, grams, calories, protein, carbs, fat, fiber, sugar, food_group,
       source, usda_fdc_id, usda_description, sketch_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]')`,
  ).run(
    dayId,
    mealId,
    f.name,
    grams,
    round1(macros.calories),
    round1(macros.protein),
    round1(macros.carbs),
    round1(macros.fat),
    round1(macros.fiber),
    round1(macros.sugar),
    group(f.food_group),
    match ? 'usda' : 'estimate',
    match?.fdcId ?? null,
    match?.description ?? null,
  );
}

export interface AgentInput {
  user: UserRow;
  dayId: number;
  text: string | null; // null: the user just opened the chat for the first time
  photoDescription: string | null;
  now: string; // HH:MM, user's local time
  photoTime: string | null;
}

type ProfilePlan = Pick<Plan, 'profile' | 'targets'>;

// Saves profile facts and the user's own daily targets from a plan; adds a note for each change.
function applyProfileAndTargets(user: UserRow, plan: ProfilePlan, notes: string[]) {
  if (plan.profile) {
    const p = plan.profile;
    const update: Partial<Profile> = {};
    if (p.age && p.age > 5 && p.age < 120) update.age = Math.round(p.age);
    if (p.sex === 'male' || p.sex === 'female') update.sex = p.sex;
    if (p.weight_kg && p.weight_kg > 20 && p.weight_kg < 400) update.weightKg = round1(p.weight_kg);
    if (p.height_cm && p.height_cm > 80 && p.height_cm < 250) update.heightCm = Math.round(p.height_cm);
    if (p.goal === 'lose' || p.goal === 'maintain' || p.goal === 'gain') update.goal = p.goal;
    if (p.units === 'metric' || p.units === 'imperial') update.units = p.units;
    if (typeof p.routine === 'string' && p.routine.trim()) update.routine = p.routine.trim().slice(0, 300);
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

  // Daily goals the user set themselves.
  if (plan.targets && typeof plan.targets === 'object') {
    const keys = { calories: 'calories', protein: 'protein', fiber: 'fiber', carbs_min: 'carbsMin', carbs_max: 'carbsMax' } as const;
    const limits = { calories: [800, 6000], protein: [10, 400], fiber: [5, 120], carbsMin: [0, 900], carbsMax: [20, 1000] } as const;
    const custom: Partial<Targets> = { ...user.profile.customTargets };
    const changed: string[] = [];
    for (const [from, to] of Object.entries(keys)) {
      if (!(from in plan.targets)) continue;
      const v = (plan.targets as Record<string, number | null | undefined>)[from];
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

export async function runAgent({
  user,
  dayId,
  text,
  photoDescription,
  now,
  photoTime,
}: AgentInput): Promise<{ reply: string; suggestions: string[] }> {
  const meals = listMeals(dayId);
  const log = meals.map((m) => ({
    id: m.id,
    heading: m.heading,
    time: m.time,
    foods: m.foods.map((f) => ({ id: f.id, name: f.name, grams: f.grams })),
  }));

  const missing = (['age', 'weightKg', 'heightCm', 'goal'] as const).filter((k) => !user.profile[k]);
  // Recent chat, so answers to a follow-up question make sense. The newest message is the current one.
  const history = listMessages(dayId)
    .slice(text === null ? -8 : -9, text === null ? undefined : -1)
    .map((m) => `${m.role === 'user' ? 'User' : 'You'}: ${m.text}`);
  const parts = [`Today's log: ${JSON.stringify(log)}`, `Current time: ${now}`];
  if (history.length) parts.push(`Recent chat:\n${history.join('\n')}`);
  const routine = user.profile.routine;
  if (routine && routine !== 'skipped') parts.push(`Their usual routine: ${routine}`);
  else if (!missing.length && routine === null) {
    parts.push(
      'Their routine is not set. If they just answered your routine question, save it in "profile.routine" (or "skipped"). Do not ask for it otherwise.',
    );
  }
  if (!missing.length) {
    const t = targetsFor(user.profile)!;
    const own = Object.keys(user.profile.customTargets);
    parts.push(
      `Profile: ${JSON.stringify({ ...user.profile, customTargets: undefined, theme: undefined, routine: undefined })}. If the user says something changed (weight, goal…), put it in "profile".`,
      `Current daily targets: ${t.calories} kcal, protein ${t.protein} g, fiber ${t.fiber} g, carbs ${t.carbsMin}-${t.carbsMax} g` +
        (own.length ? ` (set by the user: ${own.join(', ')}; the rest are automatic).` : ' (all automatic, from the profile).'),
    );
    if (meals.length) {
      const totals = sumMacros(meals.map((m) => m.totals));
      const r = (n: number) => Math.round(n);
      parts.push(
        `So far today: ${r(totals.calories)} kcal, protein ${r(totals.protein)} g, carbs ${r(totals.carbs)} g, fat ${r(totals.fat)} g, ` +
          `fiber ${r(totals.fiber)} g, sugar ${r(totals.sugar)} g. Scores out of 10: ${JSON.stringify(scoreDay(meals, totals, t))}.`,
      );
    }
  }
  if (missing.length) {
    parts.push(`Profile so far: ${JSON.stringify(user.profile)}. Still missing: ${missing.join(', ')}. ` + SETUP);
  }
  if (photoDescription) parts.push(`The user sent a photo${photoTime ? ` taken at ${photoTime}` : ''}. It shows:\n${photoDescription}`);
  parts.push(
    text === null
      ? `The user just opened Fitbook for the first time.${user.name ? ` Their name is ${user.name}.` : ''} Greet them by first name, say in one line that you log their meals, sketch them and keep them on track, and ask the first setup question. Leave the meal arrays empty.`
      : `User message: ${text || '(no text, just the photo)'}`,
  );

  const plan = await chatJson<Plan>(MODEL, [
    { role: 'system', content: PLANNER_PROMPT },
    { role: 'user', content: parts.join('\n\n') },
  ]);

  const notes: string[] = [];

  applyProfileAndTargets(user, plan, notes);

  const mealIds = new Set(meals.map((m) => m.id));
  const foods = new Map(meals.flatMap((m) => m.foods.map((f) => [f.id, f] as const)));

  for (const id of plan.remove_meals ?? []) {
    if (!mealIds.has(id)) continue;
    db.prepare("UPDATE meals SET deleted_at = datetime('now') WHERE id = ?").run(id);
    db.prepare("UPDATE log_entries SET deleted_at = datetime('now') WHERE meal_id = ?").run(id);
    notes.push(`Removed ${meals.find((m) => m.id === id)!.heading}.`);
  }
  for (const u of plan.update_meals ?? []) {
    if (!mealIds.has(u.id)) continue;
    if (u.doodle) {
      const m = meals.find((x) => x.id === u.id)!;
      const svg = await drawMeal(
        u.heading ?? m.heading,
        m.foods.map((f) => ({ name: f.name, grams: f.grams })),
        u.doodle,
      ).catch(() => null);
      if (svg?.svg) db.prepare('UPDATE meals SET doodle_json = ? WHERE id = ?').run(JSON.stringify(svg), u.id);
    }
    if (u.heading) db.prepare('UPDATE meals SET heading = ? WHERE id = ?').run(u.heading.slice(0, 40), u.id);
    if (isTime(u.time)) db.prepare('UPDATE meals SET eaten_at = ? WHERE id = ?').run(u.time, u.id);
    if (typeof u.note === 'string') db.prepare('UPDATE meals SET note = ? WHERE id = ?').run(u.note.slice(0, 60), u.id);
  }
  for (const id of plan.remove_foods ?? []) {
    const f = foods.get(id);
    if (!f) continue;
    db.prepare("UPDATE log_entries SET deleted_at = datetime('now') WHERE id = ?").run(id);
    notes.push(`Removed ${f.name}.`);
  }
  for (const u of plan.update_foods ?? []) {
    const e = foods.get(u.id);
    if (!e || !(u.grams > 0)) continue;
    const k = u.grams / e.grams;
    db.prepare('UPDATE log_entries SET grams = ?, calories = ?, protein = ?, carbs = ?, fat = ?, fiber = ?, sugar = ? WHERE id = ?').run(
      u.grams,
      e.calories * k,
      e.protein * k,
      e.carbs * k,
      e.fat * k,
      e.fiber * k,
      e.sugar * k,
      e.id,
    );
    notes.push(`Updated ${e.name} to ${Math.round(u.grams)} g (${Math.round(e.calories * k)} kcal).`);
  }

  for (const f of plan.add_foods ?? []) {
    if (!mealIds.has(f.meal_id) || !f.name) continue;
    const n = await nutritionFor(f);
    insertFood(dayId, f.meal_id, n);
    notes.push(`Added ${f.name} (${Math.round(n.macros.calories)} kcal) to ${meals.find((m) => m.id === f.meal_id)!.heading}.`);
  }

  for (const meal of plan.add_meals ?? []) {
    const planned = (meal.foods ?? []).filter((f) => f?.name);
    if (!planned.length) continue;
    const [doodle, ...nutrition] = await Promise.all([
      drawMeal(meal.heading, planned, meal.doodle).catch((err) => {
        console.warn('drawing failed', err);
        return { svg: '' };
      }),
      ...planned.map(nutritionFor),
    ]);
    const time = isTime(meal.time) ? meal.time : (photoTime ?? now);
    const { lastInsertRowid } = db
      .prepare('INSERT INTO meals (day_id, heading, eaten_at, note, doodle_json) VALUES (?, ?, ?, ?, ?)')
      .run(dayId, (meal.heading || planned[0].name).slice(0, 40), time, (meal.note ?? '').slice(0, 60), JSON.stringify(doodle));
    let kcal = 0;
    for (const n of nutrition) {
      kcal += n.macros.calories;
      insertFood(dayId, Number(lastInsertRowid), n);
    }
    notes.push(`Logged ${meal.heading} at ${time}, ${Math.round(kcal)} kcal.`);
  }

  const suggestions = (Array.isArray(plan.suggestions) ? plan.suggestions : [])
    .filter((x): x is string => typeof x === 'string' && !!x.trim())
    .map((x) => x.trim().slice(0, 40))
    .slice(0, 4);
  return { reply: [plan.reply, ...notes].filter(Boolean).join('\n'), suggestions };
}

const TIPS_PROMPT = `You are Fitbook's nutrition coach. Given today's meals, totals, targets and scores (out of 10),
write at most 2 tips to improve the rest of the day. Each tip is ONE short line, under 12 words, naming a real food
(Indian staples welcome), e.g. "• Add a bowl of dal at dinner for protein."
If the scores are good (overall 7 or more), write one short line of encouragement instead.
Plain text, each line starting with "• ". No numbers to calculate. No medical claims.
Output JSON: {"tips": "..."}`;

export async function writeTips(context: unknown): Promise<string> {
  const out = await chatJson<{ tips?: string }>(MODEL, [
    { role: 'system', content: TIPS_PROMPT },
    { role: 'user', content: JSON.stringify(context) },
  ]);
  return String(out.tips ?? '')
    .trim()
    .slice(0, 240);
}

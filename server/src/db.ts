import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  THEMES,
  type Canvas,
  type ChatMessage,
  type FoodGroup,
  type LogEntry,
  type Macros,
  type Meal,
  type Profile,
  type StrokeItem,
  type Targets,
} from '../../shared/types.ts';

// Older entries hold pen strokes; newer ones hold a coloured doodle.
export type Sketch = StrokeItem[] | { svg: string };

const DB_PATH = process.env.FITBOOK_DB ?? resolve(import.meta.dirname, '../../data/fitbook.db');
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

// Migrations run in order; user_version records how many have been applied.
const MIGRATIONS = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE days (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    date TEXT NOT NULL,
    UNIQUE (user_id, date)
  );
  CREATE TABLE canvas_versions (
    id INTEGER PRIMARY KEY,
    day_id INTEGER NOT NULL REFERENCES days(id),
    version INTEGER NOT NULL,
    canvas_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (day_id, version)
  );
  CREATE TABLE log_entries (
    id INTEGER PRIMARY KEY,
    day_id INTEGER NOT NULL REFERENCES days(id),
    kind TEXT NOT NULL DEFAULT 'food',
    name TEXT NOT NULL,
    grams REAL NOT NULL,
    calories REAL NOT NULL,
    protein REAL NOT NULL,
    carbs REAL NOT NULL,
    fat REAL NOT NULL,
    source TEXT NOT NULL,
    usda_fdc_id INTEGER,
    usda_description TEXT,
    sketch_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
  );
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY,
    day_id INTEGER NOT NULL REFERENCES days(id),
    role TEXT NOT NULL,
    text TEXT NOT NULL,
    photo_path TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  // v2: meals group foods; profiles; tips cache; Firebase uid.
  `
  ALTER TABLE users ADD COLUMN uid TEXT;
  ALTER TABLE users ADD COLUMN name TEXT;
  ALTER TABLE users ADD COLUMN age INTEGER;
  ALTER TABLE users ADD COLUMN sex TEXT;
  ALTER TABLE users ADD COLUMN weight_kg REAL;
  ALTER TABLE users ADD COLUMN height_cm REAL;
  ALTER TABLE users ADD COLUMN goal TEXT;
  ALTER TABLE users ADD COLUMN units TEXT NOT NULL DEFAULT 'metric';
  CREATE UNIQUE INDEX users_uid ON users(uid);
  ALTER TABLE days ADD COLUMN tips_text TEXT;
  ALTER TABLE days ADD COLUMN tips_version INTEGER;
  CREATE TABLE meals (
    id INTEGER PRIMARY KEY,
    day_id INTEGER NOT NULL REFERENCES days(id),
    heading TEXT NOT NULL,
    eaten_at TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    doodle_json TEXT NOT NULL,
    legacy_entry_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
  );
  ALTER TABLE log_entries ADD COLUMN meal_id INTEGER REFERENCES meals(id);
  ALTER TABLE log_entries ADD COLUMN fiber REAL NOT NULL DEFAULT 0;
  ALTER TABLE log_entries ADD COLUMN sugar REAL NOT NULL DEFAULT 0;
  ALTER TABLE log_entries ADD COLUMN food_group TEXT NOT NULL DEFAULT 'other';
  INSERT INTO meals (day_id, heading, eaten_at, doodle_json, legacy_entry_id, created_at, deleted_at)
    SELECT day_id, name, strftime('%H:%M', created_at, 'localtime'), sketch_json, id, created_at, deleted_at FROM log_entries;
  UPDATE log_entries SET meal_id = (SELECT id FROM meals WHERE legacy_entry_id = log_entries.id);
  `,
  // v3: app theme per user.
  `ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT 'paper';`,
  // v4: the app tour is shown once per person.
  `ALTER TABLE users ADD COLUMN guide_seen INTEGER NOT NULL DEFAULT 0;`,
  // v5: daily targets the user set themselves, as JSON.
  `ALTER TABLE users ADD COLUMN custom_targets TEXT NOT NULL DEFAULT '{}';`,
  // v6: quick replies offered with an assistant message, as JSON.
  `ALTER TABLE messages ADD COLUMN suggestions_json TEXT NOT NULL DEFAULT '[]';`,
  // v7: the user's usual daily routine, optional.
  `ALTER TABLE users ADD COLUMN routine TEXT;`,
  // v8: one chat thread per user (day_id is now the day that was open); several photos per message;
  // coach memory; where each food's numbers came from.
  `
  ALTER TABLE messages ADD COLUMN user_id INTEGER REFERENCES users(id);
  ALTER TABLE messages ADD COLUMN viewed_date TEXT;
  ALTER TABLE messages ADD COLUMN photos_json TEXT NOT NULL DEFAULT '[]';
  UPDATE messages SET
    user_id = (SELECT user_id FROM days WHERE days.id = messages.day_id),
    viewed_date = (SELECT date FROM days WHERE days.id = messages.day_id);
  UPDATE messages SET photos_json = json_array(photo_path) WHERE photo_path IS NOT NULL;
  CREATE INDEX messages_user ON messages(user_id, id);
  CREATE TABLE memories (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
  );
  ALTER TABLE log_entries ADD COLUMN ref TEXT;
  ALTER TABLE log_entries ADD COLUMN ingredients_json TEXT;
  ALTER TABLE log_entries ADD COLUMN source_url TEXT;
  `,
];

export function migrate() {
  const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let i = user_version; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    db.exec(MIGRATIONS[i]);
    db.exec(`PRAGMA user_version = ${i + 1}`);
    db.exec('COMMIT');
    console.log(`migration ${i + 1} applied`);
  }
}

// --- users -------------------------------------------------------------------

export interface UserRow {
  id: number;
  email: string;
  name: string | null;
  createdAt: string;
  guideSeen: boolean;
  profile: Profile;
}

function parseTargets(json: string | null): Partial<Targets> {
  try {
    const t = JSON.parse(json ?? '{}');
    return t && typeof t === 'object' ? t : {};
  } catch {
    return {};
  }
}

export function setCustomTargets(userId: number, t: Partial<Targets>) {
  db.prepare('UPDATE users SET custom_targets = ? WHERE id = ?').run(JSON.stringify(t), userId);
}

// A raw SQLite row; each one is mapped to a typed shape straight away.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

function toUser(r: Row): UserRow {
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    createdAt: r.created_at,
    guideSeen: !!r.guide_seen,
    profile: {
      age: r.age,
      sex: r.sex,
      weightKg: r.weight_kg,
      heightCm: r.height_cm,
      goal: r.goal,
      units: r.units === 'imperial' ? 'imperial' : 'metric',
      theme: (THEMES as readonly string[]).includes(r.theme) ? r.theme : 'paper',
      customTargets: parseTargets(r.custom_targets),
      routine: r.routine ?? null,
    },
  };
}

// Finds the user by Firebase uid, else by verified email (this is how pre-sign-in
// data moves to its owner), else creates them.
export function upsertUser(uid: string, email: string, name: string | null): UserRow {
  let row = db.prepare('SELECT * FROM users WHERE uid = ?').get(uid) as Row | undefined;
  if (!row) {
    const byEmail = db.prepare('SELECT * FROM users WHERE email = ? AND uid IS NULL').get(email) as Row | undefined;
    if (byEmail) db.prepare('UPDATE users SET uid = ? WHERE id = ?').run(uid, byEmail.id);
    else db.prepare('INSERT INTO users (uid, email, name) VALUES (?, ?, ?)').run(uid, email, name);
    row = db.prepare('SELECT * FROM users WHERE uid = ?').get(uid) as Row;
  }
  if (name && row.name !== name) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, row.id);
  return toUser({ ...row, name: name ?? row.name });
}

export function getUserByEmail(email: string): UserRow {
  db.prepare('INSERT OR IGNORE INTO users (email) VALUES (?)').run(email);
  return toUser(db.prepare('SELECT * FROM users WHERE email = ?').get(email) as Row);
}

export function getUser(id: number): UserRow {
  return toUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Row);
}

export function updateProfile(userId: number, p: Partial<Profile>) {
  // Custom targets are saved separately, with setCustomTargets.
  const cols: Record<Exclude<keyof Profile, 'customTargets'>, string> = {
    age: 'age',
    sex: 'sex',
    weightKg: 'weight_kg',
    heightCm: 'height_cm',
    goal: 'goal',
    units: 'units',
    theme: 'theme',
    routine: 'routine',
  };
  for (const [k, v] of Object.entries(p)) {
    const col = cols[k as keyof typeof cols];
    if (col && v !== undefined) db.prepare(`UPDATE users SET ${col} = ? WHERE id = ?`).run(v as string | number | null, userId);
  }
}

export function markGuideSeen(userId: number) {
  db.prepare('UPDATE users SET guide_seen = 1 WHERE id = ?').run(userId);
}

// Deletes everything we hold for a user; returns the photo paths to remove from disk.
export function deleteUser(userId: number): string[] {
  const rows = db.prepare('SELECT photos_json FROM messages WHERE day_id IN (SELECT id FROM days WHERE user_id = ?)').all(userId) as {
    photos_json: string;
  }[];
  const photos = rows.flatMap((r) => JSON.parse(r.photos_json) as string[]);
  db.exec('BEGIN');
  for (const t of ['messages', 'canvas_versions', 'log_entries', 'meals']) {
    db.prepare(`DELETE FROM ${t} WHERE day_id IN (SELECT id FROM days WHERE user_id = ?)`).run(userId);
  }
  db.prepare('DELETE FROM memories WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM days WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  db.exec('COMMIT');
  return photos;
}

// Messages the user sent in the last `seconds` (for rate limits).
export function countUserMessages(userId: number, seconds: number): number {
  const r = db
    .prepare(`SELECT count(*) AS n FROM messages WHERE role = 'user' AND created_at >= datetime('now', ?) AND user_id = ?`)
    .get(`-${seconds} seconds`, userId) as { n: number };
  return r.n;
}

// --- coach memory ------------------------------------------------------------------

export interface Memory {
  id: number;
  text: string;
}

export function listMemories(userId: number): Memory[] {
  return db
    .prepare('SELECT id, text FROM memories WHERE user_id = ? AND deleted_at IS NULL ORDER BY id')
    .all(userId) as unknown as Memory[];
}

export function addMemory(userId: number, text: string) {
  db.prepare('INSERT INTO memories (user_id, text) VALUES (?, ?)').run(userId, text);
}

// Returns the forgotten text, or null if it wasn't this user's.
export function forgetMemory(userId: number, id: number): string | null {
  const r = db.prepare('SELECT text FROM memories WHERE id = ? AND user_id = ? AND deleted_at IS NULL').get(id, userId) as
    { text: string } | undefined;
  if (!r) return null;
  db.prepare("UPDATE memories SET deleted_at = datetime('now') WHERE id = ?").run(id);
  return r.text;
}

// --- days, meals, entries --------------------------------------------------------

export function getOrCreateDay(userId: number, date: string): number {
  db.prepare('INSERT OR IGNORE INTO days (user_id, date) VALUES (?, ?)').run(userId, date);
  const day = db.prepare('SELECT id FROM days WHERE user_id = ? AND date = ?').get(userId, date) as { id: number };
  return day.id;
}

export function findDay(userId: number, date: string): number | null {
  const r = db.prepare('SELECT id FROM days WHERE user_id = ? AND date = ?').get(userId, date) as { id: number } | undefined;
  return r?.id ?? null;
}

export const ZERO: Macros = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0 };

export function sumMacros(items: Macros[]): Macros {
  const t = { ...ZERO };
  for (const m of items) for (const k of Object.keys(t) as (keyof Macros)[]) t[k] += m[k];
  return t;
}

export interface MealRow extends Meal {
  doodle: Sketch;
}

function toEntry(r: Row): LogEntry {
  return {
    id: r.id,
    name: r.name,
    grams: r.grams,
    calories: r.calories,
    protein: r.protein,
    carbs: r.carbs,
    fat: r.fat,
    fiber: r.fiber,
    sugar: r.sugar,
    foodGroup: r.food_group as FoodGroup,
    source: r.source,
    usdaDescription: r.usda_description,
    ingredients: r.ingredients_json
      ? (JSON.parse(r.ingredients_json) as { name: string; grams: number }[]).map(({ name, grams }) => ({ name, grams }))
      : null,
    sourceUrl: r.source_url ?? null,
  };
}

export function listMeals(dayId: number): MealRow[] {
  const meals = db.prepare('SELECT * FROM meals WHERE day_id = ? AND deleted_at IS NULL ORDER BY eaten_at, id').all(dayId) as Row[];
  const entries = db.prepare('SELECT * FROM log_entries WHERE day_id = ? AND deleted_at IS NULL ORDER BY id').all(dayId) as Row[];
  return meals
    .map((m) => {
      const foods = entries.filter((e) => e.meal_id === m.id).map(toEntry);
      return {
        id: m.id,
        heading: m.heading,
        time: m.eaten_at,
        note: m.note,
        foods,
        totals: sumMacros(foods),
        doodle: JSON.parse(m.doodle_json) as Sketch,
      };
    })
    .filter((m) => m.foods.length > 0);
}

export function getTips(dayId: number): { text: string | null; version: number | null } {
  const r = db.prepare('SELECT tips_text, tips_version FROM days WHERE id = ?').get(dayId) as Row;
  return { text: r.tips_text, version: r.tips_version };
}

export function saveTips(dayId: number, text: string, version: number) {
  db.prepare('UPDATE days SET tips_text = ?, tips_version = ? WHERE id = ?').run(text, version, dayId);
}

export function userDays(userId: number): { id: number; date: string }[] {
  return db.prepare('SELECT id, date FROM days WHERE user_id = ? ORDER BY date').all(userId) as { id: number; date: string }[];
}

export function latestCanvas(dayId: number): { version: number; canvas: Canvas } | null {
  const row = db.prepare('SELECT version, canvas_json FROM canvas_versions WHERE day_id = ? ORDER BY version DESC LIMIT 1').get(dayId) as
    { version: number; canvas_json: string } | undefined;
  return row ? { version: row.version, canvas: JSON.parse(row.canvas_json) } : null;
}

// Saves a new version unless the canvas is unchanged.
export function saveCanvas(dayId: number, canvas: Canvas): number {
  const latest = latestCanvas(dayId);
  if (latest && JSON.stringify(latest.canvas) === JSON.stringify(canvas)) return latest.version;
  const prev = latest?.version ?? 0;
  db.prepare('INSERT INTO canvas_versions (day_id, version, canvas_json) VALUES (?, ?, ?)').run(dayId, prev + 1, JSON.stringify(canvas));
  return prev + 1;
}

// The user's one chat thread, oldest first: the last `limit` messages.
export function listMessages(userId: number, limit = 80): ChatMessage[] {
  const rows = db
    .prepare(
      `SELECT * FROM (SELECT role, text, photos_json, suggestions_json, created_at, viewed_date, id FROM messages
       WHERE user_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id`,
    )
    .all(userId, limit) as Row[];
  return rows.map((r) => ({
    role: r.role,
    text: r.text,
    photos: (JSON.parse(r.photos_json) as string[]).length,
    date: r.viewed_date,
    createdAt: r.created_at,
    suggestions: JSON.parse(r.suggestions_json ?? '[]'),
  }));
}

export function addMessage(
  userId: number,
  viewedDate: string,
  role: 'user' | 'assistant',
  text: string,
  photos: string[] = [],
  suggestions: string[] = [],
) {
  const dayId = getOrCreateDay(userId, viewedDate);
  db.prepare(
    'INSERT INTO messages (user_id, day_id, viewed_date, role, text, photos_json, suggestions_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(userId, dayId, viewedDate, role, text, JSON.stringify(photos), JSON.stringify(suggestions));
}

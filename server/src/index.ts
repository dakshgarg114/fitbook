import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { relative, resolve } from 'node:path';
import {
  addMessage,
  countUserMessages,
  deleteUser,
  findDay,
  getOrCreateDay,
  getTips,
  getUser,
  latestCanvas,
  listMeals,
  listMessages,
  migrate,
  saveCanvas,
  saveTips,
  sumMacros,
  updateProfile,
  userDays,
  ZERO,
  type UserRow,
  markGuideSeen,
} from './db.ts';
import { requireUser } from './auth.ts';
import { describePhoto, runAgent, writeTips } from './agent.ts';
import { buildCanvas } from './layout.ts';
import { profileComplete, scoreDay, targetsFor } from './scores.ts';
import { THEMES, type CalendarDay, type ChatResponse, type DayView, type Me, type Profile, type Theme } from '../../shared/types.ts';

migrate();

const PORT = Number(process.env.PORT ?? 4310);
const DATA = resolve(import.meta.dirname, '../../data');
const UPLOADS = resolve(DATA, 'uploads');
const WEB_DIST = resolve(import.meta.dirname, '../../web/dist');
const PER_HOUR = Number(process.env.CHAT_LIMIT_PER_HOUR ?? 60);
const PER_DAY = Number(process.env.CHAT_LIMIT_PER_DAY ?? 100);
mkdirSync(UPLOADS, { recursive: true });

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

function me(user: UserRow): Me {
  return {
    email: user.email,
    name: user.name,
    registeredOn: user.createdAt.slice(0, 10),
    profile: user.profile,
    profileComplete: profileComplete(user.profile),
    targets: targetsFor(user.profile),
    guideSeen: user.guideSeen,
  };
}

function dayView(user: UserRow, date: string): DayView {
  const dayId = findDay(user.id, date);
  const meals = dayId ? listMeals(dayId) : [];
  const saved = dayId ? latestCanvas(dayId) : null;
  const version = saved?.version ?? 0;
  const totals = meals.length ? sumMacros(meals.map((m) => m.totals)) : ZERO;
  const targets = targetsFor(user.profile);
  const tips = dayId ? getTips(dayId) : null;
  return {
    date,
    version,
    canvas: buildCanvas(meals), // always the current layout; versions are saved on each change
    meals: meals.map(({ doodle, ...m }) => m),
    totals,
    scores: targets ? scoreDay(meals, totals, targets) : null,
    tips: tips && tips.version === version ? tips.text : null,
    messages: dayId ? listMessages(dayId) : [],
  };
}

const api = new Hono<{ Variables: { user: UserRow } }>();
api.use('*', requireUser);

api.get('/me', (c) => c.json(me(c.get('user'))));

api.put('/me/profile', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Partial<Profile>;
  const p: Partial<Profile> = {};
  const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && v >= lo && v <= hi ? v : undefined);
  p.age = num(body.age, 5, 120);
  p.weightKg = num(body.weightKg, 20, 400);
  p.heightCm = num(body.heightCm, 80, 250);
  if (body.sex === 'male' || body.sex === 'female' || body.sex === null) p.sex = body.sex;
  if (body.goal === 'lose' || body.goal === 'maintain' || body.goal === 'gain') p.goal = body.goal;
  if (body.units === 'metric' || body.units === 'imperial') p.units = body.units;
  if (THEMES.includes(body.theme as Theme)) p.theme = body.theme;
  if (typeof body.routine === 'string') p.routine = body.routine.trim().slice(0, 300) || null;
  updateProfile(c.get('user').id, p);
  return c.json(me(getUser(c.get('user').id)));
});

api.post('/me/guide-seen', (c) => {
  markGuideSeen(c.get('user').id);
  return c.json({ ok: true });
});

api.delete('/me', (c) => {
  for (const photo of deleteUser(c.get('user').id)) rmSync(resolve(DATA, photo), { force: true });
  return c.json({ ok: true });
});

api.get('/day/:date', (c) => {
  const date = c.req.param('date');
  if (!isDate(date)) return c.json({ error: 'bad date' }, 400);
  return c.json(dayView(c.get('user'), date));
});

api.post('/day/:date/tips', async (c) => {
  const user = c.get('user');
  const date = c.req.param('date');
  if (!isDate(date)) return c.json({ error: 'bad date' }, 400);
  const view = dayView(user, date);
  if (view.tips) return c.json({ tips: view.tips });
  const dayId = findDay(user.id, date);
  if (!dayId || view.meals.length === 0) return c.json({ tips: 'Log a meal and I’ll suggest how to round out your day.' });
  const tips = await writeTips({
    meals: view.meals.map((m) => ({ heading: m.heading, time: m.time, foods: m.foods.map((f) => `${f.name} ${Math.round(f.grams)} g`) })),
    totals: Object.fromEntries(Object.entries(view.totals).map(([k, v]) => [k, Math.round(v)])),
    targets: targetsFor(user.profile),
    scores: view.scores,
  });
  saveTips(dayId, tips, view.version);
  return c.json({ tips });
});

api.get('/calendar', (c) => {
  const user = c.get('user');
  const targets = targetsFor(user.profile);
  const days: CalendarDay[] = userDays(user.id).map(({ id, date }) => {
    const meals = listMeals(id);
    if (!meals.length || !targets) return { date, overall: null };
    return { date, overall: scoreDay(meals, sumMacros(meals.map((m) => m.totals)), targets).overall };
  });
  return c.json({ registeredOn: me(user).registeredOn, days });
});

api.post('/chat', async (c) => {
  const user = c.get('user');
  if (countUserMessages(user.id, 3600) >= PER_HOUR || countUserMessages(user.id, 86400) >= PER_DAY) {
    return c.json({ error: 'You’ve hit today’s message limit. Please try again later.' }, 429);
  }
  const form = await c.req.formData();
  const date = String(form.get('date') ?? '');
  const text = String(form.get('text') ?? '')
    .trim()
    .slice(0, 2000);
  const now = String(form.get('now') ?? '');
  const photoTime = String(form.get('photoTime') ?? '');
  const photo = form.get('photo');
  if (!isDate(date)) return c.json({ error: 'bad date' }, 400);
  if (!text && !(photo instanceof File)) return c.json({ error: 'empty message' }, 400);

  const dayId = getOrCreateDay(user.id, date);

  let photoPath: string | null = null;
  let photoDescription: string | null = null;
  if (photo instanceof File) {
    if (photo.size > 8_000_000) return c.json({ error: 'photo too large' }, 413);
    const buf = Buffer.from(await photo.arrayBuffer());
    const file = resolve(UPLOADS, `${randomUUID()}.jpg`);
    writeFileSync(file, buf);
    photoPath = relative(DATA, file);
    photoDescription = await describePhoto(`data:${photo.type || 'image/jpeg'};base64,${buf.toString('base64')}`);
  }

  addMessage(dayId, 'user', text, photoPath);
  let reply: string;
  let suggestions: string[] = [];
  try {
    ({ reply, suggestions } = await runAgent({
      user,
      dayId,
      text,
      photoDescription,
      now: isTime(now) ? now : new Date().toTimeString().slice(0, 5),
      photoTime: isTime(photoTime) ? photoTime : null,
    }));
    saveCanvas(dayId, buildCanvas(listMeals(dayId)));
  } catch (err) {
    console.error('agent failed', err);
    reply = 'Sorry, something went wrong on my side. Please try again.';
  }
  addMessage(dayId, 'assistant', reply, null, suggestions);
  const fresh = getUser(user.id);
  return c.json({ reply, day: dayView(fresh, date), me: me(fresh) } satisfies ChatResponse);
});

// First open for someone new: the chat greets them and asks the first setup question.
api.post('/chat/hello', async (c) => {
  const user = c.get('user');
  const body = (await c.req.json().catch(() => ({}))) as { date?: string; now?: string };
  const date = String(body.date ?? '');
  if (!isDate(date)) return c.json({ error: 'bad date' }, 400);
  const dayId = getOrCreateDay(user.id, date);
  if (!profileComplete(user.profile) && !listMessages(dayId).length) {
    try {
      const now = isTime(String(body.now)) ? String(body.now) : new Date().toTimeString().slice(0, 5);
      const out = await runAgent({ user, dayId, text: null, photoDescription: null, now, photoTime: null });
      addMessage(dayId, 'assistant', out.reply, null, out.suggestions);
    } catch (err) {
      console.error('hello failed', err);
    }
  }
  const fresh = getUser(user.id);
  return c.json({ reply: '', day: dayView(fresh, date), me: me(fresh) } satisfies ChatResponse);
});

const app = new Hono();
app.get('/healthz', (c) => c.text('ok'));
app.route('/api', api);
app.use('/*', serveStatic({ root: relative(process.cwd(), WEB_DIST) }));
app.get('*', serveStatic({ path: relative(process.cwd(), resolve(WEB_DIST, 'index.html')) }));

serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' }, (info) => console.log(`fitbook listening on http://127.0.0.1:${info.port}`));

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
  forgetMemory,
  getTips,
  getUser,
  latestCanvas,
  listMeals,
  listMemories,
  listMessages,
  migrate,
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
import { jobFor, startJob } from './jobs.ts';
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
    memories: listMemories(user.id),
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
    pending: jobFor(user.id)?.stage ?? null,
    version,
    canvas: buildCanvas(meals), // always the current layout; versions are saved on each change
    meals: meals.map(({ doodle, ...m }) => m),
    totals,
    scores: targets ? scoreDay(meals, totals, targets) : null,
    tips: tips && tips.version === version ? tips.text : null,
    messages: listMessages(user.id),
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

api.delete('/me/memories/:id', (c) => {
  forgetMemory(c.get('user').id, Number(c.req.param('id')));
  return c.json(me(getUser(c.get('user').id)));
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
    memories: listMemories(user.id).map((m) => m.text),
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

// The phone's own date, so "today" and "yesterday" are the user's, not the server's. Trusted within a day of ours.
function clientToday(v: unknown): string {
  const s = String(v ?? '');
  const ours = new Date();
  const near = [-1, 0, 1].map((d) => new Date(ours.getTime() + d * 86_400_000).toLocaleDateString('en-CA'));
  return isDate(s) && near.includes(s) ? s : near[1];
}
const nowOr = (v: unknown) => (isTime(String(v)) ? String(v) : new Date().toTimeString().slice(0, 5));

const MAX_PHOTOS = 4;

api.post('/chat', async (c) => {
  const user = c.get('user');
  if (countUserMessages(user.id, 3600) >= PER_HOUR || countUserMessages(user.id, 86400) >= PER_DAY) {
    return c.json({ error: 'You’ve hit today’s message limit. Please try again later.' }, 429);
  }
  const form = await c.req.formData();
  const date = String(form.get('date') ?? ''); // the page the user is viewing
  const today = clientToday(form.get('today'));
  const text = String(form.get('text') ?? '')
    .trim()
    .slice(0, 2000);
  const files = form.getAll('photo').filter((p): p is File => p instanceof File);
  const takenAt = form.getAll('photoTime').map(String);
  if (!isDate(date) || date > today) return c.json({ error: 'bad date' }, 400);
  if (!text && !files.length) return c.json({ error: 'empty message' }, 400);
  if (files.length > MAX_PHOTOS) return c.json({ error: `up to ${MAX_PHOTOS} photos per message` }, 400);
  if (files.some((f) => f.size > 8_000_000)) return c.json({ error: 'photo too large' }, 413);
  if (jobFor(user.id)) return c.json({ error: 'Still working on your last message, one moment.' }, 409);

  const saved = await Promise.all(
    files.map(async (photo, i) => {
      const buf = Buffer.from(await photo.arrayBuffer());
      const file = resolve(UPLOADS, `${randomUUID()}.jpg`);
      writeFileSync(file, buf);
      const when = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(takenAt[i] ?? '') ? takenAt[i] : null;
      return { path: relative(DATA, file), dataUrl: `data:${photo.type || 'image/jpeg'};base64,${buf.toString('base64')}`, takenAt: when };
    }),
  );

  addMessage(
    user.id,
    date,
    'user',
    text,
    saved.map((p) => p.path),
  );
  const now = nowOr(form.get('now'));
  // The agent works in the background: closing the app or the chat doesn't stop it.
  startJob(user.id, async (setStage) => {
    let reply: string;
    let suggestions: string[] = [];
    try {
      const photos = await Promise.all(saved.map(async (p) => ({ description: await describePhoto(p.dataUrl, text), takenAt: p.takenAt })));
      ({ reply, suggestions } = await runAgent({ user, viewedDate: date, today, now, text, photos, onStage: setStage }));
    } catch (err) {
      console.error('agent failed', err);
      reply = 'Sorry, something went wrong on my side. Please try again.';
    }
    addMessage(user.id, date, 'assistant', reply, [], suggestions);
  });
  const fresh = getUser(user.id);
  return c.json({ reply: '', day: dayView(fresh, date), me: me(fresh) } satisfies ChatResponse);
});

// What the agent is doing with the last message; null once the reply is saved.
api.get('/chat/status', (c) => c.json({ pending: jobFor(c.get('user').id)?.stage ?? null }));

// First open for someone new: the chat greets them and asks the first setup question.
api.post('/chat/hello', async (c) => {
  const user = c.get('user');
  const body = (await c.req.json().catch(() => ({}))) as { date?: string; now?: string; today?: string };
  const date = String(body.date ?? '');
  if (!isDate(date)) return c.json({ error: 'bad date' }, 400);
  if (!profileComplete(user.profile) && !listMessages(user.id, 1).length) {
    try {
      const today = clientToday(body.today);
      const out = await runAgent({ user, viewedDate: date, today, now: nowOr(body.now), text: null, photos: [] });
      addMessage(user.id, date, 'assistant', out.reply, [], out.suggestions);
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

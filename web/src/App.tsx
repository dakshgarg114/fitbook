import { Fragment } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { User } from 'firebase/auth';
import type { AgentStage, ChatResponse, DayView, Me } from '../../shared/types.ts';
import { SketchCanvas } from './SketchCanvas.tsx';
import { Summary } from './Summary.tsx';
import { Calendar, type CalendarData } from './Calendar.tsx';
import { AgentStatus } from './Orb.tsx';
import { Settings } from './Settings.tsx';
import { CoachOrb } from './CoachOrb.tsx';
import { Guide } from './Guide.tsx';
import { InstallHint } from './InstallHint.tsx';
import { Receipt, splitReply } from './Receipts.tsx';
import { MealSheet } from './MealSheet.tsx';
import { useDictation, useVisualViewport } from './hooks.ts';
import { applyTheme } from './theme.ts';
import { api } from './api.ts';
import { signIn, watchUser } from './firebase.ts';
import { nowHHMM, photoTime, prettyDate, shiftDate, today } from './dates.ts';

// Quick replies that follow the time of day and what's already logged.
function suggestionsFor(day: DayView): string[] {
  const h = new Date().getHours();
  const isToday = day.date === today();
  const out: string[] = [];
  if (!isToday) out.push('Add what I had for dinner');
  else if (h < 11) out.push('Had poha and chai for breakfast', 'Log my breakfast');
  else if (h < 16) out.push('Had 2 rotis and dal for lunch', 'Log my lunch');
  else if (h < 19) out.push('Had a coffee and biscuits', 'Ideas for a healthy snack');
  else out.push('Log my dinner', 'What should I eat for dinner?');
  const s = day.scores;
  if (s && day.meals.length) {
    const low = [
      [s.protein, 'How can I add protein?'],
      [s.fiber, 'How do I get more fiber?'],
      [s.antioxidants, 'What adds antioxidants?'],
    ] as const;
    const worst = [...low].sort((a, b) => a[0] - b[0])[0];
    if (worst[0] < 6) out.push(worst[1]);
    out.push('How am I doing today?');
  }
  return out;
}

// Shrinks a photo before upload so phones don't send 10 MB images.
async function shrinkPhoto(file: File, max = 1280): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('encode failed'))), 'image/jpeg', 0.85));
}

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  // A local dev server (DEV_USER_EMAIL) answers without a token; production returns 401.
  const [devServer, setDevServer] = useState(false);
  useEffect(() => watchUser(setUser), []);
  useEffect(() => {
    if (user === null)
      fetch('/api/me')
        .then((r) => setDevServer(r.ok))
        .catch(() => {});
  }, [user]);

  if (user === undefined) return <div class="splash">Fitbook</div>;
  return (
    <>
      {!user && !devServer ? <SignIn /> : <Main key={user?.uid ?? 'dev'} />}
      <InstallHint />
    </>
  );
}

function SignIn() {
  const [error, setError] = useState('');
  return (
    <div class="signin">
      <h1>Fitbook</h1>
      <p>Your food diary, sketched by hand.</p>
      <button
        class="google"
        onClick={() =>
          signIn().catch((e) => {
            if (e?.code !== 'auth/popup-closed-by-user') setError(e?.message ?? 'Sign-in failed');
          })
        }
      >
        Continue with Google
      </button>
      {error && <p class="err">{error}</p>}
    </div>
  );
}

const PULL = 70; // px to pull past the edge to change day

function Main() {
  const t = today();
  // ?date=YYYY-MM-DD opens another day directly.
  const asked = new URLSearchParams(location.search).get('date');
  const [date, setDate] = useState(asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked <= t ? asked : t);
  const [me, setMe] = useState<Me | null>(null);
  const [day, setDay] = useState<DayView | null>(null);
  const [error, setError] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  // Text to put in the chat box when it opens ("Change this in chat"); n makes each request new.
  const [draft, setDraft] = useState({ text: '', n: 0 });
  const [openMeal, setOpenMeal] = useState<number | null>(null);
  // Sending: the message is uploading. After that the server works in the background and day.pending
  // carries its stage, so closing the chat or the app doesn't stop it.
  const [sending, setSending] = useState(false);
  const [guide, setGuide] = useState(false);
  const [brandMenu, setBrandMenu] = useState(false);
  // Any tap outside the Fitbook name closes its popup.
  useEffect(() => {
    if (!brandMenu) return;
    const close = (e: PointerEvent) => {
      if (!(e.target as Element).closest('.brand-wrap')) setBrandMenu(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [brandMenu]);

  const [calendar, setCalendar] = useState<CalendarData | null>(null);
  // New people start in the chat, which sets up their profile. Closing it counts as skipping.
  const [setupSeen, setSetupSeen] = useState(false);
  // Preloaded so the calendar opens instantly.
  const loadCalendar = () =>
    api<CalendarData>('/calendar')
      .then(setCalendar)
      .catch(() => {});
  const [panel, setPanel] = useState<'calendar' | 'settings' | null>(null);
  const [pull, setPull] = useState(0); // >0 pulling down (previous day), <0 pulling up (next day)
  const scroller = useRef<HTMLDivElement>(null);
  const touch = useRef<{ y: number; edge: 'top' | 'bottom' | null } | null>(null);
  const wheel = useRef({ sum: 0, at: 0 });

  useEffect(() => {
    api<Me>('/me')
      .then((m) => {
        setMe(m);
        loadCalendar();
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    setDay(null);
    setError('');
    api<DayView>(`/day/${date}`)
      .then((d) => {
        setDay(d);
        scroller.current?.scrollTo({ top: 0 });
      })
      .catch((e) => setError(`Couldn't load the day: ${e.message}`));
  }, [date]);

  // Reloads the page, profile and calendar from the server: after the agent finishes, and on return to the app.
  const sync = () => {
    api<DayView>(`/day/${date}`)
      .then(setDay)
      .catch(() => {});
    api<Me>('/me')
      .then(setMe)
      .catch(() => {});
    loadCalendar();
  };
  const stage = day?.pending ?? null;
  useEffect(() => {
    if (!stage) return;
    const t = setInterval(() => {
      api<{ pending: AgentStage | null }>('/chat/status')
        .then(({ pending }) => (pending ? setDay((d) => (d ? { ...d, pending } : d)) : sync()))
        .catch(() => {});
    }, 1500);
    return () => clearInterval(t);
  }, [stage, date]);
  useEffect(() => {
    const onShow = () => document.visibilityState === 'visible' && sync();
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, [date]);

  const canNext = date < t;
  const go = (delta: number) => {
    if (delta > 0 && !canNext) return;
    if (delta < 0 && me && date <= me.registeredOn) return;
    setDate(shiftDate(date, delta));
  };

  // Pull past the top for the previous day, past the bottom for the next day.
  function edgeOf(el: HTMLDivElement): 'top' | 'bottom' | null {
    if (el.scrollTop <= 0) return 'top';
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) return 'bottom';
    return null;
  }
  const onTouchStart = (e: TouchEvent) => {
    touch.current = { y: e.touches[0].clientY, edge: edgeOf(scroller.current!) };
  };
  const onTouchMove = (e: TouchEvent) => {
    const s = touch.current;
    if (!s?.edge) return;
    const dy = e.touches[0].clientY - s.y;
    if (s.edge === 'top' && dy > 0) setPull(Math.min(dy * 0.5, PULL * 1.4));
    else if (s.edge === 'bottom' && dy < 0 && canNext) setPull(Math.max(dy * 0.5, -PULL * 1.4));
    else setPull(0);
  };
  const onTouchEnd = () => {
    if (pull >= PULL) go(-1);
    else if (pull <= -PULL) go(1);
    setPull(0);
    touch.current = null;
  };
  const onWheel = (e: WheelEvent) => {
    const edge = edgeOf(scroller.current!);
    const w = wheel.current;
    if (Date.now() - w.at > 400) w.sum = 0;
    w.at = Date.now();
    if ((edge === 'top' && e.deltaY < 0) || (edge === 'bottom' && e.deltaY > 0)) w.sum += e.deltaY;
    if (w.sum < -400) {
      w.sum = 0;
      go(-1);
    }
    if (w.sum > 400) {
      w.sum = 0;
      go(1);
    }
  };

  if (me) applyTheme(me.profile.theme);
  // First visit: the tour plays once, then the chat opens to set up the profile.
  // Someone who has seen the tour but isn't set up yet goes straight to the chat.
  useEffect(() => {
    if (!me || !day || setupSeen) return;
    if (!me.guideSeen) {
      setSetupSeen(true);
      const t = setTimeout(() => setGuide(true), 700);
      return () => clearTimeout(t);
    }
    if (!me.profileComplete) {
      setSetupSeen(true);
      setChatOpen(true);
    }
  }, [!!me, !!day]);
  const firstDay = !!me && date <= me.registeredOn;
  const pullLabel =
    pull > 0
      ? firstDay
        ? 'This is your first day 🌱'
        : `${pull >= PULL ? 'Release' : 'Pull'} for ${prettyDate(shiftDate(date, -1))}`
      : pull < 0
        ? `${pull <= -PULL ? 'Release' : 'Pull'} for ${prettyDate(shiftDate(date, 1))}`
        : '';

  return (
    <div class={`app ${sending || stage ? 'agent-busy' : ''}`}>
      <div class="agent-glow" aria-hidden="true" />
      <header class="bar">
        <div class="brand-wrap">
          <button class="brand" onClick={() => setBrandMenu(!brandMenu)} aria-expanded={brandMenu}>
            Fitbook
          </button>
          {brandMenu && (
            <div class="brand-pop" role="menu">
              <button
                role="menuitem"
                onClick={() => {
                  setBrandMenu(false);
                  setGuide(true);
                }}
              >
                Guide me
              </button>
            </div>
          )}
        </div>
        <button class="date-pill" onClick={() => setPanel('calendar')} aria-label="Open calendar">
          {date === t ? 'Today' : prettyDate(date)}
        </button>
        <button class="settings-btn" aria-label="Settings" onClick={() => setPanel('settings')}>
          <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
            <circle cx="15" cy="7" r="2.2" />
            <circle cx="9" cy="17" r="2.2" />
          </svg>
        </button>
      </header>

      <div class="scroll" ref={scroller} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onWheel={onWheel}>
        {pull > 0 && (
          <div class="pull-hint top" style={{ height: pull }}>
            {pullLabel}
          </div>
        )}
        <div style={{ transform: pull ? `translateY(${pull > 0 ? 0 : pull}px)` : undefined }}>
          <section class="paper">
            {day ? <SketchCanvas key={date} canvas={day.canvas} onPick={setOpenMeal} /> : <p class="loading">Loading…</p>}
          </section>
          {error && <p class="err">{error}</p>}
          <div class="edge-note">{canNext ? 'Pull up for the next day' : ''}</div>
        </div>
        {pull < 0 && (
          <div class="pull-hint bottom" style={{ height: -pull }}>
            {pullLabel}
          </div>
        )}
      </div>

      {day && me && (
        <Summary day={day} me={me} stage={stage ?? (sending ? 'analysing' : null)} onLog={chatOpen ? undefined : () => setChatOpen(true)} />
      )}
      {day && me && (
        <Chat
          open={chatOpen}
          date={date}
          day={day}
          me={me}
          onClose={() => setChatOpen(false)}
          onResult={(r) => {
            setDay(r.day);
            setMe(r.me);
            loadCalendar();
          }}
          onOptimistic={setDay}
          draft={draft}
          sending={sending}
          onSending={setSending}
        />
      )}

      {openMeal !== null && day && me && day.meals.some((m) => m.id === openMeal) && (
        <MealSheet
          meal={day.meals.find((m) => m.id === openMeal)!}
          day={day}
          targets={me.targets}
          onClose={() => setOpenMeal(null)}
          onAsk={(m) => {
            setDraft({ text: `${m.heading} (${m.time}): `, n: draft.n + 1 });
            setChatOpen(true);
          }}
        />
      )}

      {panel === 'calendar' && me && (
        <Calendar
          data={calendar ?? { registeredOn: me.registeredOn, days: [] }}
          selected={date}
          onClose={() => setPanel(null)}
          onPick={setDate}
        />
      )}
      {panel === 'settings' && me && (
        <Settings
          me={me}
          onClose={() => setPanel(null)}
          onSaved={(m) => {
            setMe(m);
            loadCalendar();
            api<DayView>(`/day/${date}`).then(setDay);
          }}
        />
      )}

      {guide && (
        <Guide
          setup={!!me && !me.profileComplete}
          onDone={() => {
            setGuide(false);
            if (me && !me.guideSeen) {
              setMe({ ...me, guideSeen: true });
              api('/me/guide-seen', { method: 'POST' }).catch(() => {});
            }
            if (me && !me.profileComplete) setTimeout(() => setChatOpen(true), 280);
          }}
        />
      )}
    </div>
  );
}

const MAX_PHOTOS = 4;

// Thumbnail of a photo about to be sent, with a remove button.
function PhotoChip({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return (
    <div class="photo-chip">
      {url && <img src={url} alt="Selected meal photo" />}
      <button type="button" aria-label="Remove photo" onClick={onRemove}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}

function Chat(props: {
  open: boolean;
  date: string;
  day: DayView;
  me: Me;
  onClose: () => void;
  onResult: (r: ChatResponse) => void;
  onOptimistic: (d: DayView) => void;
  draft: { text: string; n: number };
  sending: boolean;
  onSending: (b: boolean) => void;
}) {
  const { date, day, me, sending } = props;
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const photo = photos.length > 0;
  const setBusy = props.onSending;
  const stage = day.pending ?? (sending ? 'analysing' : null);
  const busy = !!stage;
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const vv = useVisualViewport();
  // Someone new opening the chat: it greets them and asks the first setup question.
  useEffect(() => {
    if (!props.open || me.profileComplete || busy || day.messages.length) return;
    setBusy(true);
    api<ChatResponse>('/chat/hello', { method: 'POST', body: JSON.stringify({ date, now: nowHHMM(), today: today() }) })
      .then(props.onResult)
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  }, [props.open, me.profileComplete]);
  const lastMsg = day.messages[day.messages.length - 1];
  const fromChat = lastMsg?.role === 'assistant' && !!lastMsg.suggestions?.length;
  const quick = fromChat ? lastMsg.suggestions! : me.profileComplete ? suggestionsFor(day) : [];
  const dictation = useDictation((t) => setText(t));
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!props.draft.n) return;
    setText(props.draft.text);
    setTimeout(() => input.current?.focus(), 350);
  }, [props.draft.n]);

  // Scroll only the message list (scrollIntoView would also scroll the page on iOS).
  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: props.open ? 'smooth' : 'auto' });
  }, [day.messages.length, busy, props.open, vv.h]);

  async function send(e: Event | null, typed = text) {
    e?.preventDefault();
    const text = typed;
    if (busy || (!text.trim() && !photo)) return;
    setBusy(true);
    setError('');
    const form = new FormData();
    form.set('date', date);
    form.set('today', today());
    form.set('text', text.trim());
    form.set('now', nowHHMM());
    for (const p of photos) {
      form.append('photoTime', (await photoTime(p).catch(() => null)) ?? '');
      form.append('photo', await shrinkPhoto(p), 'photo.jpg');
    }
    props.onOptimistic({
      ...day,
      messages: [...day.messages, { role: 'user', text: text.trim(), photos: photos.length, date, createdAt: '' }],
    });
    setText('');
    setPhotos([]);
    try {
      props.onResult(await api<ChatResponse>('/chat', { method: 'POST', body: form }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      class={`chat-overlay ${props.open ? 'open' : ''}`}
      role="dialog"
      aria-label="Chat"
      aria-hidden={!props.open}
      style={{ height: `${vv.h}px`, top: `${vv.top}px` }}
    >
      <div class="chat-head">
        <div class="agent-id">
          <CoachOrb size={30} />
          <div>
            <strong>Your coach</strong>
            <small>{busy ? 'Working…' : 'Logs your meals and keeps you on track'}</small>
          </div>
        </div>
        <button class="icon close" onClick={props.onClose} aria-label="Close chat">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </div>
      <div class="chat-log" ref={log}>
        {day.messages.map((m, i) => {
          // One thread across all days: a chip marks where the open page changed.
          const chip = m.date && m.date !== day.messages[i - 1]?.date && (
            <div class="day-chip">{m.date === today() ? 'Today' : prettyDate(m.date)}</div>
          );
          if (m.role !== 'assistant') {
            return (
              <Fragment key={i}>
                {chip}
                <div class={`msg ${m.role}`}>
                  {m.photos > 0 && <span class="photo-tag">{m.photos > 1 ? `${m.photos} photos` : 'Photo'}</span>}
                  {m.text}
                </div>
              </Fragment>
            );
          }
          const { reply, actions } = splitReply(m.text);
          return (
            <Fragment key={i}>
              {chip}
              <div class="turn">
                {reply && <div class="msg assistant">{reply}</div>}
                {actions.length > 0 && (
                  <div class="receipts">
                    {actions.map((a) => (
                      <Receipt key={a} text={a} />
                    ))}
                  </div>
                )}
              </div>
            </Fragment>
          );
        })}
        {stage && <AgentStatus stage={stage} />}
        {error && <div class="msg error">{error}</div>}
      </div>
      {!busy && !text && !photo && quick.length > 0 && (
        <div class="suggestions">
          {quick.map((sug) => (
            // The chat's own quick replies send straight away; our time-of-day ideas fill the box to edit.
            <button key={sug} type="button" class="chip" onClick={() => (fromChat ? send(null, sug) : setText(sug))}>
              {sug}
            </button>
          ))}
        </div>
      )}
      {photo && (
        <div class="photo-chips">
          {photos.map((f, i) => (
            <PhotoChip key={`${f.name}-${f.lastModified}-${i}`} file={f} onRemove={() => setPhotos(photos.filter((_, j) => j !== i))} />
          ))}
          <span>{photos.length > 1 ? `${photos.length} photos` : 'Photo ready'}</span>
        </div>
      )}
      <form class="composer" onSubmit={send}>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const picked = [...(e.currentTarget.files ?? [])];
            setPhotos([...photos, ...picked].slice(0, MAX_PHOTOS));
            e.currentTarget.value = '';
          }}
        />
        <div class="pill">
          <button
            type="button"
            class="cam"
            aria-label="Add photos of your meal"
            disabled={photos.length >= MAX_PHOTOS}
            onClick={() => fileInput.current?.click()}
          >
            <svg
              viewBox="0 0 24 24"
              width="22"
              height="22"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="3" y="5" width="15" height="14" rx="3.5" />
              <circle cx="8.5" cy="10" r="1.6" />
              <path d="M3.5 17l4.2-4.2a1.5 1.5 0 0 1 2.1 0l4.7 4.7" />
              <path d="M19 2.5v6M16 5.5h6" />
            </svg>
          </button>
          <input
            ref={input}
            class="text"
            value={text}
            placeholder={dictation.listening ? 'Listening…' : photo ? 'Add a note (optional)' : 'Tell me what you ate…'}
            onInput={(e) => setText(e.currentTarget.value)}
            enterKeyHint="send"
          />
          {dictation.supported && !text.trim() && !photo && !busy ? (
            <button
              type="button"
              class={`send mic ${dictation.listening ? 'on' : ''}`}
              aria-label={dictation.listening ? 'Stop listening' : 'Speak'}
              onClick={dictation.toggle}
            >
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
              </svg>
            </button>
          ) : (
            <button class="send" aria-label="Send" disabled={!!busy || (!text.trim() && !photo)}>
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

import type { CalendarDay } from '../../shared/types.ts';
import { localDate, today } from './dates.ts';
import { Sheet } from './Sheet.tsx';

export interface CalendarData {
  registeredOn: string;
  days: CalendarDay[];
}

// Green for good days, red for poor ones; the further from 5, the darker.
function shade(overall: number | null): string | undefined {
  if (overall == null) return undefined;
  const k = Math.min(1, Math.abs(overall - 5) / 5);
  const a = (0.22 + 0.7 * k).toFixed(2);
  return overall >= 5 ? `rgba(46, 140, 80, ${a})` : `rgba(200, 70, 55, ${a})`;
}

// Renders straight away from preloaded data; shading fills in if it arrives later.
export function Calendar(props: { data: CalendarData; selected: string; onPick: (d: string) => void; onClose: () => void }) {
  const { data, selected, onPick, onClose } = props;

  const t = today();
  const months: Date[] = [];
  const start = new Date(`${data.registeredOn.slice(0, 7)}-01T12:00:00`);
  for (let d = new Date(`${t.slice(0, 7)}-01T12:00:00`); d >= start; d.setMonth(d.getMonth() - 1)) months.push(new Date(d));
  const score = new Map(data.days.map((d) => [d.date, d.overall]));

  return (
    <Sheet onClose={onClose}>
      {(close) => (
        <>
          <div class="grabber" />
          <header class="modal-head">
            <h2>Calendar</h2>
            <button class="icon glass" onClick={close} aria-label="Close">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </header>
          <div class="months">
            {months.map((m) => {
              const first = (m.getDay() + 6) % 7; // Monday first
              const count = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
              const cells = [...Array(first).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)];
              return (
                <div class="month" key={m.toISOString()}>
                  <h3>{m.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</h3>
                  <div class="grid">
                    {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
                      <span key={`h${i}`} class="dow">
                        {d}
                      </span>
                    ))}
                    {cells.map((n, i) => {
                      if (n == null) return <span key={i} />;
                      const date = localDate(new Date(m.getFullYear(), m.getMonth(), n, 12));
                      const active = date >= data.registeredOn && date <= t;
                      const cls = ['day', active ? '' : 'off', date === t ? 'today' : '', date === selected ? 'sel' : ''].join(' ');
                      return (
                        <button
                          key={i}
                          class={cls}
                          disabled={!active}
                          style={{ background: date === t ? undefined : shade(score.get(date) ?? null) }}
                          onClick={() => {
                            onPick(date);
                            close();
                          }}
                        >
                          {n}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Sheet>
  );
}

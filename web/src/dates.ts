export const localDate = (d: Date) => d.toLocaleDateString('en-CA'); // YYYY-MM-DD
export const today = () => localDate(new Date());
export const nowHHMM = () => new Date().toTimeString().slice(0, 5);

export function shiftDate(date: string, days: number) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return localDate(d);
}

export function prettyDate(date: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', opts);
}

// Reads the capture time from a photo's EXIF data ("YYYY:MM:DD HH:MM:SS") as "YYYY-MM-DD HH:MM".
export async function photoTime(file: File): Promise<string | null> {
  const head = new Uint8Array(await file.slice(0, 128 * 1024).arrayBuffer());
  const text = new TextDecoder('latin1').decode(head);
  const m = text.match(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):\d{2}/);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : null;
}

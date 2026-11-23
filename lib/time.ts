/** London working-day sums for nudges, closing and the 9:00 reminder. Pure, tested. Bank holidays count as working days. */

const DAY = 24 * 60 * 60_000;

function parts(ms: number): { weekday: string; date: string; hour: number; minute: number } {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { weekday: p.weekday, date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
}

export function isWorkingDay(ms: number): boolean {
  const d = parts(ms).weekday;
  return d !== "Sat" && d !== "Sun";
}

export function londonDate(ms: number): string {
  return parts(ms).date;
}

/**
 * The same clock time `n` working days later. Something asked on Friday at 16:00 is
 * one working day old on Monday at 16:00. Something asked at the weekend counts from Monday.
 */
export function addWorkingDays(ms: number, n: number): number {
  let t = ms;
  while (!isWorkingDay(t)) t += DAY;
  for (let i = 0; i < n; ) {
    t += DAY;
    if (isWorkingDay(t)) i++;
  }
  return t;
}

/** The 15-minute cron slot that sends the morning reminder: working days, 09:00–09:14 London. */
export function isMorningSlot(ms: number): boolean {
  const p = parts(ms);
  return isWorkingDay(ms) && p.hour === 9 && p.minute < 15;
}

/** The hour (0-23) in London. */
export function londonHour(ms: number): number {
  return parts(ms).hour;
}

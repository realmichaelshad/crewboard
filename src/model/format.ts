import { DAY_START_HOUR } from './jobs';

const pad2 = (n: number) => String(n).padStart(2, '0');

/** "45 min", "6 h", "12 h 05 min". */
export function fmtDur(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${pad2(r)} min` : `${h} h`;
}

/** Compact "2 h 30", "45 m" for cards. */
export function fmtShort(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${pad2(r)}` : `${h} h`;
}

/** Minutes after the start of the day as a clock time, "13:20". */
export function fmtClock(offset: number): string {
  const total = DAY_START_HOUR * 60 + Math.round(offset);
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

/** Overtime reads "0" when there is none. */
export function fmtOvertime(min: number): string {
  return min <= 0 ? '0' : fmtDur(min);
}

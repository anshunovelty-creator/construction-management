/** A worker's rate in Setup is per hour; staff's is per day. */
export type PersonKind = 'worker' | 'staff';

/** A full day's pay in paise: 8 hours at a worker's hourly rate, or staff's day rate. */
export const dayPay = (kind: PersonKind, ratePaise: number): number => (kind === 'worker' ? ratePaise * 8 : ratePaise);

/**
 * The day's amount: a full day's pay when present, plus each OT hour at a day's pay ÷ 8. Whole numbers until the last
 * step, so it matches the database's check to the paisa.
 */
export const dayAmount = (present: boolean, otCenti: number, dayPayPaise: number): number =>
  (present ? dayPayPaise : 0) + Math.round((otCenti * dayPayPaise) / 800);

/** OT hours as typed ("2", "1.5"), in hundredths of an hour; empty is none. Throws when not 0–16 with 2 decimals at most. */
export function otCenti(text: string): number {
  const cleaned = text.trim();
  if (cleaned === '') return 0;
  if (!/^(\d{1,2}(\.\d{0,2})?|\.\d{1,2})$/.test(cleaned)) throw new Error('bad_ot');
  const centi = Math.round(Number(cleaned) * 100);
  if (centi > 1600) throw new Error('bad_ot');
  return centi;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The salary period asked for: a whole month ("2026-10"), from–to dates (either way round), or else this month up to today. */
export function salaryPeriod(q: { month?: string; from?: string; to?: string }, today: string): { from: string; to: string; month?: string } {
  if (/^\d{4}-\d{2}$/.test(q.month ?? '')) {
    const [y, m] = q.month!.split('-').map(Number) as [number, number];
    return { from: `${q.month}-01`, to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10), month: q.month };
  }
  if (DATE.test(q.from ?? '') && DATE.test(q.to ?? '')) {
    return q.from! <= q.to! ? { from: q.from!, to: q.to! } : { from: q.to!, to: q.from! };
  }
  return { from: `${today.slice(0, 7)}-01`, to: today, month: today.slice(0, 7) };
}

/** The month before "2026-10": "2026-09". */
export const lastMonth = (month: string): string => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

/** One day of a person's attendance, as the salary adds it up. */
export interface AttendanceDay {
  present: boolean;
  ot_hours: number | string;
  day_pay_paise: number | string;
  amount_paise: number | string;
}

/** Days present and absent, OT hours, and the pay for days and for OT, over the days given. */
export function salaryTotals(days: AttendanceDay[]) {
  const totals = { present: 0, absent: 0, otHours: 0, dayPaise: 0, otPaise: 0, totalPaise: 0 };
  for (const d of days) {
    const amount = Number(d.amount_paise);
    const dayPart = d.present ? Number(d.day_pay_paise) : 0;
    totals[d.present ? 'present' : 'absent'] += 1;
    totals.otHours += Number(d.ot_hours);
    totals.dayPaise += dayPart;
    totals.otPaise += amount - dayPart;
    totals.totalPaise += amount;
  }
  totals.otHours = Math.round(totals.otHours * 100) / 100;
  return totals;
}

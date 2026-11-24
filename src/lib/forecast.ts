import type { Paise } from '@/lib/money';

const DAY = 86_400_000;
export const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

export const KINDS = ['clients', 'plannedIn', 'parties', 'salary', 'wages', 'gst', 'tds', 'pf', 'site', 'plannedOut'] as const;
export type Kind = (typeof KINDS)[number];
/** Money expected on a day: above zero in, below zero out. */
export interface Item { date: string; kind: Kind; amount: Paise }

/**
 * What is still due on bills when payments settle the oldest first, each on its date plus the days of credit. A minus
 * bill (money put right) counts as a payment.
 */
export function stillDue(bills: { date: string; amount: Paise }[], paid: Paise, creditDays: number): { date: string; amount: Paise }[] {
  let left = paid - bills.reduce((s, b) => s + Math.min(b.amount, 0), 0);
  return [...bills].filter((b) => b.amount > 0).sort((a, b) => a.date.localeCompare(b.date)).flatMap((b) => {
    const settled = Math.min(Math.max(left, 0), b.amount);
    left -= settled;
    return b.amount - settled > 0 ? [{ date: addDays(b.date, creditDays), amount: b.amount - settled }] : [];
  });
}

/** The date `day` of the month `shift` months after the one `date` is in. `day` is 28 at most, or clamped to the month. */
export function dayOfMonth(date: string, day: number, shift = 0): string {
  const [y, m] = date.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m - 1 + shift + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + shift, Math.min(day, last))).toISOString().slice(0, 10);
}

/** The next time `day` of a month comes, today included. */
export const nextDay = (today: string, day: number) => (dayOfMonth(today, day) >= today ? dayOfMonth(today, day) : dayOfMonth(today, day, 1));

export interface Plan { direction: 'in' | 'out'; amount_paise: number | string; repeats: 'once' | 'week' | 'month'; next_on: string; until_on: string | null }

/** When a plan falls between two days. One that repeats skips what is past (it was paid); a one-time one stays due until taken off. */
export function planDates(p: Plan, from: string, to: string): string[] {
  if (p.repeats === 'once') return p.next_on <= to ? [p.next_on] : [];
  const dates: string[] = [];
  for (let i = 0; ; i++) {
    const date = p.repeats === 'week' ? addDays(p.next_on, 7 * i) : dayOfMonth(p.next_on, Number(p.next_on.slice(8)), i);
    if (date > to || (p.until_on !== null && date > p.until_on)) return dates;
    if (date >= from) dates.push(date);
  }
}

export interface Week { from: string; to: string; opening: Paise; in: Paise; out: Paise; closing: Paise; kinds: Partial<Record<Kind, Paise>> }

/** The weeks from today, each carrying what the one before leaves. What was due before today falls in the first. */
export function forecast(opening: Paise, items: Item[], today: string, count = 8): Week[] {
  let balance = opening;
  return Array.from({ length: count }, (_, i) => {
    const [from, to] = [addDays(today, 7 * i), addDays(today, 7 * i + 6)];
    const week: Week = { from, to, opening: balance, in: 0, out: 0, closing: balance, kinds: {} };
    for (const item of items) {
      if (item.date > to || (item.date < from && i > 0)) continue;
      week.kinds[item.kind] = (week.kinds[item.kind] ?? 0) + item.amount;
      if (item.amount > 0) week.in += item.amount;
      else week.out -= item.amount;
    }
    week.closing = balance + week.in - week.out;
    balance = week.closing;
    return week;
  });
}

/** A firm that runs short in a week, and the firms with money to spare at the end of it (the least they hold from then on). */
export function shortages(firms: { name: string; weeks: Week[] }[]): { name: string; week: number; short: Paise; spare: { name: string; amount: Paise }[] }[] {
  return firms.flatMap((f) => {
    const week = f.weeks.findIndex((w) => w.closing < 0);
    if (week < 0) return [];
    const spare = firms.filter((o) => o !== f).map((o) => ({ name: o.name, amount: Math.min(...o.weeks.slice(week).map((w) => w.closing)) })).filter((o) => o.amount > 0);
    return [{ name: f.name, week, short: -Math.min(...f.weeks.map((w) => w.closing)), spare }];
  });
}

/** Tax on the bills of months that are over, and of this month, less what was paid; credit from before comes off this month's. */
export function taxDue(rows: { month: string; amount: Paise }[], paid: Paise, thisMonth: string): { past: Paise; now: Paise } {
  const before = rows.filter((r) => r.month < thisMonth).reduce((s, r) => s + r.amount, 0) - paid;
  const current = rows.filter((r) => r.month >= thisMonth).reduce((s, r) => s + r.amount, 0);
  return { past: Math.max(before, 0), now: Math.max(current + Math.min(before, 0), 0) };
}

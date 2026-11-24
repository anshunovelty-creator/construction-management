import { addDays, dayOfMonth, nextDay, planDates, stillDue, taxDue, type Item, type Plan } from '@/lib/forecast';
import type { createClient } from '@/lib/supabase/server';
import { rentDays, rentPaise } from '@/lib/rent';
import { lastMonth, salaryLedger } from '@/lib/wages';
import { loadDues } from '../between/data';
import { allRows, loadFamilies } from '../labour/data';
import { loadAccounts } from '../bankbook/data';
import { loadSalaryPeople } from '../salary/data';

type Db = Awaited<ReturnType<typeof createClient>>;

export interface PlanRow extends Plan { id: string; name: string }
/** What a firm holds, what of it is not its own, and what is expected to come in and go out. */
export interface FirmForecast {
  id: string;
  name: string;
  held: number;
  gst: number;
  tds: number;
  salary: number;
  wages: number;
  clientExtra: number;
  /** Owed to our other firms; all firms together leave it out, as it cancels. */
  otherFirms: number;
  /** Party bills due by today. */
  partiesDue: number;
  items: Item[];
  plans: PlanRow[];
}
/** Counted only for all firms together, as no one firm can be named for it. */
export interface Shared { salary: number; pf: number; rent: number; items: Item[] }

const WEEKS = 8;
const n = (value: number | string | null | undefined) => Number(value ?? 0);

/** Everything the forecast is worked out from, firm by firm. ponytail: reads each firm's bills whole; add a due view when a firm passes a few thousand. */
export async function loadForecast(db: Db, firms: { id: string; name: string }[], today: string): Promise<{ firms: FirmForecast[]; shared: Shared }> {
  const month = today.slice(0, 7);
  const end = addDays(today, WEEKS * 7 - 1);
  const [accounts, dues, { data: settings }, parties, people, families, { data: rentals }, { data: salaryPaid }, { data: pfPaid }] = await Promise.all([
    loadAccounts(db), loadDues(db),
    db.from('firms').select('id, salary_day, runs_labour').returns<{ id: string; salary_day: number; runs_labour: boolean }[]>(),
    allRows<{ id: string; credit_days: number | null }>(db, 'parties', ['id']),
    loadSalaryPeople(db, today), loadFamilies(db),
    db.from('rentals').select('quantity, rate_paise, rented_on, returned_on').is('bill_no', null),
    db.from('salary_money').select('party_id, entry:entries(firm_id)').not('entry_id', 'is', null).order('money_date', { ascending: false }).returns<{ party_id: string; entry: { firm_id: string } | null }[]>(),
    db.from('tax_rows').select('amount_paise').eq('account', 'pf_paid'),
  ]);
  const credit = new Map(parties.map((p) => [p.id, p.credit_days ?? 0]));
  // A worker belongs to no firm, so the firm that last paid them is taken to pay them next.
  const payer = new Map<string, string>();
  for (const s of salaryPaid ?? []) if (s.entry && !payer.has(s.party_id)) payer.set(s.party_id, s.entry.firm_id);

  const load = async (firm: { id: string; name: string }): Promise<FirmForecast> => {
    const mine: [string, string] = ['firm_id', firm.id];
    const [vendorRows, clientRows, gstRows, tdsRows, { data: taxes }, { data: plans }, { data: spends }] = await Promise.all([
      allRows<{ party_id: string; entry_type: string; entry_date: string; amount_paise: number | string }>(db, 'party_rows', ['entry_date', 'entry_id'], mine),
      allRows<{ party_id: string; entry_type: string; entry_date: string; receivable_paise: number | string }>(db, 'client_rows', ['entry_date', 'entry_id'], mine),
      allRows<{ entry_type: string; entry_date: string; gst_paise: number | string }>(db, 'gst_rows', ['entry_date', 'entry_id'], mine),
      allRows<{ entry_type: string; entry_date: string; tds_paise: number | string }>(db, 'tds_rows', ['entry_date', 'entry_id'], mine),
      db.from('tax_rows').select('account, amount_paise').eq('firm_id', firm.id),
      db.from('planned_money').select('*').eq('firm_id', firm.id).order('next_on').returns<PlanRow[]>(),
      db.from('money_rows').select('amount_paise').eq('firm_id', firm.id).eq('entry_type', 'site_cash_expense').gte('entry_date', addDays(today, -56)),
    ]);
    const items: Item[] = [];
    const byParty = <T extends { party_id: string }>(rows: T[]) => {
      const map = new Map<string, T[]>();
      for (const r of rows) map.set(r.party_id, [...(map.get(r.party_id) ?? []), r]);
      return map;
    };
    for (const [id, rows] of byParty(vendorRows)) {
      const bills = rows.filter((r) => r.entry_type !== 'vendor_payment').map((r) => ({ date: r.entry_date, amount: n(r.amount_paise) }));
      const paid = rows.filter((r) => r.entry_type === 'vendor_payment').reduce((s, r) => s + n(r.amount_paise), 0);
      for (const due of stillDue(bills, paid, credit.get(id) ?? 0)) items.push({ date: due.date, kind: 'parties', amount: -due.amount });
    }
    let clientExtra = 0;
    for (const [id, rows] of byParty(clientRows)) {
      const net = rows.reduce((s, r) => s + n(r.receivable_paise), 0);
      if (net < 0) clientExtra -= net;
      const bills = rows.filter((r) => r.entry_type !== 'client_receipt').map((r) => ({ date: r.entry_date, amount: n(r.receivable_paise) }));
      const got = -rows.filter((r) => r.entry_type === 'client_receipt').reduce((s, r) => s + n(r.receivable_paise), 0);
      for (const due of stillDue(bills, got, credit.get(id) ?? 0)) items.push({ date: due.date, kind: 'clients', amount: due.amount });
    }
    const paidTax = (account: string) => (taxes ?? []).filter((x) => x.account === account).reduce((s, x) => s + n(x.amount_paise), 0);
    const gst = taxDue(gstRows.map((r) => ({ month: r.entry_date.slice(0, 7), amount: r.entry_type === 'client_bill' ? n(r.gst_paise) : -n(r.gst_paise) })), paidTax('gst_paid'), month);
    const tds = taxDue(tdsRows.filter((r) => r.entry_type === 'vendor_bill').map((r) => ({ month: r.entry_date.slice(0, 7), amount: n(r.tds_paise) })), paidTax('tds_paid'), month);
    // The usual days: TDS by the 7th and GST by the 20th of the month after.
    const tax = (kind: 'gst' | 'tds', due: { past: number; now: number }, day: number) => {
      if (due.past) items.push({ date: dayOfMonth(today, day), kind, amount: -due.past });
      if (due.now) items.push({ date: dayOfMonth(today, day, 1), kind, amount: -due.now });
    };
    tax('gst', gst, 20);
    tax('tds', tds, 7);
    for (const p of plans ?? []) {
      for (const date of planDates(p, today, end)) items.push({ date, kind: p.direction === 'in' ? 'plannedIn' : 'plannedOut', amount: p.direction === 'in' ? n(p.amount_paise) : -n(p.amount_paise) });
    }
    // Site spends come every week without a bill: as much as in an average week of the last eight.
    const weekly = Math.round(-(spends ?? []).reduce((s, r) => s + n(r.amount_paise), 0) / WEEKS);
    if (weekly > 0) for (let w = 0; w < WEEKS; w++) items.push({ date: addDays(today, 7 * w + 6), kind: 'site', amount: -weekly });
    const partiesDue = -items.filter((i) => i.kind === 'parties' && i.date <= today).reduce((s, i) => s + i.amount, 0);
    return {
      ...firm, items, plans: plans ?? [], clientExtra, partiesDue,
      held: accounts.filter((a) => a.firm_id === firm.id).reduce((s, a) => s + a.balance, 0),
      gst: gst.past + gst.now, tds: tds.past + tds.now, salary: 0, wages: 0,
      otherFirms: -[...dues].filter(([key, due]) => key.startsWith(`${firm.id}/`) && due < 0).reduce((s, [, due]) => s + due, 0),
    };
  };
  const loaded = await Promise.all(firms.map(load));
  const of = (id: string | undefined) => loaded.find((f) => f.id === id);
  const dayOf = (id: string | undefined) => settings?.find((s) => s.id === id)?.salary_day ?? 7;
  const shared: Shared = { salary: 0, pf: 0, rent: 0, items: [] };

  /**
   * What a person is owed: from months that are over (due now, or on this month's salary day) and for this month (due next
   * month). A month not typed yet is expected to be as usual, less what has been given on it.
   */
  const pay = (kind: 'salary' | 'wages', firmId: string | undefined, now: { before: number; paid: number; balance: number } | undefined, usual: number, untyped = false) => {
    if (!now) return;
    const older = Math.max(now.before - now.paid, 0);
    const current = Math.max(now.balance - older, 0);
    const firm = of(firmId);
    // Paid by a firm this person does not see: not theirs to forecast.
    if (firmId && !firm && kind === 'wages') return;
    const target = firm ?? shared;
    if (kind === 'wages') (target as FirmForecast).wages += older + current;
    else target.salary += older + current;
    const day = dayOf(firmId);
    const add = (date: string, amount: number) => { if (amount > 0) target.items.push({ date, kind, amount: -amount }); };
    add(nextDay(today, day).startsWith(month) ? nextDay(today, day) : today, older);
    add(dayOfMonth(today, day, 1), current + (untyped ? Math.max(usual + Math.min(now.balance, 0), 0) : 0));
    add(dayOfMonth(today, day, 2), usual);
  };
  let pfCut = 0;
  for (const p of people) {
    const ledger = salaryLedger(p.person);
    const now = ledger.find((m) => m.month === month) ?? ledger.filter((m) => m.month < month).at(-1);
    pfCut += ledger.filter((m) => m.month <= month).reduce((s, m) => s + m.pf, 0);
    // Staff earn the same next month; a worker as much as the last month typed, when that is not long ago.
    const like = p.kind === 'staff' ? ledger.find((m) => m.month === month)
      : ledger.filter((m) => m.month < month && m.month >= lastMonth(lastMonth(month)) && m.salary > 0).at(-1);
    const carried = now && now.month < month ? { before: now.balance, paid: 0, balance: now.balance } : now;
    pay('salary', payer.get(p.id), carried, p.is_active && like ? like.salary - like.pf : 0,
      p.kind === 'worker' && !ledger.some((m) => m.month === month && m.salary > 0));
  }
  const labourFirm = settings?.find((s) => s.runs_labour)?.id;
  if (labourFirm) {
    for (const f of families) {
      const now = f.ledger.find((m) => m.month === month);
      const like = f.ledger.filter((m) => m.month < month).at(-1);
      pay('wages', labourFirm, now ?? { before: f.balance, paid: 0, balance: f.balance }, f.head.is_active && like ? like.salary : 0);
    }
  }
  shared.pf = Math.max(pfCut - (pfPaid ?? []).reduce((s, r) => s + n(r.amount_paise), 0), 0);
  if (shared.pf) shared.items.push({ date: dayOfMonth(today, 15).startsWith(month) && dayOfMonth(today, 15) >= today ? dayOfMonth(today, 15) : dayOfMonth(today, 15, 1), kind: 'pf', amount: -shared.pf });
  shared.rent = (rentals ?? []).reduce((s, r) => s + rentPaise(Math.round(n(r.quantity) * 1000), n(r.rate_paise), rentDays(r.rented_on as string, (r.returned_on as string | null) ?? today)), 0);
  return { firms: loaded, shared };
}

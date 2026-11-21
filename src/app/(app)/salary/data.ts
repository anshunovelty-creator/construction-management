import type { createClient } from '@/lib/supabase/server';
import { daysInMonth, type PersonKind, type PfRate, type PfSwitch, type SalaryMoney, type SalaryPerson } from '@/lib/wages';
import { allRows } from '../labour/data';

type Db = Awaited<ReturnType<typeof createClient>>;

export interface SalaryParty {
  id: string;
  name: string;
  kind: PersonKind;
  phone: string;
  rate_paise: number | null;
  is_active: boolean;
  created_at: string;
}
export type MoneyLine = SalaryMoney & { id: string; party_id: string; method: 'cash' | 'bank' | null; note: string };
type Day = SalaryPerson['days'][number] & { party_id: string };

const endOfMonth = (date: string) => `${date.slice(0, 7)}-${String(daysInMonth(date)).padStart(2, '0')}`;

/**
 * Every worker and staff member (or one), with all their days, money lines and PF switches.
 * ponytail: reads every attendance day ever; add a per-month view when years of days make the page slow.
 */
export async function loadSalaryPeople(db: Db, today: string, id?: string) {
  const one = (column: string): [string, string] | undefined => (id ? [column, id] : undefined);
  const [parties, days, money, pf, pfRates] = await Promise.all([
    allRows<Omit<SalaryParty, 'kind'> & { kind: string }>(db, 'parties', ['name', 'id'], one('id')),
    allRows<Day>(db, 'labour_day', ['work_date', 'id'], one('party_id')),
    allRows<MoneyLine>(db, 'salary_money', ['money_date', 'created_at'], one('party_id')),
    allRows<PfSwitch & { party_id: string }>(db, 'salary_pf', ['from_month'], one('party_id')),
    allRows<PfRate>(db, 'pf_rates', ['from_date']),
  ]);
  const of = <T extends { party_id: string }>(rows: T[], partyId: string) => rows.filter((r) => r.party_id === partyId);
  return parties.filter((p): p is SalaryParty => p.kind === 'worker' || p.kind === 'staff').map((p) => {
    const mine = { days: of(days, p.id), money: of(money, p.id), pf: of(pf, p.id) };
    const dates = [...mine.days.map((d) => d.work_date), ...mine.money.map((m) => m.money_date)].sort();
    // Staff earn from the day they were added (or first marked or paid); while active, to the end of this month.
    const from = [dates[0], p.kind === 'staff' ? p.created_at.slice(0, 10) : undefined].filter((d): d is string => !!d).sort()[0] ?? today;
    const to = p.is_active && p.kind === 'staff' ? endOfMonth(today) : endOfMonth(dates.at(-1) ?? from);
    const person: SalaryPerson = { kind: p.kind, ratePaise: Number(p.rate_paise ?? 0), from, to, ...mine, pfRates };
    return { ...p, person, money: mine.money };
  });
}

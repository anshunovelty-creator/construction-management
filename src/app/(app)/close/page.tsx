import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AutoForm } from '@/components/auto-form';
import { requireProfile } from '@/lib/auth';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { daysInMonth, lastMonth } from '@/lib/wages';
import { loadDues, loadFirms } from '../between/data';
import { loadNames, showDate, showMoment, todayInIndia } from '../entries/data';
import { showMonth } from '../labour/data';
import { loadAccounts, type BankMatch, type MoneyRow } from '../bankbook/data';
import { lockMonth, unlockMonth } from './actions';

/** Every check for a month on one page, then the lock: after it nothing dated in the month or before can be added or changed. */
export default async function CloseMonthPage({ searchParams }: { searchParams: Promise<{ month?: string; error?: string }> }) {
  await requireProfile('owner');
  const [t, asked] = await Promise.all([getTranslations(), searchParams]);
  const last = lastMonth(todayInIndia().slice(0, 7));
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(asked.month ?? '') && asked.month! <= last ? asked.month! : last;
  const end = `${month}-${daysInMonth(`${month}-01`)}`;
  const db = await createClient();
  const [accounts, firms, dues, names, { data: locks }, { data: statements }, { data: counts }, { data: unknown }, { data: proof }, ...ends] = await Promise.all([
    loadAccounts(db), loadFirms(db), loadDues(db), loadNames(db),
    db.from('books_locks').select('locked_through, actor, reason, created_at').order('id', { ascending: false }).limit(12),
    db.from('bank_match').select('*').eq('statement_date', end).returns<BankMatch[]>(),
    db.from('cash_counts').select('money_account_id, counted_paise, expected_paise').eq('count_date', end).order('created_at'),
    db.from('money_rows').select('entry_id, entry_date').eq('entry_type', 'not_yet_known').lte('entry_date', end),
    db.from('firm_proof').select('firm_id, total_paise'),
  ]).then(async (all) => [...all, ...await Promise.all(all[0].filter((a) => a.firm_id).map((a) =>
    db.from('money_rows').select('money_account_id, balance_paise').eq('money_account_id', a.id).lte('entry_date', end).order('position', { ascending: false }).limit(1).maybeSingle<MoneyRow>()))] as const);
  const lock = locks?.[0]?.locked_through as string | undefined;
  const locked = lock !== undefined && lock >= end;
  const mine = accounts.filter((a) => a.firm_id);
  const heldAt = new Map(mine.map((a, i) => [a.id, (ends as { data: MoneyRow | null }[])[i]?.data]));
  // An account with nothing in it by then has nothing to check.
  const used = mine.filter((a) => heldAt.get(a.id));
  type Check = { ok: boolean; what: string; detail?: string; href?: string };
  const checks: Check[] = [
    ...used.filter((a) => a.kind === 'bank').map((a): Check => {
      const s = statements?.find((x) => x.money_account_id === a.id);
      const difference = s ? Number(s.balance_paise) - Number(s.expected_paise) : 0;
      return { ok: Boolean(s) && difference === 0, what: t('close.bank', { name: a.name }), href: `/bankbook/${a.id}/match?date=${end}`,
        detail: !s ? t('close.notMatched', { date: showDate(end) }) : difference === 0 ? t('close.agrees', { amount: showPaise(Number(s.balance_paise)) }) : t('close.differs', { amount: showPaise(Math.abs(difference)) }) };
    }),
    ...used.filter((a) => a.kind !== 'bank').map((a): Check => {
      const c = counts?.filter((x) => x.money_account_id === a.id).at(-1);
      const held = Number(heldAt.get(a.id)?.balance_paise ?? 0);
      return { ok: Boolean(c) && Number(c!.counted_paise) === held, what: t('close.cash', { name: a.name }), href: `/bankbook/${a.id}/count`,
        detail: !c ? t('close.notCounted', { date: showDate(end), amount: showPaise(held) }) : Number(c.counted_paise) === held ? t('close.agrees', { amount: showPaise(held) }) : t('close.changedSince', { amount: showPaise(held) }) };
    }),
    ...used.filter((a) => a.kind !== 'bank' && Number(heldAt.get(a.id)?.balance_paise) < 0).map((a): Check => ({ ok: false, what: t('close.belowZero', { name: a.name }), href: `/bankbook/${a.id}?month=${month}` })),
    { ok: (unknown ?? []).length === 0, what: t('close.unknown'), detail: (unknown ?? []).length ? t('close.unknownLeft', { count: (unknown ?? []).length }) : undefined, href: '/bankbook?firms=all' },
    ...firms.flatMap((a, i) => firms.slice(i + 1).map((b): Check => {
      const off = (dues.get(`${a.id}/${b.id}`) ?? 0) + (dues.get(`${b.id}/${a.id}`) ?? 0);
      return { ok: off === 0, what: t('close.pair', { a: a.name, b: b.name }), detail: off ? showPaise(Math.abs(off)) : undefined, href: '/' };
    })),
    ...firms.map((f): Check => {
      const off = Number(proof?.find((p) => p.firm_id === f.id)?.total_paise ?? 0);
      return { ok: off === 0, what: t('close.books', { firm: f.name }), detail: off ? showPaise(off) : undefined };
    }),
  ];
  const left = checks.filter((c) => !c.ok).length;

  return (
    <>
      <h1>{t('close.title')}</h1>
      <p className="lede">{t('close.lede')}</p>
      {asked.error && <p className="banner bad" role="alert">{asked.error}</p>}
      <div className="toolbar">
        <AutoForm action="/close" className="date-filter">
          <label className="muted" htmlFor="close-month">{t('salary.month')}</label>
          <input key={month} id="close-month" type="month" name="month" defaultValue={month} max={last} required />
        </AutoForm>
        <p className="hint">{lock ? t('close.lockedThrough', { date: showDate(lock) }) : t('close.neverLocked')}</p>
      </div>
      <h2>{showMonth(month)}</h2>
      <p className={`banner${left ? ' bad' : ''}`}>{left ? t('close.left', { count: left }) : t('close.allGood')}</p>
      <div className="card table-wrap flush"><table className="ledger">
        <tbody>{checks.map((c) => (
          <tr key={c.what}>
            <td><span className={`pill ${c.ok ? 'cleared' : 'pending'}`}>{t(c.ok ? 'close.ok' : 'close.check')}</span></td>
            <td><strong>{c.what}</strong>{c.detail && <span className="muted"> · {c.detail}</span>}</td>
            <td>{!c.ok && c.href && <Link href={c.href} className="underline">{t('close.open')}</Link>}</td>
          </tr>
        ))}</tbody>
      </table></div>
      <div className="ledger-section">
        {locked ? (
          <form action={unlockMonth.bind(null, month)} className="card labour-form">
            <p>{t('close.isLocked', { month: showMonth(month) })}</p>
            <div className="field"><label htmlFor="u-reason">{t('close.unlockReason')}</label><input id="u-reason" name="reason" required /></div>
            <div className="labour-form-end"><button type="submit" className="btn ghost">{t('close.unlock', { month: showMonth(month) })}</button></div>
          </form>
        ) : (
          <form action={lockMonth.bind(null, month)} className="card">
            <p>{t('close.lockHint', { date: showDate(end) })}</p>
            {left > 0 && <p className="hint minus">{t('close.lockAnyway', { count: left })}</p>}
            <button type="submit" className={`btn big${left ? ' ghost' : ''}`}>{t('close.lock', { month: showMonth(month) })}</button>
          </form>
        )}
      </div>
      {(locks ?? []).length > 0 && (
        <section className="ledger-section"><h2 className="section-title">{t('close.history')}</h2>
          <ul className="events">{(locks ?? []).map((l, i) => (
            <li key={i}>{t('close.lockedThrough', { date: showDate(l.locked_through as string) })} · {names.people.get(l.actor as string) ?? '?'} · {showMoment(l.created_at as string)}{l.reason && <> · “{l.reason}”</>}</li>
          ))}</ul>
        </section>
      )}
    </>
  );
}

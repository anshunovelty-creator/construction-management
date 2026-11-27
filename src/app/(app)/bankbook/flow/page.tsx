import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AutoForm } from '@/components/auto-form';
import { Icon } from '@/components/icons';
import { PrintButton } from '@/components/print-button';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { lastMonth } from '@/lib/wages';
import { todayInIndia } from '../../entries/data';
import { showMonth } from '../../labour/data';
import { MoneyCell, Stat } from '../../party/shared';

interface FlowRow { firm_id: string; month: string; entry_type: string; between_firms: boolean; in_paise: number | string; out_paise: number | string; reason: string | null }

/** Where the working firm's money went in a month: opening + money in − money out = closing, by kind. */
export default async function MoneyFlowPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireProfile('owner', 'office');
  const [working, t, asked] = await Promise.all([getWorkingFirm(), getTranslations(), searchParams]);
  if (!working) return <p className="empty">{t('party.noFirm')}</p>;
  const thisMonth = todayInIndia().slice(0, 7);
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(asked.month ?? '') ? asked.month! : thisMonth;
  const db = await createClient();
  const flow = db.from('money_flow').select('*').lte('month', month).eq('firm_id', working.firm.id);
  const held = db.from('balances').select('amount_paise').eq('account', 'money').eq('firm_id', working.firm.id);
  const [{ data, error }, { data: balances }] = await Promise.all([flow.returns<FlowRow[]>(), held]);
  if (error) throw new Error(error.message);
  const rows = (data ?? []).map((r) => ({ ...r, in: Number(r.in_paise), out: Number(r.out_paise) }));
  // An opening balance is what there was to start with, not money that came in.
  const opening = rows.filter((r) => r.month < month || r.entry_type === 'opening').reduce((s, r) => s + r.in - r.out, 0);
  // Moves between a firm's own accounts never count.
  const mine = rows.filter((r) => r.month === month && r.entry_type !== 'opening' && r.entry_type !== 'cash_transfer');
  const kinds = new Map<string, { in: number; out: number }>();
  for (const r of mine) {
    const key = r.entry_type === 'vendor_payment' && r.between_firms ? 'forFirm' : r.reason ?? r.entry_type;
    const k = kinds.get(key) ?? { in: 0, out: 0 };
    k.in += r.in;
    k.out += r.out;
    kinds.set(key, k);
  }
  const came = [...kinds.values()].reduce((s, k) => s + k.in, 0);
  const went = [...kinds.values()].reduce((s, k) => s + k.out, 0);
  const closing = opening + came - went;
  const now = (balances ?? []).reduce((s, r) => s + Number(r.amount_paise), 0);
  const agrees = month !== thisMonth || closing === now;
  const query = (m: string) => `/bankbook/flow?month=${m}`;
  const chip = (href: string, on: boolean, label: string) => <Link href={href} className={`chip${on ? ' on' : ''}`}>{label}</Link>;

  return (
    <>
      <Link href="/bankbook" className="back no-print"><Icon name="chevronLeft" size={16} /> {t('nav.bankbook')}</Link>
      <div className="ledger-head">
        <div>
          <p className="muted ledger-firm">{working.firm.name}</p>
          <h1>{t('flow.title')}</h1>
          <p className="muted">{showMonth(month)}</p>
        </div>
        <PrintButton label={t('ledger.print')} />
      </div>
      <div className="card report-bar salary-bar no-print">
        <nav className="filters" aria-label={t('salary.month')}>
          {chip(query(thisMonth), month === thisMonth, t('salary.thisMonth'))}
          {chip(query(lastMonth(thisMonth)), month === lastMonth(thisMonth), t('salary.lastMonth'))}
        </nav>
        <AutoForm action="/bankbook/flow" className="date-filter">
          <label className="muted" htmlFor="flow-month">{t('salary.month')}</label>
          <input key={month} id="flow-month" type="month" name="month" defaultValue={month} max={thisMonth} required />
        </AutoForm>
      </div>
      <div className="stats">
        <Stat label={t('flow.start')} value={showPaise(opening)} />
        <Stat label={t('flow.came')} value={showPaise(came)} tone="done" />
        <Stat label={t('flow.went')} value={showPaise(went)} tone="owe" />
        <Stat label={t(month === thisMonth ? 'flow.now' : 'flow.end')} value={showPaise(closing)} />
      </div>
      {!agrees && <p className="banner bad" role="alert">{t('flow.mismatch', { amount: showPaise(now) })}</p>}
      <div className="card table-wrap flush">
        <table className="ledger statement">
          <thead><tr><th>{t('flow.what')}</th><th className="num">{t('bankbook.in')}</th><th className="num">{t('bankbook.out')}</th></tr></thead>
          <tbody>
            <tr><td><strong>{t('flow.start')}</strong></td><td className="num strong" colSpan={2}>{showPaise(opening)}</td></tr>
            {kinds.size === 0 && <tr><td colSpan={3} className="muted">{t('bankbook.none')}</td></tr>}
            {[...kinds].sort(([, a], [, b]) => b.in + b.out - a.in - a.out).map(([key, k]) => (
              <tr key={key}>
                <td className={key === 'not_yet_known' ? 'minus' : undefined}>{key === 'forFirm' ? t('flow.forFirm') : t.has(`bankbook.reasons.${key}`) ? t(`bankbook.reasons.${key}`) : t(`entryTypes.${key}.title`)}</td>
                <MoneyCell paise={k.in} tone="plus" /><MoneyCell paise={k.out} tone="minus" />
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td>{t('bankbook.total')}</td><td className="num plus">{showPaise(came)}</td><td className="num minus">{showPaise(went)}</td></tr>
            <tr className="ledger-grand"><td>{t(month === thisMonth ? 'flow.now' : 'flow.end')}</td><td className="num strong" colSpan={2}>{showPaise(closing)}</td></tr>
          </tfoot>
        </table>
      </div>
      <p className="hint">{t('flow.note')}</p>
    </>
  );
}

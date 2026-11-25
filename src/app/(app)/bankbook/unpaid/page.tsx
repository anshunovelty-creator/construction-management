import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AccountOptions } from '@/components/account-options';
import { Icon } from '@/components/icons';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { showDate, todayInIndia } from '../../entries/data';
import { MoneyCell, Stat } from '../../party/shared';
import { labourFirm, payAccounts } from '../../pay/data';
import { payCost } from '../../report/actions';
import { markOnBill, payService } from '../actions';
import { loadUnpaid, type Unpaid } from '../data';

/** Costs typed as not paid yet: other costs on the daily reports of every site, and machine services. Pay each one, or say it is on a party's bill. */
export default async function UnpaidPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const profile = await requireProfile('owner', 'office');
  const [{ error }, working, t] = await Promise.all([searchParams, getWorkingFirm(), getTranslations()]);
  if (!working) return <p className="empty">{t('party.noFirm')}</p>;
  const { firm } = working;
  const db = await createClient();
  const today = todayInIndia();
  const [accounts, labour, rows] = await Promise.all([payAccounts(db, profile.role, firm.id), labourFirm(db), loadUnpaid(db)]);
  // A machine is serviced by the firm that owns it.
  const mine = rows.filter((r) => r.kind === 'cost' || labour?.id === firm.id);
  const open = mine.filter((r) => !r.onBill);
  const billed = mine.filter((r) => r.onBill);

  const line = (r: Unpaid) => (
    <tr key={r.id}>
      <td className="nowrap">{showDate(r.date)}</td>
      <td><Link href={r.kind === 'cost' ? `/report?site=${r.placeId}&date=${r.date}` : `/machines/${r.placeId}`} className="party-link">{r.place}</Link></td>
      <td>{r.what}{r.head && <span className="muted"> · {t(`options.cost_head.${r.head}`)}</span>}</td>
      <MoneyCell paise={r.amount} strong />
      <td>
        <div className="unpaid-do">
          {!r.onBill && accounts.length > 0 && (
            <details className="pay-cost">
              <summary className="btn small">{t('payList.party.button')}</summary>
              <form action={r.kind === 'cost' ? payCost.bind(null, r.id, crypto.randomUUID(), r.placeId, r.date) : payService.bind(null, r.id, crypto.randomUUID())}>
                <input type="hidden" name="back" value="unpaid" />
                <select name="account" required defaultValue="" aria-label={t('report.other.paidFrom')}><option value="">{t('bankbook.popup.pick')}</option><AccountOptions accounts={accounts} /></select>
                <input type="date" name="date" required defaultValue={today} max={today} aria-label={t('fields.entry_date')} />
                <button type="submit" className="btn small">{t('payList.party.button')}</button>
              </form>
            </details>
          )}
          <form action={markOnBill.bind(null, r.kind, r.id, !r.onBill)}>
            <button type="submit" className="btn ghost small">{t(r.onBill ? 'unpaid.notOnBill' : 'unpaid.onBill')}</button>
          </form>
        </div>
      </td>
    </tr>
  );
  const table = (list: Unpaid[]) => (
    <section className="card table-wrap flush">
      <table className="ledger">
        <thead><tr><th>{t('fields.entry_date')}</th><th>{t('unpaid.place')}</th><th>{t('unpaid.what')}</th><th className="num">{t('labour.amount')}</th><th aria-label={t('payList.party.button')} /></tr></thead>
        <tbody>{list.map(line)}</tbody>
      </table>
    </section>
  );

  return (
    <>
      <Link href="/bankbook/pay" className="back"><Icon name="chevronLeft" size={16} /> {t('payList.party.title', { firm: firm.name })}</Link>
      <h1>{t('unpaid.title')}</h1>
      <p className="lede">{t('unpaid.lede', { firm: firm.name })}</p>
      {error && <p className="banner bad" role="alert">{error}</p>}
      {accounts.length === 0 && <p className="banner bad">{t('party.needAccount')} <Link href="/masters/money-accounts" className="underline">{t('party.goSetup')}</Link></p>}
      <div className="stats"><Stat label={t('party.balance')} value={showPaise(open.reduce((s, r) => s + r.amount, 0))} tone={open.length > 0 ? 'owe' : 'done'} note={t('unpaid.count', { count: open.length })} /></div>
      {open.length > 0 ? table(open) : <p className="card empty-state">{t('unpaid.none')}</p>}
      {billed.length > 0 && (
        <details className="mt-6">
          <summary className="btn ghost">{t('unpaid.billed', { count: billed.length })}</summary>
          <div className="mt-6">{table(billed)}</div>
        </details>
      )}
    </>
  );
}

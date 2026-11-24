import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { RupeesInput } from '@/components/form';
import { Icon } from '@/components/icons';
import { requireProfile } from '@/lib/auth';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { loadNames, showDate, showMoment, todayInIndia } from '../../../entries/data';
import { MoneyCell } from '../../../party/shared';
import { countCash } from '../../actions';
import { loadAccounts } from '../../data';

interface Count { id: string; count_date: string; counted_paise: number | string; expected_paise: number | string; entry_id: string | null; note: string; created_by: string; created_at: string }

/** Counts the cash in a firm's cash account. A difference is recorded against this account on its own. */
export default async function CountCashPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; done?: string }> }) {
  await requireProfile('owner', 'office');
  const [{ id }, asked, t] = await Promise.all([params, searchParams, getTranslations()]);
  const db = await createClient();
  const account = (await loadAccounts(db)).find((a) => a.id === id);
  if (!account || account.kind === 'bank' || !account.firm_id) notFound();
  const today = todayInIndia();
  const [{ data: counts }, names] = await Promise.all([
    db.from('cash_counts').select('*').eq('money_account_id', id).order('count_date', { ascending: false }).order('created_at', { ascending: false }).limit(31).returns<Count[]>(),
    loadNames(db),
  ]);
  return (
    <>
      <Link href={`/bankbook/${id}`} className="back"><Icon name="chevronLeft" size={16} /> {account.name}</Link>
      <h1>{t('count.title', { name: account.name })}</h1>
      <p className="lede">{t('count.lede')}</p>
      {asked.error && <p className="banner bad" role="alert">{asked.error}</p>}
      {asked.done !== undefined && <p className={`banner${asked.done === '0' ? '' : ' bad'}`} role="status">
        {asked.done === '0' ? t('count.matches') : t(Number(asked.done) < 0 ? 'count.short' : 'count.extra', { amount: showPaise(Math.abs(Number(asked.done))) })}</p>}
      <form action={countCash.bind(null, id, crypto.randomUUID())} className="card labour-form">
        <div className="field"><label htmlFor="c-date">{t('count.date')}</label><input id="c-date" type="date" name="date" required defaultValue={today} max={today} /><p className="hint">{t('count.dateHint')}</p></div>
        {/* The books' figure is not shown beside the box, so what is typed is what was counted. */}
        <div className="field"><label htmlFor="c-amount">{t('count.counted')}</label><RupeesInput input={{ id: 'c-amount', name: 'amount', required: true }} /></div>
        <div className="field"><label htmlFor="c-note">{t('party.remarks')}</label><input id="c-note" name="note" /></div>
        <div className="labour-form-end"><button type="submit" className="btn">{t('count.save')}</button></div>
      </form>
      {(counts ?? []).length > 0 && (
        <div className="card table-wrap flush"><table className="ledger">
          <thead><tr><th>{t('count.date')}</th><th className="num">{t('count.books')}</th><th className="num">{t('count.counted')}</th><th className="num">{t('count.difference')}</th><th>{t('entries.typedBy')}</th></tr></thead>
          <tbody>{(counts ?? []).map((c) => {
            const difference = Number(c.counted_paise) - Number(c.expected_paise);
            return (
              <tr key={c.id}>
                <td className="nowrap">{showDate(c.count_date)}</td>
                <MoneyCell paise={Number(c.expected_paise)} /><MoneyCell paise={Number(c.counted_paise)} />
                <td className={`num${difference < 0 ? ' minus' : difference > 0 ? ' plus' : ''}`}>{difference === 0 ? t('match.agrees')
                  : c.entry_id ? <Link href={`/entries/${c.entry_id}`} className="underline">{showPaise(difference)}</Link> : showPaise(difference)}</td>
                <td>{names.people.get(c.created_by) ?? ''} · {showMoment(c.created_at)}{c.note && <span className="muted"> · {c.note}</span>}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
    </>
  );
}

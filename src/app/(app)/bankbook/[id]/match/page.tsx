import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Icon } from '@/components/icons';
import { MatchForm } from '@/components/match-form';
import { requireProfile } from '@/lib/auth';
import { groupRupees, showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { loadNames, showDate, todayInIndia } from '../../../entries/data';
import { MoneyCell } from '../../../party/shared';
import { allMoneyRows, lineName, loadAccounts, type BankMatch } from '../../data';
import { saveMatch } from './actions';

/** How far back lines the bank already has are still shown, to be unticked. */
const RECENT = 62;

/** Matches a bank's bankbook with its statement. ?date= opens on that day. */
export default async function MatchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ date?: string }> }) {
  await requireProfile('owner', 'office');
  const [{ id }, asked, t] = await Promise.all([params, searchParams, getTranslations()]);
  const db = await createClient();
  const account = (await loadAccounts(db)).find((a) => a.id === id);
  if (!account || account.kind !== 'bank') notFound();
  const today = todayInIndia();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(asked.date ?? '') && asked.date! <= today ? asked.date! : today;
  const [rows, { data: statements }, names] = await Promise.all([
    allMoneyRows(db, id),
    db.from('bank_match').select('*').eq('money_account_id', id).order('statement_date', { ascending: false }).limit(12).returns<BankMatch[]>(),
    loadNames(db),
  ]);
  const since = new Date(Date.parse(`${date}T00:00:00Z`) - RECENT * 86_400_000).toISOString().slice(0, 10);
  const old = (r: (typeof rows)[number]) => r.entry_type === 'opening' || (r.cleared_on !== null && r.cleared_on < since);
  // An opening counts from its own day; a statement from before it is outside the account's books.
  const opening = rows.filter(old).reduce((s, r) => s + Number(r.amount_paise), 0);
  const said = statements?.find((s) => s.statement_date === date);

  return (
    <>
      <Link href={`/bankbook/${id}`} className="back"><Icon name="chevronLeft" size={16} /> {account.name}</Link>
      <h1>{t('match.title', { name: account.name })}</h1>
      <p className="lede">{t('match.lede')}</p>
      <MatchForm key={`${date}${rows.length}`} today={today} date={date} since={since} opening={opening}
        balance={said ? groupRupees(String(Math.abs(Number(said.balance_paise)) / 100)) : ''} overdrawn={said ? Number(said.balance_paise) < 0 : false}
        lines={rows.filter((r) => !old(r)).map((r) => ({
          id: r.entry_id, date: r.entry_date, showDate: showDate(r.entry_date), who: lineName(r, names, t), note: [r.reference, r.narration].filter(Boolean).join(' · '),
          amount: Number(r.amount_paise), clearedOn: r.cleared_on,
        }))} save={saveMatch.bind(null, id)} />
      {(statements ?? []).length > 0 && (
        <section className="ledger-section">
          <h2>{t('match.before')}</h2>
          <div className="card table-wrap flush"><table className="ledger">
            <thead><tr><th>{t('match.date')}</th><th className="num">{t('match.bankSays')}</th><th className="num">{t('match.expected')}</th><th>{t('match.difference')}</th></tr></thead>
            <tbody>{(statements ?? []).map((s) => {
              const difference = Number(s.balance_paise) - Number(s.expected_paise);
              return (
                <tr key={s.statement_date}>
                  <td><Link href={`/bankbook/${id}/match?date=${s.statement_date}`} className="underline">{showDate(s.statement_date)}</Link></td>
                  <MoneyCell paise={Number(s.balance_paise)} /><MoneyCell paise={Number(s.expected_paise)} />
                  <td>{difference === 0 ? <span className="pill cleared">{t('match.agrees')}</span> : <span className="pill pending">{showPaise(difference)}</span>}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        </section>
      )}
    </>
  );
}

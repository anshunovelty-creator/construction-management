import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Icon } from '@/components/icons';
import { ListLink } from '@/components/list-link';
import { MoneyPopup } from '@/components/money-popup';
import { PrintButton } from '@/components/print-button';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { loadAccounts } from '../../bankbook/data';
import { postMoney } from '../../entries/actions';
import { loadNames, showDate, todayInIndia } from '../../entries/data';
import { BalanceCell, MoneyCell } from '../../party/shared';
import { lendersOf, loadLoans, pickable } from '../data';

/** One lender's statement with the working firm: each amount borrowed and returned, and what is left after it. */
export default async function LenderPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile('owner', 'office');
  const [{ id }, working, t] = await Promise.all([params, getWorkingFirm(), getTranslations()]);
  if (!working) return <p className="empty">{t('party.noFirm')}</p>;
  const { firm } = working;
  const db = await createClient();
  const none = id === 'none';
  const [all, { data: person }, names, everything] = await Promise.all([
    loadLoans(db, firm.id),
    none ? { data: null } : db.from('parties').select('id, name, is_active').eq('id', id).eq('kind', 'lender').maybeSingle(),
    loadNames(db),
    loadAccounts(db),
  ]);
  if (!none && !person) notFound();
  const rows = all.filter((r) => (none ? r.party_id === null : r.party_id === id));
  let left = 0;
  const lines = rows.map((r) => ({ ...r, amount: Number(r.amount_paise), left: (left += Number(r.amount_paise)) }));
  const borrowed = lines.reduce((s, r) => s + Math.max(r.amount, 0), 0);
  const today = todayInIndia();
  const accounts = everything.filter((a) => a.firm_id === firm.id && a.is_active);
  const lender = person && lendersOf(rows, [person])[0];
  const popup = (mode: 'in' | 'out', reason: string, button: string) => (
    <MoneyPopup mode={mode} preset={{ reason, who: id }} button={button} firm={firm} account="" accounts={accounts} people={[]}
      lenders={lender ? pickable([lender]) : []} owner={profile.role === 'owner'} today={today} save={postMoney} />
  );

  return (
    <>
      <Link href="/borrowed" className="back no-print"><Icon name="chevronLeft" size={16} /> {t('borrowed.back')}</Link>
      <div className="ledger-head">
        <div>
          <p className="muted ledger-firm">{firm.name}</p>
          <h1>{person?.name ?? t('borrowed.noName')}</h1>
        </div>
        <PrintButton label={t('ledger.print')} />
      </div>
      <p className={`banner${left > 0 ? ' bad' : ''}`}><span><strong>{t('borrowed.left')}</strong> {showPaise(left)}</span></p>

      {person?.is_active && accounts.length > 0 && (
        <div className="quick-add no-print"><div className="quick-buttons">
          {popup('out', 'loan_out', t('borrowed.give'))}
          {popup('in', 'loan_in', t('borrowed.borrow'))}
        </div></div>
      )}

      <div className="card table-wrap flush">
        <table className="ledger statement">
          <thead>
            <tr>
              <th>{t('ledger.date')}</th>
              <th>{t('borrowed.what')}</th>
              <th>{t('party.entry')}</th>
              <th className="num">{t('borrowed.borrowed')}</th>
              <th className="num">{t('borrowed.returned')}</th>
              <th className="num">{t('borrowed.left')}</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && <tr><td colSpan={6} className="muted">{t('borrowed.none')}</td></tr>}
            {lines.map((r) => (
              <tr key={r.entry_id}>
                <td className="nowrap">{showDate(r.entry_date)}</td>
                <td className="particulars">
                  <strong>{t(r.amount > 0 ? 'borrowed.inMonth' : 'borrowed.outMonth')}</strong>
                  {[names.accounts.get(r.money_account_id), r.reference].filter(Boolean).map((bit, i) => <span key={i} className="muted"> · {bit}</span>)}
                  {r.narration && <span className="ledger-note">{r.narration}</span>}
                </td>
                <td className="nowrap"><ListLink href={`/entries/${r.entry_id}`} className="serial underline">{r.serial}</ListLink></td>
                <MoneyCell paise={Math.max(r.amount, 0)} />
                <MoneyCell paise={Math.max(-r.amount, 0)} />
                <BalanceCell paise={r.left} t={t} side="lender" />
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="nowrap">{showDate(today)}</td>
              <td colSpan={2}><strong>{t('ledger.closingBalance')}</strong></td>
              <MoneyCell paise={borrowed} strong />
              <MoneyCell paise={borrowed - left} strong />
              <BalanceCell paise={left} t={t} side="lender" />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="muted ledger-printed">{t('ledger.printedOn', { date: showDate(today) })}</p>
    </>
  );
}

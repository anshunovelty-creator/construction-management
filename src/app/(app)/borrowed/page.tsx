import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Icon } from '@/components/icons';
import { ListLink } from '@/components/list-link';
import { MoneyPopup } from '@/components/money-popup';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { loadAccounts } from '../bankbook/data';
import { postMoney } from '../entries/actions';
import { todayInIndia } from '../entries/data';
import { BalanceCell, MoneyCell, Stat } from '../party/shared';
import { loadLenders, pickable } from './data';

/** Money → Borrowed money: each person who lent the working firm money, with what is left to return. */
export default async function BorrowedPage() {
  const profile = await requireProfile('owner', 'office');
  const [working, t] = await Promise.all([getWorkingFirm(), getTranslations()]);
  if (!working) return <p className="empty">{t('party.noFirm')}</p>;
  const { firm } = working;
  const db = await createClient();
  const [lenders, everything] = await Promise.all([loadLenders(db, firm.id), loadAccounts(db)]);
  const accounts = everything.filter((a) => a.firm_id === firm.id && a.is_active);
  const shown = lenders.filter((l) => l.active || l.borrowed || l.returned);
  const left = shown.reduce((s, l) => s + Math.max(l.left, 0), 0);
  const popup = (mode: 'in' | 'out', reason: string, button: string) => (
    <MoneyPopup mode={mode} preset={{ reason }} button={button} firm={firm} account="" accounts={accounts} people={[]}
      lenders={pickable(lenders)} owner={profile.role === 'owner'} today={todayInIndia()} save={postMoney} />
  );

  return (
    <>
      <h1>{t('borrowed.title')}</h1>
      <p className="lede">{t('borrowed.lede')}</p>
      {accounts.length === 0 ? (
        <p className="banner bad">{t('borrowed.noAccount')} <Link href="/masters/money-accounts" className="underline">{t('party.goSetup')}</Link></p>
      ) : (
        <div className="quick-add no-print"><div className="quick-buttons">
          {popup('in', 'loan_in', t('borrowed.borrow'))}
          {popup('out', 'loan_out', t('borrowed.give'))}
          <Link href="/masters/parties#add" className="btn big ghost"><Icon name="parties" /> {t('borrowed.addPerson')}</Link>
        </div></div>
      )}

      <div className="stats">
        <Stat label={t('borrowed.left')} value={showPaise(left)} tone="owe" />
      </div>

      <div className="card table-wrap flush">
        <table className="ledger clickable">
          <thead>
            <tr>
              <th>{t('borrowed.person')}</th>
              <th className="num">{t('borrowed.borrowed')}</th>
              <th className="num">{t('borrowed.returned')}</th>
              <th className="num">{t('borrowed.left')}</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={4} className="muted">{t('borrowed.none')}</td></tr>}
            {shown.map((l) => (
              <tr key={l.id}>
                <td><ListLink href={`/borrowed/${l.id || 'none'}`} className="party-link">{l.name || t('borrowed.noName')}</ListLink></td>
                <MoneyCell paise={l.borrowed} />
                <MoneyCell paise={l.returned} />
                <BalanceCell paise={l.left} t={t} side="lender" />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

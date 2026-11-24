import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { RupeesInput } from '@/components/form';
import { Icon } from '@/components/icons';
import { requireProfile } from '@/lib/auth';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { showDate, todayInIndia } from '../../../entries/data';
import { removeAccountOpening, saveAccountOpening } from '../../actions';
import { loadAccounts, type MoneyRow } from '../../data';

const ERRORS = new Set(['date', 'amount', 'reason', 'cash_overdrawn']);

/** A bank or cash account's opening balance: what it held at the start of the day it is kept from. Owner only. */
export default async function AccountOpeningPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await requireProfile('owner');
  const [{ id }, { error }, t] = await Promise.all([params, searchParams, getTranslations()]);
  const db = await createClient();
  const account = (await loadAccounts(db)).find((a) => a.id === id);
  if (!account?.firm_id) notFound();
  const { data: opening } = await db.from('money_rows').select('*').eq('money_account_id', id).eq('entry_type', 'opening').maybeSingle<MoneyRow>();
  const amount = Number(opening?.amount_paise ?? 0);

  return (
    <>
      <Link href={`/bankbook/${id}`} className="back"><Icon name="chevronLeft" size={16} /> {account.name}</Link>
      <h1>{t('bankbook.opening.title', { name: account.name })}</h1>
      <p className="lede">{t('bankbook.opening.lede')}</p>
      {error && <p className="banner bad" role="alert">{ERRORS.has(error) ? t(`bankbook.opening.errors.${error}`) : error}</p>}
      {opening && <p className={`banner${amount < 0 ? ' bad' : ''}`}>{t('bankbook.opening.now', { amount: showPaise(amount), date: showDate(opening.entry_date) })}</p>}
      <form action={saveAccountOpening.bind(null, id)} className="card labour-form">
        {account.kind === 'bank' && (
          <fieldset className="field wide">
            <legend>{t('bankbook.opening.side')}</legend>
            <label className="check-line"><input type="radio" name="side" value="in" defaultChecked={amount >= 0} required /> {t('bankbook.opening.sideIn')}</label>
            <label className="check-line"><input type="radio" name="side" value="over" defaultChecked={amount < 0} /> {t('bankbook.opening.sideOver')}</label>
          </fieldset>
        )}
        <div className="field">
          <label htmlFor="o-amount">{t('labour.amount')}</label>
          <RupeesInput input={{ id: 'o-amount', name: 'amount', required: true, defaultValue: amount ? String(Math.abs(amount) / 100) : '' }} />
        </div>
        <div className="field">
          <label htmlFor="o-date">{t('bankbook.opening.date')}</label>
          <input id="o-date" type="date" name="date" defaultValue={opening?.entry_date ?? todayInIndia()} max={todayInIndia()} required />
          <p className="hint">{t('bankbook.opening.dateHint')}</p>
        </div>
        {opening && (
          <div className="field">
            <label htmlFor="o-reason">{t('bankbook.opening.reason')}</label>
            <input id="o-reason" name="reason" required />
          </div>
        )}
        <div className="labour-form-end"><button type="submit" className="btn">{t('labour.save')}</button></div>
      </form>
      {opening && (
        <form action={removeAccountOpening.bind(null, id)} className="card labour-form">
          <div className="field">
            <label htmlFor="r-reason">{t('bankbook.opening.removeReason')}</label>
            <input id="r-reason" name="reason" required />
          </div>
          <div className="labour-form-end"><button type="submit" className="btn ghost">{t('labour.opening.remove')}</button></div>
        </form>
      )}
    </>
  );
}

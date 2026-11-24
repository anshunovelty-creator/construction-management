import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { RupeesInput } from '@/components/form';
import { Icon } from '@/components/icons';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { showDate, todayInIndia } from '../../../entries/data';
import { saveFirmOpening } from '../../actions';
import { loadFirms, type FirmRow } from '../../data';

const ERRORS = new Set(['date', 'amount', 'reason', 'side']);

/** What the working firm and another of our firms owed each other at the start. Typed once, for both. Owner only. */
export default async function FirmOpeningPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  await requireProfile('owner');
  const [{ id }, { error }, working, t] = await Promise.all([params, searchParams, getWorkingFirm(), getTranslations()]);
  const db = await createClient();
  const them = (await loadFirms(db)).find((f) => f.id === id);
  if (!working || !them || them.id === working.firm.id) notFound();
  const { firm } = working;
  const { data: opening } = await db.from('firm_rows').select('*').eq('firm_id', firm.id).eq('counter_firm_id', id).eq('entry_type', 'opening').maybeSingle<FirmRow>();
  const amount = Number(opening?.amount_paise ?? 0);
  const owes = (us: boolean) => t('between.owes', { debtor: us ? firm.name : them.name, creditor: us ? them.name : firm.name });

  return (
    <>
      <Link href={`/between/${id}`} className="back"><Icon name="chevronLeft" size={16} /> {them.name}</Link>
      <h1>{t('between.openingTitle', { a: firm.name, b: them.name })}</h1>
      <p className="lede">{t('between.openingLede')}</p>
      {error && <p className="banner bad" role="alert">{ERRORS.has(error) ? t(`between.errors.${error}`) : error}</p>}
      {opening && <p className={`banner${amount < 0 ? ' bad' : ''}`}>{owes(amount < 0)} {showPaise(Math.abs(amount))} · {showDate(opening.entry_date)}</p>}
      <form action={saveFirmOpening.bind(null, firm.id, id)} className="card labour-form">
        <fieldset className="field wide">
          <legend>{t('between.openingSide')}</legend>
          <label className="check-line"><input type="radio" name="side" value="us" required defaultChecked={amount < 0} /> {owes(true)}</label>
          <label className="check-line"><input type="radio" name="side" value="them" defaultChecked={amount > 0} /> {owes(false)}</label>
        </fieldset>
        <div className="field">
          <label htmlFor="b-amount">{t('labour.amount')}</label>
          <RupeesInput input={{ id: 'b-amount', name: 'amount', required: true, defaultValue: amount ? String(Math.abs(amount) / 100) : '' }} />
        </div>
        <div className="field">
          <label htmlFor="b-date">{t('bankbook.opening.date')}</label>
          <input id="b-date" type="date" name="date" defaultValue={opening?.entry_date ?? todayInIndia()} max={todayInIndia()} required />
          <p className="hint">{t('bankbook.opening.dateHint')}</p>
        </div>
        {opening && (
          <div className="field">
            <label htmlFor="b-reason">{t('bankbook.opening.reason')}</label>
            <input id="b-reason" name="reason" required />
            <p className="hint">{t('between.zeroRemoves')}</p>
          </div>
        )}
        <div className="labour-form-end"><button type="submit" className="btn">{t('labour.save')}</button></div>
      </form>
    </>
  );
}

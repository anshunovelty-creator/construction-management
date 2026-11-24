import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { RupeesInput } from '@/components/form';
import { Icon } from '@/components/icons';
import { requireProfile } from '@/lib/auth';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { todayInIndia } from '../../../../entries/data';
import { removeOpening, saveOpening } from '../../../actions';
import { loadFamilies } from '../../../data';

/** A family's opening balance: what we still had to pay them when the app started, or what they had been paid extra. */
export default async function OpeningPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await requireProfile('owner', 'office', 'labour');
  const t = await getTranslations();
  const [{ id }, { error }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [family] = await loadFamilies(await createClient(), id);
  if (!family) notFound();
  const { head, opening, ledger } = family;
  const today = todayInIndia().slice(0, 7);
  const amount = Number(opening?.amount_paise ?? 0);
  // Usually the first month typed for them; this month when nothing is typed yet.
  const month = opening?.month.slice(0, 7) ?? ledger[0]?.month ?? today;

  return (
    <>
      <Link href={`/labour/family/${head.id}`} className="back"><Icon name="chevronLeft" size={16} /> {head.name}</Link>
      <h1>{t('labour.opening.title', { name: head.name })}</h1>
      <p className="lede">{t('labour.opening.lede')}</p>
      {error && <p className="banner bad">{t(`labour.errors.${error}`)}</p>}
      {opening && (
        <p className={`banner${amount < 0 ? '' : ' bad'}`}>
          {t(amount < 0 ? 'labour.opening.nowExtra' : 'labour.opening.nowPay', { amount: showPaise(Math.abs(amount)) })}
        </p>
      )}
      <form action={saveOpening.bind(null, head.id)} className="card labour-form">
        <fieldset className="field wide">
          <legend>{t('labour.opening.side')}</legend>
          <label className="check-line"><input type="radio" name="side" value="pay" defaultChecked={amount >= 0} required /> {t('labour.opening.sidePay')}</label>
          <label className="check-line"><input type="radio" name="side" value="extra" defaultChecked={amount < 0} /> {t('labour.opening.sideExtra')}</label>
        </fieldset>
        <div className="field">
          <label htmlFor="o-amount">{t('labour.amount')}</label>
          <RupeesInput input={{ id: 'o-amount', name: 'amount', required: true, defaultValue: amount ? String(Math.abs(amount) / 100) : '' }} />
        </div>
        <div className="field">
          <label htmlFor="o-month">{t('labour.opening.month')}</label>
          <input id="o-month" type="month" name="month" defaultValue={month} max={today} required />
          <p className="hint">{t('labour.opening.monthHint')}</p>
        </div>
        <div className="field">
          <label htmlFor="o-note">{t('labour.opening.note')}</label>
          <input id="o-note" name="note" defaultValue={opening?.note ?? ''} />
        </div>
        <div className="labour-form-end"><button type="submit" className="btn">{t('labour.save')}</button></div>
      </form>
      {opening && (
        <form action={removeOpening.bind(null, head.id)}>
          <button type="submit" className="btn ghost">{t('labour.opening.remove')}</button>
        </form>
      )}
    </>
  );
}

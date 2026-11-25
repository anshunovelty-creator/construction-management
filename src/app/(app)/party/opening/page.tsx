import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { RupeesInput } from '@/components/form';
import { Icon } from '@/components/icons';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { showDate, todayInIndia } from '../../entries/data';
import { saveOpening } from './actions';
import { loadOpenings } from './data';

const ERRORS = new Set(['amount', 'date', 'reason', 'many', 'not_saved']);

/** A party's or client's opening balance in the working firm: what was left with them before the app. Owner only. ?id= */
export default async function PartyOpeningPage({ searchParams }: { searchParams: Promise<{ id?: string; error?: string }> }) {
  await requireProfile('owner');
  const [{ id = '', error }, working, t] = await Promise.all([searchParams, getWorkingFirm(), getTranslations()]);
  if (!working) return <p className="empty">{t('party.noFirm')}</p>;
  const { firm } = working;
  const db = await createClient();
  const { data: party } = await db.from('parties').select('id, name, kind').eq('id', id).in('kind', ['vendor', 'client', 'other']).maybeSingle();
  if (!party) notFound();
  const side = party.kind === 'client' ? 'client' : 'party';
  const openings = await loadOpenings(db, firm.id, party.id, side === 'client');
  const [opening] = openings;
  const amount = opening?.amount ?? 0;
  const save = saveOpening.bind(null, firm.id, party.id, crypto.randomUUID());

  return (
    <>
      <Link href={`/${side}?id=${party.id}`} className="back"><Icon name="chevronLeft" size={16} /> {party.name}</Link>
      <h1>{t('partyOpening.title', { name: party.name })}</h1>
      <p className="lede">{t(`partyOpening.lede.${side}`, { firm: firm.name })}</p>
      {error && <p className="banner bad" role="alert">{ERRORS.has(error) ? t(`partyOpening.errors.${error}`) : error}</p>}
      {openings.length > 1 ? (
        <div className="card">
          <p>{t('partyOpening.errors.many')}</p>
          {openings.map((o) => <p key={o.entry_id}><Link href={`/entries/${o.entry_id}`} className="serial underline">{o.serial}</Link> · {showDate(o.entry_date)} · {showPaise(o.amount)}</p>)}
        </div>
      ) : (
        <>
          {opening && <p className="banner">{t(`partyOpening.now.${amount < 0 ? 'extra' : 'left'}`, { amount: showPaise(Math.abs(amount)), date: showDate(opening.entry_date) })}</p>}
          <form action={save} className="card labour-form">
            <fieldset className="field wide">
              <legend>{t('partyOpening.side')}</legend>
              <label className="check-line"><input type="radio" name="side" value="left" defaultChecked={amount >= 0} required /> {t(`partyOpening.left.${side}`)}</label>
              <label className="check-line"><input type="radio" name="side" value="extra" defaultChecked={amount < 0} /> {t(`partyOpening.extra.${side}`)}</label>
            </fieldset>
            <div className="field">
              <label htmlFor="o-amount">{t('labour.amount')}</label>
              <RupeesInput input={{ id: 'o-amount', name: 'amount', required: true, defaultValue: amount ? String(Math.abs(amount) / 100) : '' }} />
            </div>
            <div className="field">
              <label htmlFor="o-date">{t('partyOpening.date')}</label>
              <input id="o-date" type="date" name="date" defaultValue={opening?.entry_date ?? todayInIndia()} max={todayInIndia()} required />
              <p className="hint">{t('partyOpening.dateHint')}</p>
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
            <form action={save} className="card labour-form">
              <input type="hidden" name="amount" value="0" />
              <div className="field">
                <label htmlFor="r-reason">{t('bankbook.opening.removeReason')}</label>
                <input id="r-reason" name="reason" required />
              </div>
              <div className="labour-form-end"><button type="submit" className="btn ghost">{t('labour.opening.remove')}</button></div>
            </form>
          )}
        </>
      )}
    </>
  );
}

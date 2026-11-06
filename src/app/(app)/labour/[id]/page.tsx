import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { PrintButton } from '@/components/print-button';
import { requireProfile } from '@/lib/auth';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { todayInIndia } from '../../entries/data';
import { BalanceCell, MoneyCell, Stat } from '../../party/shared';
import { loadLabour, showMonth } from '../data';

/** One worker's ledger, month by month: what the month came to, what was paid, and what it leaves for the next. */
export default async function LabourWorkerPage({ params }: { params: Promise<{ id: string }> }) {
  await requireProfile('owner', 'office', 'labour');
  const t = await getTranslations();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [person] = await loadLabour(await createClient(), id);
  if (!person) notFound();
  const { ledger, balance } = person;
  const sum = (key: 'salary' | 'addition' | 'deduction' | 'advance' | 'paid') => ledger.reduce((s, m) => s + m[key], 0);
  const entry = (month: string) => `/labour/month?month=${month}#${person.id}`;

  return (
    <>
      <Link href="/labour" className="back no-print">◄ {t('labour.tabs.workers')}</Link>
      <div className="ledger-head">
        <div>
          <h1>{person.name}</h1>
          {person.skill && <p className="muted">{person.skill}</p>}
        </div>
        <div className="day-picker no-print">
          <Link href={entry(todayInIndia().slice(0, 7))} className="btn">{t('labour.enterMonth')}</Link>
          <Link href={`/labour/${person.id}/edit`} className="btn ghost">{t('labour.change')}</Link>
          <PrintButton label={t('ledger.print')} />
        </div>
      </div>

      <div className="calc" aria-label={t('party.summary')}>
        <Stat label={t('labour.earned')} value={showPaise(sum('salary') + sum('addition'))} note={t('labour.earnedNote', { salary: showPaise(sum('salary')), addition: showPaise(sum('addition')) })} />
        <span className="op" aria-hidden="true">−</span>
        <Stat label={t('labour.cuts')} value={showPaise(sum('deduction') + sum('advance'))} note={t('labour.cutsNote', { deduction: showPaise(sum('deduction')), advance: showPaise(sum('advance')) })} />
        <span className="op" aria-hidden="true">−</span>
        <Stat label={t('labour.paid')} value={showPaise(sum('paid'))} />
        <span className="op" aria-hidden="true">=</span>
        {balance < 0
          ? <Stat label={t('party.statuses.extra')} value={showPaise(balance)} tone="done" note={t('labour.extraNote')} />
          : <Stat label={t('party.balance')} value={showPaise(balance)} tone={balance > 0 ? 'owe' : 'done'} note={t(balance > 0 ? 'party.balanceNote' : 'party.nothingLeft')} />}
      </div>

      <h2>{t('labour.ledgerTitle')}</h2>
      {ledger.length === 0 ? (
        <p className="card empty-state">{t('labour.noLedger')}</p>
      ) : (
        <div className="card table-wrap flush">
          <table className="ledger statement">
            <thead>
              <tr>
                <th>{t('labour.month')}</th>
                <th className="num">{t('labour.days')}</th>
                <th className="num">{t('labour.otHours')}</th>
                <th className="num">{t('labour.rateShort')}</th>
                <th className="num">{t('labour.salary')}</th>
                <th className="num">{t('labour.addition')}</th>
                <th className="num">{t('labour.deduction')}</th>
                <th className="num">{t('labour.advance')}</th>
                <th className="num">{t('labour.before')}</th>
                <th className="num">{t('labour.paid')}</th>
                <th className="num">{t('labour.left')}</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((m) => (
                <tr key={m.month} className={m.balance < 0 ? 'extra-month' : undefined}>
                  <td className="particulars">
                    <Link href={entry(m.month)} className="underline">{showMonth(m.month)}</Link>
                    {m.note && <span className="ledger-note">{m.note}</span>}
                  </td>
                  <td className="num">{m.days}</td>
                  <td className="num">{m.otHours || '–'}</td>
                  <MoneyCell paise={m.rate} />
                  <MoneyCell paise={m.salary} />
                  <MoneyCell paise={m.addition} />
                  <MoneyCell paise={m.deduction} />
                  <MoneyCell paise={m.advance} />
                  <BalanceCell paise={m.before} t={t} />
                  <MoneyCell paise={m.paid} />
                  <BalanceCell paise={m.balance} t={t} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

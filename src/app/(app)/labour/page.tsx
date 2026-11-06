import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ListLink } from '@/components/list-link';
import { RowFilter } from '@/components/row-filter';
import { requireProfile } from '@/lib/auth';
import { rateFor } from '@/lib/labour';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { todayInIndia } from '../entries/data';
import { MoneyCell, Stat } from '../party/shared';
import { loadLabour } from './data';

/** Everyone in the labour section, and what is left to pay each one or was paid extra. */
export default async function LabourPage() {
  await requireProfile('owner', 'office', 'labour');
  const t = await getTranslations();
  const month = todayInIndia().slice(0, 7);
  const people = await loadLabour(await createClient());
  const rows = people.filter((p) => p.is_active || p.balance !== 0);
  const toPay = rows.reduce((s, r) => s + Math.max(r.balance, 0), 0);
  const extra = rows.reduce((s, r) => s + Math.max(-r.balance, 0), 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('labour.title')}</h1>
          <p className="lede">{t('labour.lede')}</p>
        </div>
        <Link href="/labour/new" className="btn">{t('labour.addWorker')}</Link>
      </div>

      <div className="stats">
        <Stat label={t('party.balance')} value={showPaise(toPay)} note={t('labour.people', { count: rows.length })} tone="owe" />
        <Stat label={t('party.statuses.extra')} value={showPaise(-extra)} note={t('labour.extraNote')} tone="done" />
      </div>

      {rows.length === 0 ? (
        <p className="card empty-state">{t('labour.none')}</p>
      ) : (
        <>
          <div className="toolbar">
            <RowFilter table="labour" label={t('labour.search')} placeholder={t('labour.searchHint')} none={t('labour.searchNone')} />
          </div>
          <div className="card table-wrap flush hide-when-empty">
            <table className="ledger clickable" id="labour">
              <thead>
                <tr>
                  <th>{t('labour.name')}</th>
                  <th className="num">{t('labour.rateShort')}</th>
                  <th className="num">{t('party.balance')}</th>
                  <th className="num">{t('party.statuses.extra')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} data-name={r.name}>
                    <td><ListLink href={`/labour/${r.id}`} className="party-link">{r.name}</ListLink>{r.skill && <span className="muted"> · {r.skill}</span>}</td>
                    <MoneyCell paise={rateFor(r.rates, month)} />
                    <MoneyCell paise={Math.max(r.balance, 0)} strong tone="minus" />
                    <MoneyCell paise={Math.min(r.balance, 0)} strong tone="plus" />
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>{t('party.grandTotal')}</td>
                  <MoneyCell paise={toPay} strong tone="minus" />
                  <MoneyCell paise={-extra} strong tone="plus" />
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </>
  );
}

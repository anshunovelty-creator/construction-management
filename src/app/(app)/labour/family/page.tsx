import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ListLink } from '@/components/list-link';
import { RowFilter } from '@/components/row-filter';
import { requireProfile } from '@/lib/auth';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { MoneyCell, Stat } from '../../party/shared';
import { loadFamilies } from '../data';

/** Families that work together and are paid through their head: only the heads are listed, with what the family is owed. */
export default async function FamiliesPage() {
  await requireProfile('owner', 'office', 'labour');
  const t = await getTranslations();
  const families = (await loadFamilies(await createClient())).filter((f) => f.head.is_active || f.balance !== 0);
  const toPay = families.reduce((s, f) => s + Math.max(f.balance, 0), 0);
  const extra = families.reduce((s, f) => s + Math.max(-f.balance, 0), 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('labour.familiesTitle')}</h1>
          <p className="lede">{t('labour.familiesLede')}</p>
        </div>
        <Link href="/labour/new?head=new" className="btn">{t('labour.newFamily')}</Link>
      </div>

      <div className="stats">
        <Stat label={t('party.balance')} value={showPaise(toPay)} note={t('labour.families', { count: families.length })} tone="owe" />
        <Stat label={t('party.statuses.extra')} value={showPaise(-extra)} note={t('labour.extraNote')} tone="done" />
      </div>

      {families.length === 0 ? (
        <p className="card empty-state">{t('labour.noFamilies')}</p>
      ) : (
        <>
          <div className="toolbar">
            <RowFilter table="labour-families" label={t('labour.searchFamily')} placeholder={t('labour.searchHint')} none={t('labour.searchNone')} />
          </div>
          <div className="card table-wrap flush hide-when-empty">
            <table className="ledger clickable" id="labour-families">
              <thead>
                <tr>
                  <th>{t('labour.head')}</th>
                  <th className="num">{t('labour.members')}</th>
                  <th className="num">{t('party.balance')}</th>
                  <th className="num">{t('party.statuses.extra')}</th>
                </tr>
              </thead>
              <tbody>
                {families.map((f) => (
                  <tr key={f.head.id} data-name={f.head.name}>
                    <td><ListLink href={`/labour/family/${f.head.id}`} className="party-link">{f.head.name}</ListLink></td>
                    <td className="num">{f.members.length}</td>
                    <MoneyCell paise={Math.max(f.balance, 0)} strong tone="minus" />
                    <MoneyCell paise={Math.min(f.balance, 0)} strong tone="plus" />
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

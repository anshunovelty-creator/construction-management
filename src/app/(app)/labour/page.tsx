import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ListLink } from '@/components/list-link';
import { RowFilter } from '@/components/row-filter';
import { requireProfile } from '@/lib/auth';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { MoneyCell, Stat } from '../party/shared';
import { loadFamilies } from './data';

/**
 * Everyone in Labour payment, a family to a line: a single worker is a family of one, and a family's members are paid
 * through its head. Only the heads are listed, with what the family is owed.
 */
export default async function LabourPage() {
  await requireProfile('owner', 'office', 'labour');
  const t = await getTranslations();
  const families = (await loadFamilies(await createClient())).filter((f) => f.head.is_active || f.balance !== 0);
  const toPay = families.reduce((s, f) => s + Math.max(f.balance, 0), 0);
  const extra = families.reduce((s, f) => s + Math.max(-f.balance, 0), 0);

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
        <Stat label={t('party.balance')} value={showPaise(toPay)} note={t('labour.people', { count: families.reduce((n, f) => n + f.members.length, 0) })} tone="owe" />
        <Stat label={t('party.statuses.extra')} value={showPaise(-extra)} note={t('labour.extraNote')} tone="done" />
      </div>

      {families.length === 0 ? (
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
                  <th className="num">{t('labour.members')}</th>
                  <th className="num">{t('party.balance')}</th>
                  <th className="num">{t('party.statuses.extra')}</th>
                </tr>
              </thead>
              <tbody>
                {families.map((f) => (
                  <tr key={f.head.id} data-name={f.members.map((m) => m.name).join(' ')}>
                    <td>
                      <ListLink href={`/labour/family/${f.head.id}`} className="party-link">{f.head.name}</ListLink>
                      {f.members.length > 1
                        ? <span className="muted"> · {t('labour.withMembers', { names: f.members.slice(1).map((m) => m.name).join(', ') })}</span>
                        : f.head.skill && <span className="muted"> · {f.head.skill}</span>}
                    </td>
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

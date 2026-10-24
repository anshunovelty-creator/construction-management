import Link from 'next/link';
import type { getTranslations } from 'next-intl/server';
import type { Group, LineRow, Names, Plain } from '@/lib/ledger/plain';
import { showPaise } from '@/lib/money';

type T = Awaited<ReturnType<typeof getTranslations>>;

export const GROUPS: Exclude<Group, 'sites'>[] = ['money', 'weOwe', 'owedToUs', 'betweenFirms', 'heldByClients', 'owner'];
/** Long groups show this many rows, the rest behind "show more". */
const SHOWN = 6;

/** One card per group of balances ("Money we hold", "We owe", ...), skipping empty groups. */
export function GroupCards({ plain, groups, t, supervisor = false }: { plain: Plain[]; groups: readonly Exclude<Group, 'sites'>[]; t: T; supervisor?: boolean }) {
  return (
    <div className="board">
      {groups.map((group) => {
        const items = plain.filter((p) => p.group === group);
        if (items.length === 0) return null;
        const sum = items.reduce((s, p) => s + p.shown, 0);
        const row = (p: Plain) => (
          <div key={p.key} className="row">
            <span className="name">{p.label}</span>
            <span className="val">{showPaise(p.shown)}</span>
          </div>
        );
        return (
          <section key={group} className={`group card g-${group}`}>
            <h2 className="eyebrow">{t(supervisor && group === 'money' ? 'board.yourCash' : `board.${group}.title`)}</h2>
            {/* The owner card mixes unrelated things (own money, cash short), so its sum means nothing. */}
            {group !== 'owner' && <p className="group-total">{showPaise(sum)}</p>}
            <p className="hint">{t(`board.${group}.hint`)}</p>
            {items.slice(0, SHOWN).map(row)}
            {items.length > SHOWN && (
              <details>
                <summary>{t('board.showMore', { count: String(items.length - SHOWN) })}</summary>
                {items.slice(SHOWN).map(row)}
              </details>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** Each site: what was billed to clients and what it cost, across the given rows. */
export function siteTotals(rows: LineRow[]) {
  const sites = new Map<string, { billed: number; cost: number }>();
  for (const r of rows) {
    if (r.account !== 'site_cost' && r.account !== 'contract_income') continue;
    const s = sites.get(r.site_id!) ?? { billed: 0, cost: 0 };
    if (r.account === 'site_cost') s.cost += Number(r.amount_paise);
    else s.billed -= Number(r.amount_paise);
    sites.set(r.site_id!, s);
  }
  return sites;
}

/** Billed, costs and profit per site; each site name opens that site's entries (for `firmId` only, if given). */
export function SitesTable({ rows, names, t, hint, firmId }: { rows: LineRow[]; names: Names; t: T; hint: string; firmId?: string }) {
  const sites = siteTotals(rows);
  if (sites.size === 0) return null;
  return (
    <section className="card sites">
      <h2 className="eyebrow">{t('board.sites.title')}</h2>
      <p className="hint">{hint}</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t('board.sites.site')}</th>
              <th className="num">{t('board.sites.billed')}</th>
              <th className="num">{t('board.sites.cost')}</th>
              <th className="num">{t('board.sites.profit')}</th>
            </tr>
          </thead>
          <tbody>
            {[...sites].map(([id, s]) => {
              const profit = s.billed - s.cost;
              return (
                <tr key={id}>
                  <td>
                    <Link href={`/entries?site=${id}${firmId ? `&firm=${firmId}` : ''}`} className="underline">{names.sites.get(id)}</Link>
                  </td>
                  <td className="num">{showPaise(s.billed)}</td>
                  <td className="num">{showPaise(s.cost)}</td>
                  <td className={`num strong ${profit < 0 ? 'down' : 'up'}`}>{showPaise(profit)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

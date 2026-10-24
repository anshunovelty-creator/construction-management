import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { requireProfile } from '@/lib/auth';
import { describeAll, type Group, type LineRow, type Plain } from '@/lib/ledger/plain';
import { ENTRY_FORMS, type EntryFormSlug } from '@/lib/masters/registry';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { loadNames } from './entries/data';

const GROUPS: Exclude<Group, 'sites'>[] = ['money', 'weOwe', 'owedToUs', 'betweenFirms', 'heldByClients', 'owner'];
const QUICK: Record<string, EntryFormSlug[]> = {
  owner: ['vendor-bill', 'pay-vendor', 'move-money'],
  office: ['vendor-bill', 'pay-vendor', 'client-receipt'],
  supervisor: ['site-spend', 'day-close'],
};
/** Long groups show this many rows, the rest behind "show more". */
const SHOWN = 6;

export default async function HomePage() {
  const profile = await requireProfile();
  const db = await createClient();
  const [{ data: rows }, { count: waiting }, names, t] = await Promise.all([
    db.from('balances').select('*').returns<LineRow[]>(),
    db.from('entry_status').select('entry_id', { count: 'exact', head: true }).eq('status', 'unverified'),
    loadNames(db),
    getTranslations(),
  ]);
  // ponytail: reads the whole balances view; fine until it holds thousands of rows (PostgREST caps at 1000).
  const supervisor = profile.role === 'supervisor';
  // A supervisor also sees the other side of cash handed to them (e.g. a firm's bank), but only
  // their own cash accounts are theirs to count.
  const balances = (rows ?? []).filter((r) => !supervisor || (r.account === 'money' && names.accounts.has(r.money_account_id!)));
  const plain = describeAll(balances, names, t);
  const total = balances.reduce((sum, r) => sum + Number(r.amount_paise), 0);

  // Each site: what was billed to clients and what it cost, across every firm.
  const sites = new Map<string, { billed: number; cost: number }>();
  for (const r of balances) {
    if (r.account !== 'site_cost' && r.account !== 'contract_income') continue;
    const s = sites.get(r.site_id!) ?? { billed: 0, cost: 0 };
    if (r.account === 'site_cost') s.cost += Number(r.amount_paise);
    else s.billed -= Number(r.amount_paise);
    sites.set(r.site_id!, s);
  }

  const groupCard = (group: (typeof GROUPS)[number], items: Plain[]) => {
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
  };

  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">{t('home.greeting')}</p>
          <h1>{t('home.welcome', { name: profile.full_name })}</h1>
          <p className="lede">{t(supervisor ? 'home.ledeSupervisor' : 'home.lede')}</p>
        </div>
        <div className="hero-actions">
          <Link href="/entries/new" className="btn big">＋ {t('home.addEntry')}</Link>
          {QUICK[profile.role]!.map((slug) => (
            <Link key={slug} href={`/entries/new/${slug}`} className="btn ghost">
              <span aria-hidden="true">{ENTRY_FORMS[slug].icon}</span> {t(`entryForms.${slug}.title`)}
            </Link>
          ))}
        </div>
      </section>

      {!supervisor && (waiting ?? 0) > 0 && (
        <Link href="/entries?waiting=1" className="notice">
          <span className="notice-count">{waiting}</span>
          <span>
            <b>{t('home.waitingTitle')}</b>
            <span className="block muted">{t('home.waitingHint')}</span>
          </span>
          <span aria-hidden="true">→</span>
        </Link>
      )}

      {balances.length === 0 ? (
        <section className="card empty-board">
          <h2>{t('home.emptyTitle')}</h2>
          <p>{t(supervisor ? 'home.emptySupervisor' : 'home.emptyHint')}</p>
        </section>
      ) : (
        <>
          <div className="board-head">
            <h2 className="eyebrow">{t('board.title')}</h2>
            {!supervisor && (
              <span className="balanced">{total === 0 ? t('board.balanced') : t('board.unbalanced', { amount: showPaise(total) })}</span>
            )}
          </div>
          <div className="board">
            {(supervisor ? (['money'] as const) : GROUPS).map((group) => {
              const items = plain.filter((p) => p.group === group);
              return items.length > 0 ? groupCard(group, items) : null;
            })}
          </div>

          {!supervisor && sites.size > 0 && (
            <section className="card sites">
              <h2 className="eyebrow">{t('board.sites.title')}</h2>
              <p className="hint">{t('board.sites.hint')}</p>
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
                          <td>{names.sites.get(id)}</td>
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
          )}
        </>
      )}
    </>
  );
}

import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { requireProfile } from '@/lib/auth';
import { GroupCards, GROUPS, SitesTable } from '@/components/board';
import { describeAll, type LineRow } from '@/lib/ledger/plain';
import { ENTRY_FORMS, type EntryFormSlug } from '@/lib/masters/registry';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { loadNames } from '../entries/data';

const QUICK: Record<string, EntryFormSlug[]> = {
  owner: ['vendor-bill', 'pay-vendor', 'client-receipt'],
  office: ['vendor-bill', 'pay-vendor', 'client-receipt'],
  supervisor: ['site-spend', 'day-close'],
};

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
          <GroupCards plain={plain} groups={supervisor ? ['money'] : GROUPS} t={t} supervisor={supervisor} />
          {!supervisor && <SitesTable rows={balances} names={names} t={t} hint={t('board.sites.hint')} />}
        </>
      )}
    </>
  );
}

import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { requireProfile } from '@/lib/auth';
import { GroupCards, GROUPS, SitesTable } from '@/components/board';
import { describeAll, type LineRow } from '@/lib/ledger/plain';
import { ENTRY_FORMS, type EntryFormSlug } from '@/lib/masters/registry';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { loadNames } from '../entries/data';
import { Icon } from '@/components/icons';

const QUICK: Record<string, EntryFormSlug[]> = {
  owner: ['vendor-bill', 'pay-vendor', 'client-receipt'],
  office: ['vendor-bill', 'pay-vendor', 'client-receipt'],
  supervisor: ['site-spend', 'day-close'],
};

export default async function HomePage() {
  const profile = await requireProfile();
  const db = await createClient();
  const [{ data: rows }, names, t] = await Promise.all([
    db.from('balances').select('*').returns<LineRow[]>(),
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
          <h1>{t('home.welcome', { name: profile.full_name })}</h1>
          <p className="lede">{t(supervisor ? 'home.ledeSupervisor' : 'home.lede')}</p>
        </div>
        <div className="hero-actions">
          <Link href="/entries/new" className="btn big"><Icon name="plus" /> {t('home.addEntry')}</Link>
          {QUICK[profile.role]!.map((slug) => (
            <Link key={slug} href={`/entries/new/${slug}`} className="btn ghost">
              <Icon name={ENTRY_FORMS[slug].icon} /> {t(`entryForms.${slug}.title`)}
            </Link>
          ))}
        </div>
      </section>


      {balances.length === 0 ? (
        <section className="card empty-board">
          <h2>{t('home.emptyTitle')}</h2>
          <p>{t(supervisor ? 'home.emptySupervisor' : 'home.emptyHint')}</p>
        </section>
      ) : (
        <>
          <div className="board-head">
            <h2 className="section-title">{t('board.title')}</h2>
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

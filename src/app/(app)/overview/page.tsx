import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { requireProfile } from '@/lib/auth';
import { GroupCards, GROUPS, SitesTable } from '@/components/board';
import { describeAll, type LineRow } from '@/lib/ledger/plain';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { loadNames, showDate, todayInIndia } from '../entries/data';
import { Icon } from '@/components/icons';

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

  // A supervisor's day: which parts of today's report are filled for each of their sites.
  const today = todayInIndia();
  const PARTS = [['work_done', 'work_date', 'partWork'], ['material_use', 'use_date', 'partMaterial'],
    ['labour_day', 'work_date', 'partLabour'], ['other_cost', 'work_date', 'partOther']] as const;
  let mySites: { id: string; name: string }[] = [];
  const filled = new Set<string>();
  if (supervisor) {
    const [{ data: given }, ...parts] = await Promise.all([
      db.from('user_sites').select('site:sites(id, name, is_active)').eq('user_id', profile.user_id)
        .returns<{ site: { id: string; name: string; is_active: boolean } | null }[]>(),
      ...PARTS.map(([table, column]) => db.from(table).select('site_id').eq(column, today).returns<{ site_id: string }[]>()),
    ]);
    mySites = (given ?? []).flatMap((g) => (g.site?.is_active ? [g.site] : [])).sort((a, b) => a.name.localeCompare(b.name));
    parts.forEach(({ data }, i) => (data ?? []).forEach((r) => filled.add(`${r.site_id}/${PARTS[i]![2]}`)));
  }

  return (
    <>
      <section className="hero">
        <div>
          <h1>{t('home.welcome', { name: profile.full_name })}</h1>
          <p className="lede">{t(supervisor ? 'home.ledeSupervisor' : 'home.lede')}</p>
        </div>
        {supervisor && mySites.length > 0 && (
          <div className="hero-actions">
            <Link href={`/report?site=${mySites[0]!.id}`} className="btn big"><Icon name="report" /> {t('home.fillReport')}</Link>
          </div>
        )}
      </section>

      {supervisor && (mySites.length === 0 ? <p className="empty">{t('home.noSites')}</p> : (
        <section className="card today-report">
          <h2 className="section-title">{t('home.todayTitle', { date: showDate(today) })}</h2>
          <p className="hint">{t('home.todayHint')}</p>
          {mySites.map((site) => (
            <Link key={site.id} href={`/report?site=${site.id}`} className="today-site">
              <b>{site.name}</b>
              <span className="today-parts">
                {PARTS.map(([, , key]) => {
                  const done = filled.has(`${site.id}/${key}`);
                  return (
                    <span key={key} className={`pill ${done ? 'cleared' : 'pending'}`}>
                      {t(`home.${key}`)}: {t(done ? 'home.filled' : 'home.notFilled')}
                    </span>
                  );
                })}
              </span>
            </Link>
          ))}
        </section>
      ))}

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
          {/* The owner's first question is which site makes money, so the sites come before the balances. */}
          {!supervisor && <SitesTable rows={balances} names={names} t={t} hint={t('board.sites.hint')} />}
          <GroupCards plain={plain} groups={supervisor ? ['money'] : GROUPS} t={t} supervisor={supervisor} />
        </>
      )}
    </>
  );
}

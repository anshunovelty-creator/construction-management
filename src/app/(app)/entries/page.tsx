import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AutoForm } from '@/components/auto-form';
import { GroupCards, GROUPS, SitesTable } from '@/components/board';
import { requireProfile } from '@/lib/auth';
import { describeAll, type LineRow } from '@/lib/ledger/plain';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { loadNames, showDate } from './data';

interface Row {
  id: string;
  serial: string;
  entry_type: string;
  entry_date: string;
  party_id: string | null;
  narration: string;
  lines: { account: string; amount_paise: number }[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { waiting?: string; date?: string; firm?: string; site?: string };

/**
 * Every entry, newest first. Filters: ?waiting=1 (not yet checked), ?date=YYYY-MM-DD, ?firm=<id>, ?site=<id>.
 * Firm and site work together ("Firm A at Site 1"); either one adds a summary of what its books show now.
 */
export default async function DayBookPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const { waiting } = params;
  const date = params.date && DATE.test(params.date) ? params.date : undefined;
  const firm = params.firm && UUID.test(params.firm) ? params.firm : undefined;
  const site = params.site && UUID.test(params.site) ? params.site : undefined;
  const profile = await requireProfile();
  const db = await createClient();

  const { data: statuses } = await db.from('entry_status').select('entry_id, status');
  const statusOf = new Map((statuses ?? []).map((s) => [s.entry_id as string, s.status as string]));
  const waitingIds = [...statusOf].filter(([, s]) => s === 'unverified').map(([id]) => id);

  // `lines` sizes the entry; `match` (an inner join on the same lines) keeps only entries touching the firm/site.
  // ponytail: latest 200 only; add paging when the books outgrow it.
  let query = db
    .from('entries')
    .select(`id, serial, entry_type, entry_date, party_id, narration, lines:entry_lines(account, amount_paise)${firm || site ? ', match:entry_lines!inner(firm_id, site_id)' : ''}`)
    .order('created_at', { ascending: false })
    .limit(200);
  if (date) query = query.eq('entry_date', date);
  if (waiting) query = query.in('id', waitingIds);
  if (firm) query = query.eq('match.firm_id', firm);
  if (site) query = query.eq('match.site_id', site);

  // What the books show now for this firm and/or site. A firm also sees the between-firm amounts other firms hold against it.
  let balances = db.from('balances').select('*');
  if (site) balances = balances.eq('site_id', site);
  if (firm) balances = site ? balances.eq('firm_id', firm) : balances.or(`firm_id.eq.${firm},counter_firm_id.eq.${firm}`);

  const [{ data: rows }, { data: summary }, names, t] = await Promise.all([
    query.returns<Row[]>(),
    // Supervisors see their entries but not profits, as on the home page.
    (firm || site) && profile.role !== 'supervisor' ? balances.returns<LineRow[]>() : Promise.resolve({ data: null }),
    loadNames(db),
    getTranslations(),
  ]);

  // The size of an entry: its plus lines, leaving out the automatic between-firm pair.
  const amountOf = (r: Row) =>
    r.lines.filter((l) => l.account !== 'inter_firm' && l.amount_paise > 0).reduce((s, l) => s + Number(l.amount_paise), 0);
  const href = (change: Partial<Params>) => {
    const next = new URLSearchParams(Object.entries({ firm, site, date, waiting, ...change }).filter(([, v]) => v) as [string, string][]);
    return `/entries${next.size ? `?${next}` : ''}`;
  };
  const firmName = firm && names.firms.get(firm);
  const siteName = site && names.sites.get(site);
  const title = firmName && siteName ? t('daybook.at', { firm: firmName, site: siteName }) : (firmName || siteName || t('nav.daybook'));

  // Costs at the site by kind of work (material, labour, ...), biggest first.
  const costs = new Map<string, number>();
  for (const r of summary ?? []) if (site && r.account === 'site_cost') costs.set(r.cost_head!, (costs.get(r.cost_head!) ?? 0) + Number(r.amount_paise));

  return (
    <>
      <p className="eyebrow">{t('daybook.eyebrow')}</p>
      <h1>{title}</h1>
      <p className="lede">{t(site ? 'daybook.siteLede' : firm ? 'daybook.firmLede' : 'daybook.lede')}</p>

      <AutoForm action="/entries" className="filters book-filter">
        <label className="sr-only" htmlFor="firm">{t('daybook.firm')}</label>
        <select id="firm" name="firm" defaultValue={firm ?? ''}>
          <option value="">{t('daybook.allFirms')}</option>
          {[...names.firms].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <label className="sr-only" htmlFor="site">{t('daybook.site')}</label>
        <select id="site" name="site" defaultValue={site ?? ''}>
          <option value="">{t('daybook.allSites')}</option>
          {[...names.sites].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <label htmlFor="date" className="sr-only">{t('daybook.onDate')}</label>
        <input id="date" type="date" name="date" defaultValue={date ?? ''} />
        {waiting && <input type="hidden" name="waiting" value="1" />}
        {(firm || site || date || waiting) && <Link href="/entries" className="chip">{t('daybook.clear')}</Link>}
      </AutoForm>

      {summary && (
        <div className="book-summary">
          <SitesTable rows={summary} names={names} t={t} hint={t(firm ? 'daybook.sitesHintFirm' : 'board.sites.hint')} firmId={firm} />
          {costs.size > 0 && (
            <section className="card">
              <h2 className="eyebrow">{t('daybook.costs')}</h2>
              <p className="hint">{t('daybook.costsHint')}</p>
              {[...costs].sort((a, b) => b[1] - a[1]).map(([head, amount]) => (
                <div key={head} className="row">
                  <span className="name">{t(`options.cost_head.${head}`)}</span>
                  <span className="val">{showPaise(amount)}</span>
                </div>
              ))}
            </section>
          )}
          {firm && !site && (
            <GroupCards plain={describeAll(summary, names, t)} groups={GROUPS.filter((g) => g !== 'owner')} t={t} />
          )}
        </div>
      )}

      <div className="filters">
        <Link href={href({ waiting: undefined })} className={`chip ${!waiting ? 'on' : ''}`}>{t('daybook.all')}</Link>
        <Link href={href({ waiting: '1' })} className={`chip ${waiting ? 'on' : ''}`}>
          {t('daybook.waiting')}{' '}
          <b>{firm || site || date ? (rows ?? []).filter((r) => statusOf.get(r.id) === 'unverified').length : waitingIds.length}</b>
        </Link>
        <span className="muted">{t('daybook.count', { count: rows?.length ?? 0 })}</span>
      </div>
      {rows && rows.length > 0 ? (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('daybook.serial')}</th>
                <th>{t('daybook.date')}</th>
                <th>{t('daybook.what')}</th>
                <th className="num">{t('daybook.amount')}</th>
                <th>{t('daybook.status')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const status = statusOf.get(r.id) ?? 'unverified';
                return (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/entries/${r.id}`} className="serial underline">{r.serial}</Link>
                    </td>
                    <td className="nowrap">{showDate(r.entry_date)}</td>
                    <td>
                      <b>{t(`entryTypes.${r.entry_type}.title`)}</b>
                      {(r.party_id || r.narration) && (
                        <span className="muted block">
                          {[r.party_id && names.parties.get(r.party_id), r.narration].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </td>
                    <td className="num">{showPaise(amountOf(r))}</td>
                    <td><span className={`pill ${status}`}>{t(`entries.status.${status}`)}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty">{t('daybook.empty')}</p>
      )}
    </>
  );
}

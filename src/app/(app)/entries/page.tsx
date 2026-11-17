import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AutoForm } from '@/components/auto-form';
import { SitesTable } from '@/components/board';
import { ListLink } from '@/components/list-link';
import { SearchSelect } from '@/components/search-select';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { isCommonEntry } from '@/lib/firm';
import type { LineRow } from '@/lib/ledger/plain';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { loadNames, showDate, showMoment } from './data';

interface Row {
  id: string;
  serial: string;
  entry_type: string;
  entry_date: string;
  party_id: string | null;
  narration: string;
  created_at: string;
  created_by: string;
  lines: { account: string; amount_paise: number; firm_id: string | null }[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// ponytail: latest 200 only; add paging when the books outgrow it.
const LIMIT = 200;

type Params = { date?: string; site?: string; cancelled?: string };

const WEEKDAY = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * Every entry by its date, newest day first, under a heading per day. Owner and office staff see the working firm's
 * entries plus the Common ones (no firm on any line, e.g. cash handed to a supervisor), which carry a tag. Supervisors
 * see the entries they may see. A cancelled mistake and the entry cancelling it are hidden unless ?cancelled=1.
 * Filters: ?date=YYYY-MM-DD, ?site=<id>; a site adds a summary of its books (the Dashboard's site names link here).
 */
export default async function DayBookPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const date = params.date && DATE.test(params.date) ? params.date : undefined;
  const site = params.site && UUID.test(params.site) ? params.site : undefined;
  const showCancelled = params.cancelled === '1';
  const profile = await requireProfile();
  const working = await getWorkingFirm();
  const firm = working?.firm.id;
  const db = await createClient();

  // Only cancelled entries and the entries that cancel them carry a tag; a short list, unlike every entry's status.
  // ponytail: past 1,000 cancellations this list is cut off; join the status into the list query then.
  const { data: statuses } = await db.from('entry_status').select('entry_id, status').in('status', ['cancelled', 'reversal']);
  const statusOf = new Map((statuses ?? []).map((s) => [s.entry_id as string, s.status as string]));

  // `lines` sizes the entry and shows whether it names a firm; `match` (an inner join on the same lines) keeps only
  // entries touching the firm/site. Common entries all have the CM serial (no entry firm); `lines` tells which of those
  // name no firm at all, since a firm's bill paid from owner cash is CM too.
  const list = (only?: 'firm' | 'common') => {
    let query = db
      .from('entries')
      .select(`id, serial, entry_type, entry_date, party_id, narration, created_at, created_by, lines:entry_lines(account, amount_paise, firm_id)${only === 'firm' || site ? ', match:entry_lines!inner(firm_id, site_id)' : ''}`)
      .order('entry_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(LIMIT);
    if (date) query = query.eq('entry_date', date);
    if (only === 'firm') query = query.eq('match.firm_id', firm!);
    if (only === 'common') query = query.is('firm_id', null);
    if (site) query = query.eq('match.site_id', site);
    return query.returns<Row[]>();
  };

  // What the books show now for a picked site, in the working firm. The firm as a whole is on the Dashboard.
  let balances = db.from('balances').select('*').eq('site_id', site ?? '');
  if (firm) balances = balances.eq('firm_id', firm);

  const [{ data: own }, { data: cm }, { data: summary }, names, t] = await Promise.all([
    firm ? list('firm') : list(),
    firm ? list('common') : Promise.resolve({ data: [] as Row[] }),
    // Supervisors see their entries but not profits, as on the home page.
    site && profile.role !== 'supervisor' ? balances.returns<LineRow[]>() : Promise.resolve({ data: null }),
    loadNames(db),
    getTranslations(),
  ]);
  const common = (cm ?? []).filter((r) => isCommonEntry(r.lines));
  const commonIds = new Set(common.map((r) => r.id));
  const all = [...(own ?? []), ...common]
    .sort((a, b) => b.entry_date.localeCompare(a.entry_date) || b.created_at.localeCompare(a.created_at)).slice(0, LIMIT);
  const hidden = all.filter((r) => statusOf.has(r.id)).length;
  const rows = showCancelled ? all : all.filter((r) => !statusOf.has(r.id));
  // Rows are already newest day first, so a Map keeps the days in order.
  const byDay = new Map<string, Row[]>();
  for (const r of rows) byDay.set(r.entry_date, [...(byDay.get(r.entry_date) ?? []), r]);
  // The same filters, with cancelled entries shown or not.
  const cancelledLink = (on: boolean) => {
    const q = new URLSearchParams({ ...(site && { site }), ...(date && { date }), ...(on && { cancelled: '1' }) }).toString();
    return q ? `/entries?${q}` : '/entries';
  };

  // The size of an entry: its plus lines, leaving out the automatic between-firm pair.
  const amountOf = (r: Row) =>
    r.lines.filter((l) => l.account !== 'inter_firm' && l.amount_paise > 0).reduce((s, l) => s + Number(l.amount_paise), 0);
  const firmName = working?.firm.name;
  const siteName = site && names.sites.get(site);
  const title = firmName && siteName ? t('daybook.at', { firm: firmName, site: siteName }) : (firmName || siteName || t('nav.daybook'));

  // Costs at the site by kind of work (material, labour, ...), biggest first.
  const costs = new Map<string, number>();
  for (const r of summary ?? []) if (site && r.account === 'site_cost') costs.set(r.cost_head!, (costs.get(r.cost_head!) ?? 0) + Number(r.amount_paise));

  return (
    <>
      <h1>{title}</h1>
      <p className="lede">{t(site ? 'daybook.siteLede' : 'daybook.lede')}</p>

      <AutoForm action="/entries" className="filters book-filter">
        <label className="sr-only" htmlFor="site">{t('daybook.site')}</label>
        <SearchSelect id="site" name="site" defaultValue={site ?? ''} emptyLabel={t('daybook.allSites')} submitOnPick
          options={[...names.sites].map(([id, name]) => ({ value: id, label: name }))} />
        <label htmlFor="date" className="sr-only">{t('daybook.onDate')}</label>
        <input id="date" type="date" name="date" defaultValue={date ?? ''} />
        {(site || date) && <Link href="/entries" className="chip">{t('daybook.clear')}</Link>}
      </AutoForm>

      {summary && (
        <div className="book-summary">
          <SitesTable rows={summary} names={names} t={t} hint={t(firm ? 'daybook.sitesHintFirm' : 'board.sites.hint')} />
          {costs.size > 0 && (
            <section className="card">
              <h2 className="section-title">{t('daybook.costs')}</h2>
              <p className="hint">{t('daybook.costsHint')}</p>
              {[...costs].sort((a, b) => b[1] - a[1]).map(([head, amount]) => (
                <div key={head} className="row">
                  <span className="name">{t(`options.cost_head.${head}`)}</span>
                  <span className="val">{showPaise(amount)}</span>
                </div>
              ))}
            </section>
          )}
        </div>
      )}

      <div className="filters">
        <span className="muted">{t('daybook.count', { count: rows.length })}</span>
        {hidden > 0 && (
          <Link href={cancelledLink(!showCancelled)} className="chip">
            {t(showCancelled ? 'daybook.hideCancelled' : 'daybook.showCancelled', { count: hidden })}
          </Link>
        )}
      </div>
      {rows.length > 0 ? (
        <div className="card table-wrap">
          <table className="day-book">
            <thead>
              <tr>
                <th>{t('daybook.what')}</th>
                <th className="num">{t('daybook.amount')}</th>
                <th>{t('daybook.enteredBy')}</th>
              </tr>
            </thead>
            {[...byDay].map(([day, list]) => (
              <tbody key={day}>
                <tr className="day-row">
                  <td colSpan={3}>
                    <strong>{WEEKDAY.format(new Date(`${day}T00:00:00Z`))}</strong>
                    <span className="muted"> · {t('daybook.count', { count: list.length })}</span>
                  </td>
                </tr>
                {list.map((r) => {
                  const status = statusOf.get(r.id);
                  return (
                    <tr key={r.id} className={status === 'cancelled' ? 'was-cancelled' : undefined}>
                      <td>
                        <ListLink href={`/entries/${r.id}`} className="underline"><b>{(r.party_id && names.parties.get(r.party_id)) || t(`entryTypes.${r.entry_type}.title`)}</b></ListLink>
                        {commonIds.has(r.id) && <span className="pill common" title={t('firm.commonHint')}>{t('firm.common')}</span>}
                        {status && <span className={`pill ${status}`}>{t(`entries.status.${status}`)}</span>}
                        <span className="muted block">
                          {[r.party_id && t(`entryTypes.${r.entry_type}.title`), r.narration, r.serial].filter(Boolean).join(' · ')}
                        </span>
                      </td>
                      <td className="num">{showPaise(amountOf(r))}</td>
                      <td className="nowrap muted">
                        {names.people.get(r.created_by) ?? '?'}
                        <span className="block small">{showMoment(r.created_at)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
      ) : (
        <p className="empty">{t('daybook.empty')}</p>
      )}
    </>
  );
}

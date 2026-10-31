import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AutoForm } from '@/components/auto-form';
import { GroupCards, GROUPS, SitesTable } from '@/components/board';
import { ListLink } from '@/components/list-link';
import { SearchSelect } from '@/components/search-select';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { isCommonEntry } from '@/lib/firm';
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
  created_at: string;
  lines: { account: string; amount_paise: number; firm_id: string | null }[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// ponytail: latest 200 only; add paging when the books outgrow it.
const LIMIT = 200;

type Params = { waiting?: string; date?: string; site?: string };

/**
 * Every entry, newest first. Owner and office staff see the working firm's entries plus the Common ones (no firm on
 * any line, e.g. cash handed to a supervisor), which carry a tag. Supervisors see the entries they may see.
 * Filters: ?waiting=1 (not yet checked), ?date=YYYY-MM-DD, ?site=<id>. A firm or site adds a summary of its books.
 */
export default async function DayBookPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const { waiting } = params;
  const date = params.date && DATE.test(params.date) ? params.date : undefined;
  const site = params.site && UUID.test(params.site) ? params.site : undefined;
  const profile = await requireProfile();
  const working = await getWorkingFirm();
  const firm = working?.firm.id;
  const db = await createClient();

  // Only entries that are not simply checked: a list that stays short as entries get checked, where the whole table
  // grew with every entry (and was cut off at 1,000 rows, showing older checked entries as waiting).
  // ponytail: past 1,000 unchecked or cancelled entries this list is cut off too; join the status into the list query then.
  const { data: statuses } = await db.from('entry_status').select('entry_id, status').neq('status', 'verified');
  const statusOf = new Map((statuses ?? []).map((s) => [s.entry_id as string, s.status as string]));
  const waitingIds = [...statusOf].filter(([, s]) => s === 'unverified').map(([id]) => id);

  // `lines` sizes the entry and shows whether it names a firm; `match` (an inner join on the same lines) keeps only
  // entries touching the firm/site. Common entries all have the CM serial (no entry firm); `lines` tells which of those
  // name no firm at all, since a firm's bill paid from owner cash is CM too.
  const list = (only?: 'firm' | 'common') => {
    let query = db
      .from('entries')
      .select(`id, serial, entry_type, entry_date, party_id, narration, created_at, lines:entry_lines(account, amount_paise, firm_id)${only === 'firm' || site ? ', match:entry_lines!inner(firm_id, site_id)' : ''}`)
      .order('created_at', { ascending: false })
      .limit(LIMIT);
    if (date) query = query.eq('entry_date', date);
    if (waiting) query = query.in('id', waitingIds);
    if (only === 'firm') query = query.eq('match.firm_id', firm!);
    if (only === 'common') query = query.is('firm_id', null);
    if (site) query = query.eq('match.site_id', site);
    return query.returns<Row[]>();
  };

  // What the books show now for this firm and/or site. A firm also sees the between-firm amounts other firms hold against it.
  let balances = db.from('balances').select('*');
  if (site) balances = balances.eq('site_id', site);
  if (firm) balances = site ? balances.eq('firm_id', firm) : balances.or(`firm_id.eq.${firm},counter_firm_id.eq.${firm}`);

  const [{ data: own }, { data: cm }, { data: summary }, names, t] = await Promise.all([
    firm ? list('firm') : list(),
    firm ? list('common') : Promise.resolve({ data: [] as Row[] }),
    // Supervisors see their entries but not profits, as on the home page.
    (firm || site) && profile.role !== 'supervisor' ? balances.returns<LineRow[]>() : Promise.resolve({ data: null }),
    loadNames(db),
    getTranslations(),
  ]);
  const common = (cm ?? []).filter((r) => isCommonEntry(r.lines));
  const commonIds = new Set(common.map((r) => r.id));
  const rows = [...(own ?? []), ...common].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, LIMIT);

  // The size of an entry: its plus lines, leaving out the automatic between-firm pair.
  const amountOf = (r: Row) =>
    r.lines.filter((l) => l.account !== 'inter_firm' && l.amount_paise > 0).reduce((s, l) => s + Number(l.amount_paise), 0);
  const href = (change: Partial<Params>) => {
    const next = new URLSearchParams(Object.entries({ site, date, waiting, ...change }).filter(([, v]) => v) as [string, string][]);
    return `/entries${next.size ? `?${next}` : ''}`;
  };
  const firmName = working?.firm.name;
  const siteName = site && names.sites.get(site);
  const title = firmName && siteName ? t('daybook.at', { firm: firmName, site: siteName }) : (firmName || siteName || t('nav.daybook'));

  // Costs at the site by kind of work (material, labour, ...), biggest first.
  const costs = new Map<string, number>();
  for (const r of summary ?? []) if (site && r.account === 'site_cost') costs.set(r.cost_head!, (costs.get(r.cost_head!) ?? 0) + Number(r.amount_paise));

  return (
    <>
      <h1>{title}</h1>
      <p className="lede">{t(site ? 'daybook.siteLede' : firm ? 'daybook.firmLede' : 'daybook.lede')}</p>

      <AutoForm action="/entries" className="filters book-filter">
        <label className="sr-only" htmlFor="site">{t('daybook.site')}</label>
        <SearchSelect id="site" name="site" defaultValue={site ?? ''} emptyLabel={t('daybook.allSites')} submitOnPick
          options={[...names.sites].map(([id, name]) => ({ value: id, label: name }))} />
        <label htmlFor="date" className="sr-only">{t('daybook.onDate')}</label>
        <input id="date" type="date" name="date" defaultValue={date ?? ''} />
        {waiting && <input type="hidden" name="waiting" value="1" />}
        {(site || date || waiting) && <Link href="/entries" className="chip">{t('daybook.clear')}</Link>}
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
          {firm && !site && (
            <GroupCards plain={describeAll(summary, names, t)} groups={GROUPS.filter((g) => g !== 'owner')} t={t} />
          )}
        </div>
      )}

      <div className="filters">
        <Link href={href({ waiting: undefined })} className={`chip ${!waiting ? 'on' : ''}`}>{t('daybook.all')}</Link>
        <Link href={href({ waiting: '1' })} className={`chip ${waiting ? 'on' : ''}`}>
          {t('daybook.waiting')}{' '}
          <b>{firm || site || date ? rows.filter((r) => statusOf.get(r.id) === 'unverified').length : waitingIds.length}</b>
        </Link>
        <span className="muted">{t('daybook.count', { count: rows.length })}</span>
      </div>
      {rows.length > 0 ? (
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
                const status = statusOf.get(r.id) ?? 'verified';
                return (
                  <tr key={r.id}>
                    <td>
                      <ListLink href={`/entries/${r.id}`} className="serial underline">{r.serial}</ListLink>
                    </td>
                    <td className="nowrap">{showDate(r.entry_date)}</td>
                    <td>
                      <b>{t(`entryTypes.${r.entry_type}.title`)}</b>
                      {commonIds.has(r.id) && <span className="pill common" title={t('firm.commonHint')}>{t('firm.common')}</span>}
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

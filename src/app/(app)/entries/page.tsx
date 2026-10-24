import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { requireProfile } from '@/lib/auth';
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
  entry_lines: { account: string; amount_paise: number }[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Every entry, newest first. Filters: ?waiting=1 (not yet checked) and ?date=YYYY-MM-DD. */
export default async function DayBookPage({ searchParams }: { searchParams: Promise<{ waiting?: string; date?: string }> }) {
  const { waiting, date } = await searchParams;
  await requireProfile();
  const db = await createClient();

  const { data: statuses } = await db.from('entry_status').select('entry_id, status');
  const statusOf = new Map((statuses ?? []).map((s) => [s.entry_id as string, s.status as string]));
  const waitingIds = [...statusOf].filter(([, s]) => s === 'unverified').map(([id]) => id);

  // ponytail: latest 200 only; add paging when the books outgrow it.
  let query = db
    .from('entries')
    .select('id, serial, entry_type, entry_date, party_id, narration, entry_lines(account, amount_paise)')
    .order('created_at', { ascending: false })
    .limit(200);
  if (date && DATE.test(date)) query = query.eq('entry_date', date);
  if (waiting) query = query.in('id', waitingIds);
  const [{ data: rows }, names, t] = await Promise.all([query.returns<Row[]>(), loadNames(db), getTranslations()]);

  // The size of an entry: its plus lines, leaving out the automatic between-firm pair.
  const amountOf = (r: Row) =>
    r.entry_lines.filter((l) => l.account !== 'inter_firm' && l.amount_paise > 0).reduce((s, l) => s + Number(l.amount_paise), 0);

  return (
    <>
      <p className="eyebrow">{t('daybook.eyebrow')}</p>
      <h1>{t('nav.daybook')}</h1>
      <p className="lede">{t('daybook.lede')}</p>
      <div className="filters">
        <Link href="/entries" className={`chip ${!waiting && !date ? 'on' : ''}`}>{t('daybook.all')}</Link>
        <Link href="/entries?waiting=1" className={`chip ${waiting ? 'on' : ''}`}>
          {t('daybook.waiting')} <b>{waitingIds.length}</b>
        </Link>
        <form className="date-filter">
          <label htmlFor="date" className="sr-only">{t('daybook.onDate')}</label>
          <input id="date" type="date" name="date" defaultValue={date ?? ''} />
          <button type="submit" className="btn ghost">{t('daybook.show')}</button>
        </form>
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

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Icon } from '@/components/icons';
import { PrintButton } from '@/components/print-button';
import { requireProfile } from '@/lib/auth';
import { showPaise } from '@/lib/money';
import { passbook, QTY, usedNote, type Used } from '@/lib/stock';
import { createClient } from '@/lib/supabase/server';
import { showDate, todayInIndia } from '../../entries/data';
import type { ArrivalRow } from '../arrivals';

interface UseRow extends Used { id: string; remark: string; mix_name: string }

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One material at one site, like a bank passbook: the stock at the start of the period, then each arrival and each use
 * from the daily reports, with what was left after it. ?site=&material=&from=&to=
 */
export default async function MaterialPassbookPage({ searchParams }: {
  searchParams: Promise<{ site?: string; material?: string; from?: string; to?: string }>;
}) {
  await requireProfile();
  const params = await searchParams;
  if (!UUID.test(params.site ?? '') || !UUID.test(params.material ?? '')) notFound();
  const today = todayInIndia();
  const to = DATE.test(params.to ?? '') ? params.to! : today;
  const from = DATE.test(params.from ?? '') && params.from! <= to ? params.from! : `${to.slice(0, 8)}01`;
  const t = await getTranslations();
  const db = await createClient();
  // A supervisor gets no site row (and no lines) for a site that is not theirs.
  const [{ data: site }, { data: material }, { data: inData }, { data: useData }] = await Promise.all([
    db.from('sites').select('id, name').eq('id', params.site!).maybeSingle(),
    db.from('materials').select('id, name, unit:units(name)').eq('id', params.material!)
      .returns<{ id: string; name: string; unit: { name: string } | null }[]>().maybeSingle(),
    db.from('stock_in_rows').select('*').eq('site_id', params.site!).eq('material_id', params.material!)
      .lte('entry_date', to).returns<ArrivalRow[]>(),
    db.from('material_use').select('id, site_id, material_id, use_date, quantity, remark, mix_name')
      .eq('site_id', params.site!).eq('material_id', params.material!).lte('use_date', to).order('created_at').returns<UseRow[]>(),
  ]);
  if (!site || !material) notFound();
  const { opening, lines } = passbook(inData ?? [], useData ?? [], from, to);
  const unit = material.unit?.name ?? '';
  const qty = (n: number) => `${QTY.format(n)} ${unit}`.trim();
  const closing = lines.at(-1)?.balance ?? opening;
  const period = `${showDate(from)} – ${showDate(to)}`;
  const isArrival = (row: ArrivalRow | UseRow): row is ArrivalRow => 'entry_date' in row;

  return (
    <>
      <p className="mb-2 no-print">
        <Link href={`/stock?site=${site.id}&from=${from}&to=${to}`} className="back">
          <Icon name="chevronLeft" size={16} /> {t('stock.title')}
        </Link>
      </p>
      <div className="ledger-head">
        <div>
          <h1>{material.name}</h1>
          <p className="muted">{site.name} · {period}</p>
        </div>
        <PrintButton label={t('report.print')} title={`${material.name} - ${site.name} - ${period}`} />
      </div>

      <div className="card table-wrap flush">
        <table className="ledger statement">
          <thead>
            <tr>
              <th>{t('stock.date')}</th>
              <th>{t('stock.particulars')}</th>
              <th className="num">{t('stock.inQty')}</th>
              <th className="num">{t('stock.outQty')}</th>
              <th className="num">{t('stock.left')}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="nowrap">{showDate(from)}</td>
              <td><strong>{t('stock.opening')}</strong></td>
              <td /><td />
              <td className={opening < 0 ? 'num minus' : 'num'}><strong>{qty(opening)}</strong></td>
            </tr>
            {lines.map((l) => (
              <tr key={l.row.id}>
                <td className="nowrap">
                  {isArrival(l.row) ? showDate(l.date) : (
                    <Link href={`/report?site=${site.id}&date=${l.date}`} className="underline">{showDate(l.date)}</Link>
                  )}
                </td>
                <td>
                  {isArrival(l.row) ? t('stock.arrivedLine') : t('stock.usedLine')}
                  {isArrival(l.row) && l.row.rate_paise !== null && <span className="muted"> · {showPaise(Number(l.row.rate_paise))}</span>}
                  {(isArrival(l.row) ? l.row.note : usedNote(l.row)) && (
                    <span className="ledger-note">{isArrival(l.row) ? l.row.note : usedNote(l.row)}</span>
                  )}
                </td>
                <td className="num">{l.in ? qty(l.in) : ''}</td>
                <td className="num">{l.out ? qty(l.out) : ''}</td>
                <td className={l.balance < 0 ? 'num minus' : 'num'}>{qty(l.balance)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>{t('stock.closing')}</td>
              <td className="num">{qty(lines.reduce((s, l) => s + l.in, 0))}</td>
              <td className="num">{qty(lines.reduce((s, l) => s + l.out, 0))}</td>
              <td className={closing < 0 ? 'num minus' : 'num'}><strong>{qty(closing)}</strong></td>
            </tr>
          </tfoot>
        </table>
      </div>
      {lines.length === 0 && <p className="hint">{t('stock.noMoves')}</p>}
    </>
  );
}

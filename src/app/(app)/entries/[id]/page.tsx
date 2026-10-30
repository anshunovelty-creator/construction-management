import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireProfile } from '@/lib/auth';
import { describeChanges, lineLabel, type LineRow } from '@/lib/ledger/plain';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { cancelEntry, verifyEntry } from '../actions';
import { loadNames, showDate } from '../data';
import { Icon } from '@/components/icons';

interface Entry {
  id: string;
  serial: string;
  entry_type: string;
  entry_date: string;
  party_id: string | null;
  reference: string;
  narration: string;
  reverses_entry_id: string | null;
  created_by: string;
}

interface BillTdsRow {
  rate_bp: number;
  section: string;
  tds_paise: number | string;
}

interface BillItemRow {
  line_no: number;
  quantity: number | string;
  rate_paise: number | string;
  gst_bp: number;
  amount_paise: number | string;
  gst_paise: number | string;
  material: { name: string } | null;
}

export default async function EntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const [{ id }, { saved, error }] = await Promise.all([params, searchParams]);
  const profile = await requireProfile();
  const db = await createClient();
  const { data: entry } = await db.from('entries').select('*').eq('id', id).maybeSingle<Entry>();
  if (!entry) notFound();

  const [{ data: lines }, { data: items }, { data: tds }, { data: status }, { data: events }, { data: reversal }, { data: pairs }, names, t] = await Promise.all([
    db.from('entry_lines').select('*').eq('entry_id', id).order('line_no').returns<LineRow[]>(),
    db.from('bill_items').select('line_no, quantity, rate_paise, gst_bp, amount_paise, gst_paise, material:materials(name)')
      .eq('entry_id', id).order('line_no').returns<BillItemRow[]>(),
    db.from('bill_tds').select('rate_bp, section, tds_paise').eq('entry_id', id).maybeSingle<BillTdsRow>(),
    db.from('entry_status').select('status').eq('entry_id', id).maybeSingle<{ status: string }>(),
    db.from('entry_events').select('kind, actor, reason').eq('entry_id', id).order('id'),
    db.from('entries').select('id, serial').eq('reverses_entry_id', id).maybeSingle(),
    db.from('balances').select('*').eq('account', 'inter_firm').returns<LineRow[]>(),
    loadNames(db),
    getTranslations(),
  ]);
  const changes = describeChanges(lines ?? [], pairs ?? [], names, t);
  const total = (lines ?? []).reduce((sum, l) => sum + Number(l.amount_paise), 0);
  const state = status?.status ?? 'unverified';
  const canCheck = state === 'unverified' && entry.created_by !== profile.user_id && profile.role !== 'supervisor';
  // Only the owner changes checked entries (the database enforces it too).
  const canCancel = state === 'unverified' || (state === 'verified' && profile.role === 'owner');
  const date = showDate(entry.entry_date);

  return (
    <>
      <p className="mb-2">
        <Link href="/entries" className="back"><Icon name="chevronLeft" size={16} /> {t('nav.daybook')}</Link>
      </p>
      {saved && (
        <p className="banner" role="status">
          <Icon name="check" /> {t('entries.saved', { serial: entry.serial })}
        </p>
      )}
      {error && (
        <p className="banner bad" role="alert">
          {error === 'reason_required' ? t('errors.reason_required') : error}
        </p>
      )}
      <article className="card story-card">
        <div className="meta">
          <span>
            {t('entries.serial')} <b className="serial">{entry.serial}</b>
          </span>
          <span>{date}</span>
          <span>
            {t('entries.typedBy')} <b>{names.people.get(entry.created_by) ?? '?'}</b>
          </span>
          <span className={`pill ${state}`}>{t(`entries.status.${state}`)}</span>
        </div>
        <h1>{t(`entryTypes.${entry.entry_type}.title`)}</h1>
        {(entry.narration || entry.party_id || entry.reference) && (
          <p className="story">
            {[
              entry.party_id && <b key="party">{names.parties.get(entry.party_id)}</b>,
              entry.narration,
              entry.reference && <span key="ref" className="muted">{t('entries.ref', { ref: entry.reference })}</span>,
            ]
              .filter(Boolean)
              .flatMap((part, i) => (i === 0 ? [part] : [' · ', part]))}
          </p>
        )}

        {items && items.length > 0 && (
          <BillItemsTable items={items} tds={tds} vendorBill={entry.entry_type === 'vendor_bill'} t={t} />
        )}

        <section>
          <h2 className="section-title">{t('entries.whatChanges')}</h2>
          <ul className="effects">
            {changes.map((c) => (
              <li key={c.key}>
                <span className={`arrow ${c.shown > 0 ? 'up' : 'down'}`} aria-hidden="true">{c.shown > 0 ? '↑' : '↓'}</span>
                <span>{c.label}</span>
                <span className={`amount ${c.shown > 0 ? 'up' : 'down'}`}>
                  {t(c.shown > 0 ? 'entries.up' : 'entries.down', { amount: showPaise(Math.abs(c.shown)) })}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <p className="why">{t(`entryTypes.${entry.entry_type}.why`)}</p>

        <div className="table-wrap">
          <table>
            <caption>{t('entries.linesCaption')}</caption>
            <thead>
              <tr>
                <th>{t('entries.line')}</th>
                <th className="num">+</th>
                <th className="num">−</th>
              </tr>
            </thead>
            <tbody>
              {(lines ?? []).map((line, i) => {
                const amount = Number(line.amount_paise);
                return (
                  <tr key={i}>
                    <td>{lineLabel(line, names, t)}</td>
                    <td className="num up">{amount > 0 ? showPaise(amount) : ''}</td>
                    <td className="num down">{amount < 0 ? showPaise(-amount) : ''}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>{t('entries.together')}</td>
                <td className="num balanced" colSpan={2}>
                  {total === 0 ? t('entries.balanced') : showPaise(total)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {reversal && (
          <p className="muted">
            {t('entries.cancelledBy')}{' '}
            <Link href={`/entries/${reversal.id}`} className="serial underline">{reversal.serial}</Link>
          </p>
        )}
        {entry.reverses_entry_id && (
          <p className="muted">
            <Link href={`/entries/${entry.reverses_entry_id}`} className="underline">{t('entries.seeOriginal')}</Link>
          </p>
        )}

        {(canCheck || canCancel) && (
          <div className="actions">
            {canCheck && (
              <form action={verifyEntry.bind(null, id)}>
                <button type="submit" className="btn"><Icon name="check" /> {t('entries.check')}</button>
              </form>
            )}
            {canCancel && (
              <details className="cancel">
                <summary>{t(canCheck ? 'entries.somethingWrong' : 'entries.cancelTitle')}</summary>
                <form action={cancelEntry.bind(null, id)} className="form">
                  <div className="field">
                    <label htmlFor="reason">{t('entries.reason')}</label>
                    <input id="reason" name="reason" required />
                  </div>
                  <div className="row-buttons">
                    {canCheck && (
                      <button type="submit" name="do" value="reject" className="btn danger">{t('entries.reject')}</button>
                    )}
                    <button type="submit" name="do" value="cancel" className="btn ghost">{t('entries.cancel')}</button>
                  </div>
                  <p className="hint">{t('entries.cancelHint')}</p>
                </form>
              </details>
            )}
          </div>
        )}

        {events && events.length > 0 && (
          <ul className="events">
            {events.map((e, i) => (
              <li key={i}>
                {t(`entries.event.${e.kind}`, { who: names.people.get(e.actor) ?? '?' })}
                {e.reason && <> · “{e.reason}”</>}
              </li>
            ))}
          </ul>
        )}
      </article>
    </>
  );
}

/** A bill's lines as typed, and the three totals at its foot. */
function BillItemsTable({
  items,
  tds,
  vendorBill,
  t,
}: {
  items: BillItemRow[];
  tds: BillTdsRow | null;
  vendorBill: boolean;
  t: Awaited<ReturnType<typeof getTranslations>>;
}) {
  const rows = items.map((i) => ({ ...i, amount: Number(i.amount_paise), gst: Number(i.gst_paise) }));
  const base = rows.reduce((s, r) => s + r.amount, 0);
  const gst = rows.reduce((s, r) => s + r.gst, 0);
  const tdsAmount = tds ? Number(tds.tds_paise) : 0;
  return (
    <section>
      <h2 className="section-title">{t('items.title')}</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="num">#</th>
              <th>{t('items.item')}</th>
              <th className="num">{t('items.qty')}</th>
              <th className="num">{t('items.rate')}</th>
              <th className="num">{t('items.amount')}</th>
              <th className="num">{t('items.gst')}</th>
              <th className="num">{t('items.gstAmount')}</th>
              <th className="num">{t('items.total')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.line_no}>
                <td className="num muted">{r.line_no}</td>
                <td>{r.material?.name}</td>
                <td className="num">{Number(r.quantity)}</td>
                <td className="num">{showPaise(Number(r.rate_paise))}</td>
                <td className="num">{showPaise(r.amount)}</td>
                <td className="num">{r.gst_bp / 100}%</td>
                <td className="num">{showPaise(r.gst)}</td>
                <td className="num"><b>{showPaise(r.amount + r.gst)}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="bill-totals">
        <div><dt>{t('items.base')}</dt><dd>{showPaise(base)}</dd></div>
        <div><dt>{t('items.gstTotal')}</dt><dd>{showPaise(gst)}</dd></div>
        <div className="grand"><dt>{t('items.grand')}</dt><dd>{showPaise(base + gst)}</dd></div>
        {tds && (
          <div>
            <dt>{t('items.tds', { rate: String(tds.rate_bp / 100) })}{tds.section && ` · ${tds.section}`}</dt>
            <dd>−{showPaise(tdsAmount)}</dd>
          </div>
        )}
        {tds && vendorBill && (
          <div className="grand"><dt>{t('items.netVendor')}</dt><dd>{showPaise(base + gst - tdsAmount)}</dd></div>
        )}
      </dl>
    </section>
  );
}

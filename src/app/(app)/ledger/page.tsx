import { getTranslations } from 'next-intl/server';
import { ListLink } from '@/components/list-link';
import { SearchSelect } from '@/components/search-select';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { buildStatement } from '@/lib/ledger/statement';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { loadNames, showDate, todayInIndia } from '../entries/data';
import { PrintButton } from '@/components/print-button';

interface Line {
  entry_id: string;
  serial: string;
  entry_type: string;
  date: string;
  status: string;
  reference: string;
  /** Where the money went or came from, already named: a site, an account, a party, items. */
  detail: string[];
  narration: string;
  debit: number;
  credit: number;
  common?: boolean;
}

/** Columns every ledger view shares. */
interface ViewRow {
  entry_id: string; serial: string; entry_type: string; entry_date: string; status: string; reference: string; narration: string;
}
type VendorRow = ViewRow & { amount_paise: string | number; site_id: string | null; money_account_id: string | null; item_names: string | null };
type ClientRow = ViewRow & {
  receivable_paise: string | number; gross_paise: string | number; gst_paise: string | number; site_id: string | null; money_account_id: string | null;
};
type SiteRow = ViewRow & { cost_paise: string | number; billed_paise: string | number; firm_id: string | null; party_id: string | null; item_names: string | null };

const base = (r: ViewRow) => ({
  entry_id: r.entry_id, serial: r.serial, entry_type: r.entry_type, date: r.entry_date, status: r.status, reference: r.reference, narration: r.narration,
});
const named = (...bits: (string | null | undefined)[]) => bits.filter((b): b is string => !!b);

/**
 * One vendor's, client's or site's statement in the working firm, like a bank statement:
 * date, entry, particulars, debit, credit and the running balance. ?of=party:<id> or site:<id>, &from, &to.
 */
export default async function LedgerPage({ searchParams }: { searchParams: Promise<{ of?: string; from?: string; to?: string }> }) {
  await requireProfile('owner', 'office');
  const { of = '', from = '', to = '' } = await searchParams;
  const [kind, id = ''] = of.split(':');
  const [working, t] = await Promise.all([getWorkingFirm(), getTranslations()]);
  if (!working) return <p className="empty">{t('party.noFirm')}</p>;
  const { firm } = working;
  const db = await createClient();
  const [names, { data: parties }, { data: sites }] = await Promise.all([
    loadNames(db),
    db.from('parties').select('id, name, kind').in('kind', ['vendor', 'client']).order('name'),
    db.from('sites').select('id, name').order('name'),
  ]);
  const party = kind === 'party' ? (parties ?? []).find((p) => p.id === id) : undefined;
  const site = kind === 'site' ? (sites ?? []).find((s) => s.id === id) : undefined;
  const subject = party?.name ?? site?.name;

  let rows: Line[] = [];
  if (party?.kind === 'vendor') {
    const { data, error } = await db.from('party_rows').select('*').eq('firm_id', firm.id).eq('party_id', id)
      .order('entry_date').order('serial').returns<VendorRow[]>();
    if (error) throw new Error(error.message);
    rows = (data ?? []).map((r) => {
      const amount = Number(r.amount_paise);
      const paid = r.entry_type === 'vendor_payment';
      return {
        ...base(r),
        detail: named(r.site_id && names.sites.get(r.site_id), r.money_account_id && names.accounts.get(r.money_account_id), r.item_names),
        // From our books: a bill is owed to the vendor (credit), a payment clears it (debit).
        debit: paid ? amount : 0,
        credit: paid ? 0 : amount,
      };
    });
  } else if (party?.kind === 'client') {
    const { data, error } = await db.from('client_rows').select('*').eq('firm_id', firm.id).eq('party_id', id)
      .order('entry_date').order('serial').returns<ClientRow[]>();
    if (error) throw new Error(error.message);
    rows = (data ?? []).map((r) => {
      const due = Number(r.receivable_paise);
      // client_rows' gross includes GST.
      const gst = Number(r.gst_paise);
      const gross = Number(r.gross_paise) - gst;
      return {
        ...base(r),
        detail: named(
          r.site_id && names.sites.get(r.site_id),
          r.money_account_id && names.accounts.get(r.money_account_id),
          r.entry_type === 'client_bill'
            ? [
              t('ledger.bill.gross', { amount: showPaise(gross) }),
              gst > 0 && t('ledger.bill.gst', { amount: showPaise(gst) }),
              gross + gst > due && t('ledger.bill.cut', { amount: showPaise(gross + gst - due) }),
            ].filter(Boolean).join(' ')
            : null,
        ),
        // A bill (net of what the client cut) is owed to us (debit); money received clears it (credit).
        debit: Math.max(due, 0),
        credit: Math.max(-due, 0),
      };
    });
  } else if (site) {
    // Costs paid from owner or supervisor cash belong to no firm; they are this site's too, marked "common".
    const { data, error } = await db.from('site_rows').select('*').eq('site_id', id).or(`firm_id.eq.${firm.id},firm_id.is.null`)
      .order('entry_date').order('serial').returns<SiteRow[]>();
    if (error) throw new Error(error.message);
    rows = (data ?? []).map((r) => ({
      ...base(r),
      detail: named(r.party_id && names.parties.get(r.party_id), r.item_names),
      debit: Number(r.cost_paise),
      credit: Number(r.billed_paise),
      common: r.firm_id === null,
    }));
  }

  const s = buildStatement(rows, from, to);
  const side = party?.kind ?? 'site';
  const drCr = (paise: number) => (paise === 0 ? showPaise(0) : `${showPaise(Math.abs(paise))} ${paise > 0 ? t('ledger.dr') : t('ledger.cr')}`);
  const closingWords = s.closing === 0
    ? t('ledger.settled')
    : t(`ledger.closing.${side}.${s.closing > 0 ? 'dr' : 'cr'}`, { firm: firm.name, name: subject ?? '', amount: showPaise(Math.abs(s.closing)) });
  const period = from || to
    ? t('ledger.period', { from: from ? showDate(from) : t('ledger.start'), to: showDate(to || todayInIndia()) })
    : t('ledger.allEntries', { to: showDate(todayInIndia()) });

  return (
    <>
      <div className="ledger-head">
        <div>
          <p className="muted ledger-firm">{firm.name}</p>
          <h1>{subject ? t('ledger.titleOf', { name: subject }) : t('ledger.title')}</h1>
          {subject && <p className="muted">{period}</p>}
        </div>
        {subject && <PrintButton label={t('ledger.print')} />}
      </div>

      <form className="card ledger-filters no-print" method="get">
        <div className="field">
          <label htmlFor="ledger-of">{t('ledger.of')}</label>
          <SearchSelect id="ledger-of" name="of" defaultValue={of} required placeholder={t('ledger.pick')} options={[
            ...(parties ?? []).map((p) => ({ value: `party:${p.id}`, label: p.name, group: t(`ledger.groups.${p.kind as 'vendor' | 'client'}`) })),
            ...(sites ?? []).map((x) => ({ value: `site:${x.id}`, label: x.name, group: t('ledger.groups.site') })),
          ]} />
        </div>
        <div className="field">
          <label htmlFor="ledger-from">{t('ledger.from')}</label>
          <input id="ledger-from" type="date" name="from" defaultValue={from} />
        </div>
        <div className="field">
          <label htmlFor="ledger-to">{t('ledger.to')}</label>
          <input id="ledger-to" type="date" name="to" defaultValue={to} />
        </div>
        <button type="submit" className="btn">{t('ledger.show')}</button>
      </form>

      {!subject ? (
        <p className="card empty">{of ? t('ledger.notFound') : t('ledger.hint')}</p>
      ) : (
        <>
          <div className="card table-wrap flush">
            <table className="ledger statement">
              <thead>
                <tr>
                  <th>{t('ledger.date')}</th>
                  <th>{t('ledger.entry')}</th>
                  <th>{t('ledger.particulars')}</th>
                  <th className="num">{t(`ledger.debit.${side}`)}</th>
                  <th className="num">{t(`ledger.credit.${side}`)}</th>
                  <th className="num">{t('ledger.balance')}</th>
                </tr>
              </thead>
              <tbody>
                {from && (
                  <tr>
                    <td className="nowrap">{showDate(from)}</td>
                    <td />
                    <td><strong>{t('ledger.broughtForward')}</strong></td>
                    <td /><td />
                    <td className="num strong">{drCr(s.opening)}</td>
                  </tr>
                )}
                {s.lines.length === 0 && (
                  <tr><td colSpan={6} className="muted">{t('ledger.none')}</td></tr>
                )}
                {s.lines.map((r) => (
                  <tr key={r.entry_id}>
                    <td className="nowrap">{showDate(r.date)}</td>
                    <td className="nowrap">
                      <ListLink href={`/entries/${r.entry_id}`} className="serial underline">{r.serial}</ListLink>
                    </td>
                    <td className="particulars">
                      <strong>{t(`entryTypes.${r.entry_type}.title`)}{r.reference && ` ${r.reference}`}</strong>
                      {r.common && <span className="pill small-pill">{t('ledger.common')}</span>}
                      {r.detail.length > 0 && <span className="muted"> · {r.detail.join(' · ')}</span>}
                      {r.narration && <span className="ledger-note">{r.narration}</span>}
                    </td>
                    <td className="num">{r.debit ? showPaise(r.debit) : ''}</td>
                    <td className="num">{r.credit ? showPaise(r.credit) : ''}</td>
                    <td className="num">{drCr(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>{t('ledger.totals')}</td>
                  <td className="num">{showPaise(s.debit)}</td>
                  <td className="num">{showPaise(s.credit)}</td>
                  <td className="num strong">{drCr(s.closing)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="ledger-closing"><strong>{t('ledger.closingTitle')}</strong> {closingWords}</p>
          <p className="muted ledger-printed">{t('ledger.printedOn', { date: showDate(todayInIndia()) })}</p>
        </>
      )}
    </>
  );
}

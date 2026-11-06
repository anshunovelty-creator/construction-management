import { getTranslations } from 'next-intl/server';
import { ListLink } from '@/components/list-link';
import { SearchSelect } from '@/components/search-select';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { buildStatement, tallyFoot } from '@/lib/ledger/statement';
import { showPaise, roundOffSmall } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { loadNames, showDate, todayInIndia } from '../entries/data';
import { PrintButton } from '@/components/print-button';
import { Icon } from '@/components/icons';
import Link from 'next/link';

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

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** The first and last day of the month `shift` months from the one `date` falls in. */
function monthOf(date: string, shift = 0): { from: string; to: string } {
  const first = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1 + shift, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

/**
 * One vendor's, client's or site's statement in the working firm, like a bank statement:
 * date, entry, particulars, debit, credit and the running balance. ?of=party:<id> or site:<id>, &from, &to.
 */
export default async function LedgerPage({ searchParams }: { searchParams: Promise<{ of?: string; from?: string; to?: string }> }) {
  await requireProfile('owner', 'office');
  const params = await searchParams;
  const of = params.of ?? '';
  // Like Tally, a ledger is read a month at a time: this month unless dates are given.
  const given = DATE.test(params.from ?? '') || DATE.test(params.to ?? '');
  const from = given ? (DATE.test(params.from ?? '') ? params.from! : '') : monthOf(todayInIndia()).from;
  const to = given ? (DATE.test(params.to ?? '') ? params.to! : '') : monthOf(todayInIndia()).to;
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
  const foot = tallyFoot(s);
  const monthLink = (shift: number) => {
    const m = monthOf(from || todayInIndia(), shift);
    return `/ledger?of=${encodeURIComponent(of)}&from=${m.from}&to=${m.to}`;
  };
  const side = party?.kind ?? 'site';
  const drCr = (paise: number) => (paise === 0 ? showPaise(0) : `${showPaise(Math.abs(paise))} ${paise > 0 ? t('ledger.dr') : t('ledger.cr')}`);
  // Dr/Cr alone does not say who owes whom, so a vendor's or client's balance also says it in words and colour.
  // In both, a debit balance is money we get: extra paid to a vendor, or what a client still owes.
  const balanceCell = (exact: number, paise = side === 'site' ? exact : roundOffSmall(exact)) => (side === 'site' || paise === 0 ? drCr(paise) : (
    <span className={paise > 0 ? 'plus' : 'minus'}>
      {side === 'vendor' && paise > 0 && '-'}{drCr(paise)}
      <span className="balance-word">{t(`ledger.balanceWord.${side}.${paise > 0 ? 'dr' : 'cr'}`)}</span>
    </span>
  ));
  // Green when the balance comes to us, red when it goes from us.
  const closing = side === 'site' ? s.closing : roundOffSmall(s.closing);
  const closingGood = side === 'site' ? closing <= 0 : closing >= 0;
  const closingWords = closing === 0
    ? t('ledger.settled')
    : t(`ledger.closing.${side}.${closing > 0 ? 'dr' : 'cr'}`, { firm: firm.name, name: subject ?? '', amount: showPaise(Math.abs(closing)) });
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
        {of && (
          <div className="day-picker">
            <Link href={monthLink(-1)} className="btn ghost" aria-label={t('ledger.prevMonth')}><Icon name="chevronLeft" /> {t('ledger.prevMonth')}</Link>
            <Link href={monthLink(1)} className="btn ghost" aria-label={t('ledger.nextMonth')}>{t('ledger.nextMonth')} <Icon name="chevronRight" /></Link>
          </div>
        )}
      </form>

      {!subject ? (
        <p className="card empty">{of ? t('ledger.notFound') : t('ledger.hint')}</p>
      ) : (
        <>
          <p className={`banner${closingGood ? '' : ' bad'}`}>
            <span><strong>{t('ledger.closingTitle', { date: showDate(to || todayInIndia()) })}</strong> {closingWords}</span>
          </p>
          <div className="card table-wrap flush">
            <table className="ledger statement">
              <thead>
                <tr>
                  <th>{t('ledger.date')}</th>
                  <th>{t('ledger.particulars')}</th>
                  <th>{t('ledger.billNo')}</th>
                  <th className="num">{t(`ledger.debit.${side}`)}</th>
                  <th className="num">{t(`ledger.credit.${side}`)}</th>
                  <th className="num">{t('ledger.balance')}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="nowrap">{from ? showDate(from) : ''}</td>
                  <td><strong>{t('ledger.openingBalance')}</strong></td>
                  <td />
                  <td className="num">{s.opening > 0 ? showPaise(s.opening) : ''}</td>
                  <td className="num">{s.opening < 0 ? showPaise(-s.opening) : ''}</td>
                  <td className="num strong">{balanceCell(s.opening)}</td>
                </tr>
                {s.lines.length === 0 && (
                  <tr><td colSpan={6} className="muted">{t('ledger.none')}</td></tr>
                )}
                {s.lines.map((r) => (
                  <tr key={r.entry_id}>
                    <td className="nowrap">{showDate(r.date)}</td>
                    <td className="particulars">
                      <strong>{t(`entryTypes.${r.entry_type}.title`)}</strong>
                      {r.common && <span className="pill small-pill">{t('ledger.common')}</span>}
                      {r.detail.length > 0 && <span className="muted"> · {r.detail.join(' · ')}</span>}
                      {r.narration && <span className="ledger-note">{r.narration}</span>}
                    </td>
                    {/* The bill (or cheque) number as typed; the app's own number when there is none. Opens the entry. */}
                    <td className="nowrap">
                      <ListLink href={`/entries/${r.entry_id}`} className="underline">
                        {r.reference || <span className="serial muted">{r.serial}</span>}
                      </ListLink>
                    </td>
                    <td className="num">{r.debit ? showPaise(r.debit) : ''}</td>
                    <td className="num">{r.credit ? showPaise(r.credit) : ''}</td>
                    <td className="num">{balanceCell(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
              {/* Tally's foot: the current totals (with the opening balance), the closing balance on the other side,
                  then both columns on the same total. */}
              <tfoot>
                <tr>
                  <td colSpan={3}>{t('ledger.currentTotal')}</td>
                  <td className="num">{showPaise(foot.debit)}</td>
                  <td className="num">{showPaise(foot.credit)}</td>
                  <td />
                </tr>
                <tr>
                  <td className="nowrap">{showDate(to || todayInIndia())}</td>
                  <td><strong>{t('ledger.closingBalance')}</strong></td>
                  <td />
                  <td className="num">{foot.closingDebit ? showPaise(foot.closingDebit) : ''}</td>
                  <td className="num">{foot.closingCredit ? showPaise(foot.closingCredit) : ''}</td>
                  <td className="num strong">{balanceCell(s.closing)}</td>
                </tr>
                <tr className="ledger-grand">
                  <td colSpan={3} />
                  <td className="num">{showPaise(foot.total)}</td>
                  <td className="num">{showPaise(foot.total)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="muted ledger-printed">{t('ledger.printedOn', { date: showDate(todayInIndia()) })}</p>
        </>
      )}
    </>
  );
}

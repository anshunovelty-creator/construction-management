import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { EntrySheet } from '@/components/entry-sheet';
import { requireProfile } from '@/lib/auth';
import { partyFigures } from '@/lib/ledger/party';
import { getEntryForm } from '@/lib/masters/registry';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { loadChoices } from '../masters/options';
import { postPartyRows } from '../entries/actions';
import { loadNames, showDate, todayInIndia } from '../entries/data';
import { sheetColumns } from '../entries/sheet/columns';
import { MoneyCell, Stat, StatusPill } from './shared';

interface PartyRow {
  entry_id: string;
  serial: string;
  entry_type: 'opening' | 'vendor_bill' | 'vendor_payment';
  entry_date: string;
  reference: string;
  narration: string;
  status: 'verified' | 'unverified';
  amount_paise: number | string;
  site_id: string | null;
  cost_head: string | null;
  money_account_id: string | null;
  material_id: string | null;
}

type Slug = 'vendor-bill' | 'pay-vendor';
/** Sheet columns in the workbook's order. */
const BILL_COLUMNS = ['entry_date', 'bill_no', 'material_id', 'amount', 'site_id', 'cost_head', 'narration'];
const PAY_COLUMNS = ['entry_date', 'amount', 'from_account_id', 'reference', 'narration'];
const fieldsOf = (slug: Slug, names: string[]) => names.map((name) => getEntryForm(slug)!.fields.find((f) => f.name === name)!);
/** Sheet headings worded like the tables above them (party.* keys). */
const LABELS: Record<string, string> = {
  bill_no: 'billNo', material_id: 'material', amount: 'amount', site_id: 'site', cost_head: 'costType', narration: 'remarks',
  from_account_id: 'paidFrom', reference: 'reference',
};

/** One party's page for one firm, like a vendor sheet of the outstanding workbook. ?firm=&id= */
export default async function PartyPage({ searchParams }: { searchParams: Promise<{ firm?: string; id?: string }> }) {
  await requireProfile('owner', 'office');
  const { firm: firmId = '', id = '' } = await searchParams;
  const db = await createClient();
  const [{ data: firm }, { data: party }] = await Promise.all([
    db.from('firms').select('id, name').eq('id', firmId).maybeSingle(),
    db.from('parties').select('id, name').eq('id', id).maybeSingle(),
  ]);
  if (!firm || !party) notFound();

  const billFields = fieldsOf('vendor-bill', BILL_COLUMNS);
  const payFields = fieldsOf('pay-vendor', PAY_COLUMNS);
  const [{ data }, names, choices, t, { data: materials }] = await Promise.all([
    db.from('party_rows').select('*').eq('firm_id', firm.id).eq('party_id', party.id)
      .order('entry_date').order('serial').returns<PartyRow[]>(),
    loadNames(db),
    loadChoices(db, [...billFields, ...payFields]),
    getTranslations(),
    db.from('materials').select('id, name'),
  ]);
  const materialOf = new Map((materials ?? []).map((m) => [m.id as string, m.name as string]));
  const rows = (data ?? []).map((r) => ({ ...r, amount: Number(r.amount_paise) }));
  const sumOf = (type: PartyRow['entry_type']) => rows.filter((r) => r.entry_type === type).reduce((s, r) => s + r.amount, 0);
  const bills = rows.filter((r) => r.entry_type === 'vendor_bill');
  const payments = rows.filter((r) => r.entry_type === 'vendor_payment');
  const opening = rows.find((r) => r.entry_type === 'opening');
  const f = partyFigures({
    opening_paise: sumOf('opening'), bills_paise: sumOf('vendor_bill'), paid_paise: sumOf('vendor_payment'),
    last_payment: payments.at(-1)?.entry_date ?? null,
  });

  // Balance after each payment, in date order: everything owed up to that day, less everything paid.
  const balanceAfter = new Map<string, number>();
  let running = 0;
  const isPay = (r: { entry_type: string }) => Number(r.entry_type === 'vendor_payment');
  for (const r of [...rows].sort((a, b) => a.entry_date.localeCompare(b.entry_date) || isPay(a) - isPay(b))) {
    running += isPay(r) ? -r.amount : r.amount;
    if (isPay(r)) balanceAfter.set(r.entry_id, running);
  }

  const lastBill = bills.at(-1);
  const lastFrom = payments.at(-1)?.money_account_id;
  const columns = (slug: Slug, fields: typeof billFields, dateKey: string) =>
    sheetColumns(slug, fields, choices, t).map((c) => ({
      ...c, label: t(`party.${c.name === 'entry_date' ? dateKey : LABELS[c.name] ?? c.name}`),
    }));
  const entryLink = (r: PartyRow) => (
    <>
      <Link href={`/entries/${r.entry_id}`} className="serial underline">{r.serial}</Link>
      {r.status === 'unverified' && <span className="pill unverified small-pill" title={t('party.notCheckedHint')}>{t('party.notChecked')}</span>}
    </>
  );
  // Without a site or a bank/cash account the sheet cannot save, so say where to add one.
  const missing = (source: 'sites' | 'moneyAccountsWeOwe', slug: string, key: string) =>
    (choices[source] ?? []).length === 0 && (
      <p className="banner bad">
        {t(`party.${key}`)} <Link href={`/masters/${slug}`} className="underline">{t('party.goSetup')}</Link>
      </p>
    );

  return (
    <>
      <Link href={`/?firm=${firm.id}`} className="back">◄ {t('party.home')}</Link>
      <div className="party-head">
        <h1>{party.name}</h1>
        <StatusPill status={f.status} t={t} />
      </div>
      <p className="lede">
        {opening
          ? t('party.openingAsOf', { firm: firm.name, date: showDate(opening.entry_date) })
          : t('party.noOpening', { firm: firm.name })}
      </p>

      {/* The workbook's summary block, read left to right as a sum. */}
      <div className="calc" aria-label={t('party.summary')}>
        <Stat label={t('party.opening')} value={showPaise(f.opening)} />
        <span className="op" aria-hidden="true">+</span>
        <Stat label={t('party.bills')} value={showPaise(f.bills)} />
        <span className="op" aria-hidden="true">=</span>
        <Stat label={t('party.total')} value={showPaise(f.total)} />
        <span className="op" aria-hidden="true">−</span>
        <Stat label={t('party.paid')} value={showPaise(f.paid)} tone="done"
          note={f.lastPayment ? t('party.lastOn', { date: showDate(f.lastPayment) }) : t('party.nothingPaid')} />
        <span className="op" aria-hidden="true">=</span>
        <Stat label={t('dashboard.balance')} value={showPaise(f.balance)} tone={f.balance > 0 ? 'owe' : 'done'} note={t('party.balanceNote')} />
      </div>

      <section className="ledger-section">
        <div className="section-head">
          <h2>{t('party.billsTitle')} <span className="count">{bills.length}</span></h2>
          <p className="hint">{t('party.billsHint')}</p>
        </div>
        {bills.length === 0 ? (
          <p className="card empty">{t('party.noBills')}</p>
        ) : (
          <div className="card table-wrap flush">
            <table className="ledger">
              <thead>
                <tr>
                  <th className="num">{t('party.sr')}</th>
                  <th>{t('party.billDate')}</th>
                  <th>{t('party.billNo')}</th>
                  <th>{t('party.material')}</th>
                  <th className="num">{t('party.amount')}</th>
                  <th>{t('party.site')}</th>
                  <th>{t('party.remarks')}</th>
                  <th>{t('party.entry')}</th>
                </tr>
              </thead>
              <tbody>
                {bills.map((r, i) => (
                  <tr key={r.entry_id}>
                    <td className="num muted">{i + 1}</td>
                    <td className="nowrap">{showDate(r.entry_date)}</td>
                    <td>{r.reference}</td>
                    <td>{r.material_id ? materialOf.get(r.material_id) : <span className="muted">–</span>}</td>
                    <MoneyCell paise={r.amount} />
                    <td>
                      {r.site_id ? names.sites.get(r.site_id) : ''}
                      {r.cost_head && <span className="muted"> · {t(`options.cost_head.${r.cost_head}`)}</span>}
                    </td>
                    <td>{r.narration}</td>
                    <td className="nowrap">{entryLink(r)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td /><td colSpan={3}>{t('party.totalBills')}</td><MoneyCell paise={f.bills} /><td colSpan={3} /></tr>
              </tfoot>
            </table>
          </div>
        )}
        <details className="add-rows">
          <summary className="btn">＋ {t('party.addBills')}</summary>
          {missing('sites', 'sites', 'needSite')}
          {(choices.materials ?? []).length === 0 && (
            <p className="hint">
              {t('party.noMaterials')} <Link href="/masters/materials" className="underline">{t('party.goSetup')}</Link>
            </p>
          )}
          <p className="hint">{t('party.addHint')}</p>
          <EntrySheet
            columns={columns('vendor-bill', billFields, 'billDate')}
            today={todayInIndia()}
            start={3}
            defaults={lastBill ? { site_id: lastBill.site_id ?? '', cost_head: lastBill.cost_head ?? '' } : {}}
            save={postPartyRows.bind(null, 'vendor-bill', firm.id, party.id)}
          />
        </details>
      </section>

      <section className="ledger-section">
        <div className="section-head">
          <h2>{t('party.paymentsTitle')} <span className="count">{payments.length}</span></h2>
          <p className="hint">{t('party.paymentsHint')}</p>
        </div>
        {payments.length === 0 ? (
          <p className="card empty">{t('party.noPayments')}</p>
        ) : (
          <div className="card table-wrap flush">
            <table className="ledger">
              <thead>
                <tr>
                  <th className="num">{t('party.sr')}</th>
                  <th>{t('party.payDate')}</th>
                  <th className="num">{t('party.amount')}</th>
                  <th>{t('party.paidFrom')}</th>
                  <th>{t('party.reference')}</th>
                  <th>{t('party.remarks')}</th>
                  <th className="num">{t('party.balanceAfter')}</th>
                  <th>{t('party.entry')}</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((r, i) => (
                  <tr key={r.entry_id}>
                    <td className="num muted">{i + 1}</td>
                    <td className="nowrap">{showDate(r.entry_date)}</td>
                    <MoneyCell paise={r.amount} />
                    <td>{r.money_account_id ? names.accounts.get(r.money_account_id) : ''}</td>
                    <td>{r.reference}</td>
                    <td>{r.narration}</td>
                    <MoneyCell paise={balanceAfter.get(r.entry_id)!} strong />
                    <td className="nowrap">{entryLink(r)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td /><td>{t('party.paid')}</td><MoneyCell paise={f.paid} /><td colSpan={5} /></tr>
              </tfoot>
            </table>
          </div>
        )}
        <details className="add-rows">
          <summary className="btn">＋ {t('party.addPayments')}</summary>
          {missing('moneyAccountsWeOwe', 'money-accounts', 'needAccount')}
          <p className="hint">{t('party.addHint')}</p>
          <EntrySheet
            columns={columns('pay-vendor', payFields, 'payDate')}
            today={todayInIndia()}
            start={3}
            defaults={lastFrom ? { from_account_id: lastFrom } : {}}
            save={postPartyRows.bind(null, 'pay-vendor', firm.id, party.id)}
          />
        </details>
      </section>
    </>
  );
}

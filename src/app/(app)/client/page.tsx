import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { EntrySheet } from '@/components/entry-sheet';
import { Tabs } from '@/components/tabs';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { clientFigures } from '@/lib/ledger/party';
import { getEntryForm } from '@/lib/masters/registry';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { loadChoices } from '../masters/options';
import { postEntryRows } from '../entries/actions';
import { loadNames, showDate, todayInIndia } from '../entries/data';
import { sheetColumns } from '../entries/sheet/columns';
import { MoneyCell, Stat, StatusPill } from '../party/shared';

interface ClientRow {
  entry_id: string;
  serial: string;
  entry_type: 'opening' | 'client_bill' | 'client_receipt';
  entry_date: string;
  reference: string;
  narration: string;
  status: 'verified' | 'unverified';
  work_order_id: string;
  site_id: string;
  gross_paise: number | string;
  tds_paise: number | string;
  retention_paise: number | string;
  deposit_paise: number | string;
  other_cut_paise: number | string;
  receivable_paise: number | string;
  money_account_id: string | null;
}

type Slug = 'client-bill' | 'client-receipt';
/** Sheet columns in reading order. */
const BILL_COLUMNS = ['entry_date', 'bill_no', 'work_order_id', 'gross', 'tds', 'retention', 'security_deposit', 'narration'];
const RECEIPT_COLUMNS = ['entry_date', 'work_order_id', 'amount', 'to_account_id', 'reference', 'narration'];
const fieldsOf = (slug: Slug, names: string[]) => names.map((name) => getEntryForm(slug)!.fields.find((f) => f.name === name)!);
/** Sheet headings worded like the tables above them. */
const LABELS: Record<string, string> = {
  bill_no: 'party.billNo', work_order_id: 'client.workOrder', gross: 'client.gross', tds: 'client.tds',
  retention: 'client.retention', security_deposit: 'client.deposit', narration: 'party.remarks',
  amount: 'party.amount', to_account_id: 'client.receivedIn', reference: 'party.reference',
};

/** One client's page in the working firm: bills given and money received. ?id= */
export default async function ClientPage({ searchParams }: { searchParams: Promise<{ id?: string; tab?: string }> }) {
  await requireProfile('owner', 'office');
  const { id = '', tab = 'bills' } = await searchParams;
  const [working, t] = await Promise.all([getWorkingFirm(), getTranslations()]);
  if (!working) return <p className="empty">{t('party.noFirm')}</p>;
  const { firm } = working;
  const db = await createClient();
  const { data: client } = await db.from('parties').select('id, name').eq('id', id).eq('kind', 'client').maybeSingle();
  if (!client) notFound();

  const billFields = fieldsOf('client-bill', BILL_COLUMNS);
  const receiptFields = fieldsOf('client-receipt', RECEIPT_COLUMNS);
  const [{ data }, { data: orders }, names, choices] = await Promise.all([
    db.from('client_rows').select('*').eq('firm_id', firm.id).eq('party_id', client.id)
      .order('entry_date').order('serial').returns<ClientRow[]>(),
    db.from('work_orders').select('id, ref, is_active, site:sites(name)').eq('firm_id', firm.id).eq('client_id', client.id)
      .order('ref').returns<{ id: string; ref: string; is_active: boolean; site: { name: string } | null }[]>(),
    loadNames(db),
    loadChoices(db, [...billFields, ...receiptFields], { working, t }),
  ]);
  // Only this client's own work orders for this firm, named by their site.
  const orderLabel = new Map((orders ?? []).map((o) => [o.id, `${o.ref} · ${o.site?.name ?? ''}`]));
  choices.workOrders = (orders ?? []).filter((o) => o.is_active).map((o) => ({ value: o.id, label: orderLabel.get(o.id)! }));

  const rows = (data ?? []).map((r) => ({
    ...r,
    gross: Number(r.gross_paise),
    cuts: Number(r.tds_paise) + Number(r.retention_paise) + Number(r.deposit_paise) + Number(r.other_cut_paise),
    receivable: Number(r.receivable_paise),
  }));
  const of = (type: ClientRow['entry_type']) => rows.filter((r) => r.entry_type === type);
  const bills = of('client_bill');
  const receipts = of('client_receipt');
  const opening = of('opening')[0];
  // The opening due is listed as the first bill, so the bills add up to the total to receive.
  const billRows = [...of('opening').map((r) => ({ ...r, gross: r.receivable, cuts: 0 })), ...bills];
  const f = clientFigures({
    firm_id: firm.id, party_id: client.id,
    opening_paise: of('opening').reduce((s, r) => s + r.receivable, 0),
    gross_paise: bills.reduce((s, r) => s + r.gross, 0),
    deductions_paise: bills.reduce((s, r) => s + r.cuts, 0),
    received_paise: -receipts.reduce((s, r) => s + r.receivable, 0),
    last_receipt: receipts.at(-1)?.entry_date ?? null,
  });

  // Balance after each receipt, in date order: everything due up to that day, less everything received.
  const balanceAfter = new Map<string, number>();
  let running = 0;
  const isIn = (r: { entry_type: string }) => Number(r.entry_type === 'client_receipt');
  for (const r of [...rows].sort((a, b) => a.entry_date.localeCompare(b.entry_date) || isIn(a) - isIn(b))) {
    running += r.receivable;
    if (isIn(r)) balanceAfter.set(r.entry_id, running);
  }

  const columns = (slug: Slug, fields: typeof billFields, dateKey: string) =>
    sheetColumns(slug, fields, choices, t).map((c) => ({ ...c, label: t(c.name === 'entry_date' ? dateKey : LABELS[c.name]!) }));
  const onlyOrder: Record<string, string> = choices.workOrders.length === 1 ? { work_order_id: choices.workOrders[0]!.value } : {};
  const lastTo = receipts.at(-1)?.money_account_id;
  const entryLink = (r: ClientRow) => (
    <>
      <Link href={`/entries/${r.entry_id}`} className="serial underline">{r.serial}</Link>
      {r.status === 'unverified' && <span className="pill unverified small-pill" title={t('party.notCheckedHint')}>{t('party.notChecked')}</span>}
    </>
  );
  const noOrders = choices.workOrders.length === 0 && (
    <p className="banner bad">
      {t('client.needWorkOrder')} <Link href="/masters/work-orders" className="underline">{t('party.goSetup')}</Link>
    </p>
  );
  const sum = (key: 'tds_paise' | 'retention_paise' | 'deposit_paise' | 'other_cut_paise') => bills.reduce((s, r) => s + Number(r[key]), 0);

  return (
    <>
      <Link href="/clients" className="back">◄ {t('client.home')}</Link>
      <div className="party-head">
        <h1>{client.name}</h1>
        <StatusPill status={f.status} t={t} side="client" />
      </div>
      <p className="lede">
        {opening
          ? t('client.openingAsOf', { firm: firm.name, date: showDate(opening.entry_date) })
          : t('client.noOpening', { firm: firm.name })}
      </p>

      <div className="calc three" aria-label={t('party.summary')}>
        <Stat label={t('client.total')} value={showPaise(f.total)}
          note={t('client.includesOpening', { amount: showPaise(f.opening) })} />
        <span className="op" aria-hidden="true">−</span>
        <Stat label={t('client.received')} value={showPaise(f.paid)} tone="done"
          note={f.lastPayment ? t('client.lastOn', { date: showDate(f.lastPayment) }) : t('client.nothingReceived')} />
        <span className="op" aria-hidden="true">=</span>
        <Stat label={t('client.balance')} value={showPaise(f.balance)} tone={f.balance > 0 ? 'due' : 'done'} note={t('client.balanceNote')} />
      </div>

      <Tabs initial={tab} tabs={[
        { key: 'bills', label: t('client.billsTitle'), count: billRows.length, panel: (
          <>
            <p className="hint tab-hint">{t('client.billsHint')}</p>
            {billRows.length === 0 ? (
              <p className="card empty">{t('client.noBills')}</p>
            ) : (
              <div className="card table-wrap flush">
                <table className="ledger">
                  <thead>
                    <tr>
                      <th className="num">{t('party.sr')}</th>
                      <th>{t('party.billDate')}</th>
                      <th>{t('party.billNo')}</th>
                      <th>{t('client.workOrder')}</th>
                      <th className="num">{t('client.gross')}</th>
                      <th className="num">{t('client.tds')}</th>
                      <th className="num">{t('client.retention')}</th>
                      <th className="num">{t('client.deposit')}</th>
                      <th className="num">{t('client.otherCuts')}</th>
                      <th className="num">{t('client.net')}</th>
                      <th>{t('party.entry')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {billRows.map((r, i) => (
                      <tr key={r.entry_id}>
                        <td className="num muted">{i + 1}</td>
                        <td className="nowrap">{showDate(r.entry_date)}</td>
                        <td>{r.entry_type === 'opening' ? <strong>{t('client.opening')}</strong> : r.reference}</td>
                        <td>{orderLabel.get(r.work_order_id) ?? names.sites.get(r.site_id)}</td>
                        <MoneyCell paise={r.gross} />
                        <MoneyCell paise={Number(r.tds_paise)} />
                        <MoneyCell paise={Number(r.retention_paise)} />
                        <MoneyCell paise={Number(r.deposit_paise)} />
                        <MoneyCell paise={Number(r.other_cut_paise)} />
                        <MoneyCell paise={r.gross - r.cuts} strong />
                        <td className="nowrap">{entryLink(r)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td /><td colSpan={3}>{t('client.total')}</td>
                      <MoneyCell paise={f.opening + f.gross} />
                      <MoneyCell paise={sum('tds_paise')} />
                      <MoneyCell paise={sum('retention_paise')} />
                      <MoneyCell paise={sum('deposit_paise')} />
                      <MoneyCell paise={sum('other_cut_paise')} />
                      <MoneyCell paise={f.total} strong />
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            <details className="add-rows">
              <summary className="btn">＋ {t('client.addBills')}</summary>
              {noOrders}
              <p className="hint">{t('client.addBillsHint')}</p>
              <EntrySheet
                columns={columns('client-bill', billFields, 'party.billDate')}
                today={todayInIndia()}
                start={3}
                defaults={onlyOrder}
                save={postEntryRows.bind(null, 'client-bill', firm.id)}
              />
            </details>
          </>
        ) },
        { key: 'payments', label: t('client.receiptsTitle'), count: receipts.length, panel: (
          <>
            <p className="hint tab-hint">{t('client.receiptsHint')}</p>
            {receipts.length === 0 ? (
              <p className="card empty">{t('client.noReceipts')}</p>
            ) : (
              <div className="card table-wrap flush">
                <table className="ledger">
                  <thead>
                    <tr>
                      <th className="num">{t('party.sr')}</th>
                      <th>{t('client.receiptDate')}</th>
                      <th className="num">{t('party.amount')}</th>
                      <th>{t('client.receivedIn')}</th>
                      <th>{t('party.reference')}</th>
                      <th>{t('party.remarks')}</th>
                      <th className="num">{t('client.balanceAfter')}</th>
                      <th>{t('party.entry')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receipts.map((r, i) => (
                      <tr key={r.entry_id}>
                        <td className="num muted">{i + 1}</td>
                        <td className="nowrap">{showDate(r.entry_date)}</td>
                        <MoneyCell paise={-r.receivable} />
                        <td>{r.money_account_id ? names.accounts.get(r.money_account_id) : ''}</td>
                        <td>{r.reference}</td>
                        <td>{r.narration}</td>
                        <MoneyCell paise={balanceAfter.get(r.entry_id)!} strong />
                        <td className="nowrap">{entryLink(r)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr><td /><td>{t('client.received')}</td><MoneyCell paise={f.paid} /><td colSpan={5} /></tr>
                  </tfoot>
                </table>
              </div>
            )}
            <details className="add-rows">
              <summary className="btn">＋ {t('client.addReceipts')}</summary>
              {noOrders}
              {(choices.moneyAccountsTheyOwe ?? []).length === 0 && (
                <p className="banner bad">
                  {t('party.needAccount')} <Link href="/masters/money-accounts" className="underline">{t('party.goSetup')}</Link>
                </p>
              )}
              <p className="hint">{t('party.addHint')}</p>
              <EntrySheet
                columns={columns('client-receipt', receiptFields, 'client.receiptDate')}
                today={todayInIndia()}
                start={3}
                defaults={lastTo ? { ...onlyOrder, to_account_id: lastTo } : onlyOrder}
                save={postEntryRows.bind(null, 'client-receipt', firm.id)}
              />
            </details>
          </>
        ) },
      ]} />
    </>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AutoForm } from '@/components/auto-form';
import { FirmPopup } from '@/components/firm-popup';
import { Icon } from '@/components/icons';
import { ListLink } from '@/components/list-link';
import { PrintButton } from '@/components/print-button';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { getEntryForm } from '@/lib/masters/registry';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { lastMonth, salaryPeriod } from '@/lib/wages';
import { loadNames, showDate, todayInIndia } from '../../entries/data';
import { showMonth } from '../../labour/data';
import { loadChoices } from '../../masters/options';
import { loadAccounts, loadPeople } from '../../bankbook/data';
import { postBetween } from '../actions';
import { loadFirms, type FirmRow } from '../data';

/** The running account of the working firm with another of our firms, a month at a time. */
export default async function FirmPairPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ month?: string }> }) {
  const profile = await requireProfile('owner', 'office');
  const [{ id }, asked, working, t] = await Promise.all([params, searchParams, getWorkingFirm(), getTranslations()]);
  if (!working) return <p className="empty">{t('party.noFirm')}</p>;
  const { firm } = working;
  const db = await createClient();
  const firms = await loadFirms(db);
  const them = firms.find((f) => f.id === id);
  if (!them || them.id === firm.id) notFound();

  const today = todayInIndia();
  const thisMonth = today.slice(0, 7);
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(asked.month ?? '') ? asked.month! : thisMonth;
  const { from, to } = salaryPeriod({ month }, today);
  const account = () => db.from('firm_rows').select('*').eq('firm_id', firm.id).eq('counter_firm_id', id);
  // Adding needs both firms, as it lands in both books.
  const both = working.firms.some((f) => f.id === id);
  const bill = getEntryForm('client-bill')!.fields;
  const [{ data, error }, { data: before }, { data: newest }, names, people, theirs, accounts, choices, { data: machines }] = await Promise.all([
    account().gte('entry_date', from).lte('entry_date', to).order('position').returns<FirmRow[]>(),
    account().lt('entry_date', from).order('position', { ascending: false }).limit(1).maybeSingle<FirmRow>(),
    account().order('position', { ascending: false }).limit(1).maybeSingle<FirmRow>(),
    loadNames(db),
    both ? loadPeople(db, firm.id) : null,
    both ? loadPeople(db, id) : null,
    both ? loadAccounts(db) : [],
    both ? loadChoices(db, bill, { working, t }) : {} as Awaited<ReturnType<typeof loadChoices>>,
    both ? db.from('machines').select('name').eq('is_active', true).order('name') : { data: [] as { name: string }[] },
  ]);
  if (error) throw new Error(error.message);
  const rows = (data ?? []).map((r) => ({ ...r, amount: Number(r.amount_paise), balance: Number(r.balance_paise) }));
  const moved = rows.filter((r) => r.entry_type !== 'opening');
  const start = Number(before?.balance_paise ?? 0) + (rows.find((r) => r.entry_type === 'opening')?.amount ?? 0);
  const given = moved.reduce((s, r) => s + Math.max(r.amount, 0), 0);
  const got = moved.reduce((s, r) => s + Math.max(-r.amount, 0), 0);
  const now = Number(newest?.balance_paise ?? 0);
  const words = (due: number) => (due === 0 ? t('between.settled') : `${t('between.owes', { debtor: due > 0 ? them.name : firm.name, creditor: due > 0 ? firm.name : them.name })} ${showPaise(Math.abs(due))}`);
  const tone = (due: number) => (due > 0 ? ' plus' : due < 0 ? ' minus' : '');
  const monthChip = (m: string, label: string) => <Link href={`/between/${id}?month=${m}`} className={`chip${m === month ? ' on' : ''}`}>{label}</Link>;
  const of = (firmId: string) => accounts.filter((a) => a.firm_id === firmId && a.is_active);
  const kindOf = (r: FirmRow) => t(r.entry_type === 'vendor_payment' ? 'between.paidParty' : `entryTypes.${r.entry_type}.title`);
  // Between these two, only the firm that owns the machines gives them on rent.
  const rentTo = them.runs_labour ? firm.id : firms.find((f) => f.id === firm.id)?.runs_labour ? id : null;

  return (
    <>
      <Link href="/" className="back no-print"><Icon name="chevronLeft" size={16} /> {t('nav.parties')}</Link>
      <div className="ledger-head">
        <div>
          <p className="muted ledger-firm">{firm.name}</p>
          <h1>{t('between.pairTitle', { firm: them.name })}</h1>
          <p className="muted">{showMonth(month)}</p>
        </div>
        <PrintButton label={t('ledger.print')} />
      </div>
      <p className={`banner${now < 0 ? ' bad' : ''}`}><span><strong>{t('between.nowTitle')}</strong> {words(now)}</span></p>

      {both ? (
        <div className="quick-add no-print"><div className="quick-buttons">
          <FirmPopup us={{ id: firm.id, name: firm.name, accounts: of(firm.id), parties: people!.out }}
            them={{ id, name: them.name, accounts: of(id), parties: theirs!.out }}
            sites={choices.sites ?? []} gstRates={choices.gstRates ?? []} tdsRates={choices.tdsRates ?? []}
            machines={(machines ?? []).map((m) => m.name as string)} rentTo={rentTo} today={today} save={postBetween.bind(null, firm.id, id)} />
          {profile.role === 'owner' && <Link href={`/between/${id}/opening`} className="btn big ghost">{t('bankbook.buttons.opening')}</Link>}
          {rentTo && <Link href="/labour/supplied" className="btn big ghost">{t('between.labourSupplied')}</Link>}
        </div></div>
      ) : <p className="hint no-print">{t('between.needBoth', { firm: them.name })}</p>}

      <div className="card report-bar salary-bar no-print">
        <nav className="filters" aria-label={t('salary.month')}>
          {monthChip(thisMonth, t('salary.thisMonth'))}
          {monthChip(lastMonth(thisMonth), t('salary.lastMonth'))}
        </nav>
        <AutoForm action={`/between/${id}`} className="date-filter">
          <label className="muted" htmlFor="between-month">{t('salary.month')}</label>
          <input key={month} id="between-month" type="month" name="month" defaultValue={month} max={thisMonth} required />
        </AutoForm>
      </div>

      <div className="card table-wrap flush">
        <table className="ledger statement">
          <thead>
            <tr>
              <th>{t('ledger.date')}</th>
              <th>{t('between.what')}</th>
              <th>{t('party.entry')}</th>
              <th className="num">{t('between.givenTo', { firm: them.name })}</th>
              <th className="num">{t('between.gotFrom', { firm: them.name })}</th>
              <th className="num">{t('bankbook.balance')}</th>
            </tr>
          </thead>
          <tbody>
            {moved.length === rows.length && (
              <tr><td className="nowrap">{showDate(from)}</td><td><strong>{t('ledger.openingBalance')}</strong></td><td /><td /><td />
                <td className={`num strong${tone(start)}`}>{words(start)}</td></tr>
            )}
            {rows.length === 0 && <tr><td colSpan={6} className="muted">{t('between.noneInMonth')}</td></tr>}
            {rows.map((r) => (
              <tr key={r.entry_id}>
                <td className="nowrap">{showDate(r.entry_date)}</td>
                <td className="particulars">
                  <strong>{r.entry_type === 'opening' ? t('ledger.openingBalance') : kindOf(r)}</strong>
                  {[r.party_id && names.parties.get(r.party_id), r.site_id && names.sites.get(r.site_id), r.money_account_id && names.accounts.get(r.money_account_id), r.entry_type !== 'opening' && r.reference]
                    .filter(Boolean).map((bit, i) => <span key={i} className="muted"> · {bit}</span>)}
                  {r.narration && r.entry_type !== 'opening' && <span className="ledger-note">{r.narration}</span>}
                </td>
                <td className="nowrap"><ListLink href={`/entries/${r.entry_id}`} className="serial underline">{r.serial}</ListLink></td>
                <td className="num">{r.amount > 0 && r.entry_type !== 'opening' ? showPaise(r.amount) : ''}</td>
                <td className="num">{r.amount < 0 && r.entry_type !== 'opening' ? showPaise(-r.amount) : ''}</td>
                <td className={`num${tone(r.balance)}`}>{words(r.balance)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="nowrap">{showDate(to < today ? to : today)}</td>
              <td colSpan={2}><strong>{t('ledger.closingBalance')}</strong></td>
              <td className="num">{showPaise(given)}</td>
              <td className="num">{showPaise(got)}</td>
              <td className={`num strong${tone(start + given - got)}`}>{words(start + given - got)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="muted ledger-printed">{t('ledger.printedOn', { date: showDate(today) })}</p>
    </>
  );
}

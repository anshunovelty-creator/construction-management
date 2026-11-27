import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AutoForm } from '@/components/auto-form';
import { Icon } from '@/components/icons';
import { ListLink } from '@/components/list-link';
import { MoneyPopup } from '@/components/money-popup';
import { PrintButton } from '@/components/print-button';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { lastMonth, salaryPeriod } from '@/lib/wages';
import { postMoney } from '../../entries/actions';
import { loadNames, showDate, todayInIndia } from '../../entries/data';
import { showMonth } from '../../labour/data';
import { lineName, loadAccounts, type BankMatch, type MoneyRow } from '../data';

/** One bank or cash account's bankbook: a month of entries, each with the balance after it. ?month=2026-11 */
export default async function BankbookPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const profile = await requireProfile('owner', 'office');
  const [{ id }, asked, working, t] = await Promise.all([params, searchParams, getWorkingFirm(), getTranslations()]);
  const db = await createClient();
  const accounts = await loadAccounts(db);
  const account = accounts.find((a) => a.id === id);
  if (!account) notFound();

  const today = todayInIndia();
  const thisMonth = today.slice(0, 7);
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(asked.month ?? '') ? asked.month! : thisMonth;
  const { from, to } = salaryPeriod({ month }, today);
  // The pop-ups are for the firm being worked in, so nobody types into another firm's account.
  const here = account.firm_id !== null && account.firm_id === working?.firm.id && account.is_active;
  const bankbook = () => db.from('money_rows').select('*').eq('money_account_id', id);
  const [{ data, error }, { data: before }, { data: newest }, { data: opening }, names, { data: matched }] = await Promise.all([
    bankbook().gte('entry_date', from).lte('entry_date', to).order('position').returns<MoneyRow[]>(),
    bankbook().lt('entry_date', from).order('position', { ascending: false }).limit(1).maybeSingle<MoneyRow>(),
    bankbook().order('position', { ascending: false }).limit(1).maybeSingle<MoneyRow>(),
    bankbook().eq('entry_type', 'opening').maybeSingle<MoneyRow>(),
    loadNames(db),
    db.from('bank_match').select('*').eq('money_account_id', id).order('statement_date', { ascending: false }).limit(1).maybeSingle<BankMatch>(),
  ]);
  if (error) throw new Error(error.message);
  const rows = (data ?? []).map((r) => ({ ...r, amount: Number(r.amount_paise), balance: Number(r.balance_paise) }));
  // An account's own opening balance is what it started with, not money that came in this month.
  const moved = rows.filter((r) => r.entry_type !== 'opening');
  const start = Number(before?.balance_paise ?? 0) + (rows.find((r) => r.entry_type === 'opening')?.amount ?? 0);
  const came = moved.reduce((sum, r) => sum + Math.max(r.amount, 0), 0);
  const went = moved.reduce((sum, r) => sum + Math.max(-r.amount, 0), 0);
  const closing = start + came - went;
  // The bankbook and the books must say the same: the last line is what the ledger holds, and this month adds up to its own.
  const agrees = Number(newest?.balance_paise ?? 0) === account.balance && (rows.length === 0 || rows.at(-1)!.balance === closing);
  const firmName = account.firm_id ? names.firms.get(account.firm_id) : undefined;

  const other = (r: MoneyRow) => (r.entry_type === 'not_yet_known' ? <span className="pill pending">{lineName(r, names, t)}</span> : lineName(r, names, t));
  const bank = account.kind === 'bank';
  // A move between a bank and cash is called what it is at the bank: cash taken out, or cash put in.
  const cashWord = (r: MoneyRow & { amount: number }) => {
    const to = r.entry_type === 'cash_transfer' && accounts.find((a) => a.id === r.other_account_id);
    if (!to || (to.kind === 'bank') === bank) return undefined;
    return t((r.amount < 0) === bank ? 'cash.withdrawn' : 'cash.deposited');
  };
  const monthChip = (m: string, label: string) => <Link href={`/bankbook/${id}?month=${m}`} className={`chip${m === month ? ' on' : ''}`}>{label}</Link>;

  return (
    <>
      <Link href="/bankbook" className="back no-print"><Icon name="chevronLeft" size={16} /> {t('nav.bankbook')}</Link>
      <div className="ledger-head">
        <div>
          <p className="muted ledger-firm">{firmName ?? t('bankbook.noFirm')}</p>
          <h1>{account.name}</h1>
          <p className="muted">{t(`options.money_account_kind.${account.kind}`)} · {showMonth(month)}</p>
        </div>
        <PrintButton label={t('ledger.print')} />
      </div>

      <p className={`banner${account.balance < 0 ? ' bad' : ''}`}>
        <span><strong>{t('bankbook.now')}</strong> {showPaise(account.balance)}{account.balance < 0 && <> · {t(account.kind === 'bank' ? 'bankbook.overdrawn' : 'bankbook.belowZero')}</>}</span>
      </p>
      {!agrees && <p className="banner bad" role="alert">{t('bankbook.mismatch')}</p>}

      {bank && <p className="hint">{matched ? t(Number(matched.balance_paise) === Number(matched.expected_paise) ? 'match.upTo' : 'match.off', { date: showDate(matched.statement_date) }) : t('match.never')}</p>}
      {here ? (
        <div className="quick-add no-print">
          <div className="quick-buttons">
            <Link href={`/bankbook/receive?account=${id}`} className="btn big get"><Icon name="receive" /> {t('payList.client.button')}</Link>
            <Link href={`/bankbook/pay?account=${id}`} className="btn big pay"><Icon name="payOut" /> {t('payList.party.button')}</Link>
            {(bank ? ['withdraw', 'deposit', 'move'] as const : ['withdraw', 'deposit'] as const).map((mode) => (
              <MoneyPopup key={mode} mode={mode} firm={working!.firm} account={id} owner={profile.role === 'owner'} today={today} save={postMoney}
                accounts={accounts.filter((a) => a.firm_id === account.firm_id && a.is_active)} people={[]} />
            ))}
            {profile.role === 'owner' && <MoneyPopup mode="out" personal button={t('bankbook.buttons.personal')} firm={working!.firm} account={id} owner today={today} save={postMoney}
              accounts={accounts.filter((a) => a.firm_id === account.firm_id && a.is_active)} people={[]} />}
            {bank && <Link href={`/bankbook/${id}/match`} className="btn big ghost">{t('match.button')}</Link>}
            {!bank && <Link href={`/bankbook/${id}/count`} className="btn big ghost">{t('count.button')}</Link>}
            {profile.role === 'owner' && <Link href={`/bankbook/${id}/opening`} className="btn big ghost">{t('bankbook.buttons.opening')}</Link>}
          </div>
        </div>
      ) : account.firm_id && account.is_active && <p className="hint no-print">{t('bankbook.switchFirm', { firm: firmName ?? '' })}</p>}

      <div className="card report-bar salary-bar no-print">
        <nav className="filters" aria-label={t('salary.month')}>
          {monthChip(thisMonth, t('salary.thisMonth'))}
          {monthChip(lastMonth(thisMonth), t('salary.lastMonth'))}
        </nav>
        <AutoForm action={`/bankbook/${id}`} className="date-filter">
          <label className="muted" htmlFor="bankbook-month">{t('salary.month')}</label>
          <input key={month} id="bankbook-month" type="month" name="month" defaultValue={month} max={thisMonth} required />
        </AutoForm>
      </div>

      <div className="card table-wrap flush">
        <table className="ledger statement">
          <thead>
            <tr>
              <th>{t('ledger.date')}</th>
              <th>{t('bankbook.fromTo')}</th>
              <th>{t('bankbook.why')}</th>
              <th>{t('party.entry')}</th>
              {bank && <th>{t('match.bank')}</th>}
              <th className="num">{t('bankbook.in')}</th>
              <th className="num">{t('bankbook.out')}</th>
              <th className="num">{t('bankbook.balance')}</th>
            </tr>
          </thead>
          <tbody>
            {/* The month the account itself opens in starts with that entry instead. */}
            {moved.length === rows.length && (
              <tr>
                <td className="nowrap">{showDate(from)}</td>
                <td><strong>{t('ledger.openingBalance')}</strong></td>
                <td /><td />{bank && <td />}<td /><td />
                <td className={`num strong${start < 0 ? ' minus' : ''}`}>{showPaise(start)}</td>
              </tr>
            )}
            {rows.length === 0 && <tr><td colSpan={8} className="muted">{t('bankbook.none')}</td></tr>}
            {rows.map((r) => (
              <tr key={r.entry_id}>
                <td className="nowrap">{showDate(r.entry_date)}</td>
                <td><strong>{other(r)}</strong></td>
                <td className="particulars">
                  {r.entry_type !== 'opening' && r.entry_type !== 'not_yet_known' && (r.entry_type === 'vendor_payment' && r.amount > 0 ? t('bankbook.partyBack') : r.entry_type === 'client_receipt' && r.amount < 0 ? t('bankbook.clientBack')
                    : r.reason && r.party_id && r.entry_type === 'other_in' ? t(`bankbook.reasons.${r.reason}`) : cashWord(r) ?? t(`entryTypes.${r.entry_type}.title`))}
                  {r.party_id && r.counter_firm_id && <span className="muted"> · {t('bankbook.forFirm', { firm: names.firms.get(r.counter_firm_id) ?? '' })}</span>}
                  {r.reference && <span className="muted"> · {r.reference}</span>}
                  {r.narration && r.entry_type !== 'opening' && <span className="ledger-note">{r.narration}</span>}
                </td>
                <td className="nowrap"><ListLink href={`/entries/${r.entry_id}`} className="serial underline">{r.serial}</ListLink></td>
                {bank && <td>{r.entry_type !== 'opening' && (r.cleared_on ? <span className="muted nowrap">{showDate(r.cleared_on)}</span> : <span className="pill partPaid">{t('match.notYet')}</span>)}</td>}
                <td className="num plus">{r.amount > 0 && r.entry_type !== 'opening' ? showPaise(r.amount) : ''}</td>
                <td className="num minus">{r.amount < 0 && r.entry_type !== 'opening' ? showPaise(-r.amount) : ''}</td>
                <td className={`num${r.balance < 0 ? ' minus' : ''}`}>{showPaise(r.balance)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="nowrap">{showDate(to < today ? to : today)}</td>
              <td colSpan={bank ? 4 : 3}><strong>{t('ledger.closingBalance')}</strong></td>
              <td className="num">{showPaise(came)}</td>
              <td className="num">{showPaise(went)}</td>
              <td className={`num strong${closing < 0 ? ' minus' : ''}`}>{showPaise(closing)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {opening === null && profile.role === 'owner' && <p className="hint no-print">{t('bankbook.noOpening')}</p>}
      <p className="muted ledger-printed">{t('ledger.printedOn', { date: showDate(today) })}</p>
    </>
  );
}

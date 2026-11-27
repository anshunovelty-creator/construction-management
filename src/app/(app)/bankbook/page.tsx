import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Icon } from '@/components/icons';
import { ListLink } from '@/components/list-link';
import { MoneyPopup } from '@/components/money-popup';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { postMoney } from '../entries/actions';
import { showDate, todayInIndia } from '../entries/data';
import { Stat } from '../party/shared';
import { loadAccounts, type Account, type BankMatch, type MoneyRow } from './data';

const KINDS = ['bank', 'owner_cash', 'supervisor_cash'] as const;
const held = (accounts: Account[]) => accounts.reduce((sum, a) => sum + a.balance, 0);

/** Every bank and cash account of the working firm with what it holds. Each firm stands alone: no all-firms view (owner decision 2026-11-26). */
export default async function BankbooksPage() {
  const profile = await requireProfile('owner', 'office');
  const [working, t] = await Promise.all([getWorkingFirm(), getTranslations()]);
  if (!working) return <p className="empty">{t('party.noFirm')}</p>;
  const db = await createClient();
  const accounts = await loadAccounts(db);

  const firms = [working.firm];
  const groups: { name: string; accounts: Account[] }[] = firms.map((f) => ({ name: f.name, accounts: accounts.filter((a) => a.firm_id === f.id) }));
  const shown = groups.flatMap((g) => g.accounts);
  const [unknown, ...lasts] = await Promise.all([
    db.from('money_rows').select('*').eq('entry_type', 'not_yet_known').in('firm_id', firms.map((f) => f.id)).order('entry_date').returns<MoneyRow[]>(),
    ...shown.map((a) => db.from('money_rows').select('entry_date').eq('money_account_id', a.id).order('position', { ascending: false }).limit(1).maybeSingle()),
  ]);
  const last = new Map(shown.map((a, i) => [a.id, lasts[i]!.data?.entry_date as string | undefined]));
  const unknownRows = unknown.data ?? [];
  const nameOf = new Map(accounts.map((a) => [a.id, a.name]));
  const total = held(shown);
  // Each bank's latest statement and each cash account's latest count.
  const [{ data: matches }, { data: counts }] = await Promise.all([
    db.from('bank_match').select('*').order('statement_date', { ascending: false }).returns<BankMatch[]>(),
    db.from('cash_counts').select('money_account_id, count_date').order('count_date', { ascending: false }).limit(500),
  ]);
  const today = todayInIndia();
  const checkOf = (a: Account) => {
    if (a.kind === 'bank') {
      const m = matches?.find((x) => x.money_account_id === a.id);
      if (!m) return <span className="pill unverified">{t('match.never')}</span>;
      return Number(m.balance_paise) === Number(m.expected_paise)
        ? <span className="pill cleared">{t('match.upTo', { date: showDate(m.statement_date) })}</span>
        : <span className="pill pending">{t('match.off', { date: showDate(m.statement_date) })}</span>;
    }
    const c = counts?.find((x) => x.money_account_id === a.id);
    if (a.balance === 0 && !c) return <span className="muted">–</span>;
    return c?.count_date === today ? <span className="pill cleared">{t('count.today')}</span>
      : <span className="pill unverified">{c ? t('count.lastOn', { date: showDate(c.count_date as string) }) : t('count.never')}</span>;
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('bankbook.title', { firm: working.firm.name })}</h1>
          <p className="lede">{t('bankbook.lede')}</p>
        </div>
        <Link href="/bankbook/flow" className="btn ghost">{t('flow.title')} <Icon name="arrowRight" size={16} /></Link>
      </div>

      {shown.length > 0 && (
        <div className="quick-add no-print"><div className="quick-buttons">
          <Link href="/bankbook/receive" className="btn big get"><Icon name="receive" /> {t('payList.client.button')}</Link>
          <Link href="/bankbook/pay" className="btn big pay"><Icon name="payOut" /> {t('payList.party.button')}</Link>
          {(['withdraw', 'deposit', 'move'] as const).map((mode) => (
            <MoneyPopup key={mode} mode={mode} firm={working.firm} account="" owner={profile.role === 'owner'} today={today} save={postMoney}
              accounts={shown.filter((a) => a.is_active)} people={[]} />
          ))}
          {profile.role === 'owner' && <MoneyPopup mode="out" personal button={t('bankbook.buttons.personal')} firm={working.firm} account="" owner today={today} save={postMoney}
            accounts={shown.filter((a) => a.is_active)} people={[]} />}
          {profile.role === 'owner' && <Link href="/masters/money-accounts#add" className="btn big ghost"><Icon name="bank" /> {t('bankbook.addAccount')}</Link>}
        </div></div>
      )}
      {shown.length === 0 ? (
        <p className="card empty">
          {t('bankbook.empty')}{' '}
          {profile.role === 'owner' && <Link href="/masters/money-accounts" className="underline">{t('party.goSetup')}</Link>}
        </p>
      ) : (
        <>
          <div className="stats">
            <Stat label={t('bankbook.held')} value={showPaise(total)} tone={total < 0 ? 'owe' : undefined} />
            {KINDS.map((kind) => {
              const of = shown.filter((a) => a.kind === kind);
              return of.length > 0 && <Stat key={kind} label={t(`bankbook.kinds.${kind}`)} value={showPaise(held(of))} tone={held(of) < 0 ? 'owe' : undefined} />;
            })}
          </div>

          {groups.map((g) => (
            <section key={g.name} className="card table-wrap flush bankbook-group">
              <table className="ledger clickable">
                <thead>
                  <tr>
                    <th>{g.name || t('bankbook.account')}</th>
                    <th>{t('bankbook.kind')}</th>
                    <th>{t('bankbook.lastEntry')}</th>
                    <th>{t('bankbook.checked')}</th>
                    <th className="num">{t('bankbook.balance')}</th>
                  </tr>
                </thead>
                <tbody>
                  {g.accounts.length === 0 && <tr><td colSpan={5} className="muted">{t('bankbook.empty')}</td></tr>}
                  {KINDS.flatMap((kind) => g.accounts.filter((a) => a.kind === kind)).map((a) => (
                    <tr key={a.id}>
                      <td>
                        <ListLink href={`/bankbook/${a.id}`} className="party-link">{a.name}</ListLink>
                        {!a.is_active && <span className="pill common">{t('bankbook.off')}</span>}
                      </td>
                      <td>{t(`options.money_account_kind.${a.kind}`)}</td>
                      <td className="nowrap">{last.get(a.id) ? showDate(last.get(a.id)!) : <span className="muted">–</span>}</td>
                      <td>{checkOf(a)}</td>
                      <td className={`num strong${a.balance < 0 ? ' minus' : ''}`}>{showPaise(a.balance)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td>{t('bankbook.total')}</td><td /><td /><td /><td className={`num strong${held(g.accounts) < 0 ? ' minus' : ''}`}>{showPaise(held(g.accounts))}</td></tr>
                </tfoot>
              </table>
            </section>
          ))}
        </>
      )}

      {unknownRows.length > 0 && (
        <section className="card">
          <h2 className="section-title minus">{t('bankbook.unknownTitle', { count: String(unknownRows.length) })}</h2>
          <p className="hint">{t('bankbook.unknownHint')}</p>
          <div className="table-wrap">
            <table className="ledger clickable">
              <thead>
                <tr><th>{t('ledger.date')}</th><th>{t('bankbook.account')}</th><th>{t('bankbook.why')}</th><th className="num">{t('bankbook.in')}</th><th className="num">{t('bankbook.out')}</th></tr>
              </thead>
              <tbody>
                {unknownRows.map((r) => {
                  const amount = Number(r.amount_paise);
                  return (
                    <tr key={r.entry_id}>
                      <td className="nowrap">{showDate(r.entry_date)}</td>
                      <td><ListLink href={`/entries/${r.entry_id}`} className="party-link">{nameOf.get(r.money_account_id)}</ListLink></td>
                      <td>{r.narration}</td>
                      <td className="num plus">{amount > 0 ? showPaise(amount) : ''}</td>
                      <td className="num minus">{amount < 0 ? showPaise(-amount) : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {profile.role === 'owner' && (
        <p className="mt-6"><Link href="/masters/money-accounts" className="btn ghost"><Icon name="setup" /> {t('bankbook.setup')}</Link></p>
      )}
    </>
  );
}

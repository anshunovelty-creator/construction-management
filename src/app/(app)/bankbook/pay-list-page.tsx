import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Icon } from '@/components/icons';
import { ListLink } from '@/components/list-link';
import { MoneyPopup } from '@/components/money-popup';
import { PayList } from '@/components/pay-list';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { loadDues, loadFirmLines, loadFirms } from '../between/data';
import { postMoney } from '../entries/actions';
import { showDate, todayInIndia } from '../entries/data';
import { loadForecast } from '../forecast/data';
import { labourFirm } from '../pay/data';
import { Stat } from '../party/shared';
import { loadAccounts, loadPayList } from './data';

interface Also { name: string; note?: string; amount: number; href: string }

/** The Pay or Receive page of the working firm's bankbook: the full list, then whoever else is due, then anything else. */
export async function PayListPage({ side, account: asked }: { side: 'party' | 'client'; account?: string }) {
  const profile = await requireProfile('owner', 'office');
  const [working, t] = await Promise.all([getWorkingFirm(), getTranslations()]);
  if (!working) return <p className="empty">{t('party.noFirm')}</p>;
  const { firm } = working;
  const pay = side === 'party';
  const path = pay ? '/bankbook/pay' : '/bankbook/receive';
  const db = await createClient();
  const today = todayInIndia();
  const [everything, lists, dues, firms, labour, forecast] = await Promise.all([
    loadAccounts(db), loadPayList(db, firm.id), loadDues(db), loadFirms(db),
    labourFirm(db), pay ? loadForecast(db, [firm], today) : null,
  ]);
  const accounts = everything.filter((a) => a.firm_id === firm.id && a.is_active)
    .sort((a, b) => Number(b.kind === 'bank') - Number(a.kind === 'bank'));
  const account = accounts.find((a) => a.id === asked) ?? (accounts.length === 1 ? accounts[0] : undefined);
  // Paying another of our firms lands in both books, so it needs both firms; one this person has not is only shown below.
  const others = firms.filter((f) => f.id !== firm.id);
  const both = others.filter((f) => working.firms.some((w) => w.id === f.id));
  const people = [...lists[side], ...await loadFirmLines(db, firm.id, both, side)]
    .sort((a, b) => Math.max(b.left, 0) - Math.max(a.left, 0) || a.name.localeCompare(b.name))
    .map((p) => ({ ...p, last: p.last && showDate(p.last) }));
  const choices = (firmId: string) => everything.filter((a) => a.firm_id === firmId && a.is_active).map((a) => ({ id: a.id, name: a.name, kind: a.kind, balance: a.balance }));
  const due = people.reduce((s, p) => s + Math.max(p.left, 0), 0);
  const extra = people.filter((p) => !p.firm).reduce((s, p) => s + Math.max(-p.left, 0), 0);

  // On Pay the people and taxes, each paid on its own page as many at once.
  const mine = forecast?.firms[0];
  const also: Also[] = [
    ...(mine ? [
      { name: t('payList.also.salary'), note: t('payList.also.allFirms'), amount: mine.salary + forecast!.shared.salary, href: '/salary/pay' },
      ...(labour?.id === firm.id ? [{ name: t('payList.also.labour'), amount: mine.wages, href: '/labour/pay' }] : []),
      { name: t('payList.also.gst'), amount: mine.gst, href: '/gst' },
      { name: t('payList.also.tds'), amount: mine.tds, href: '/tds' },
      { name: t('payList.also.pf'), note: t('payList.also.allFirms'), amount: forecast!.shared.pf, href: '/salary' },
    ] : []),
    ...others.filter((f) => !both.includes(f)).map((f) => ({ name: f.name, amount: (dues.get(`${firm.id}/${f.id}`) ?? 0) * (pay ? -1 : 1), href: `/between/${f.id}` })),
  ].filter((a) => a.amount > 0);

  return (
    <>
      <Link href={account ? `/bankbook/${account.id}` : '/bankbook'} className="back"><Icon name="chevronLeft" size={16} /> {account?.name ?? t('nav.bankbook')}</Link>
      <h1>{t(`payList.${side}.title`, { firm: firm.name })}</h1>
      <p className="lede">{t(`payList.${side}.lede`)}</p>

      {accounts.length === 0 ? (
        <p className="banner bad">{t('party.needAccount')} <Link href="/masters/money-accounts" className="underline">{t('party.goSetup')}</Link></p>
      ) : (
        <nav className="filters" aria-label={t(pay ? 'party.paidFrom' : 'client.receivedIn')}>
          <span className="muted">{t(pay ? 'party.paidFrom' : 'client.receivedIn')}</span>
          {accounts.map((a) => (
            <Link key={a.id} href={`${path}?account=${a.id}`} replace className={`chip${a.id === account?.id ? ' on' : ''}`} aria-current={a.id === account?.id ? 'true' : undefined}>
              <Icon name={a.kind === 'bank' ? 'bank' : 'receive'} size={15} /> {a.name} · {showPaise(a.balance)}
            </Link>
          ))}
        </nav>
      )}

      <div className="stats">
        <Stat label={t(`${side}.balance`)} value={showPaise(due)} tone={pay ? 'owe' : 'done'} />
        {extra > 0 && <Stat label={t(`${side}.statuses.extra`)} value={showPaise(pay ? -extra : extra)} tone={pay ? 'done' : 'owe'} />}
      </div>

      <PayList key={account?.id ?? ''} side={side} firm={firm} people={people} account={account?.id} today={today}
        accounts={accounts.map((a) => ({ value: a.id, label: a.name, kind: a.kind, balance: a.balance }))}
        theirs={Object.fromEntries(both.map((f) => [f.id, choices(f.id)]))} />

      {also.length > 0 && (
        <section className="card table-wrap flush mt-6">
          <table className="ledger clickable">
            <thead><tr><th>{t(`payList.${side}.also`)}</th><th className="num">{t(`${side}.balance`)}</th></tr></thead>
            <tbody>
              {also.map((a) => (
                <tr key={a.href + a.name}>
                  <td><ListLink href={a.href} className="party-link">{a.name}</ListLink>{a.note && <span className="muted"> · {a.note}</span>}</td>
                  <td className={`num strong ${pay ? 'minus' : 'plus'}`}>{showPaise(a.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {account ? (
        <section className="mt-6">
          <p className="hint">{t(`payList.${side}.otherHint`)}</p>
          <MoneyPopup key={account.id} mode={pay ? 'out' : 'in'} listed firm={firm} account={account.id} owner={profile.role === 'owner'} today={today} save={postMoney}
            accounts={accounts} people={lists[side]} others={lists[pay ? 'client' : 'party']} button={t(`payList.${side}.other`)} />
        </section>
      ) : accounts.length > 0 && <p className="hint mt-6">{t(`payList.${side}.pickFirst`)}</p>}
    </>
  );
}

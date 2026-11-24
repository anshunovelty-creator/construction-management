'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { postBetween } from '@/app/(app)/between/actions';
import { postMoney } from '@/app/(app)/entries/actions';
import { ReceiveMoney, type PayAccount } from '@/components/receive-money';
import { showPaise } from '@/lib/money';

/** A party to pay or a client to receive from, with what they come to in this firm. `left` below zero is extra. */
export interface ListPerson { id: string; name: string; total: number; done: number; left: number; last: string | null; /** Another of our firms: paid into its own bank or cash, as one entry in both books. */ firm?: boolean }

/**
 * Everyone a firm pays (side "party") or receives from (side "client"), those with something left first. Pressing a row
 * opens the payment pop-up, and what is saved goes to that party's or client's ledger and to the account's bankbook.
 */
export function PayList({ side, firm, people, accounts, account, theirs, today }: {
  side: 'party' | 'client';
  firm: { id: string; name: string };
  people: ListPerson[];
  accounts: PayAccount[];
  /** The account the list was opened from, picked already in the pop-up. */
  account?: string;
  /** The banks and cash of each of our other firms in the list. */
  theirs: Record<string, { id: string; name: string; kind: string; balance: number }[]>;
  today: string;
}) {
  const t = useTranslations();
  const [everyone, setEveryone] = useState(false);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const due = people.filter((p) => p.left > 0);
  const want = search.trim().toLowerCase();
  // A search looks at everyone, so a party with nothing left can still be given an advance.
  const rows = want ? people.filter((p) => p.name.toLowerCase().includes(want)) : everyone ? people : people.filter((p) => p.left > 0 || p.firm);
  // Kept apart from the rows shown: a party paid in full leaves the list, and its pop-up still says it was saved.
  const chosen = people.find((p) => p.id === open);
  const pay = side === 'party';
  const slug = pay ? 'pay-vendor' : 'client-receipt';
  const chip = (on: boolean, label: string, press: () => void) => (
    <button type="button" className={`chip${on ? ' on' : ''}`} aria-pressed={on} onClick={press}>{label}</button>
  );

  return (
    <>
      <div className="toolbar">
        <div className="row-filter">
          <input type="search" aria-label={t('payList.search')} placeholder={t('payList.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="filters">
          {chip(!everyone, t(`payList.${side}.due`, { count: due.length }), () => setEveryone(false))}
          {chip(everyone, t('payList.everyone', { count: people.length }), () => setEveryone(true))}
        </div>
      </div>
      <div className="card table-wrap flush">
        <table className="ledger clickable pay-list">
          <thead>
            <tr>
              <th className="num">{t('party.sr')}</th>
              <th>{t(`payList.${side}.name`)}</th>
              <th className="num">{t(`${side}.total`)}</th>
              <th className="num">{t(pay ? 'party.paid' : 'client.received')}</th>
              <th>{t(pay ? 'party.lastPayment' : 'client.lastReceipt')}</th>
              <th className="num">{t(`${side}.balance`)}</th>
              <th aria-label={t(`payList.${side}.button`)} />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="muted">{t(want ? 'payList.notFound' : `payList.${side}.none`)}</td></tr>}
            {rows.map((p, i) => (
              <tr key={p.id} onClick={() => setOpen(p.id)}>
                <td className="num muted">{i + 1}</td>
                <td>{p.name}{p.firm && <span className="pill common">{t('between.ourFirm')}</span>}</td>
                <td className="num">{p.total ? showPaise(p.total) : '–'}</td>
                <td className="num">{p.done ? showPaise(p.done) : '–'}</td>
                <td className="nowrap">{p.last ?? <span className="muted">–</span>}</td>
                <td className={`num strong${p.left === 0 ? ' muted' : (p.left > 0) === pay ? ' minus' : ' plus'}`}>
                  {p.left === 0 ? '–' : showPaise(pay && !p.firm ? p.left : Math.abs(p.left))}
                  {p.left < 0 && <span className="balance-word">{t(p.firm ? `payList.${side}.firmExtra` : `${side}.statuses.extra`)}</span>}
                </td>
                <td className="pay-cell"><button type="button" className={`btn small${p.left > 0 ? '' : ' ghost'}`} aria-label={`${t(`payList.${side}.button`)}: ${p.name}`}>{t(`payList.${side}.button`)}</button></td>
              </tr>
            ))}
          </tbody>
          {!want && rows.length > 0 && (
            <tfoot>
              <tr>
                <td /><td>{t('party.grandTotal')}</td>
                <td className="num">{showPaise(rows.reduce((s, p) => s + p.total, 0))}</td>
                <td className="num">{showPaise(rows.reduce((s, p) => s + p.done, 0))}</td>
                <td />
                <td className={`num strong ${pay ? 'minus' : 'plus'}`}>{showPaise(due.reduce((s, p) => s + p.left, 0))}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {chosen && (
        <ReceiveMoney key={chosen.id} side={side} name={chosen.name} firm={firm.name} total={chosen.total} received={chosen.done} balance={chosen.left}
          accounts={accounts} lastAccount={account} today={today} onClose={() => setOpen(null)}
          other={chosen.firm ? { name: chosen.name, accounts: theirs[chosen.id] ?? [] } : undefined}
          save={async ([row]) => {
            const { id, cells } = row!;
            const ours = cells[pay ? 'from_account_id' : 'to_account_id']!;
            return { [id]: chosen.firm
              ? await postBetween(firm.id, chosen.id, id, pay ? 'gave' : 'took', { ...cells, date: cells.entry_date!, from: pay ? ours : cells.other_account_id!, to: pay ? cells.other_account_id! : ours })
              : await postMoney(id, slug, firm.id, { ...cells, [pay ? 'vendor_id' : 'client_id']: chosen.id }) };
          }} />
      )}
    </>
  );
}

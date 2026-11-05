import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ListLink } from '@/components/list-link';
import { RowFilter } from '@/components/row-filter';
import { SearchSelect } from '@/components/search-select';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { sumFigures } from '@/lib/ledger/party';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { showDate } from '../entries/data';
import { loadFirmClients, MoneyCell, PercentBar, Stat, StatusPill } from '../party/shared';

/** Every client who owes the working firm, one line each: the client side of the party list. */
export default async function ClientIndexPage() {
  await requireProfile('owner', 'office');
  const [working, t] = await Promise.all([getWorkingFirm(), getTranslations()]);
  if (!working) return <p className="empty">{t('party.noFirm')}</p>;
  const { firm } = working;
  const db = await createClient();
  const [clients, { data: all }] = await Promise.all([
    loadFirmClients(db, firm.id),
    db.from('parties').select('id, name').eq('kind', 'client').eq('is_active', true).order('name'),
  ]);
  const sum = sumFigures(clients.map((c) => c.f));
  const gross = clients.reduce((s, c) => s + c.f.gross, 0);
  const deductions = clients.reduce((s, c) => s + c.f.deductions, 0);
  // Clients with no entry in this firm yet are listed hidden: a search finds them, so the first bill can be added.
  const listed = new Set(clients.map((c) => c.id));
  const quiet = (all ?? []).filter((c) => !listed.has(c.id));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('client.indexTitle', { firm: firm.name })}</h1>
          <p className="lede">{t('client.indexLede')}</p>
        </div>
      </div>

      {clients.length === 0 && <p className="card empty">{t('client.empty')}</p>}
      {clients.length + quiet.length > 0 && (
        <>
          {clients.length > 0 && <div className="stats">
            <Stat label={t('client.total')} value={showPaise(sum.total)} note={t('client.clientCount', { count: clients.length })} />
            <Stat label={t('client.received')} value={showPaise(sum.paid)} note={t('party.percentNote', { percent: sum.percentPaid })} tone="done" />
            <Stat label={t('client.balance')} value={showPaise(sum.toPay)} note={t('client.balanceNote')} tone="due" />
            {sum.extra > 0 && <Stat label={t('client.statuses.extra')} value={showPaise(sum.extra)} note={t('client.extraNote')} tone="owe" />}
          </div>}

          <div className="toolbar">
            <RowFilter table="clients" label={t('client.search')} placeholder={t('client.searchHint')} none={t('client.searchNone')} />
            <p className="hint">{t('client.clickHint')}</p>
          </div>
          <div className="card table-wrap flush hide-when-empty">
            <table className="ledger clickable" id="clients">
              <thead>
                <tr>
                  <th className="num">{t('party.sr')}</th>
                  <th>{t('client.name')}</th>
                  <th className="num">{t('client.opening')}</th>
                  <th className="num">{t('client.billsGiven')}</th>
                  <th className="num">{t('client.deductions')}</th>
                  <th className="num">{t('client.total')}</th>
                  <th className="num">{t('client.received')}</th>
                  <th className="num">{t('client.balance')}</th>
                  <th className="num">{t('client.statuses.extra')}</th>
                  <th className="num">{t('client.percentReceived')}</th>
                  <th>{t('party.status')}</th>
                  <th>{t('client.lastReceipt')}</th>
                </tr>
              </thead>
              <tbody>
                {clients.map(({ id, name, f }, i) => (
                  <tr key={id} data-name={name}>
                    <td className="num muted">{i + 1}</td>
                    <td><ListLink href={`/client?id=${id}`} className="party-link">{name}</ListLink></td>
                    <MoneyCell paise={f.opening} />
                    <MoneyCell paise={f.gross} />
                    <MoneyCell paise={f.deductions} />
                    <MoneyCell paise={f.total} />
                    <MoneyCell paise={f.paid} />
                    <MoneyCell paise={Math.max(f.balance, 0)} strong tone="plus" />
                    <MoneyCell paise={Math.max(-f.balance, 0)} strong tone="minus" />
                    <td><PercentBar percent={f.percentPaid} /></td>
                    <td><StatusPill status={f.status} t={t} side="client" /></td>
                    <td className="nowrap">{f.lastPayment ? showDate(f.lastPayment) : <span className="muted">–</span>}</td>
                  </tr>
                ))}
                {quiet.map(({ id, name }) => (
                  <tr key={id} data-name={name} data-quiet="" hidden>
                    <td className="num muted">–</td>
                    <td><ListLink href={`/client?id=${id}`} className="party-link">{name}</ListLink></td>
                    <td colSpan={10} className="muted">{t('party.noEntriesYet')}</td>
                  </tr>
                ))}
              </tbody>
              {clients.length > 0 && <tfoot>
                <tr>
                  <td />
                  <td>{t('party.grandTotal')}</td>
                  <MoneyCell paise={sum.opening} />
                  <MoneyCell paise={gross} />
                  <MoneyCell paise={deductions} />
                  <MoneyCell paise={sum.total} />
                  <MoneyCell paise={sum.paid} />
                  <MoneyCell paise={sum.toPay} strong tone="plus" />
                  <MoneyCell paise={sum.extra} strong tone="minus" />
                  <td className="num">{sum.percentPaid}%</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>}
            </table>
          </div>
        </>
      )}

      <form action="/client" className="open-other card">
        <label htmlFor="open-id">{t('client.openOther')}</label>
        <SearchSelect id="open-id" name="id" required options={(all ?? []).map((c) => ({ value: c.id, label: c.name }))} />
        <button type="submit" className="btn ghost">{t('party.open')} ►</button>
        <p className="hint">
          {t('client.openOtherHint')} <Link href="/masters/parties" className="underline">{t('client.addClient')}</Link>
        </p>
      </form>
    </>
  );
}

import type { getTranslations } from 'next-intl/server';
import { clientFigures, partyFigures, type ClientTotalRow, type PartyFigures, type PartyStatus, type PartyTotalRow } from '@/lib/ledger/party';
import { showPaise, roundOffSmall } from '@/lib/money';
import type { createClient } from '@/lib/supabase/server';

type Db = Awaited<ReturnType<typeof createClient>>;
type T = Awaited<ReturnType<typeof getTranslations>>;
export type PartyLine = { id: string; name: string; f: PartyFigures };
export type ClientLine = { id: string; name: string; f: ReturnType<typeof clientFigures> };

async function partyNames(db: Db) {
  const { data } = await db.from('parties').select('id, name');
  return new Map((data ?? []).map((p) => [p.id as string, p.name as string]));
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

/** The vendors a firm owes, A to Z, with their figures. */
export async function loadFirmParties(db: Db, firmId: string): Promise<PartyLine[]> {
  const [{ data: totals }, nameOf] = await Promise.all([
    db.from('party_totals').select('*').eq('firm_id', firmId).returns<PartyTotalRow[]>(),
    partyNames(db),
  ]);
  const parties = (totals ?? []).map((row) => ({ id: row.party_id, name: nameOf.get(row.party_id) ?? '', f: partyFigures(row) }));
  return parties.sort(byName);
}

/** The clients who owe a firm, A to Z, with their figures. */
export async function loadFirmClients(db: Db, firmId: string): Promise<ClientLine[]> {
  const [{ data: totals }, nameOf] = await Promise.all([
    db.from('client_totals').select('*').eq('firm_id', firmId).returns<ClientTotalRow[]>(),
    partyNames(db),
  ]);
  const clients = (totals ?? []).map((row) => ({ id: row.party_id, name: nameOf.get(row.party_id) ?? '', f: clientFigures(row) }));
  return clients.sort(byName);
}

/** `side` picks the words: a vendor is "paid", a client has "received". */
export function StatusPill({ status, t, side = 'party' }: { status: PartyStatus; t: T; side?: 'party' | 'client' }) {
  return <span className={`pill ${status}`}>{t(`${side}.statuses.${status}`)}</span>;
}

/** A money table cell; nothing (a dash) reads quicker than ₹0 down a long column. Red is money we pay, green money we get. */
export function MoneyCell({ paise, strong = false, tone }: { paise: number; strong?: boolean; tone?: 'plus' | 'minus' }) {
  return (
    <td className={`num${strong ? ' strong' : ''}${paise === 0 ? ' muted' : tone ? ` ${tone}` : ''}`}>{paise === 0 ? '–' : showPaise(paise)}</td>
  );
}

/** What is left after a payment, in words and colour. Extra paid to a party also carries a minus sign (owner decision 2026-11-06). */
export function BalanceCell({ paise: exact, t, side = 'party' }: { paise: number; t: T; side?: 'party' | 'client' }) {
  const paise = roundOffSmall(exact);
  if (paise === 0) return <MoneyCell paise={0} />;
  const weGet = side === 'party' ? paise < 0 : paise > 0;
  const word = side === 'party' ? (paise > 0 ? 'vendor.cr' : 'vendor.dr') : (paise > 0 ? 'client.dr' : 'client.cr');
  return (
    <td className={`num strong ${weGet ? 'plus' : 'minus'}`}>
      {showPaise(side === 'party' ? paise : Math.abs(paise))}
      <span className="balance-word">{t(`ledger.balanceWord.${word}`)}</span>
    </td>
  );
}

/** % paid as a short bar and the number, so a long list shows who is nearly settled at a glance. */
export function PercentBar({ percent }: { percent: number }) {
  return (
    <span className="pct">
      <span className="pct-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} /></span>
      <span className="num">{percent}%</span>
    </span>
  );
}

/** A labelled number in a tile. `tone` colours the number: what we still owe, or what is settled. */
export function Stat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'owe' | 'due' | 'done' }) {
  return (
    <div className={`stat card${tone ? ` ${tone}` : ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {note && <span className="stat-note">{note}</span>}
    </div>
  );
}

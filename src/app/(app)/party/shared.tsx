import Link from 'next/link';
import type { getTranslations } from 'next-intl/server';
import { clientFigures, partyFigures, type ClientTotalRow, type PartyFigures, type PartyStatus, type PartyTotalRow } from '@/lib/ledger/party';
import { showPaise } from '@/lib/money';
import type { createClient } from '@/lib/supabase/server';

type Db = Awaited<ReturnType<typeof createClient>>;
type T = Awaited<ReturnType<typeof getTranslations>>;
export type Firm = { id: string; name: string };
export type PartyLine = { id: string; name: string; f: PartyFigures };
export type ClientLine = { id: string; name: string; f: ReturnType<typeof clientFigures> };

/** The firms the user may see and the chosen one; with none chosen, the first that has rows in `view`. */
async function pickFirm(db: Db, firmId: string | undefined, view: 'party_totals' | 'client_totals') {
  const { data } = await db.from('firms').select('id, name').order('name').returns<Firm[]>();
  const firms = data ?? [];
  let firm = firms.find((f) => f.id === firmId);
  if (!firm) {
    const { data: used } = await db.from(view).select('firm_id').limit(1);
    firm = firms.find((f) => f.id === used?.[0]?.firm_id) ?? firms[0];
  }
  return { firms, firm };
}

async function partyNames(db: Db) {
  const { data } = await db.from('parties').select('id, name');
  return new Map((data ?? []).map((p) => [p.id as string, p.name as string]));
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

/** The vendors a firm owes, A to Z, with their figures. */
export async function loadFirmParties(db: Db, firmId?: string): Promise<{ firms: Firm[]; firm?: Firm; parties: PartyLine[] }> {
  const { firms, firm } = await pickFirm(db, firmId, 'party_totals');
  if (!firm) return { firms, parties: [] };
  const [{ data: totals }, nameOf] = await Promise.all([
    db.from('party_totals').select('*').eq('firm_id', firm.id).returns<PartyTotalRow[]>(),
    partyNames(db),
  ]);
  const parties = (totals ?? []).map((row) => ({ id: row.party_id, name: nameOf.get(row.party_id) ?? '', f: partyFigures(row) }));
  return { firms, firm, parties: parties.sort(byName) };
}

/** The clients who owe a firm, A to Z, with their figures. */
export async function loadFirmClients(db: Db, firmId?: string): Promise<{ firms: Firm[]; firm?: Firm; clients: ClientLine[] }> {
  const { firms, firm } = await pickFirm(db, firmId, 'client_totals');
  if (!firm) return { firms, clients: [] };
  const [{ data: totals }, nameOf] = await Promise.all([
    db.from('client_totals').select('*').eq('firm_id', firm.id).returns<ClientTotalRow[]>(),
    partyNames(db),
  ]);
  const clients = (totals ?? []).map((row) => ({ id: row.party_id, name: nameOf.get(row.party_id) ?? '', f: clientFigures(row) }));
  return { firms, firm, clients: clients.sort(byName) };
}

/** One chip per firm, like the workbook's one file per firm. */
export function FirmTabs({ firms, firm, path, t }: { firms: Firm[]; firm: Firm; path: string; t: T }) {
  if (firms.length < 2) return null;
  return (
    <nav className="filters" aria-label={t('party.firms')}>
      {firms.map((f) => (
        <Link key={f.id} href={`${path}?firm=${f.id}`} className={`chip${f.id === firm.id ? ' on' : ''}`} aria-current={f.id === firm.id ? 'page' : undefined}>
          {f.name}
        </Link>
      ))}
    </nav>
  );
}

/** `side` picks the words: a vendor is "paid", a client has "received". */
export function StatusPill({ status, t, side = 'party' }: { status: PartyStatus; t: T; side?: 'party' | 'client' }) {
  return <span className={`pill ${status}`}>{t(`${side}.statuses.${status}`)}</span>;
}

/** A money table cell; nothing (a dash) reads quicker than ₹0 down a long column. */
export function MoneyCell({ paise, strong = false }: { paise: number; strong?: boolean }) {
  return (
    <td className={`num${strong ? ' strong' : ''}${paise === 0 ? ' muted' : ''}`}>{paise === 0 ? '–' : showPaise(paise)}</td>
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

import Link from 'next/link';
import type { getTranslations } from 'next-intl/server';
import { partyFigures, type PartyFigures, type PartyStatus, type PartyTotalRow } from '@/lib/ledger/party';
import { showPaise } from '@/lib/money';
import type { createClient } from '@/lib/supabase/server';

type Db = Awaited<ReturnType<typeof createClient>>;
type T = Awaited<ReturnType<typeof getTranslations>>;
export type Firm = { id: string; name: string };
export type PartyLine = { id: string; name: string; f: PartyFigures };

/** The firms the user may see, the chosen one (or the first), and its parties A to Z with their figures. */
export async function loadFirmParties(db: Db, firmId?: string): Promise<{ firms: Firm[]; firm?: Firm; parties: PartyLine[] }> {
  const { data: firms } = await db.from('firms').select('id, name').order('name').returns<Firm[]>();
  let firm = (firms ?? []).find((f) => f.id === firmId);
  if (!firm) {
    // No firm chosen: open one that has parties, rather than an empty one.
    const { data: used } = await db.from('party_totals').select('firm_id').limit(1);
    firm = (firms ?? []).find((f) => f.id === used?.[0]?.firm_id) ?? firms?.[0];
  }
  if (!firm) return { firms: [], parties: [] };
  const [{ data: totals }, { data: names }] = await Promise.all([
    db.from('party_totals').select('*').eq('firm_id', firm.id).returns<PartyTotalRow[]>(),
    db.from('parties').select('id, name'),
  ]);
  const nameOf = new Map((names ?? []).map((p) => [p.id as string, p.name as string]));
  const parties = (totals ?? [])
    .map((row) => ({ id: row.party_id, name: nameOf.get(row.party_id) ?? '', f: partyFigures(row) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { firms: firms ?? [], firm, parties };
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

export function StatusPill({ status, t }: { status: PartyStatus; t: T }) {
  return <span className={`pill ${status}`}>{t(`party.statuses.${status}`)}</span>;
}

/** A money table cell; nothing (a dash) reads quicker than ₹0 down a long column. */
export function MoneyCell({ paise, strong = false }: { paise: number; strong?: boolean }) {
  return (
    <td className={`num${strong ? ' strong' : ''}${paise === 0 ? ' muted' : ''}`}>{paise === 0 ? '–' : showPaise(paise)}</td>
  );
}

/** A labelled number in a tile. `tone` colours the number: what we still owe, or what is settled. */
export function Stat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'owe' | 'done' }) {
  return (
    <div className={`stat card${tone ? ` ${tone}` : ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {note && <span className="stat-note">{note}</span>}
    </div>
  );
}

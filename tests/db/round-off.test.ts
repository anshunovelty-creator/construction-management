import type { PGlite, PGliteInterface } from '@electric-sql/pglite';
import { beforeAll, beforeEach, expect, it } from 'vitest';
import { roundOffDraft } from '@/lib/ledger/round-off';
import { partyFigures, clientFigures, type ClientTotalRow, type PartyTotalRow } from '@/lib/ledger/party';
import { asUser, createMigratedDb, createUser, seedBasics, type Seed } from './harness';

let template: PGlite;
let db: PGliteInterface;
let seed: Seed;
let office: string;

beforeAll(async () => {
  template = await createMigratedDb();
});

beforeEach(async () => {
  db = await template.clone();
  seed = await seedBasics(db);
  office = await createUser(db, 'office', 'Office', { firms: [seed.ab] });
});

/** Posts as the office, the way the app does, and returns the account's balance for that party. */
const post = async (draft: unknown) => asUser(db, office, (tx) => tx.query(`select app_post_entry($1::jsonb)`, [JSON.stringify(draft)]));
const sumOn = async (account: string, party: string) => Number((await db.query<{ n: string }>(
  `select coalesce(sum(amount_paise), 0) as n from entry_lines where account = $1 and party_id = $2`, [account, party])).rows[0]!.n);

const vendorOpening = (paise: number) => ({
  id: crypto.randomUUID(), entryType: 'vendor_payment', entryDate: '2026-10-01', firmId: seed.ab, partyId: seed.ansari, reference: 'x',
  lines: [{ account: 'vendor_payable', amountPaise: -paise, firmId: seed.ab, partyId: seed.ansari }, { account: 'cash_short_excess', amountPaise: paise, firmId: seed.ab }],
});

it.each([[-50, 'we still owe 50 paise'], [99, 'we paid 99 paise extra']])('clears a vendor remainder of %i (%s) through every total', async (start) => {
  await post(vendorOpening(-start));
  expect(await sumOn('vendor_payable', seed.ansari)).toBe(start);
  await post(roundOffDraft({ account: 'vendor_payable', amountPaise: 0, firmId: seed.ab, partyId: seed.ansari }, start, '2026-10-02'));
  expect(await sumOn('vendor_payable', seed.ansari)).toBe(0);
  const row = (await db.query<PartyTotalRow>(`select * from party_totals where party_id = $1`, [seed.ansari])).rows[0]!;
  expect(Number(row.opening_paise) + Number(row.bills_paise) - Number(row.paid_paise)).toBe(0);
  expect(partyFigures(row).status).toBe('cleared');
});

it.each([[50, 'the client still owes 50 paise'], [-99, 'the client paid 99 paise extra']])('clears a client remainder of %i (%s) through every total', async (start) => {
  await post({
    id: crypto.randomUUID(), entryType: 'client_receipt', entryDate: '2026-10-01', firmId: seed.ab, partyId: seed.svgClient, reference: 'x',
    lines: [{ account: 'client_receivable', amountPaise: start, firmId: seed.ab, partyId: seed.svgClient }, { account: 'cash_short_excess', amountPaise: -start, firmId: seed.ab }],
  });
  await post(roundOffDraft({ account: 'client_receivable', amountPaise: 0, firmId: seed.ab, partyId: seed.svgClient }, start, '2026-10-02'));
  expect(await sumOn('client_receivable', seed.svgClient)).toBe(0);
  const row = (await db.query<ClientTotalRow>(`select * from client_totals where party_id = $1`, [seed.svgClient])).rows[0]!;
  expect(clientFigures(row).status).toBe('cleared');
  expect(Number(row.received_paise)).toBe(0);
});

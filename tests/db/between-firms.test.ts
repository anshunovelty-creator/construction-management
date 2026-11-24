import type { PGlite, PGliteInterface } from '@electric-sql/pglite';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { replaceEntry, reverseEntry } from '@/lib/ledger/lifecycle';
import { firmSupply, firmTransfer, openingFirms, paidForFirm } from '@/lib/ledger/posting/firms';
import { openingMoneyBalance } from '@/lib/ledger/posting/opening';
import { vendorBill } from '@/lib/ledger/posting/vendor';
import { postEntry } from '@/lib/ledger/repo';
import type { EntryDraft, MoneyAccountRef } from '@/lib/ledger/types';
import { asUser, balanceOf, createMigratedDb, createUser, OWNER, seedBasics, type Seed } from './harness';

let template: PGlite;
let db: PGliteInterface;
let seed: Seed;
let ansari: string;
let ansariBank: MoneyAccountRef;

beforeAll(async () => {
  template = await createMigratedDb();
});

beforeEach(async () => {
  db = await template.clone();
  seed = await seedBasics(db);
  ansari = (await db.query<{ id: string }>(`insert into firms (code, name, runs_labour) values ('AE', 'Ansari Enterprise', true) returning id`)).rows[0]!.id;
  ansariBank = { id: (await db.query<{ id: string }>(`insert into money_accounts (kind, name, firm_id) values ('bank', 'Ansari - Bank', $1) returning id`, [ansari])).rows[0]!.id, kind: 'bank', firmId: ansari };
});

const post = (draft: EntryDraft) => postEntry(db, draft, OWNER);
const opening = (amountPaise = 13_30_193_00) => openingFirms({ firmId: ansari, counterFirmId: seed.jayraj, amountPaise, asOf: '2026-11-01' });
const take = (amountPaise = 5_00_000_00) => firmTransfer({ from: seed.jayrajBank, to: ansariBank, amountPaise, date: '2026-11-05' });
const labour = (amountPaise = 4_20_000_00, extra: object = {}) => firmSupply({
  kind: 'labour_supplied', supplierId: ansari, takerId: seed.jayraj, siteId: seed.svgSite, amountPaise, date: '2026-11-30', reference: '2026-11', ...extra,
});
/** Above zero, `counter` owes `firm`. */
const due = async (firm: string, counter: string) => balanceOf(db, 'inter_firm', { firm_id: firm, counter_firm_id: counter });
const everyFirmBalances = async () => {
  const { rows } = await db.query<{ total: number }>('select sum(amount_paise)::bigint as total from entry_lines group by firm_id');
  expect(rows.every((r) => Number(r.total) === 0)).toBe(true);
};

describe('the running account of two firms', () => {
  it('is the owner’s example, the same from both sides: 13,30,193 − 5,00,000 + 4,20,000 = 12,50,193', async () => {
    await post(opening());
    await post(take());
    await post(labour());
    expect(await due(ansari, seed.jayraj)).toBe(12_50_193_00);
    expect(await due(seed.jayraj, ansari)).toBe(-12_50_193_00);
    const { rows } = await db.query<{ entry_type: string; balance_paise: number }>(
      'select entry_type, balance_paise from firm_rows where firm_id = $1 and counter_firm_id = $2 order by position', [ansari, seed.jayraj]);
    expect(rows).toEqual([
      { entry_type: 'opening', balance_paise: 13_30_193_00 },
      { entry_type: 'firm_transfer', balance_paise: 8_30_193_00 },
      { entry_type: 'labour_supplied', balance_paise: 12_50_193_00 },
    ]);
    await everyFirmBalances();
  });

  it('turns over when more is taken than supplied, and one cancel undoes both sides', async () => {
    const taken = await post(take());
    expect(await due(seed.jayraj, ansari)).toBe(5_00_000_00);
    expect(await balanceOf(db, 'money', { money_account_id: ansariBank.id })).toBe(5_00_000_00);
    await reverseEntry(db, taken.id, OWNER, 'typed twice');
    expect(await due(seed.jayraj, ansari)).toBe(0);
    expect(await balanceOf(db, 'money', { money_account_id: ansariBank.id })).toBe(0);
    expect(await balanceOf(db, 'money', { money_account_id: seed.jayrajBank.id })).toBe(0);
  });

  it('takes a supply’s GST and TDS in both books, and in both records', async () => {
    await post(labour(1_00_000_00, { gstBp: 1800, tdsBp: 200 }));
    expect(await due(ansari, seed.jayraj)).toBe(1_16_000_00);
    expect(await balanceOf(db, 'gst_input', { firm_id: seed.jayraj })).toBe(18_000_00);
    expect(await balanceOf(db, 'gst_output', { firm_id: ansari })).toBe(-18_000_00);
    expect(await balanceOf(db, 'tds_payable', { firm_id: seed.jayraj })).toBe(-2_000_00);
    expect(await balanceOf(db, 'tds_claimable', { firm_id: ansari })).toBe(2_000_00);
    expect(await balanceOf(db, 'site_cost', { firm_id: seed.jayraj, site_id: seed.svgSite })).toBe(1_00_000_00);
    await everyFirmBalances();
    const gst = (await db.query('select firm_id, entry_type, base_paise, gst_paise, counter_firm_id from gst_rows order by entry_type')).rows;
    expect(gst).toEqual([
      { firm_id: seed.jayraj, entry_type: 'vendor_bill', base_paise: 1_00_000_00, gst_paise: 18_000_00, counter_firm_id: ansari },
      { firm_id: ansari, entry_type: 'client_bill', base_paise: 1_00_000_00, gst_paise: 18_000_00, counter_firm_id: seed.jayraj },
    ]);
    const tds = (await db.query('select firm_id, entry_type, rate_bp, base_paise, tds_paise from tds_rows order by entry_type')).rows;
    expect(tds).toEqual([
      { firm_id: seed.jayraj, entry_type: 'vendor_bill', rate_bp: 200, base_paise: 1_00_000_00, tds_paise: 2_000_00 },
      { firm_id: ansari, entry_type: 'client_bill', rate_bp: 200, base_paise: 1_00_000_00, tds_paise: 2_000_00 },
    ]);
  });

  it('lets one firm pay another’s party: that party is owed less, and the firm owes the one that paid', async () => {
    await post(vendorBill({ firmId: seed.ab, vendorId: seed.ansari, siteId: seed.svgSite, billDate: '2026-11-01', billNo: 'C-1', items: [{ costHead: 'material', amountPaise: 2_00_000_00 }] }));
    await post(paidForFirm({ from: seed.jayrajBank, billFirmId: seed.ab, vendorId: seed.ansari, amountPaise: 50_000_00, date: '2026-11-03' }));
    expect(await balanceOf(db, 'vendor_payable', { firm_id: seed.ab })).toBe(-1_50_000_00);
    expect(await due(seed.jayraj, seed.ab)).toBe(50_000_00);
    const { rows } = await db.query<{ paid_paise: number }>('select paid_paise from party_totals where firm_id = $1', [seed.ab]);
    expect(rows).toEqual([{ paid_paise: 50_000_00 }]);
    await everyFirmBalances();
  });
});

describe('the database', () => {
  it('keeps one opening per pair, with nothing before it, changed in one step', async () => {
    const first = await post(opening());
    await expect(post(openingFirms({ firmId: seed.jayraj, counterFirmId: ansari, amountPaise: 1_00, asOf: '2026-11-02' }))).rejects.toThrow('already have an opening balance');
    await expect(post(firmTransfer({ from: seed.jayrajBank, to: ansariBank, amountPaise: 1_00, date: '2026-10-31' }))).rejects.toThrow('nothing can be dated before that');
    await replaceEntry(db, first.id, opening(10_00_000_00), OWNER, 'statement corrected');
    expect(await due(ansari, seed.jayraj)).toBe(10_00_000_00);
    await post(openingFirms({ firmId: ansari, counterFirmId: seed.ab, amountPaise: -5_00, asOf: '2026-11-02' }));
  });

  it('counts a month’s labour at a site once, and lets it be confirmed again as one step', async () => {
    const first = await post(labour());
    await expect(post(labour(1_00))).rejects.toThrow('already in the books');
    await replaceEntry(db, first.id, labour(4_30_000_00), OWNER, 'days changed');
    expect(await due(ansari, seed.jayraj)).toBe(4_30_000_00);
    await post(labour(1_00, { reference: '2026-12', date: '2026-12-31' }));
  });

  it('refuses two sides that differ, and any other kind of entry between firms', async () => {
    const draft = take(1_000_00);
    const uneven = { ...draft, lines: draft.lines.map((l) => (l.account === 'inter_firm' && l.firmId === ansari ? { ...l, counterFirmId: seed.ab } : l)) };
    await expect(post(uneven)).rejects.toThrow('do not say the same');
    await expect(post({ ...draft, id: crypto.randomUUID(), entryType: 'cash_transfer' })).rejects.toThrow('cannot move money between firms');
    await expect(async () => firmTransfer({ from: seed.jayrajBank, to: seed.ownerCash, amountPaise: 1, date: '2026-11-01' })).rejects.toThrow('two different firms');
  });

  it('keeps a firm’s cash from going below zero when it is taken', async () => {
    await expect(post(firmTransfer({ from: seed.ownerCash, to: ansariBank, amountPaise: 1_00, date: '2026-11-05' }))).rejects.toThrow('not enough cash');
  });

  it('lets one firm run the labour business', async () => {
    await expect(db.query('update firms set runs_labour = true where id = $1', [seed.ab])).rejects.toThrow('firms_one_runs_labour');
  });
});

describe('the group', () => {
  it('is worth opening + outside in − outside out: what moved between our firms cancels', async () => {
    await post(openingMoneyBalance({ account: seed.jayrajBank, amountPaise: 10_00_000_00, asOf: '2026-11-01' }));
    await post(take());
    await post(labour());
    const { rows } = await db.query<{ entry_type: string; i: number; o: number }>(
      `select entry_type, sum(in_paise)::bigint as i, sum(out_paise)::bigint as o from money_flow where month = '2026-11' group by 1 order by 1`);
    expect(rows).toEqual([
      { entry_type: 'opening', i: 10_00_000_00, o: 0 },
      { entry_type: 'firm_transfer', i: 5_00_000_00, o: 5_00_000_00 },
    ]);
    expect(await balanceOf(db, 'money')).toBe(10_00_000_00);
  });
});

describe('who sees and does what', () => {
  const rpc = (user: string, sql: string, params: unknown[]) => asUser(db, user, (tx) => tx.query(sql, params));
  const postAs = (user: string, draft: EntryDraft) => rpc(user, 'select app_post_entry($1::jsonb, null)', [JSON.stringify(draft)]);

  it('shows office staff their own firm’s side only, and lets only someone with both firms make or cancel it', async () => {
    const jayrajOnly = await createUser(db, 'office', 'Priya', { firms: [seed.jayraj] });
    const both = await createUser(db, 'office', 'Both', { firms: [seed.jayraj, ansari] });
    await expect(postAs(jayrajOnly, take())).rejects.toThrow('not assigned to every firm');
    await postAs(both, take());
    const id = (await db.query<{ id: string }>(`select id from entries where entry_type = 'firm_transfer'`)).rows[0]!.id;
    const seen = await asUser(db, jayrajOnly, async (tx) => (await tx.query<{ firm_id: string; amount_paise: number }>('select firm_id, amount_paise from entry_lines where entry_id = $1', [id])).rows);
    expect(seen.map((r) => r.firm_id)).toEqual([seed.jayraj, seed.jayraj]);
    expect(seen.reduce((s, r) => s + Number(r.amount_paise), 0)).toBe(0);
    const mine = await asUser(db, jayrajOnly, async (tx) => (await tx.query<{ balance_paise: number }>('select balance_paise from firm_rows')).rows);
    expect(mine).toEqual([{ balance_paise: 5_00_000_00 }]);
    await expect(rpc(jayrajOnly, 'select app_reverse_entry($1, $2)', [id, 'wrong'])).rejects.toThrow('another firm');
    await rpc(both, 'select app_reverse_entry($1, $2)', [id, 'wrong']);
  });

  it('keeps openings to the owner, and charged rates from a Labour login', async () => {
    const both = await createUser(db, 'office', 'Both', { firms: [seed.jayraj, ansari] });
    const lalit = await createUser(db, 'labour', 'Lalit');
    await expect(postAs(both, opening())).rejects.toThrow('office staff cannot post opening');
    await db.query(`insert into labour_workers (id, name, kind, joined_on) values ('00000000-0000-4000-8000-0000000000aa', 'W', 'worker', '2026-11-01')`);
    await db.query(`insert into labour_charge_rates values ('00000000-0000-4000-8000-0000000000aa', '2026-11-01', 60000)`);
    await db.query(`insert into labour_places (name, firm_id, site_id) values ('Jayraj · SVG', $1, $2)`, [seed.jayraj, seed.svgSite]);
    const count = (user: string, table: string) => asUser(db, user, async (tx) => (await tx.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0]!.n);
    expect(await count(both, 'labour_charge_rates')).toBe(1);
    expect(await count(lalit, 'labour_charge_rates')).toBe(0);
    expect(await count(lalit, 'labour_places')).toBe(1);
    for (const view of ['firm_rows', 'money_flow', 'gst_rows', 'tds_rows']) expect(await count(lalit, view)).toBe(0);
    await expect(rpc(lalit, `insert into labour_places (name, client_id) values ('x', $1)`, [seed.svgClient])).rejects.toThrow('row-level security');
    await expect(rpc(lalit, `insert into labour_charge_rates values ('00000000-0000-4000-8000-0000000000aa', '2026-12-01', 1)`, [])).rejects.toThrow('row-level security');
  });
});

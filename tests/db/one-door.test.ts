import type { PGlite, PGliteInterface } from '@electric-sql/pglite';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { reverseEntry } from '@/lib/ledger/lifecycle';
import { siteCashExpense } from '@/lib/ledger/posting/cash';
import { clientBill } from '@/lib/ledger/posting/client';
import { openingMoneyBalance } from '@/lib/ledger/posting/opening';
import { machineService, otherMoney, REASONS, reasonOf, wagesPaid, withBankCharges } from '@/lib/ledger/posting/other';
import { vendorBill } from '@/lib/ledger/posting/vendor';
import { postEntry } from '@/lib/ledger/repo';
import type { EntryDraft, MoneyAccountRef } from '@/lib/ledger/types';
import { lendersOf, type LoanRow } from '@/app/(app)/borrowed/data';
import { asUser, balanceOf, createMigratedDb, createUser, OWNER, seedBasics, type Seed } from './harness';

let template: PGlite;
let db: PGliteInterface;
let seed: Seed;
let owner: string;
let labour: string;
let ansari: string;
let ansariCash: MoneyAccountRef;
let raju: string;
let sita: string;
let head: string;
let member: string;

beforeAll(async () => {
  template = await createMigratedDb();
});

beforeEach(async () => {
  db = await template.clone();
  seed = await seedBasics(db);
  const id = async (sql: string, params: unknown[] = []) => (await db.query<{ id: string }>(sql, params)).rows[0]!.id;
  owner = await createUser(db, 'owner', 'Owner');
  labour = await createUser(db, 'labour', 'Lalit');
  ansari = await id(`insert into firms (code, name, runs_labour) values ('AE', 'Ansari Enterprise', true) returning id`);
  ansariCash = { id: await id(`insert into money_accounts (kind, name, firm_id, holder_user_id) values ('supervisor_cash', 'Ansari - Cash with Lalit', $1, $2) returning id`, [ansari, labour]), kind: 'supervisor_cash', firmId: ansari };
  raju = await id(`insert into parties (kind, name, rate_paise) values ('worker', 'Raju', 7000) returning id`);
  sita = await id(`insert into parties (kind, name, rate_paise) values ('staff', 'Sita', 2000000) returning id`);
  head = await id(`insert into labour_workers (name, kind, joined_on) values ('Bhola', 'worker', '2026-01-01') returning id`);
  member = await id(`insert into labour_workers (name, kind, joined_on, head_id) values ('Laxmi', 'worker', '2026-01-01', $1) returning id`, [head]);
  await postEntry(db, openingMoneyBalance({ account: ansariCash, amountPaise: 50_000_00, asOf: '2026-11-01' }), OWNER);
});

type Batch = { entry: EntryDraft | null; lines: object[] };
const payAs = (user: string, ...batches: Batch[]) => asUser(db, user, async (tx) =>
  (await tx.query<{ r: { id: string; duplicate?: boolean }[] }>('select app_pay($1::jsonb) as r', [JSON.stringify(batches)])).rows[0]!.r);
const salary = (id: string, amountPaise: number, kind = 'payment') => ({ source: 'salary', id, kind, amountPaise });
const wages = (account: MoneyAccountRef, amountPaise: number) => wagesPaid({ account, amountPaise, date: '2026-11-10', narration: 'Salary' });
const held = (a: MoneyAccountRef) => balanceOf(db, 'money', { money_account_id: a.id });
const count = async (table: string) => (await db.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0]!.n;

describe('a site cost paid later', () => {
  const cost = { source: 'other_cost', siteId: '', date: '2026-11-10', description: 'Diesel', costHead: 'site_overhead', quantity: 2, ratePaise: 750_00, amountPaise: 1_500_00 };
  const payCost = (user: string, id: string, entry: EntryDraft) => asUser(db, user, async (tx) =>
    (await tx.query<{ r: { id: string; duplicate?: boolean } }>('select app_pay_cost($1, $2::jsonb) as r', [id, JSON.stringify(entry)])).rows[0]!.r);
  const unpaid = async () => {
    await payAs(owner, { entry: null, lines: [{ ...cost, siteId: seed.svgSite }] });
    return (await db.query<{ id: string }>('select id from other_cost')).rows[0]!.id;
  };
  const entry = (amountPaise = 1_500_00) => siteCashExpense({ from: seed.jayrajBank, siteId: seed.svgSite, costHead: 'site_overhead', amountPaise, expenseDate: '2026-11-12', narration: 'Diesel' });

  it('takes the money out once and keeps the one line, now paid', async () => {
    const id = await unpaid();
    const draft = entry();
    await payCost(owner, id, draft);
    expect((await payCost(owner, id, draft)).duplicate).toBe(true);
    expect(await held(seed.jayrajBank)).toBe(-1_500_00);
    expect((await db.query("select work_date::text as day, amount_paise, entry_id from other_cost")).rows).toEqual([{ day: '2026-11-10', amount_paise: 1_500_00, entry_id: draft.id }]);
    await expect(payCost(owner, (await db.query<{ id: string }>('select id from other_cost')).rows[0]!.id, entry())).rejects.toThrow(/already paid/);
  });

  it('is refused for another amount, or by a supervisor', async () => {
    const id = await unpaid();
    await expect(payCost(owner, id, entry(1_000_00))).rejects.toThrow(/does not pay this cost/);
    const ramesh = await createUser(db, 'supervisor', 'Ramesh', { sites: [seed.svgSite] });
    await expect(payCost(ramesh, id, entry())).rejects.toThrow(/cannot pay/);
    expect(await count('other_cost')).toBe(1);
    expect(await held(seed.jayrajBank)).toBe(0);
  });
});

describe('only Bank and Cash', () => {
  it('gives a firm one cash and any number of banks, and adds no cash with a person', async () => {
    const add = (kind: string, name: string) => asUser(db, owner, (tx) => tx.query('insert into money_accounts (kind, name, firm_id) values ($1, $2, $3)', [kind, name, ansari]));
    await add('owner_cash', 'Ansari cash');
    await add('bank', 'Ansari bank 1');
    await add('bank', 'Ansari bank 2');
    await expect(add('owner_cash', 'Ansari cash 2')).rejects.toThrow(/already has its cash/);
    await expect(add('supervisor_cash', 'Cash with X')).rejects.toThrow(/a bank or cash/);
  });
});

describe('salaries', () => {
  it('pays many people with one bank line, and cancelling that line takes every one of them off', async () => {
    const [paid] = await payAs(owner, { entry: wages(seed.jayrajBank, 30_000_00), lines: [salary(raju, 10_000_00), salary(sita, 20_000_00, 'advance')] });
    expect(await held(seed.jayrajBank)).toBe(-30_000_00);
    expect(await balanceOf(db, 'wages_paid', { firm_id: seed.jayraj })).toBe(30_000_00);
    expect((await db.query('select kind, amount_paise, method, entry_id from salary_money order by amount_paise')).rows).toEqual([
      { kind: 'payment', amount_paise: 10_000_00, method: 'bank', entry_id: paid!.id },
      { kind: 'advance', amount_paise: 20_000_00, method: 'bank', entry_id: paid!.id },
    ]);
    // One of two cannot go alone: the bank line is one.
    await expect(asUser(db, owner, (tx) => tx.query('delete from salary_money where party_id = $1', [raju]))).rejects.toThrow('paid together with others');
    await reverseEntry(db, paid!.id, OWNER, 'bank returned it');
    expect(await count('salary_money')).toBe(0);
    expect(await held(seed.jayrajBank)).toBe(0);
  });

  it('removing a line puts its money back, and the change log keeps it', async () => {
    await payAs(owner, { entry: wages(seed.jayrajBank, 10_000_00), lines: [salary(raju, 10_000_00)] });
    await asUser(db, owner, (tx) => tx.query('delete from salary_money where party_id = $1', [raju]));
    expect(await held(seed.jayrajBank)).toBe(0);
    expect(await count('salary_money')).toBe(0);
    expect(await count(`master_changes where table_name = 'salary_money' and new_row is null`)).toBe(1);
  });

  it('takes money handed back, and the same payment sent twice only once', async () => {
    const back = wagesPaid({ account: seed.jayrajBank, amountPaise: -2_000_00, date: '2026-11-11', narration: 'Advance back' });
    await payAs(owner, { entry: back, lines: [salary(raju, 2_000_00, 'returned')] });
    expect(await held(seed.jayrajBank)).toBe(2_000_00);
    const again = await payAs(owner, { entry: back, lines: [salary(raju, 2_000_00, 'returned')] });
    expect(again[0]!.duplicate).toBe(true);
    expect(await count('salary_money')).toBe(1);
  });

  it('refuses lines that do not add up, no account, or a line tied to an entry by hand', async () => {
    await expect(payAs(owner, { entry: wages(seed.jayrajBank, 10_000_00), lines: [salary(raju, 9_000_00)] })).rejects.toThrow('add up');
    await expect(payAs(owner, { entry: null, lines: [salary(raju, 9_000_00)] })).rejects.toThrow('needs the account');
    await expect(payAs(owner, { entry: wages(seed.rameshCash, 1_00), lines: [salary(raju, 1_00)] })).rejects.toThrow('not enough cash');
    const [paid] = await payAs(owner, { entry: wages(seed.jayrajBank, 1_00), lines: [salary(raju, 1_00)] });
    await expect(asUser(db, owner, (tx) => tx.query(`insert into salary_money (party_id, money_date, kind, amount_paise, note, entry_id) values ($1, '2026-11-01', 'deduction', 5, 'x', $2)`, [raju, paid!.id]))).rejects.toThrow('only when the money is paid');
  });
});

describe('Ansari’s workers', () => {
  const bhola = (amountPaise: number, kind = 'payment') => ({ source: 'labour', id: head, kind, amountPaise });
  it('are paid by a Labour login from the cash it holds, and from nothing else', async () => {
    await payAs(labour, { entry: wages(ansariCash, 8_000_00), lines: [bhola(8_000_00)] });
    expect(await held(ansariCash)).toBe(42_000_00);
    await expect(payAs(labour, { entry: wages(seed.jayrajBank, 1_00), lines: [bhola(1_00)] })).rejects.toThrow('your own cash');
    await expect(payAs(labour, { entry: wages(ansariCash, 1_00), lines: [salary(raju, 1_00)] })).rejects.toThrow('your own cash');
    await expect(payAs(labour, { entry: wages(ansariCash, 60_000_00), lines: [bhola(60_000_00)] })).rejects.toThrow('not enough cash');
    const seen = await asUser(db, labour, async (tx) => (await tx.query<{ money_account_id: string }>('select distinct money_account_id from money_rows')).rows);
    expect(seen).toEqual([{ money_account_id: ansariCash.id }]);
    for (const table of ['firms', 'parties', 'salary_money', 'tax_rows', 'firm_rows']) {
      expect(await asUser(db, labour, async (tx) => (await tx.query(`select * from ${table}`)).rows)).toEqual([]);
    }
  });

  it('are paid through the head, and only by the firm that runs Labour payment', async () => {
    await expect(payAs(owner, { entry: wages(seed.jayrajBank, 1_00), lines: [bhola(1_00)] })).rejects.toThrow('runs Labour payment');
    await expect(payAs(owner, { entry: wages(ansariCash, 1_00), lines: [{ ...bhola(1_00), id: member }] })).rejects.toThrow('through its head');
  });

  it('are not paid on the monthly sheet any more', async () => {
    await expect(asUser(db, owner, (tx) => tx.query(`insert into labour_months (worker_id, month, paid_paise) values ($1, '2026-11-01', 100)`, [head]))).rejects.toThrow('Pay page');
    // What was there from before stays when the days change.
    await db.query(`insert into labour_months (worker_id, month, paid_paise) values ($1, '2026-10-01', 100)`, [head]);
    await asUser(db, owner, (tx) => tx.query(`update labour_months set present_days = 5 where worker_id = $1`, [head]));
    // Saved again as the sheet does: the old Paid stays, and an advance is typed.
    await asUser(db, owner, (tx) => tx.query(`insert into labour_months (worker_id, month, paid_paise, advance_paise, note) values ($1, '2026-10-01', 100, 50000, 'Medicine')
      on conflict (worker_id, month) do update set paid_paise = excluded.paid_paise, advance_paise = excluded.advance_paise, note = excluded.note`, [head]));
    expect((await db.query(`select paid_paise::int, advance_paise::int, note from labour_months where worker_id = $1`, [head])).rows).toEqual([{ paid_paise: 100, advance_paise: 50000, note: 'Medicine' }]);
  });
});

describe('daily-report costs', () => {
  const cost = (user: string, from: MoneyAccountRef | null, amountPaise = 1_500_00) => payAs(user, {
    entry: from && siteCashExpense({ from, siteId: seed.svgSite, costHead: 'site_overhead', amountPaise, expenseDate: '2026-11-10', narration: 'Diesel' }),
    lines: [{ source: 'other_cost', siteId: seed.svgSite, date: '2026-11-10', description: 'Diesel', costHead: 'site_overhead', quantity: 1, ratePaise: amountPaise, amountPaise }],
  });
  it('come out of the supervisor’s own cash when paid, and out of nothing when a bill will come', async () => {
    const ramesh = await createUser(db, 'supervisor', 'Ramesh', { sites: [seed.svgSite] });
    await db.query('update money_accounts set holder_user_id = $1 where id = $2', [ramesh, seed.rameshCash.id]);
    await postEntry(db, openingMoneyBalance({ account: seed.rameshCash, amountPaise: 5_000_00, asOf: '2026-11-01' }), OWNER);
    await cost(ramesh, seed.rameshCash);
    await cost(ramesh, null);
    expect(await held(seed.rameshCash)).toBe(3_500_00);
    expect(await balanceOf(db, 'site_cost', { site_id: seed.svgSite })).toBe(1_500_00);
    expect(await count('other_cost')).toBe(2);
    await expect(cost(ramesh, seed.jayrajBank)).rejects.toThrow('own cash');
    // Taking the line off the report gives the cash back.
    await asUser(db, ramesh, (tx) => tx.query('delete from other_cost where entry_id is not null'));
    expect(await held(seed.rameshCash)).toBe(5_000_00);
  });

  it('are saved all or none', async () => {
    await expect(payAs(owner, { entry: null, lines: [{ source: 'other_cost', siteId: seed.svgSite, date: '2026-11-10', description: 'A', costHead: 'other', quantity: 1, ratePaise: 100, amountPaise: 100 }] },
      { entry: wages(seed.ownerCash, 1_00), lines: [salary(raju, 1_00)] })).rejects.toThrow('not enough cash');
    expect(await count('other_cost')).toBe(0);
  });
});

describe('machine service', () => {
  it('is paid by the firm that owns the machines, and comes off with its entry', async () => {
    const machine = (await db.query<{ id: string }>(`insert into machines (name) values ('AJAX 1') returning id`)).rows[0]!.id;
    const line = { source: 'machine', id: machine, hours: 500, amountPaise: 12_000_00, note: '' };
    const draft = (account: MoneyAccountRef) => machineService({ account, amountPaise: 12_000_00, date: '2026-11-10', narration: 'AJAX 1' });
    await expect(payAs(owner, { entry: draft(seed.jayrajBank), lines: [line] })).rejects.toThrow('the firm that owns it');
    const [paid] = await payAs(owner, { entry: draft(ansariCash), lines: [line] });
    expect(await held(ansariCash)).toBe(38_000_00);
    await reverseEntry(db, paid!.id, OWNER, 'wrong');
    expect(await count('machine_services')).toBe(0);
  });

  it('can be paid later, keeping the day of the service', async () => {
    const machine = (await db.query<{ id: string }>(`insert into machines (name) values ('AJAX 1') returning id`)).rows[0]!.id;
    const id = (await db.query<{ id: string }>(
      `insert into machine_services (machine_id, service_date, running_hours, cost_paise, created_by) values ($1, '2026-11-01', 500, 1200000, $2) returning id`, [machine, owner])).rows[0]!.id;
    const pay = (amountPaise: number, account: MoneyAccountRef) => asUser(db, owner, (tx) => tx.query(`select app_pay_service($1, $2)`,
      [id, JSON.stringify(machineService({ account, amountPaise, date: '2026-11-20', narration: 'AJAX 1' }))]));
    await expect(pay(11_000_00, ansariCash)).rejects.toThrow('does not pay this service');
    await expect(pay(12_000_00, seed.jayrajBank)).rejects.toThrow('the firm that owns it');
    await pay(12_000_00, ansariCash);
    expect(await held(ansariCash)).toBe(38_000_00);
    expect((await db.query(`select service_date::text as day, entry_id is not null as paid from machine_services`)).rows).toEqual([{ day: '2026-11-01', paid: true }]);
    await expect(pay(12_000_00, ansariCash)).rejects.toThrow('already paid or removed');
  });
});

describe('money borrowed', () => {
  it('names the lender on the entry, never on the loan line, and adds up per lender', async () => {
    const friend = (await db.query<{ id: string }>(`insert into parties (kind, name) values ('lender', 'Ramesh') returning id`)).rows[0]!.id;
    expect(() => otherMoney({ reason: 'loan_in', account: seed.jayrajBank, amountPaise: 1_00, date: '2026-11-20' })).toThrow('choose who');
    await postEntry(db, otherMoney({ reason: 'loan_in', account: seed.jayrajBank, amountPaise: 50_000_00, date: '2026-11-10', partyId: friend }), OWNER);
    await postEntry(db, otherMoney({ reason: 'loan_out', account: seed.jayrajBank, amountPaise: 20_000_00, date: '2026-11-20', partyId: friend }), OWNER);
    expect((await db.query(`select count(*)::int as n from entry_lines where account = 'loan' and party_id is not null`)).rows).toEqual([{ n: 0 }]);
    const { rows } = await db.query<LoanRow>(`select entry_id, serial, entry_date::text, party_id, money_account_id, reference, narration, amount_paise
      from money_rows where reason = 'loan' order by entry_date`);
    const [l] = lendersOf(rows, [{ id: friend, name: 'Ramesh', is_active: true }]);
    expect(l).toMatchObject({ id: friend, borrowed: 50_000_00, returned: 20_000_00, left: 30_000_00 });
    expect(await balanceOf(db, 'loan')).toBe(-30_000_00);
  });
});

describe('every other reason', () => {
  it('moves the account, balances in the firm, and lands where it belongs', async () => {
    await postEntry(db, clientBill({ client: seed.client, billDate: '2026-11-01', billNo: 'RA-1', grossPaise: 1_00_000_00, gstPaise: 18_000_00, deductions: { retentionPaise: 5_000_00, securityDepositPaise: 2_000_00 } }), OWNER);
    await postEntry(db, vendorBill({ firmId: seed.jayraj, vendorId: seed.ansari, siteId: seed.svgSite, billDate: '2026-11-01', billNo: 'B-1', items: [{ costHead: 'material', amountPaise: 10_000_00 }], tds: { rateBp: 100, section: '' } }), OWNER);
    for (const reason of [...Object.keys(REASONS.in), ...Object.keys(REASONS.out)]) {
      const before = await held(seed.jayrajBank);
      const r = reasonOf(reason)!;
      await postEntry(db, otherMoney({
        reason, account: seed.jayrajBank, amountPaise: 1_000_00, date: '2026-11-20', month: '2026-10', narration: 'x',
        partyId: r.party === 'client' ? seed.svgClient : r.party || r.lender ? seed.ansari : undefined,
      }), OWNER);
      expect((await held(seed.jayrajBank)) - before, reason).toBe(r.direction === 'in' ? 1_000_00 : -1_000_00);
    }
    expect(await balanceOf(db, 'retention_held')).toBe(4_000_00);
    expect(await balanceOf(db, 'security_deposit_held')).toBe(1_000_00);
    // Money back from a party: we owe it that much more again.
    expect(await balanceOf(db, 'vendor_payable', { firm_id: seed.jayraj })).toBe(-(9_900_00 + 1_000_00));
    expect((await db.query('select paid_paise from party_totals')).rows).toEqual([{ paid_paise: -1_000_00 }]);
    for (const account of ['loan', 'deposit_given', 'gst_paid']) expect(await balanceOf(db, account), account).toBe(0);
    const { rows } = await db.query<{ total: number }>('select sum(amount_paise)::bigint as total from entry_lines group by firm_id');
    expect(rows.every((x) => Number(x.total) === 0)).toBe(true);
    expect((await db.query(`select account, month, sum(amount_paise)::int as paise from tax_rows group by 1, 2 order by 1`)).rows).toEqual([
      { account: 'gst_paid', month: '2026-10', paise: -1_000_00 }, { account: 'gst_paid', month: '2026-10', paise: 1_000_00 },
      { account: 'tds_paid', month: '2026-10', paise: 1_000_00 }, { account: 'pf_paid', month: '2026-10', paise: 1_000_00 },
      { account: 'tds_claimed', month: '', paise: -1_000_00 },
    ].filter((r) => r.account !== 'gst_paid').concat({ account: 'gst_paid', month: '2026-10', paise: 0 }).sort((a, b) => ['gst_paid', 'tds_paid', 'pf_paid', 'tds_claimed'].indexOf(a.account) - ['gst_paid', 'tds_paid', 'pf_paid', 'tds_claimed'].indexOf(b.account)));
    expect((await db.query(`select reason, in_paise, out_paise from money_flow where reason like 'firm_cost%' order by reason`)).rows).toHaveLength(4);
  });

  it('asks for what it needs', () => {
    const base = { account: seed.jayrajBank, amountPaise: 1, date: '2026-11-20' };
    expect(() => otherMoney({ ...base, reason: 'office' })).toThrow('what it was for');
    expect(() => otherMoney({ ...base, reason: 'retention_back' })).toThrow('who it was with');
    expect(() => otherMoney({ ...base, reason: 'gst_paid' })).toThrow('month');
    expect(() => otherMoney({ ...base, reason: 'nonsense' })).toThrow('choose');
  });
});

describe('bank charges on a payment', () => {
  it('pays salaries and a machine service with what the bank kept on top, and still checks the lines add up', async () => {
    await postEntry(db, openingMoneyBalance({ account: seed.jayrajBank, amountPaise: 1_00_000_00, asOf: '2026-11-01' }), OWNER);
    await payAs(owner, { entry: withBankCharges(wages(seed.jayrajBank, 20_000_00), seed.jayrajBank, 10_00), lines: [salary(sita, 20_000_00)] });
    expect(await held(seed.jayrajBank)).toBe(79_990_00);
    expect((await db.query(`select charges_paise::int as c from bank_charge_rows`)).rows).toEqual([{ c: 10_00 }]);
    await expect(payAs(owner, { entry: withBankCharges(wages(seed.jayrajBank, 20_000_00), seed.jayrajBank, 10_00), lines: [salary(sita, 19_990_00)] }))
      .rejects.toThrow('add up');

    const bank: MoneyAccountRef = { id: (await db.query<{ id: string }>(`insert into money_accounts (kind, name, firm_id) values ('bank', 'Ansari Bank', $1) returning id`, [ansari])).rows[0]!.id, kind: 'bank', firmId: ansari };
    await postEntry(db, openingMoneyBalance({ account: bank, amountPaise: 50_000_00, asOf: '2026-11-01' }), OWNER);
    const machine = (await db.query<{ id: string }>(`insert into machines (name) values ('AJAX 1') returning id`)).rows[0]!.id;
    const id = (await db.query<{ id: string }>(
      `insert into machine_services (machine_id, service_date, running_hours, cost_paise, created_by) values ($1, '2026-11-01', 500, 1200000, $2) returning id`, [machine, owner])).rows[0]!.id;
    const entry = withBankCharges(machineService({ account: bank, amountPaise: 12_000_00, date: '2026-11-20', narration: 'AJAX 1' }), bank, 5_00);
    await asUser(db, owner, (tx) => tx.query(`select app_pay_service($1, $2)`, [id, JSON.stringify(entry)]));
    expect(await held(bank)).toBe(37_995_00);
    expect((await db.query(`select cost_paise::int as cost from machine_services`)).rows).toEqual([{ cost: 12_000_00 }]);
  });
});

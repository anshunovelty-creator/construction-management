import type { PGlite, PGliteInterface, Transaction } from '@electric-sql/pglite';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { replaceEntry, reverseEntry } from '@/lib/ledger/lifecycle';
import { cashCloseDifference, cashTransfer, notYetKnown, ownerCapital, ownerDrawing, siteCashExpense } from '@/lib/ledger/posting/cash';
import { clientReceipt } from '@/lib/ledger/posting/client';
import { openingMoneyBalance } from '@/lib/ledger/posting/opening';
import { vendorPayment } from '@/lib/ledger/posting/vendor';
import { postEntry } from '@/lib/ledger/repo';
import type { EntryDraft, MoneyAccountRef } from '@/lib/ledger/types';
import { asUser, balanceOf, createMigratedDb, createUser, OWNER, seedBasics, type Seed } from './harness';

let template: PGlite;
let db: PGliteInterface;
let seed: Seed;

beforeAll(async () => {
  template = await createMigratedDb();
});

beforeEach(async () => {
  db = await template.clone();
  seed = await seedBasics(db);
});

const post = (draft: EntryDraft) => postEntry(db, draft, OWNER);
const open = (account: MoneyAccountRef, amountPaise: number, asOf = '2026-11-01') => openingMoneyBalance({ account, amountPaise, asOf });
const pay = (from: MoneyAccountRef, amountPaise: number, paymentDate = '2026-11-05') =>
  vendorPayment({ billFirmId: seed.jayraj, vendorId: seed.ansari, from, amountPaise, paymentDate });
const bankbook = async (account: MoneyAccountRef) => (await db.query<{ entry_type: string; amount_paise: number; balance_paise: number }>(
  `select entry_type, amount_paise, balance_paise from money_rows where money_account_id = $1 order by position`, [account.id])).rows;

describe('bank and cash accounts', () => {
  it('keep their firm and kind once they have an entry', async () => {
    const change = (column: string, value: string) => db.query(`update money_accounts set ${column} = $1 where id = $2`, [value, seed.ownerCash.id]);
    await change('firm_id', seed.ab); // nothing posted yet
    await change('firm_id', seed.jayraj);
    await post(open(seed.ownerCash, 100_00));
    await expect(change('firm_id', seed.ab)).rejects.toThrow('cannot change');
    await expect(change('kind', 'bank')).rejects.toThrow('cannot change');
    await change('name', 'Office cash');
  });
});

describe('opening balance', () => {
  it('is one per account, and nothing is dated before it', async () => {
    await post(open(seed.jayrajBank, 1_000_00));
    await expect(post(open(seed.jayrajBank, 500_00, '2026-11-02'))).rejects.toThrow('already has an opening balance');
    await expect(post(pay(seed.jayrajBank, 10_00, '2026-10-31'))).rejects.toThrow('nothing can be dated before that');
    await post(pay(seed.jayrajBank, 10_00, '2026-11-01'));
  });

  it('can be changed in one step, but not moved past an entry', async () => {
    const opening = await post(open(seed.ownerCash, 1_000_00));
    await post(pay(seed.ownerCash, 900_00));
    // Lower than what was spent: judged as one step, so the cash would be short on the 5th.
    await expect(replaceEntry(db, opening.id, open(seed.ownerCash, 800_00), OWNER, 'counted again')).rejects.toThrow('would go below zero on 5 Nov 2026');
    await expect(replaceEntry(db, opening.id, open(seed.ownerCash, 1_000_00, '2026-11-06'), OWNER, 'wrong date')).rejects.toThrow('nothing can be dated before that');
    await replaceEntry(db, opening.id, open(seed.ownerCash, 950_00), OWNER, 'counted again');
    expect(await bankbook(seed.ownerCash)).toEqual([
      { entry_type: 'opening', amount_paise: 950_00, balance_paise: 950_00 },
      { entry_type: 'vendor_payment', amount_paise: -900_00, balance_paise: 50_00 },
    ]);
  });
});

describe('cash', () => {
  it('never goes below zero, on the day or on any day after', async () => {
    await expect(post(pay(seed.ownerCash, 1_00))).rejects.toThrow('not enough cash');
    await post(open(seed.ownerCash, 1_000_00));
    await post(pay(seed.ownerCash, 900_00, '2026-11-10'));
    // There was 1,000 on the 5th, but 900 of it is spent on the 10th.
    await expect(post(pay(seed.ownerCash, 200_00, '2026-11-05'))).rejects.toThrow('would go below zero on 10 Nov 2026');
    await post(pay(seed.ownerCash, 100_00, '2026-11-05'));
    await expect(post(pay(seed.ownerCash, 1, '2026-11-11'))).rejects.toThrow('not enough cash');
  });

  it('covers cash with a person too, while a bank may be overdrawn', async () => {
    await expect(post(pay(seed.rameshCash, 1_00))).rejects.toThrow('not enough cash');
    await post(pay(seed.jayrajBank, 1_000_00));
    expect(await bankbook(seed.jayrajBank)).toEqual([{ entry_type: 'vendor_payment', amount_paise: -1_000_00, balance_paise: -1_000_00 }]);
  });

  it('lets a wrong receipt be cancelled even after its cash was spent, and shows it below zero', async () => {
    const receipt = await post(clientReceipt({ client: seed.client, to: seed.ownerCash, amountPaise: 500_00, receiptDate: '2026-11-02' }));
    await post(pay(seed.ownerCash, 400_00));
    await reverseEntry(db, receipt.id, OWNER, 'never received');
    expect(await bankbook(seed.ownerCash)).toEqual([{ entry_type: 'vendor_payment', amount_paise: -400_00, balance_paise: -400_00 }]);
    // Cash coming in is never refused, so it can be put right.
    await post(ownerCapital({ account: seed.ownerCash, amountPaise: 100_00, date: '2026-11-06' }));
  });
});

describe('firms', () => {
  it('refuse a line with no firm, and an entry that only balances across firms', async () => {
    const lines = (a: string | null, b: string | null): EntryDraft => ({
      id: crypto.randomUUID(), entryType: 'owner_capital', entryDate: '2026-11-05', firmId: seed.jayraj,
      lines: [
        { account: 'money', amountPaise: 100, firmId: a, moneyAccountId: seed.jayrajBank.id },
        { account: 'owner_capital', amountPaise: -100, firmId: b },
      ],
    });
    await expect(post(lines(seed.jayraj, null))).rejects.toThrow('a line with no firm');
    await expect(post(lines(seed.jayraj, seed.ab))).rejects.toThrow('does not balance within each firm');
    await post(lines(seed.jayraj, seed.jayraj));
  });

  it('each add up to zero after every kind of money entry', async () => {
    await post(open(seed.jayrajBank, 10_000_00));
    await post(cashTransfer({ from: seed.jayrajBank, to: seed.ownerCash, amountPaise: 3_000_00, transferDate: '2026-11-02' }));
    await post(cashTransfer({ from: seed.ownerCash, to: seed.rameshCash, amountPaise: 1_000_00, transferDate: '2026-11-02' }));
    await post(siteCashExpense({ from: seed.rameshCash, siteId: seed.svgSite, costHead: 'labour', amountPaise: 400_00, expenseDate: '2026-11-03', narration: 'helpers' }));
    await post(cashCloseDifference({ account: seed.rameshCash, expectedPaise: 600_00, countedPaise: 590_00, closeDate: '2026-11-03' }));
    await post(ownerDrawing({ account: seed.ownerCash, amountPaise: 50_00, date: '2026-11-03' }));
    await post(notYetKnown({ account: seed.jayrajBank, direction: 'in', amountPaise: 25_00, date: '2026-11-04', narration: 'NEFT credit' }));
    await post(ownerCapital({ account: seed.abBank, amountPaise: 70_00, date: '2026-11-04' }));
    const { rows } = await db.query<{ firm_id: string; total: number }>('select firm_id, sum(amount_paise)::int as total from entry_lines group by firm_id');
    expect(rows.map((r) => r.firm_id).sort()).toEqual([seed.ab, seed.jayraj].sort());
    expect(rows.every((r) => r.total === 0)).toBe(true);
    // Openings + in − out = what every bankbook of the firm holds; moves cancel out.
    const held = (await Promise.all([seed.jayrajBank, seed.ownerCash, seed.rameshCash].map((a) => balanceOf(db, 'money', { money_account_id: a.id })))).reduce((s, n) => s + n, 0);
    expect(held).toBe(10_000_00 - 400_00 - 10_00 - 50_00 + 25_00);
  });
});

describe('the bankbook', () => {
  it('runs in date order with an opening first on its day, names the other account of a move, and leaves out what was cancelled', async () => {
    const wrong = await post(pay(seed.jayrajBank, 999_00, '2026-11-03'));
    await reverseEntry(db, wrong.id, OWNER, 'typed twice');
    await post(pay(seed.jayrajBank, 10_00, '2026-11-03'));
    await post(cashTransfer({ from: seed.jayrajBank, to: seed.ownerCash, amountPaise: 300_00, transferDate: '2026-11-02' }));
    // Typed last, but on the 1st.
    await post(pay(seed.jayrajBank, 40_00, '2026-11-01'));
    await post(open(seed.jayrajBank, 1_000_00, '2026-11-01'));
    expect((await bankbook(seed.jayrajBank)).map((r) => [r.entry_type, r.amount_paise, r.balance_paise])).toEqual([
      ['opening', 1_000_00, 1_000_00],
      ['vendor_payment', -40_00, 960_00],
      ['cash_transfer', -300_00, 660_00],
      ['vendor_payment', -10_00, 650_00],
    ]);
    expect(await balanceOf(db, 'money', { money_account_id: seed.jayrajBank.id })).toBe(650_00);
    const { rows } = await db.query(`select other_account_id, amount_paise from money_rows where entry_type = 'cash_transfer' order by amount_paise`);
    expect(rows).toEqual([
      { other_account_id: seed.ownerCash.id, amount_paise: -300_00 },
      { other_account_id: seed.jayrajBank.id, amount_paise: 300_00 },
    ]);
  });
});

describe('money not yet known', () => {
  it('counts at once, both ways, and is sorted out in one step', async () => {
    await expect(async () => notYetKnown({ account: seed.jayrajBank, direction: 'in', amountPaise: 1, date: '2026-11-04', narration: ' ' })).rejects.toThrow('write what');
    const credit = await post(notYetKnown({ account: seed.jayrajBank, direction: 'in', amountPaise: 25_000_00, date: '2026-11-04', narration: 'NEFT credit' }));
    await post(notYetKnown({ account: seed.jayrajBank, direction: 'out', amountPaise: 590_00, date: '2026-11-04', narration: 'bank debit' }));
    expect(await balanceOf(db, 'money', { money_account_id: seed.jayrajBank.id })).toBe(24_410_00);
    expect(await balanceOf(db, 'not_yet_known', { firm_id: seed.jayraj })).toBe(-24_410_00);
    await replaceEntry(db, credit.id, clientReceipt({ client: seed.client, to: seed.jayrajBank, amountPaise: 25_000_00, receiptDate: '2026-11-04' }), OWNER, 'it was the client');
    expect(await balanceOf(db, 'money', { money_account_id: seed.jayrajBank.id })).toBe(24_410_00);
    expect(await balanceOf(db, 'not_yet_known', { firm_id: seed.jayraj })).toBe(590_00);
    expect(await balanceOf(db, 'client_receivable', { party_id: seed.svgClient })).toBe(-25_000_00);
  });
});

describe('who sees and does what', () => {
  const rpc = (tx: Transaction, draft: EntryDraft) => tx.query('select app_post_entry($1::jsonb, null)', [JSON.stringify(draft)]);

  it('shows office staff their firms only, a supervisor their own cash, and a Labour login nothing', async () => {
    await post(open(seed.jayrajBank, 1_000_00));
    await post(ownerCapital({ account: seed.abBank, amountPaise: 70_00, date: '2026-11-04' }));
    await post(cashTransfer({ from: seed.jayrajBank, to: seed.rameshCash, amountPaise: 100_00, transferDate: '2026-11-02' }));
    const office = await createUser(db, 'office', 'Priya', { firms: [seed.ab] });
    const supervisor = await createUser(db, 'supervisor', 'Ramesh');
    const labour = await createUser(db, 'labour', 'Lalit');
    await db.query('update money_accounts set holder_user_id = $1 where id = $2', [supervisor, seed.rameshCash.id]);
    const seen = (user: string) => asUser(db, user, async (tx) =>
      (await tx.query<{ money_account_id: string }>('select distinct money_account_id from money_rows')).rows.map((r) => r.money_account_id));
    expect(await seen(office)).toEqual([seed.abBank.id]);
    expect(await seen(supervisor)).toEqual([seed.rameshCash.id]);
    expect(await seen(labour)).toEqual([]);
  });

  it('lets office staff move money and write down what is not yet known, but not openings or owner money', async () => {
    const office = await createUser(db, 'office', 'Priya', { firms: [seed.jayraj] });
    const labour = await createUser(db, 'labour', 'Lalit');
    const as = (user: string, draft: EntryDraft) => asUser(db, user, (tx) => rpc(tx, draft));
    const unknown = () => notYetKnown({ account: seed.jayrajBank, direction: 'in', amountPaise: 25_00, date: '2026-11-04', narration: 'NEFT credit' });
    await as(office, unknown());
    await as(office, cashTransfer({ from: seed.jayrajBank, to: seed.ownerCash, amountPaise: 10_00, transferDate: '2026-11-05' }));
    await expect(as(office, open(seed.jayrajBank, 1_00))).rejects.toThrow('office staff cannot post opening');
    await expect(as(office, ownerCapital({ account: seed.jayrajBank, amountPaise: 1_00, date: '2026-11-05' }))).rejects.toThrow('cannot post owner_capital');
    await expect(as(labour, unknown())).rejects.toThrow('cannot post');
  });

  it('checks what office staff post as strictly as the owner, though they see less', async () => {
    const office = await createUser(db, 'office', 'Priya', { firms: [seed.jayraj] });
    await expect(asUser(db, office, (tx) => rpc(tx, pay(seed.ownerCash, 1_00)))).rejects.toThrow('not enough cash');
  });

  it('lets an entry from before, with no firm on a line, still be cancelled', async () => {
    const id = crypto.randomUUID();
    // Written as it used to be, with the checks off.
    await db.exec('alter table entries disable trigger entries_balanced; alter table entries disable trigger entries_money');
    await post({ id, entryType: 'owner_capital', entryDate: '2026-10-01', firmId: seed.jayraj, lines: [
      { account: 'money', amountPaise: 100, firmId: seed.jayraj, moneyAccountId: seed.jayrajBank.id },
      { account: 'owner_capital', amountPaise: -100 },
    ] });
    await db.exec('alter table entries enable trigger entries_balanced; alter table entries enable trigger entries_money');
    await reverseEntry(db, id, OWNER, 'wrong');
    expect(await bankbook(seed.jayrajBank)).toEqual([]);
  });
});

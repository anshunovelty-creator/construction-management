import type { PGlite, PGliteInterface } from '@electric-sql/pglite';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { reverseEntry } from '@/lib/ledger/lifecycle';
import { cashTransfer } from '@/lib/ledger/posting/cash';
import { clientReceipt } from '@/lib/ledger/posting/client';
import { openingMoneyBalance } from '@/lib/ledger/posting/opening';
import { otherMoney } from '@/lib/ledger/posting/other';
import { vendorPayment } from '@/lib/ledger/posting/vendor';
import { lockBooks, postEntry } from '@/lib/ledger/repo';
import type { EntryDraft } from '@/lib/ledger/types';
import { asUser, balanceOf, createMigratedDb, createUser, OWNER, seedBasics, type Seed } from './harness';

let template: PGlite;
let db: PGliteInterface;
let seed: Seed;
let owner: string;

beforeAll(async () => {
  template = await createMigratedDb();
});

beforeEach(async () => {
  db = await template.clone();
  seed = await seedBasics(db);
  owner = await createUser(db, 'owner', 'Owner');
});

const post = (draft: EntryDraft) => postEntry(db, draft, OWNER);
const run = (user: string, sql: string, params: unknown[] = []) => asUser(db, user, async (tx) => (await tx.query<Record<string, unknown>>(sql, params)).rows);
const TICK = `insert into bank_ticks (entry_id, money_account_id, cleared_on) values ($1, $2, $3)`;
const UNTICK = 'delete from bank_ticks where entry_id = $1';

describe('bank matching', () => {
  it('is the owner’s example: our 6,38,410 and a cheque waiting of 2,40,000 make the bank 8,78,410', async () => {
    const bank = seed.jayrajBank;
    await post(openingMoneyBalance({ account: bank, amountPaise: 4_20_000_00, asOf: '2026-11-01' }));
    const ids = [
      await post(clientReceipt({ client: seed.client, to: bank, amountPaise: 6_00_000_00, receiptDate: '2026-11-02' })),
      await post(cashTransfer({ from: bank, to: seed.ownerCash, amountPaise: 50_000_00, transferDate: '2026-11-03' })),
      await post(otherMoney({ reason: 'office', account: bank, amountPaise: 1_16_000_00, date: '2026-11-04', narration: 'x' })),
      await post(otherMoney({ reason: 'bank_charges', account: bank, amountPaise: 590_00, date: '2026-11-06' })),
      await post(clientReceipt({ client: seed.client, to: bank, amountPaise: 25_000_00, receiptDate: '2026-11-07' })),
    ];
    const cheque = await post(vendorPayment({ billFirmId: seed.jayraj, vendorId: seed.ansari, from: bank, amountPaise: 2_40_000_00, paymentDate: '2026-11-05', reference: '000412' }));
    expect(await balanceOf(db, 'money', { money_account_id: bank.id })).toBe(6_38_410_00);
    for (const { id } of ids) await run(owner, TICK, [id, bank.id, '2026-11-07']);
    await run(owner, `insert into bank_statements (money_account_id, statement_date, balance_paise) values ($1, '2026-11-07', 87841000)`, [bank.id]);
    const match = `select (balance_paise - expected_paise)::int as difference from bank_match order by statement_date`;
    expect(await run(owner, match)).toEqual([{ difference: 0 }]);
    // The cheque clears later: the 7th still agrees, and so does the 10th.
    await run(owner, TICK, [cheque.id, bank.id, '2026-11-10']);
    await run(owner, `insert into bank_statements (money_account_id, statement_date, balance_paise) values ($1, '2026-11-10', 63841000)`, [bank.id]);
    expect(await run(owner, match)).toEqual([{ difference: 0 }, { difference: 0 }]);
    // A tick taken off later shows at once.
    await run(owner, UNTICK, [ids[0]!.id]);
    expect(await run(owner, match)).toEqual([{ difference: 6_00_000_00 }, { difference: 6_00_000_00 }]);
  });

  it('keeps a matched line from being cancelled until it is unticked, and ticks only bank lines', async () => {
    const paid = await post(vendorPayment({ billFirmId: seed.jayraj, vendorId: seed.ansari, from: seed.jayrajBank, amountPaise: 100_00, paymentDate: '2026-11-05' }));
    await run(owner, TICK, [paid.id, seed.jayrajBank.id, '2026-11-06']);
    await expect(reverseEntry(db, paid.id, OWNER, 'wrong')).rejects.toThrow('matched with the bank');
    await run(owner, UNTICK, [paid.id]);
    await reverseEntry(db, paid.id, OWNER, 'wrong');
    await post(openingMoneyBalance({ account: seed.ownerCash, amountPaise: 100_00, asOf: '2026-11-01' }));
    const cash = await post(vendorPayment({ billFirmId: seed.jayraj, vendorId: seed.ansari, from: seed.ownerCash, amountPaise: 10_00, paymentDate: '2026-11-05' }));
    await expect(run(owner, TICK, [cash.id, seed.ownerCash.id, '2026-11-06'])).rejects.toThrow('only a line of a bank');
    await expect(run(owner, TICK, [paid.id, seed.jayrajBank.id, '2026-11-06'])).rejects.toThrow('only a line of a bank');
  });

  it('is done by the office of that firm, and seen by no one else', async () => {
    const paid = await post(vendorPayment({ billFirmId: seed.jayraj, vendorId: seed.ansari, from: seed.jayrajBank, amountPaise: 100_00, paymentDate: '2026-11-05' }));
    const jayraj = await createUser(db, 'office', 'Priya', { firms: [seed.jayraj] });
    const ab = await createUser(db, 'office', 'Amit', { firms: [seed.ab] });
    const supervisor = await createUser(db, 'supervisor', 'Ramesh');
    for (const user of [ab, supervisor]) await expect(run(user, TICK, [paid.id, seed.jayrajBank.id, '2026-11-06'])).rejects.toThrow('row-level security');
    await run(jayraj, TICK, [paid.id, seed.jayrajBank.id, '2026-11-06']);
    expect(await run(jayraj, 'select cleared_on::text from money_rows')).toEqual([{ cleared_on: '2026-11-06' }]);
    expect(await run(ab, 'select * from bank_ticks')).toEqual([]);
  });
});

describe('a cheque returned', () => {
  it('puts the money back with the client’s due, as a receipt the other way round', async () => {
    await post(clientReceipt({ client: seed.client, to: seed.jayrajBank, amountPaise: 50_000_00, receiptDate: '2026-11-02' }));
    await post(otherMoney({ reason: 'client_back', account: seed.jayrajBank, amountPaise: 50_000_00, date: '2026-11-05', partyId: seed.svgClient, narration: 'cheque returned' }));
    expect(await balanceOf(db, 'client_receivable')).toBe(0);
    expect(await balanceOf(db, 'money')).toBe(0);
    expect((await db.query('select received_paise from client_totals')).rows).toEqual([{ received_paise: 0 }]);
  });
});

describe('counting cash', () => {
  const count = (user: string, account: string, date: string, counted: number, id = crypto.randomUUID()) =>
    run(user, 'select app_count_cash($1, $2, $3, $4, $5) as r', [id, account, date, counted, 'evening']).then((r) => r[0]!.r as { expected: number; difference: number });

  it('compares with the books at the end of that day, not today, and records a difference once', async () => {
    const cash = seed.ownerCash;
    await post(openingMoneyBalance({ account: cash, amountPaise: 1_000_00, asOf: '2026-11-01' }));
    await post(vendorPayment({ billFirmId: seed.jayraj, vendorId: seed.ansari, from: cash, amountPaise: 300_00, paymentDate: '2026-11-10' }));
    expect(await count(owner, cash.id, '2026-11-05', 1_000_00)).toEqual({ expected: 1_000_00, difference: 0 });
    const id = crypto.randomUUID();
    expect(await count(owner, cash.id, '2026-11-10', 690_00, id)).toEqual({ expected: 700_00, difference: -10_00 });
    // The same count sent twice is one count.
    await count(owner, cash.id, '2026-11-10', 690_00, id);
    expect(await balanceOf(db, 'money', { money_account_id: cash.id })).toBe(690_00);
    expect(await balanceOf(db, 'cash_short_excess', { firm_id: seed.jayraj })).toBe(10_00);
    expect((await db.query(`select count(*)::int as n from cash_counts`)).rows).toEqual([{ n: 2 }]);
    expect((await db.query('select sum(total_paise)::int as n from firm_proof')).rows).toEqual([{ n: 0 }]);
    await expect(db.query('update cash_counts set counted_paise = 1')).rejects.toThrow('append-only');
  });

  it('is done by whoever holds the cash or keeps the firm, on a day that is not locked', async () => {
    const ramesh = await createUser(db, 'supervisor', 'Ramesh');
    const ab = await createUser(db, 'office', 'Amit', { firms: [seed.ab] });
    await db.query('update money_accounts set holder_user_id = $1 where id = $2', [ramesh, seed.rameshCash.id]);
    expect(await count(ramesh, seed.rameshCash.id, '2026-11-05', 50_00)).toEqual({ expected: 0, difference: 50_00 });
    await expect(count(ramesh, seed.ownerCash.id, '2026-11-05', 1)).rejects.toThrow('cannot count');
    await expect(count(ab, seed.ownerCash.id, '2026-11-05', 1)).rejects.toThrow('cannot count');
    await expect(count(owner, seed.jayrajBank.id, '2026-11-05', 1)).rejects.toThrow('only a cash account');
    await lockBooks(db, '2026-11-30', OWNER);
    await expect(count(owner, seed.ownerCash.id, '2026-11-05', 1)).rejects.toThrow('locked');
  });
});

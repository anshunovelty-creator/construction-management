import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { percentOf } from '@/lib/money';
import { cashCloseDifference, cashTransfer, siteCashExpense } from '@/lib/ledger/posting/cash';
import { clientBill, clientReceipt } from '@/lib/ledger/posting/client';
import { openingMoneyBalance, openingVendorBalance } from '@/lib/ledger/posting/opening';
import { vendorBill, vendorPayment } from '@/lib/ledger/posting/vendor';
import { postEntry } from '@/lib/ledger/repo';
import { balanceOf, createMigratedDb, OFFICE, seedBasics, SUPERVISOR, type Seed } from './harness';

let db: PGlite;
let seed: Seed;

/**
 * One realistic stretch of business, posted through the real posting rules into the real schema.
 * Figures follow the spec's worked examples and the SVG site report.
 */
beforeAll(async () => {
  db = await createMigratedDb();
  seed = await seedBasics(db);
  const s = seed;

  const drafts = [
    openingVendorBalance({ firmId: s.jayraj, vendorId: s.ansari, amountPaise: 133_019_300, asOf: '2026-10-21' }),
    openingVendorBalance({ firmId: s.ab, vendorId: s.ansari, amountPaise: 85_000_000, asOf: '2026-10-21' }),
    openingMoneyBalance({ account: s.jayrajBank, amountPaise: 62_000_000, asOf: '2026-10-21' }),
    openingMoneyBalance({ account: s.ownerCash, amountPaise: 3_000_000, asOf: '2026-10-21' }),
    // AB Infra buys ₹5,00,000 of bricks for the SVG site.
    vendorBill({
      firmId: s.ab, vendorId: s.ansari, siteId: s.svgSite, billDate: '2026-10-22', billNo: 'BR-101',
      items: [{ costHead: 'material', amountPaise: 50_000_000 }],
    }),
    // Jayraj's bank pays ₹2,00,000 towards that AB Infra bill.
    vendorPayment({
      billFirmId: s.ab, vendorId: s.ansari, from: s.jayrajBank, amountPaise: 20_000_000,
      paymentDate: '2026-10-22', reference: 'UTR-778',
    }),
    // Owner gives Ramesh ₹20,000; Ramesh pays the day's labour; counts ₹240 short at close.
    cashTransfer({ from: s.ownerCash, to: s.rameshCash, amountPaise: 2_000_000, transferDate: '2026-10-22' }),
    siteCashExpense({
      from: s.rameshCash, siteId: s.svgSite, costHead: 'labour', amountPaise: 1_106_000,
      expenseDate: '2026-10-22', narration: 'Labour 22-10 (26 workers)',
    }),
    cashCloseDifference({ account: s.rameshCash, expectedPaise: 894_000, countedPaise: 870_000, closeDate: '2026-10-22' }),
    // RA-1 to the SVG client: ₹10,00,000 gross, TDS 1% and retention 5% from the work order.
    clientBill({
      workOrder: s.workOrder, billDate: '2026-10-31', billNo: 'RA-1', grossPaise: 100_000_000,
      deductions: { tdsPaise: percentOf(100_000_000, 100), retentionPaise: percentOf(100_000_000, 500) },
    }),
    clientReceipt({ workOrder: s.workOrder, to: s.jayrajBank, amountPaise: 94_000_000, receiptDate: '2026-11-15', reference: 'UTR-9001' }),
  ];
  for (const draft of drafts) {
    await postEntry(db, draft, draft.entryType === 'site_cash_expense' ? SUPERVISOR : OFFICE);
  }
});

describe('a realistic sequence of postings', () => {
  it('keeps the whole ledger balanced', async () => {
    const { rows } = await db.query<{ total: number; entries: number }>(
      'select coalesce(sum(amount_paise), 0)::bigint as total, count(distinct entry_id)::int as entries from entry_lines',
    );
    expect(rows[0]).toEqual({ total: 0, entries: 11 });
  });

  it("tracks what each firm owes the shared vendor separately", async () => {
    expect(await balanceOf(db, 'vendor_payable', { firm_id: seed.jayraj, party_id: seed.ansari })).toBe(-133_019_300);
    // AB: −8,50,000 opening − 5,00,000 bill + 2,00,000 paid by Jayraj = −11,50,000
    expect(await balanceOf(db, 'vendor_payable', { firm_id: seed.ab, party_id: seed.ansari })).toBe(-115_000_000);
  });

  it('records that AB Infra owes Jayraj Infra the ₹2,00,000 Jayraj paid', async () => {
    expect(await balanceOf(db, 'inter_firm', { firm_id: seed.jayraj, counter_firm_id: seed.ab })).toBe(20_000_000);
    expect(await balanceOf(db, 'inter_firm', { firm_id: seed.ab, counter_firm_id: seed.jayraj })).toBe(-20_000_000);
  });

  it("puts every firm's cost into the SVG site and gives site profit = billed − costs", async () => {
    const cost = await balanceOf(db, 'site_cost', { site_id: seed.svgSite });
    const income = -(await balanceOf(db, 'contract_income', { site_id: seed.svgSite }));
    expect(cost).toBe(51_106_000); // ₹5,00,000 bricks + ₹11,060 labour
    expect(income - cost).toBe(48_894_000); // ₹4,88,940
  });

  it('tracks bank and supervisor cash exactly', async () => {
    // ₹6,20,000 − ₹2,00,000 + ₹9,40,000
    expect(await balanceOf(db, 'money', { money_account_id: seed.jayrajBank.id })).toBe(136_000_000);
    // ₹20,000 − ₹11,060 − ₹240 short
    expect(await balanceOf(db, 'money', { money_account_id: seed.rameshCash.id })).toBe(870_000);
    expect(await balanceOf(db, 'cash_short_excess')).toBe(24_000);
  });

  it('shows the client has paid the bill, with TDS and retention still ours', async () => {
    const wo = { work_order_id: seed.workOrder.id };
    expect(await balanceOf(db, 'client_receivable', wo)).toBe(0);
    expect(await balanceOf(db, 'tds_claimable', wo)).toBe(1_000_000);
    expect(await balanceOf(db, 'retention_held', wo)).toBe(5_000_000);
  });

  it('starts every entry as unverified', async () => {
    const { rows } = await db.query<{ status: string; n: number }>(
      'select status, count(*)::int as n from entry_status group by status',
    );
    expect(rows).toEqual([{ status: 'unverified', n: 11 }]);
  });
});

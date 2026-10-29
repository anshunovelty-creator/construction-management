import { describe, expect, it } from 'vitest';
import { clientBill, clientReceipt } from '@/lib/ledger/posting/client';
import { AB, AB_BANK, CLIENT, JI, JI_BANK, SVG, WO } from './fixtures';

describe('clientBill', () => {
  it('books gross income, TDS and retention as ours, and the net as receivable (spec example)', () => {
    const draft = clientBill({
      workOrder: WO,
      billDate: '2026-10-31',
      billNo: 'RA-1',
      grossPaise: 100_000_000,
      deductions: { tdsPaise: 1_000_000, retentionPaise: 5_000_000 },
    });
    const dims = { firmId: JI, partyId: CLIENT, siteId: SVG, workOrderId: WO.id };
    expect(draft).toMatchObject({ entryType: 'client_bill', firmId: JI, partyId: CLIENT, reference: 'RA-1' });
    expect(draft.lines).toEqual([
      { account: 'client_receivable', amountPaise: 94_000_000, ...dims },
      { account: 'tds_claimable', amountPaise: 1_000_000, ...dims },
      { account: 'retention_held', amountPaise: 5_000_000, ...dims },
      { account: 'contract_income', amountPaise: -100_000_000, ...dims },
    ]);
  });

  it('treats material recovery and penalties as site costs', () => {
    const draft = clientBill({
      workOrder: WO,
      billDate: '2026-10-31',
      billNo: 'RA-2',
      grossPaise: 1_000_000,
      deductions: { materialRecoveryPaise: 200_000, otherPaise: 50_000 },
    });
    expect(draft.lines.filter((l) => l.account === 'site_cost').map((l) => [l.costHead, l.amountPaise])).toEqual([
      ['material', 200_000],
      ['other', 50_000],
    ]);
    expect(draft.lines[0]).toMatchObject({ account: 'client_receivable', amountPaise: 750_000 });
  });

  it('refuses deductions larger than the gross amount', () => {
    expect(() =>
      clientBill({ workOrder: WO, billDate: '2026-10-31', billNo: 'RA-3', grossPaise: 100, deductions: { tdsPaise: 101 } }),
    ).toThrow('deductions are more than the bill amount');
  });
});

describe('clientReceipt', () => {
  it('reduces what the client owes', () => {
    const draft = clientReceipt({
      workOrder: WO, to: JI_BANK, amountPaise: 94_000_000, receiptDate: '2026-11-15', reference: 'UTR5',
    });
    expect(draft.lines).toHaveLength(2);
    expect(draft.lines[1]).toMatchObject({ account: 'client_receivable', amountPaise: -94_000_000 });
  });

  it('refuses a receipt into another firm’s account: firms are independent', () => {
    expect(() => clientReceipt({ workOrder: WO, to: AB_BANK, amountPaise: 500, receiptDate: '2026-11-15', reference: 'UTR6' })).toThrow('own bank or cash');
  });

  it('requires a UTR or cheque number for bank receipts', () => {
    expect(() => clientReceipt({ workOrder: WO, to: JI_BANK, amountPaise: 1, receiptDate: '2026-11-15' })).toThrow(
      'UTR or cheque number is required',
    );
  });
});

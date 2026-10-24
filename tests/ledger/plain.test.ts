import { describe as group, expect, it } from 'vitest';
import { describeAll, describeChanges, type LineRow } from '@/lib/ledger/plain';

const t = (key: string, values: Record<string, string> = {}) =>
  `${key.replace('plain.', '')}(${Object.values(values).join(',')})`;
const names = {
  firms: new Map([['a', 'Firm A'], ['b', 'Firm B']]),
  parties: new Map([['v1', 'Vendor 1']]),
  sites: new Map([['s1', 'Site 1']]),
  accounts: new Map([['bankA', 'Firm A bank']]),
};
const line = (account: LineRow['account'], amount: number, dims: Partial<LineRow> = {}): LineRow => ({
  account, amount_paise: amount, firm_id: null, counter_firm_id: null, money_account_id: null,
  party_id: null, site_id: null, cost_head: null, ...dims,
});
// Firm A's bank pays Firm B's vendor: B now owes A.
const aLends = (amount: number) => [
  line('inter_firm', amount, { firm_id: 'a', counter_firm_id: 'b' }),
  line('inter_firm', -amount, { firm_id: 'b', counter_firm_id: 'a' }),
];

group('plain words', () => {
  it('shows what we owe as a plus and counts a due between firms once', () => {
    const rows = [line('vendor_payable', -40_000, { firm_id: 'a', party_id: 'v1' }), ...aLends(50_000)];
    expect(describeAll(rows, names, t).map((p) => [p.label, p.shown])).toEqual([
      ['interFirm(Firm B,Firm A)', 50_000],
      ['vendorPayable(Firm A,Vendor 1)', 40_000],
    ]);
  });

  it('calls money paid to a vendor before the bill an advance owed back to us', () => {
    const [advance] = describeAll([line('vendor_payable', 20_000, { firm_id: 'a', party_id: 'v1' })], names, t);
    expect([advance!.group, advance!.label, advance!.shown]).toEqual(['owedToUs', 'vendorAdvance(Firm A,Vendor 1)', 20_000]);
  });

  it('names the firm that owes, so a repayment reads as the due going down', () => {
    const repay = aLends(-50_000);
    const [change] = describeChanges(repay, aLends(20_000), names, t);
    expect([change!.label, change!.shown]).toEqual(['interFirm(Firm B,Firm A)', -50_000]);
    // Paid back in full: the due is now zero, and it still reads as B's due going down.
    const [settled] = describeChanges(repay, [], names, t);
    expect([settled!.label, settled!.shown]).toEqual(['interFirm(Firm B,Firm A)', -50_000]);
  });

  it('reads the same whichever firm sorts first', () => {
    // Firm ids are random, so the counted side may be the owing firm's. Here id 'a' is Firm B.
    const swapped = { ...names, firms: new Map([['a', 'Firm B'], ['b', 'Firm A']]) };
    // Firm A ('b') lends: Firm B ('a') stores a minus.
    const [lent] = describeChanges(aLends(-50_000), aLends(-50_000), swapped, t);
    expect([lent!.label, lent!.shown]).toEqual(['interFirm(Firm B,Firm A)', 50_000]);
    const [repaid] = describeChanges(aLends(50_000), [], swapped, t);
    expect([repaid!.label, repaid!.shown]).toEqual(['interFirm(Firm B,Firm A)', -50_000]);
  });
});

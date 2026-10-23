import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  cellToPaise,
  checkVendorTotals,
  extractVendorOpenings,
  openingDraft,
  openingEntryId,
  readReviewSheet,
  writeReviewSheet,
  type OpeningRow,
} from '@/lib/openings/openings';

/** A workbook in the layout the spec describes: one sheet per vendor, an opening amount, an empty payment table. */
function outstandingWorkbook(vendors: [string, number][]): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  for (const [name, amount] of vendors) {
    const sheet = workbook.addWorksheet(name);
    sheet.addRow([name]);
    sheet.addRow(['Statement date', '21-10-2026']);
    sheet.addRow(['Opening outstanding', amount]);
    sheet.addRow([]);
    sheet.addRow(['Date', 'Payment', 'Mode', 'Balance']);
  }
  return workbook;
}

const row = (overrides: Partial<OpeningRow>): OpeningRow => ({
  line: 2, kind: 'vendor', firm: 'JI', name: 'Ansari Enterprise', source: 'Ansari Enterprise', amountPaise: 100, ...overrides,
});

describe('cellToPaise', () => {
  it('accepts exact rupee amounts from numbers, formulas and text', () => {
    expect(cellToPaise(1330193)).toBe(133_019_300);
    expect(cellToPaise(53118.72)).toBe(5_311_872);
    expect(cellToPaise({ formula: 'A1+A2', result: 0.1 + 0.2 })).toBe(30);
    expect(cellToPaise('61,99,578')).toBe(619_957_800);
  });

  it('refuses fractions of a paisa and empty cells', () => {
    expect(() => cellToPaise(12.345)).toThrow('not an exact rupee amount');
    expect(() => cellToPaise(null)).toThrow('expected an amount');
  });
});

describe('extractVendorOpenings', () => {
  it('reads one opening amount per vendor sheet and reports sheets it could not read', () => {
    const workbook = outstandingWorkbook([['Ansari Enterprise', 1330193], ['Briks SVG Site', 250000.5]]);
    workbook.addWorksheet('Notes').addRow(['nothing here']);
    expect(extractVendorOpenings(workbook)).toEqual({
      openings: [
        { sourceName: 'Ansari Enterprise', amountPaise: 133_019_300 },
        { sourceName: 'Briks SVG Site', amountPaise: 25_000_050 },
      ],
      skippedSheets: ['Notes'],
    });
  });
});

describe('the review sheet', () => {
  it('round-trips rows and reads back what the owner edited', async () => {
    const workbook = new ExcelJS.Workbook();
    writeReviewSheet(workbook, [
      { kind: 'vendor', firm: 'JI', name: 'Briks SVG Site', source: 'Briks SVG Site', amountPaise: 25_000_050 },
    ]);
    const sheet = workbook.getWorksheet('openings')!;
    sheet.getCell('C2').value = 'Shree Bricks'; // the owner cleans the name
    sheet.addRow(['money', '', 'Owner cash', '', 30000]);
    const reread = new ExcelJS.Workbook();
    await reread.xlsx.load(await workbook.xlsx.writeBuffer());
    expect(readReviewSheet(reread)).toEqual([
      { line: 2, kind: 'vendor', firm: 'JI', name: 'Shree Bricks', source: 'Briks SVG Site', amountPaise: 25_000_050 },
      { line: 3, kind: 'money', firm: '', name: 'Owner cash', source: '', amountPaise: 3_000_000 },
    ]);
  });

  it('lists every bad row instead of importing part of the file', () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('openings');
    sheet.addRow(['kind', 'firm', 'name', 'source', 'amount']);
    sheet.addRow(['vendr', 'JI', 'A', '', 1]);
    sheet.addRow(['vendor', '', 'B', '', 1]);
    sheet.addRow(['vendor', 'JI', 'C', '', 0]);
    expect(() => readReviewSheet(workbook)).toThrow(
      /row 2: kind must be vendor, money, client\nrow 3: firm code is required\nrow 4: amount cannot be zero/,
    );
  });
});

describe('checkVendorTotals', () => {
  it('passes only when each firm matches its statement total exactly', () => {
    const expected = { JI: 300, AB: 50 };
    expect(() => checkVendorTotals([row({ amountPaise: 100 }), row({ amountPaise: 200 }), row({ firm: 'AB', amountPaise: 50 })], expected)).not.toThrow();
    expect(() => checkVendorTotals([row({ amountPaise: 299 })], expected)).toThrow(
      'firm JI: vendor rows add up to ₹2.99, statements say ₹3.00',
    );
    expect(() => checkVendorTotals([row({ firm: 'XX' })], expected)).toThrow('no expected vendor total for firm XX');
  });

  it('matches the real statement totals from the spec', () => {
    expect(() => checkVendorTotals([row({ amountPaise: 619_957_800 }), row({ firm: 'AB', amountPaise: 167_160_600 })])).not.toThrow();
  });
});

describe('opening entries', () => {
  it('give the same row the same id every time, ignoring name case', () => {
    expect(openingEntryId(row({}))).toBe(openingEntryId(row({ name: 'ANSARI ENTERPRISE', line: 9 })));
    expect(openingEntryId(row({}))).not.toBe(openingEntryId(row({ firm: 'AB' })));
    expect(openingEntryId(row({}))).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('post vendor openings on the statement date, keeping the original name as the reference', () => {
    const draft = openingDraft(row({ name: 'Shree Bricks', source: 'Briks SVG Site', amountPaise: 500 }), {
      kind: 'vendor', firmId: 'firm-ji', vendorId: 'party-1',
    });
    expect(draft).toMatchObject({ entryType: 'opening', entryDate: '2026-10-21', reference: 'Briks SVG Site' });
    expect(draft.lines).toEqual([
      { account: 'opening_balance', amountPaise: 500 },
      { account: 'vendor_payable', amountPaise: -500, firmId: 'firm-ji', partyId: 'party-1' },
    ]);
  });
});

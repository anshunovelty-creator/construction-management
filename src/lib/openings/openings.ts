import { createHash } from 'node:crypto';
import type { CellValue, Workbook } from 'exceljs';
import { openingClientBalance, openingMoneyBalance, openingVendorBalance } from '@/lib/ledger/posting/opening';
import type { ClientRef, EntryDraft, MoneyAccountRef } from '@/lib/ledger/types';
import { formatPaise, rupeesToPaise, type Paise } from '@/lib/money';

/** The date of the vendor statements in the two outstanding workbooks (spec section 8). */
export const OPENING_DATE = '2026-10-21';

/** Vendor totals the import must match exactly, per firm code (spec section 14). */
export const EXPECTED_VENDOR_TOTALS: Record<string, Paise> = {
  JI: 619_957_800, // Jayraj Infra ₹61,99,578
  AB: 167_160_600, // A B Infra ₹16,71,606
};

export const OPENING_KINDS = ['vendor', 'money', 'client'] as const;
export type OpeningKind = (typeof OPENING_KINDS)[number];

/**
 * One reviewed opening balance. `name` is the cleaned vendor name, the money account name,
 * or the work order ref. `source` is the original name in the workbook, kept for reference.
 * Positive amount: we owe the vendor / money we hold / the client owes us.
 */
export interface OpeningRow {
  line: number;
  kind: OpeningKind;
  firm: string;
  name: string;
  source: string;
  amountPaise: Paise;
}

export const REVIEW_SHEET = 'openings';
const REVIEW_COLUMNS = ['kind', 'firm', 'name', 'source', 'amount'] as const;

/** Excel cells hold floats; accept them only when they are a whole number of paise. */
export function cellToPaise(value: CellValue): Paise {
  const raw = value !== null && typeof value === 'object' && 'result' in value ? value.result : value;
  if (typeof raw === 'number') {
    const paise = Math.round(raw * 100);
    if (!Number.isSafeInteger(paise) || Math.abs(raw * 100 - paise) > 1e-6) {
      throw new Error(`${raw} is not an exact rupee amount`);
    }
    return paise;
  }
  if (typeof raw === 'string') {
    return rupeesToPaise(raw);
  }
  throw new Error(`expected an amount, got ${JSON.stringify(raw)}`);
}

const cellText = (value: CellValue): string =>
  value === null || value === undefined ? '' : typeof value === 'object' && 'richText' in value
    ? value.richText.map((part) => part.text).join('')
    : String(value);

/**
 * Reads vendor opening balances from an outstanding workbook.
 * Layout assumed from the spec: one worksheet per vendor, named after the vendor, with the
 * opening amount in the first numeric cell to the right of a cell saying "opening" or "outstanding".
 * Check this against the real files first (Task 9, Step 1) and adjust here if they differ.
 */
export function extractVendorOpenings(workbook: Workbook): {
  openings: { sourceName: string; amountPaise: Paise }[];
  skippedSheets: string[];
} {
  const openings: { sourceName: string; amountPaise: Paise }[] = [];
  const skippedSheets: string[] = [];
  for (const sheet of workbook.worksheets) {
    let amountPaise: Paise | undefined;
    sheet.eachRow((row) => {
      if (amountPaise !== undefined) return;
      const cells = Array.isArray(row.values) ? row.values : [];
      const labelAt = cells.findIndex((v) => /opening|outstanding/i.test(cellText(v ?? null)));
      if (labelAt < 0) return;
      const amount = cells.slice(labelAt + 1).find((v) => {
        const raw = v !== null && typeof v === 'object' && 'result' in v ? v.result : v;
        return typeof raw === 'number';
      });
      if (amount !== undefined) amountPaise = cellToPaise(amount);
    });
    if (amountPaise === undefined) skippedSheets.push(sheet.name);
    else openings.push({ sourceName: sheet.name.trim(), amountPaise });
  }
  return { openings, skippedSheets };
}

/** Writes rows to the sheet the owner reviews (and cleans vendor names in) before importing. */
export function writeReviewSheet(workbook: Workbook, rows: Omit<OpeningRow, 'line'>[]): void {
  const sheet = workbook.addWorksheet(REVIEW_SHEET);
  sheet.addRow([...REVIEW_COLUMNS]);
  for (const row of rows) {
    sheet.addRow([row.kind, row.firm, row.name, row.source, row.amountPaise / 100]);
  }
}

/** Reads the reviewed sheet. Throws listing every bad row, so nothing is half-imported. */
export function readReviewSheet(workbook: Workbook): OpeningRow[] {
  const sheet = workbook.getWorksheet(REVIEW_SHEET);
  if (!sheet) {
    throw new Error(`no "${REVIEW_SHEET}" sheet in this workbook`);
  }
  const header = REVIEW_COLUMNS.map((_, i) => cellText(sheet.getRow(1).getCell(i + 1).value).trim().toLowerCase());
  if (header.join(',') !== REVIEW_COLUMNS.join(',')) {
    throw new Error(`the first row must be: ${REVIEW_COLUMNS.join(', ')}`);
  }
  const rows: OpeningRow[] = [];
  const problems: string[] = [];
  sheet.eachRow((row, line) => {
    if (line === 1) return;
    const [kind, firm, name, source] = [1, 2, 3, 4].map((col) => cellText(row.getCell(col).value).trim());
    if (!kind && !name) return; // blank line
    try {
      if (!(OPENING_KINDS as readonly string[]).includes(kind!)) throw new Error(`kind must be ${OPENING_KINDS.join(', ')}`);
      if (!name) throw new Error('name is required');
      if (kind !== 'money' && !firm) throw new Error('firm code is required');
      const amountPaise = cellToPaise(row.getCell(5).value);
      if (amountPaise === 0) throw new Error('amount cannot be zero');
      rows.push({ line, kind: kind as OpeningKind, firm: firm!.toUpperCase(), name: name!, source: source!, amountPaise });
    } catch (error) {
      problems.push(`row ${line}: ${(error as Error).message}`);
    }
  });
  if (problems.length > 0) {
    throw new Error(`fix these rows and run again:\n${problems.join('\n')}`);
  }
  return rows;
}

/** Vendor rows must add up exactly to the statement totals before anything is posted. */
export function checkVendorTotals(rows: OpeningRow[], expected: Record<string, Paise> = EXPECTED_VENDOR_TOTALS): void {
  const totals = new Map<string, Paise>();
  for (const row of rows.filter((r) => r.kind === 'vendor')) {
    totals.set(row.firm, (totals.get(row.firm) ?? 0) + row.amountPaise);
  }
  const problems: string[] = [];
  for (const [firm, total] of totals) {
    if (!(firm in expected)) problems.push(`no expected vendor total for firm ${firm}`);
    else if (total !== expected[firm]) {
      problems.push(`firm ${firm}: vendor rows add up to ${formatPaise(total)}, statements say ${formatPaise(expected[firm]!)}`);
    }
  }
  if (problems.length > 0) {
    throw new Error(problems.join('\n'));
  }
}

/** The same row always gets the same entry id, so running the import twice posts nothing twice. */
export function openingEntryId(row: Pick<OpeningRow, 'kind' | 'firm' | 'name'>): string {
  const h = createHash('sha256').update(`opening|${row.kind}|${row.firm}|${row.name.toLowerCase()}`).digest('hex');
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export type OpeningRefs =
  | { kind: 'vendor'; firmId: string; vendorId: string }
  | { kind: 'money'; account: MoneyAccountRef }
  | { kind: 'client'; client: ClientRef };

export function openingDraft(row: OpeningRow, refs: OpeningRefs): EntryDraft {
  const id = openingEntryId(row);
  switch (refs.kind) {
    case 'vendor':
      return openingVendorBalance({
        id, firmId: refs.firmId, vendorId: refs.vendorId, amountPaise: row.amountPaise, asOf: OPENING_DATE,
        reference: row.source === row.name ? '' : row.source,
      });
    case 'money':
      return openingMoneyBalance({ id, account: refs.account, amountPaise: row.amountPaise, asOf: OPENING_DATE });
    case 'client':
      return openingClientBalance({ id, client: refs.client, amountPaise: row.amountPaise, asOf: OPENING_DATE });
  }
}

// Posts reviewed opening balances to Supabase. Safe to run again: each row has a fixed entry id.
import ExcelJS from 'exceljs';
import type { MoneyAccountRef, WorkOrderRef } from '@/lib/ledger/types';
import { formatPaise } from '@/lib/money';
import {
  checkVendorTotals,
  EXPECTED_VENDOR_TOTALS,
  openingDraft,
  readReviewSheet,
  type OpeningRefs,
  type OpeningRow,
} from '@/lib/openings/openings';
import { createAdminClient } from '@/lib/supabase/admin';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: npm run openings:import -- data/private/openings-JI.xlsx [more files]');
  process.exit(1);
}

const rows: OpeningRow[] = [];
for (const file of files) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  rows.push(...readReviewSheet(workbook));
}
checkVendorTotals(rows); // nothing is written unless every firm's vendor rows match the statements

const db = createAdminClient();
const must = <T>(result: { data: T; error: { message: string } | null }, what: string): NonNullable<T> => {
  if (result.error || result.data === null || result.data === undefined) {
    throw new Error(`${what}: ${result.error?.message ?? 'not found'}`);
  }
  return result.data;
};

const owner = must(
  await db.from('profiles').select('user_id').eq('role', 'owner').eq('is_active', true).limit(1).maybeSingle(),
  'an active owner account (run npm run create-owner first)',
);
const firms = new Map(must(await db.from('firms').select('id, code'), 'firms').map((f) => [f.code as string, f.id as string]));

// Resolve every row first, so a typo stops the import before anything is posted.
const resolved: { row: OpeningRow; refs: OpeningRefs }[] = [];
for (const row of rows) {
  const where = `row ${row.line} (${row.name})`;
  const firmId = row.firm ? firms.get(row.firm) : undefined;
  if (row.firm && !firmId) throw new Error(`${where}: no firm with code ${row.firm}; add it under Masters → Firms`);
  if (row.kind === 'vendor') {
    const existing = await db.from('parties').select('id').eq('kind', 'vendor').eq('name', row.name).maybeSingle();
    const vendorId =
      (existing.data?.id as string | undefined) ??
      (must(await db.from('parties').insert({ kind: 'vendor', name: row.name }).select('id').single(), `${where}: add vendor`)
        .id as string);
    resolved.push({ row, refs: { kind: 'vendor', firmId: firmId!, vendorId } });
  } else if (row.kind === 'money') {
    const a = must(
      await db.from('money_accounts').select('id, kind, firm_id').eq('name', row.name).maybeSingle(),
      `${where}: no money account with this name; add it under Masters → Bank and cash accounts`,
    );
    const account: MoneyAccountRef = { id: a.id, kind: a.kind, firmId: a.firm_id };
    resolved.push({ row, refs: { kind: 'money', account } });
  } else {
    const w = must(
      await db.from('work_orders').select('id, firm_id, client_id, site_id').eq('firm_id', firmId!).eq('ref', row.name).maybeSingle(),
      `${where}: no work order with this number for firm ${row.firm}`,
    );
    const workOrder: WorkOrderRef = { id: w.id, firmId: w.firm_id, clientId: w.client_id, siteId: w.site_id };
    resolved.push({ row, refs: { kind: 'client', workOrder } });
  }
}

let posted = 0;
let already = 0;
const entryIds: string[] = [];
for (const { row, refs } of resolved) {
  const result = must(
    await db.rpc('post_entry', { p_entry: openingDraft(row, refs), p_actor: owner.user_id }),
    `row ${row.line} (${row.name}): posting`,
  ) as { id: string; serial: string; duplicate: boolean };
  entryIds.push(result.id);
  if (result.duplicate) already++;
  else posted++;
}
console.log(`Posted ${posted} opening entries; ${already} were already posted.`);

// Reconcile from what the database now holds, not from the file.
const lines = must(
  await db.from('entry_lines').select('firm_id, amount_paise').eq('account', 'vendor_payable').in('entry_id', entryIds),
  'reconciliation',
);
for (const [code, expected] of Object.entries(EXPECTED_VENDOR_TOTALS)) {
  const firmId = firms.get(code);
  if (!rows.some((r) => r.kind === 'vendor' && r.firm === code)) continue;
  const owed = -lines.filter((l) => l.firm_id === firmId).reduce((sum, l) => sum + Number(l.amount_paise), 0);
  const ok = owed === expected;
  console.log(`${code}: owed to vendors ${formatPaise(owed)}, statements ${formatPaise(expected)} ${ok ? 'OK' : 'MISMATCH'}`);
  if (!ok) process.exitCode = 1;
}

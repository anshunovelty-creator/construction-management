// Reads one outstanding workbook and writes a review sheet to data/private/ for the owner to check.
import { existsSync, mkdirSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { formatPaise } from '@/lib/money';
import { EXPECTED_VENDOR_TOTALS, extractVendorOpenings, writeReviewSheet } from '@/lib/openings/openings';

const [file, firmArg] = process.argv.slice(2);
if (!file || !firmArg) {
  console.error('usage: npm run openings:extract -- <outstanding.xlsx> <firm code, e.g. JI>');
  process.exit(1);
}
const firm = firmArg.toUpperCase();
const target = `data/private/openings-${firm}.xlsx`;
if (existsSync(target)) {
  console.error(`${target} already exists and may hold your edits. Delete it first to extract again.`);
  process.exit(1);
}

const source = new ExcelJS.Workbook();
await source.xlsx.readFile(file);
const { openings, skippedSheets } = extractVendorOpenings(source);
const review = new ExcelJS.Workbook();
writeReviewSheet(
  review,
  openings.map((o) => ({ kind: 'vendor', firm, name: o.sourceName, source: o.sourceName, amountPaise: o.amountPaise })),
);
mkdirSync('data/private', { recursive: true });
await review.xlsx.writeFile(target);

const total = openings.reduce((sum, o) => sum + o.amountPaise, 0);
const expected = EXPECTED_VENDOR_TOTALS[firm];
console.log(`${openings.length} vendors, total ${formatPaise(total)}; statements say ${expected ? formatPaise(expected) : '(unknown firm code)'}.`);
if (skippedSheets.length > 0) console.log(`Sheets without an opening amount, check them: ${skippedSheets.join(', ')}`);
console.log(`Now open ${target}, clean the vendor names in the "name" column, add any money/client rows, then run:`);
console.log(`  npm run openings:import -- ${target}`);

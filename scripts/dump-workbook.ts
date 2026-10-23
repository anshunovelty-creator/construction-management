// Prints every sheet's non-empty cells, to check a workbook's real layout before extracting from it.
import ExcelJS from 'exceljs';

const file = process.argv[2];
if (!file) {
  console.error('usage: npm run openings:dump -- <workbook.xlsx>');
  process.exit(1);
}
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(file);
for (const sheet of workbook.worksheets) {
  console.log(`\n=== sheet "${sheet.name}" (${sheet.rowCount} rows)`);
  sheet.eachRow((row, number) => {
    if (number > 40) return;
    const cells: string[] = [];
    row.eachCell((cell) => cells.push(`${cell.address}=${JSON.stringify(cell.value)}`));
    console.log(cells.join('  '));
  });
}

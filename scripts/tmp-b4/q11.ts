import * as fs from "node:fs";
import * as ExcelJS from "exceljs";
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(fs.readFileSync("/tmp/b4-en.xlsx"));
for (const w of wb.worksheets) {
  const rows: unknown[][] = [];
  w.eachRow((r) => rows.push(r.values?.slice(1)));
  console.log(`[${w.name}]`);
  for (const r of rows) console.log("  ", JSON.stringify(r));
}

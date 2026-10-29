import * as fs from "node:fs";
import * as ExcelJS from "exceljs";
const wb = new ExcelJS.Workbook();
for (const f of ["/tmp/b4-id.xlsx"]) {
  await wb.xlsx.load(fs.readFileSync(f));
  console.log(f, "sheets:", wb.worksheets.map((w) => w.name).join(" | "));
  for (const w of wb.worksheets) {
    console.log(` [${w.name}]`, JSON.stringify(w.getRow(2).values?.slice(1)));
    console.log(`       `, JSON.stringify(w.getRow(3).values?.slice(1)));
  }
}

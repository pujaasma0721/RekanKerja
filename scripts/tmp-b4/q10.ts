import * as fs from "node:fs";
import * as ExcelJS from "exceljs";
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(fs.readFileSync("/tmp/b4-en.xlsx"));
console.log("EN sheets:", wb.worksheets.map((w) => w.name).join(" | "));
console.log("plan row2:", JSON.stringify(wb.worksheets[0].getRow(2).values?.slice(1)));
console.log("cand row2:", JSON.stringify(wb.worksheets[1].getRow(3).values?.slice(1)));

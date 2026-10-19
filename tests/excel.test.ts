import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { detectLayout, loadWorkbook, readRows } from "@/lib/excel";
import { isNumericSeal, patchColumn } from "@/lib/xlsx-patch";

const fixture = readFileSync(new URL("./fixtures/sample-base-sheet.xlsx", import.meta.url));

async function sheetXml(buf: Buffer) {
  return (await JSZip.loadAsync(buf)).file("xl/worksheets/sheet1.xml")!.async("string");
}

describe("excel", () => {
  it("finds the heading row and columns in the sample sheet", async () => {
    const layout = detectLayout(await loadWorkbook(fixture));
    expect(layout).toEqual({ sheetName: "Containers", headerRow: 4, containerCol: 2, sealCol: 6 });
  });

  it("reads all container rows", async () => {
    const wb = await loadWorkbook(fixture);
    const parsed = readRows(wb, detectLayout(wb)!);
    expect(parsed.rows).toHaveLength(10);
    expect(parsed.rows[0]).toEqual({ row: 5, container: "MRSU4985257", seal: null, otherSeals: [] });
    expect(parsed.otherSealCols).toEqual([]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings).toEqual([]);
  });

  it("reads seals in other seal columns, like Revised Seal", async () => {
    const wb = await loadWorkbook(fixture);
    const ws = wb.getWorksheet("Containers")!;
    ws.getCell("I4").value = "Revised Seal";
    ws.getCell("I6").value = 20260611;
    const parsed = readRows(wb, detectLayout(wb)!);
    expect(parsed.otherSealCols).toEqual([9]);
    expect(parsed.rows[1].otherSeals).toEqual(["20260611"]);
  });

  it("writes seals into the seal column and keeps other cells", async () => {
    const out = await patchColumn(fixture, "Containers", 6, [
      { row: 5, value: "20260977" },
      { row: 6, value: "0012345" },
      { row: 7, value: "AB-12" },
    ]);
    const ws = (await loadWorkbook(out)).getWorksheet("Containers")!;
    expect(ws.getCell("F5").value).toBe(20260977);
    expect(ws.getCell("F6").value).toBe("0012345");
    expect(ws.getCell("F7").value).toBe("AB-12");
    expect(ws.getCell("B5").value).toBe("MRSU4985257");
    expect(ws.getCell("F4").value).toBe("Seal No");
    expect(ws.getCell("B4").font?.bold).toBe(true);
    expect(ws.getCell("F8").value).toBe(null);
  });

  it("leaves every other part of the file untouched", async () => {
    const out = await patchColumn(fixture, "Containers", 6, [{ row: 5, value: "20260977" }]);
    const [a, b] = await Promise.all([JSZip.loadAsync(fixture), JSZip.loadAsync(out)]);
    expect(Object.keys(b.files).sort()).toEqual(Object.keys(a.files).sort());
    for (const name of Object.keys(a.files)) {
      if (name === "xl/worksheets/sheet1.xml" || name === "xl/workbook.xml" || a.files[name].dir) continue;
      expect(await b.file(name)!.async("string"), name).toBe(await a.file(name)!.async("string"));
    }
    expect(await b.file("xl/workbook.xml")!.async("string")).toContain('fullCalcOnLoad="1"');
  });

  it("adds a missing cell in column order and creates a missing row", async () => {
    const out = await patchColumn(fixture, "Containers", 6, [{ row: 40, value: "777777" }]);
    const xml = await sheetXml(out);
    expect(xml).toMatch(/<row r="40"><c r="F40"( s="\d+")?><v>777777<\/v><\/c><\/row>/);
    const ws = (await loadWorkbook(out)).getWorksheet("Containers")!;
    expect(ws.getCell("F40").value).toBe(777777);
  });

  it("stores plain digit seals as numbers only when nothing would be lost", () => {
    expect(isNumericSeal("20260977")).toBe(true);
    expect(isNumericSeal("0012345")).toBe(false);
    expect(isNumericSeal("1234567890123456")).toBe(false);
    expect(isNumericSeal("AB12")).toBe(false);
  });
});

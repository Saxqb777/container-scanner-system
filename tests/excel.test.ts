import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectLayout, fillWorkbook, loadWorkbook, readRows } from "@/lib/excel";

const fixture = readFileSync(new URL("./fixtures/sample-base-sheet.xlsx", import.meta.url));

describe("excel", () => {
  it("finds the heading row and columns in the sample sheet", async () => {
    const layout = detectLayout(await loadWorkbook(fixture));
    expect(layout).toEqual({ sheetName: "Containers", headerRow: 4, containerCol: 2, sealCol: 6 });
  });

  it("reads all container rows", async () => {
    const wb = await loadWorkbook(fixture);
    const parsed = readRows(wb, detectLayout(wb)!);
    expect(parsed.rows).toHaveLength(10);
    expect(parsed.rows[0]).toEqual({ row: 5, container: "MRSU4985257", seal: null });
    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings).toEqual([]);
  });

  it("writes seals into the seal column and keeps other cells", async () => {
    const wb = await loadWorkbook(fixture);
    const layout = detectLayout(wb)!;
    const out = await fillWorkbook(fixture, layout, [{ row: 5, seal: "20260977" }]);
    const ws = (await loadWorkbook(out)).getWorksheet("Containers")!;
    expect(ws.getCell("F5").value).toBe("20260977");
    expect(ws.getCell("B5").value).toBe("MRSU4985257");
    expect(ws.getCell("F4").value).toBe("Seal No");
    expect(ws.getCell("B4").font?.bold).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { evaluateSets, type SheetEntry } from "@/lib/validate";

const sheet: SheetEntry[] = [
  { row_number: 5, container_no: "MRSU4985257", seal_no: null },
  { row_number: 6, container_no: "TCLU9276404", seal_no: "20260978" },
  { row_number: 7, container_no: "MSKU3395635", seal_no: null },
  { row_number: 8, container_no: "MSKU3395635", seal_no: null },
  { row_number: 9, container_no: "MAEU9939086", seal_no: null },
];

const one = (container: string, seal: string) => evaluateSets([{ id: "a", container, seal }], sheet)[0];

describe("evaluateSets", () => {
  it("marks a clean match ready with its row", () => {
    const r = one("MRSU 498525 7", "20260977");
    expect(r.status).toBe("ready");
    expect(r.row).toBe(5);
  });

  it("treats the same seal already recorded as done", () => {
    expect(one("TCLU9276404", "20260978").status).toBe("done");
  });

  it("never overwrites a different seal", () => {
    const r = one("TCLU9276404", "11111111");
    expect(r.status).toBe("error");
    expect(r.issues.join()).toMatch(/already filled with 20260978/);
  });

  it("blocks containers that are not in the sheet", () => {
    expect(one("MAEU9939086".replace("9939086", "1234565"), "123456").issues.join()).toMatch(/not found|Check digit/);
  });

  it("blocks containers listed twice", () => {
    expect(one("MSKU3395635", "555555").issues.join()).toMatch(/listed 2 times/);
  });

  it("blocks a seal already used on another container", () => {
    expect(one("MRSU4985257", "20260978").issues.join()).toMatch(/already used on TCLU9276404/);
  });

  it("blocks a bad check digit", () => {
    expect(one("MRSU4985258", "20260977").status).toBe("error");
  });

  it("blocks duplicates inside one batch", () => {
    const rs = evaluateSets(
      [
        { id: "a", container: "MRSU4985257", seal: "1000" },
        { id: "b", container: "MAEU9939086", seal: "1000" },
      ],
      sheet,
    );
    expect(rs.every((r) => r.status === "error")).toBe(true);
  });
});

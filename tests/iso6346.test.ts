import { describe, expect, it } from "vitest";
import { checkContainer, computeCheckDigit } from "@/lib/iso6346";

describe("ISO 6346 check digit", () => {
  it("accepts the numbers from the sample photos", () => {
    expect(checkContainer("MRSU 498525 7").ok).toBe(true);
    expect(checkContainer("tclu9276404").ok).toBe(true);
  });

  it("maps check value 10 to 0", () => {
    expect(computeCheckDigit("CSQU305438")).toBe(3);
    // Sum mod 11 is 10 here, which the standard writes as 0.
    expect(computeCheckDigit("MSKU000008")).toBe(0);
  });

  it("rejects a misread digit", () => {
    const r = checkContainer("MRSU4985258");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/should be 7/);
  });

  it("rejects bad formats", () => {
    expect(checkContainer("").ok).toBe(false);
    expect(checkContainer("MRS4985257").ok).toBe(false);
    expect(checkContainer("MRSX4985257").ok).toBe(false);
  });
});

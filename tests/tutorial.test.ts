import { describe, expect, it } from "vitest";
import { PRACTICE_SETS, practiceResults } from "@/lib/tutorial";

describe("tutorial practice round", () => {
  const results = practiceResults();

  it("marks the first practice set ready on its row", () => {
    expect(results["practice-1"]).toMatchObject({ status: "ready", row: 14, container: "MRSU4985257", seal: "20260977" });
    expect(results["practice-1"].issues).toEqual([]);
  });

  it("blocks the trap set with the real seal-already-used message", () => {
    const trap = results["practice-2"];
    expect(trap.status).toBe("error");
    expect(trap.issues).toEqual(["Seal already used on CSQU3054383 (row 9)"]);
  });

  it("gives the same answer when the first set is checked alone", () => {
    expect(practiceResults([PRACTICE_SETS[0]])["practice-1"].status).toBe("ready");
  });
});

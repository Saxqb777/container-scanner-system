import { checkContainer } from "./iso6346";
import { checkSeal } from "./seal";

export type SetInput = { id: string; container: string; seal: string };

export type SheetEntry = { row_number: number; container_no: string; seal_no: string | null };

export type SetStatus = "ready" | "done" | "error";

export type SetResult = {
  id: string;
  container: string;
  seal: string;
  status: SetStatus;
  row: number | null;
  issues: string[];
};

/**
 * Decides, for each set, whether its seal can be written. Nothing here writes;
 * the commit route runs this again and then writes with a guarded update.
 */
export function evaluateSets(sets: SetInput[], sheet: SheetEntry[]): SetResult[] {
  const byContainer = new Map<string, SheetEntry[]>();
  const bySeal = new Map<string, SheetEntry>();
  for (const entry of sheet) {
    byContainer.set(entry.container_no, [...(byContainer.get(entry.container_no) ?? []), entry]);
    if (entry.seal_no) bySeal.set(entry.seal_no, entry);
  }

  const checked = sets.map((s) => ({ input: s, container: checkContainer(s.container), seal: checkSeal(s.seal) }));

  const containerCount = new Map<string, number>();
  const sealCount = new Map<string, number>();
  for (const c of checked) {
    if (c.container.value) containerCount.set(c.container.value, (containerCount.get(c.container.value) ?? 0) + 1);
    if (c.seal.value) sealCount.set(c.seal.value, (sealCount.get(c.seal.value) ?? 0) + 1);
  }

  return checked.map(({ input, container, seal }) => {
    const issues: string[] = [];
    let row: number | null = null;
    let done = false;

    if (!container.ok) issues.push(container.reason);
    if (!seal.ok) issues.push(seal.reason);
    if (container.value && (containerCount.get(container.value) ?? 0) > 1) {
      issues.push("Same container appears in more than one set in this batch");
    }
    if (seal.value && (sealCount.get(seal.value) ?? 0) > 1) {
      issues.push("Same seal number appears in more than one set in this batch");
    }

    if (container.ok) {
      const matches = byContainer.get(container.value) ?? [];
      if (matches.length === 0) {
        issues.push("Container not found in the base sheet");
      } else if (matches.length > 1) {
        issues.push(`Container is listed ${matches.length} times in the sheet (rows ${matches.map((m) => m.row_number).join(", ")})`);
      } else {
        const match = matches[0];
        row = match.row_number;
        if (match.seal_no && seal.ok && match.seal_no === seal.value) {
          done = true;
        } else if (match.seal_no) {
          issues.push(`Seal already filled with ${match.seal_no}. Not overwritten.`);
        }
      }
    }

    if (seal.ok && !done) {
      const owner = bySeal.get(seal.value);
      if (owner && owner.container_no !== container.value) {
        issues.push(`Seal already used on ${owner.container_no} (row ${owner.row_number})`);
      }
    }

    const status: SetStatus = issues.length > 0 ? "error" : done ? "done" : "ready";
    return { id: input.id, container: container.value, seal: seal.value, status, row, issues };
  });
}

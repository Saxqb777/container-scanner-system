import { evaluateSets, type SetResult, type SheetEntry } from "./validate";

// Everything the tutorial's practice round needs. It runs the real validation
// against a made-up sheet in memory, so no API is called and nothing is written.

export const TUTORIAL_DONE_KEY = "sealRegister.tutorialDone";

export type PracticePhoto = { kind: "container" | "seal"; src: string; value: string; alt: string };

export type PracticeSet = { id: string; container: PracticePhoto; seal: PracticePhoto };

export const PRACTICE_SHEET: SheetEntry[] = [
  { row_number: 9, container_no: "CSQU3054383", seal_no: "20260412" },
  { row_number: 14, container_no: "MRSU4985257", seal_no: null },
  { row_number: 15, container_no: "TCLU9276404", seal_no: null },
];

export const PRACTICE_SETS: PracticeSet[] = [
  {
    id: "practice-1",
    container: { kind: "container", src: "/tutorial/container-mrsu.svg", value: "MRSU4985257", alt: "Container door marked MRSU 498525 7" },
    seal: { kind: "seal", src: "/tutorial/seal-20260977.svg", value: "20260977", alt: "Bolt seal marked 20260977" },
  },
  {
    id: "practice-2",
    container: { kind: "container", src: "/tutorial/container-tclu.svg", value: "TCLU9276404", alt: "Container door marked TCLU 927640 4" },
    seal: { kind: "seal", src: "/tutorial/seal-20260412.svg", value: "20260412", alt: "Bolt seal marked 20260412" },
  },
];

/** Results for the practice sets, checked together the way the real app checks a batch. */
export function practiceResults(sets: PracticeSet[] = PRACTICE_SETS): Record<string, SetResult> {
  const results = evaluateSets(
    sets.map((s) => ({ id: s.id, container: s.container.value, seal: s.seal.value })),
    PRACTICE_SHEET,
  );
  return Object.fromEntries(results.map((r) => [r.id, r]));
}

/** Reads the "seen the tour" flag. If storage is blocked we count it as seen so it never nags on every visit. */
export function tutorialDone(): boolean {
  try {
    return window.localStorage.getItem(TUTORIAL_DONE_KEY) === "1";
  } catch {
    return true;
  }
}

export function markTutorialDone() {
  try {
    window.localStorage.setItem(TUTORIAL_DONE_KEY, "1");
  } catch {
    // Storage is blocked; the tour can still be replayed with the ? button.
  }
}

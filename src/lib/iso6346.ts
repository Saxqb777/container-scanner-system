// ISO 6346 container numbers: 3-letter owner code, category letter (U/J/Z/R),
// 6-digit serial, 1 check digit. Example: MRSU 498525 7.

const LETTER_VALUES: Record<string, number> = (() => {
  // Values skip multiples of 11 (11, 22, 33).
  const map: Record<string, number> = {};
  let v = 10;
  for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    if (v % 11 === 0) v++;
    map[ch] = v++;
  }
  return map;
})();

export function normalizeContainer(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function computeCheckDigit(first10: string): number {
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = first10[i];
    const value = /[A-Z]/.test(ch) ? LETTER_VALUES[ch] : Number(ch);
    sum += value * 2 ** i;
  }
  return (sum % 11) % 10;
}

export type ContainerCheck =
  | { ok: true; value: string }
  | { ok: false; value: string; reason: string };

export function checkContainer(raw: string): ContainerCheck {
  const value = normalizeContainer(raw);
  if (!value) return { ok: false, value, reason: "Container number is empty" };
  if (!/^[A-Z]{3}[UJZR][0-9]{7}$/.test(value)) {
    return { ok: false, value, reason: "Not a valid container number format (e.g. MRSU4985257)" };
  }
  const expected = computeCheckDigit(value.slice(0, 10));
  if (expected !== Number(value[10])) {
    return {
      ok: false,
      value,
      reason: `Check digit is wrong (photo says ${value[10]}, should be ${expected}). Likely misread.`,
    };
  }
  return { ok: true, value };
}

export function formatContainer(value: string): string {
  return value.length === 11 ? `${value.slice(0, 4)} ${value.slice(4, 10)} ${value[10]}` : value;
}

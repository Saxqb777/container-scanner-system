export function normalizeSeal(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, "");
}

export function checkSeal(raw: string): { ok: true; value: string } | { ok: false; value: string; reason: string } {
  const value = normalizeSeal(raw);
  if (!value) return { ok: false, value, reason: "Seal number is empty" };
  if (!/^[A-Z0-9]{4,20}$/.test(value)) {
    return { ok: false, value, reason: "Seal number should be 4 to 20 letters or digits" };
  }
  return { ok: true, value };
}

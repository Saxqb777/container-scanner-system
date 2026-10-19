import { NextResponse } from "next/server";
import { getActiveWorkbook } from "@/lib/db";
import { loadSheetEntries } from "@/lib/sheet";
import { evaluateSets, type SetInput } from "@/lib/validate";
import { fail, serverError } from "@/lib/http";

export async function POST(req: Request) {
  const { sets } = (await req.json().catch(() => ({}))) as { sets?: SetInput[] };
  if (!Array.isArray(sets)) return fail("No sets sent");
  try {
    const workbook = await getActiveWorkbook();
    if (!workbook) return fail("Upload the base Excel sheet first");
    const results = evaluateSets(sets, await loadSheetEntries(workbook.id));
    return NextResponse.json({ results });
  } catch (err) {
    return serverError(err);
  }
}

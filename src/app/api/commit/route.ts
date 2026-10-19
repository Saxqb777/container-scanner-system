import { NextResponse } from "next/server";
import { getActiveWorkbook, isUniqueViolation, sql } from "@/lib/db";
import { loadSheetEntries } from "@/lib/sheet";
import { evaluateSets, type SetInput, type SetResult } from "@/lib/validate";
import { fail, serverError } from "@/lib/http";

type Written = SetResult & { written: boolean };

export async function POST(req: Request) {
  const { sets, workbookId } = (await req.json().catch(() => ({}))) as { sets?: SetInput[]; workbookId?: number };
  if (!Array.isArray(sets) || sets.length === 0) return fail("No sets sent");

  try {
    const workbook = await getActiveWorkbook();
    if (!workbook) return fail("Upload the base Excel sheet first");
    if (workbook.id !== workbookId) {
      return fail("The base sheet was replaced while you were working. Check the sets again.", 409);
    }

    // Re-check everything server side. The screen may be stale.
    const results = evaluateSets(sets, await loadSheetEntries(workbook.id));
    const out: Written[] = [];

    for (const r of results) {
      if (r.status !== "ready") {
        out.push({ ...r, written: false });
        continue;
      }
      try {
        // Only writes when exactly one row has this container and its seal is still empty.
        const rows = (await sql()`
          with target as (
            select id from containers where workbook_id = ${workbook.id} and container_no = ${r.container}
          ),
          upd as (
            update containers set seal_no = ${r.seal}, sealed_at = now()
            where id = (select id from target) and seal_no is null and (select count(*) from target) = 1
            returning row_number
          )
          insert into audit_log (workbook_id, action, container_no, seal_no, row_number)
          select ${workbook.id}, 'write', ${r.container}, ${r.seal}, row_number from upd
          returning row_number
        `) as { row_number: number }[];

        if (rows.length === 1) out.push({ ...r, written: true });
        else out.push({ ...r, status: "error", written: false, issues: ["Row changed just now. Check again."] });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        out.push({ ...r, status: "error", written: false, issues: ["Seal was just used on another container"] });
      }
    }

    return NextResponse.json({ results: out });
  } catch (err) {
    return serverError(err);
  }
}

import { NextResponse } from "next/server";
import { getActiveWorkbook, sql } from "@/lib/db";
import { fail, serverError } from "@/lib/http";

export async function POST(req: Request) {
  const { container, seal } = (await req.json().catch(() => ({}))) as { container?: string; seal?: string };
  if (!container || !seal) return fail("Missing container or seal");
  try {
    const workbook = await getActiveWorkbook();
    if (!workbook) return fail("No base sheet");
    // Only clears if the seal is still the one the user saw.
    const rows = (await sql()`
      with upd as (
        update containers set seal_no = null, sealed_at = null
        where workbook_id = ${workbook.id} and container_no = ${container} and seal_no = ${seal}
        returning row_number
      )
      insert into audit_log (workbook_id, action, container_no, previous_seal, row_number)
      select ${workbook.id}, 'undo', ${container}, ${seal}, row_number from upd
      returning row_number
    `) as { row_number: number }[];
    if (rows.length === 0) return fail("That seal is no longer on this container", 409);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError(err);
  }
}

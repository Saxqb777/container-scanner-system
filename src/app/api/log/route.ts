import { NextResponse } from "next/server";
import { getActiveWorkbook, sql } from "@/lib/db";
import { serverError } from "@/lib/http";

export async function GET() {
  try {
    const workbook = await getActiveWorkbook();
    if (!workbook) return NextResponse.json({ entries: [] });
    const entries = await sql()`
      select l.id, l.action, l.container_no, l.seal_no, l.previous_seal, l.row_number, l.note, l.created_at,
             exists (
               select 1 from containers c
               where c.workbook_id = l.workbook_id and c.container_no = l.container_no and c.seal_no = l.seal_no
             ) as current
      from audit_log l
      where l.workbook_id = ${workbook.id}
      order by l.id desc limit 50
    `;
    return NextResponse.json({ entries });
  } catch (err) {
    return serverError(err);
  }
}

import { NextResponse } from "next/server";
import { getActiveWorkbook, sql } from "@/lib/db";
import { detectLayout, loadWorkbook, previewWorkbook, readRows, type Layout } from "@/lib/excel";
import { fail, serverError } from "@/lib/http";

export const maxDuration = 60;

const MAX_BYTES = 4 * 1024 * 1024;

export async function GET() {
  try {
    const workbook = await getActiveWorkbook();
    if (!workbook) return NextResponse.json({ workbook: null });
    const [stats] = (await sql()`
      select count(*)::int as total, count(seal_no)::int as sealed
      from containers where workbook_id = ${workbook.id}
    `) as { total: number; sealed: number }[];
    return NextResponse.json({ workbook: { ...workbook, ...stats } });
  } catch (err) {
    return serverError(err);
  }
}

function parseLayout(form: FormData): Layout | null {
  const sheetName = form.get("sheetName");
  const headerRow = Number(form.get("headerRow"));
  const containerCol = Number(form.get("containerCol"));
  const sealCol = Number(form.get("sealCol"));
  if (typeof sheetName !== "string" || !headerRow || !containerCol || !sealCol) return null;
  if (containerCol === sealCol) return null;
  return { sheetName, headerRow, containerCol, sealCol };
}

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File)) return fail("Choose an Excel file (.xlsx)");
  if (!/\.xlsx$/i.test(file.name)) return fail("Only .xlsx files are supported. In Excel, use Save As and pick .xlsx.");
  if (file.size > MAX_BYTES) return fail("File is larger than 4 MB");

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    let wb;
    try {
      wb = await loadWorkbook(buffer);
    } catch {
      return fail("Could not open this file. Is it a real .xlsx file?");
    }

    const layout = parseLayout(form) ?? detectLayout(wb);
    if (!layout) {
      return fail("Couldn't find a Container column and a Seal column. Pick them below.", 422, {
        needsMapping: true,
        preview: previewWorkbook(wb),
      });
    }

    const parsed = readRows(wb, layout);
    if (parsed.errors.length > 0) {
      return fail("The sheet has problems. Nothing was saved.", 422, { errors: parsed.errors, warnings: parsed.warnings });
    }

    const rows = parsed.rows;
    // Single statement: new sheet becomes active, previous one is kept but switched off.
    const [saved] = (await sql()`
      with w as (
        insert into workbooks (name, file, sheet_name, header_row, container_col, seal_col)
        values (${file.name}, ${"\\x" + buffer.toString("hex")}, ${layout.sheetName}, ${layout.headerRow}, ${layout.containerCol}, ${layout.sealCol})
        returning id
      ),
      off as (update workbooks set active = false where active),
      ins as (
        insert into containers (workbook_id, row_number, container_no, seal_no)
        select (select id from w), r.row_number, r.container_no, r.seal_no
        from unnest(${rows.map((r) => r.row)}::int[], ${rows.map((r) => r.container)}::text[], ${rows.map((r) => r.seal)}::text[])
          as r(row_number, container_no, seal_no)
        returning 1
      )
      insert into audit_log (workbook_id, action, note)
      select id, 'upload', ${`${file.name}: ${rows.length} containers`} from w
      returning workbook_id
    `) as { workbook_id: number }[];

    return NextResponse.json({
      ok: true,
      workbookId: saved.workbook_id,
      layout,
      count: rows.length,
      prefilled: rows.filter((r) => r.seal).length,
      warnings: parsed.warnings,
    });
  } catch (err) {
    return serverError(err);
  }
}

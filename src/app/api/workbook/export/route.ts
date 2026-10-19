import { getActiveWorkbook, sql } from "@/lib/db";
import { fillWorkbook } from "@/lib/excel";
import { fail, serverError } from "@/lib/http";

export const maxDuration = 60;

export async function GET() {
  try {
    const workbook = await getActiveWorkbook();
    if (!workbook) return fail("No base sheet uploaded", 404);
    const [{ file }] = (await sql()`select file from workbooks where id = ${workbook.id}`) as { file: string | Uint8Array }[];
    const original = typeof file === "string" ? Buffer.from(file.replace(/^\\x/, ""), "hex") : Buffer.from(file);
    const seals = (await sql()`
      select row_number as row, seal_no as seal from containers where workbook_id = ${workbook.id}
    `) as { row: number; seal: string | null }[];

    const filled = await fillWorkbook(
      original,
      {
        sheetName: workbook.sheet_name,
        headerRow: workbook.header_row,
        containerCol: workbook.container_col,
        sealCol: workbook.seal_col,
      },
      seals,
    );
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
    const name = workbook.name.replace(/\.xlsx$/i, "") + `-sealed-${stamp}.xlsx`;
    return new Response(new Uint8Array(filled), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${encodeURIComponent(name)}"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return serverError(err);
  }
}

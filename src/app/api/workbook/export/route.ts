import { getActiveWorkbook, sql } from "@/lib/db";
import { patchColumn } from "@/lib/xlsx-patch";
import { fail, serverError } from "@/lib/http";

export const maxDuration = 60;

export async function GET() {
  try {
    const workbook = await getActiveWorkbook();
    if (!workbook) return fail("No base sheet uploaded", 404);
    const [{ file }] = (await sql()`select file from workbooks where id = ${workbook.id}`) as { file: string | Uint8Array }[];
    const original = typeof file === "string" ? Buffer.from(file.replace(/^\\x/, ""), "hex") : Buffer.from(file);
    // Only seals written in the app. Everything that came with the file stays exactly as it was.
    const writes = (await sql()`
      select row_number as row, seal_no as value from containers
      where workbook_id = ${workbook.id} and sealed_at is not null and seal_no is not null
    `) as { row: number; value: string }[];

    const filled = await patchColumn(original, workbook.sheet_name, workbook.seal_col, writes);
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

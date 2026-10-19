import { sql } from "./db";
import type { SheetEntry } from "./validate";

export async function loadSheetEntries(workbookId: number): Promise<SheetEntry[]> {
  return (await sql()`
    select row_number, container_no, seal_no, other_seals from containers where workbook_id = ${workbookId}
  `) as SheetEntry[];
}

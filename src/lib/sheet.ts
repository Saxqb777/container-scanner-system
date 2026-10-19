import { sql } from "./db";
import type { SheetEntry } from "./validate";

export async function loadSheetEntries(workbookId: number): Promise<SheetEntry[]> {
  return (await sql()`
    select row_number, container_no, seal_no from containers where workbook_id = ${workbookId}
  `) as SheetEntry[];
}

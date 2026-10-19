import ExcelJS from "exceljs";
import { checkContainer, normalizeContainer } from "./iso6346";
import { normalizeSeal } from "./seal";

export type Layout = {
  sheetName: string;
  headerRow: number;
  containerCol: number;
  sealCol: number;
};

export type SheetRow = { row: number; container: string; seal: string | null };

export type ParsedSheet = Layout & {
  rows: SheetRow[];
  warnings: string[];
  errors: string[];
};

export type SheetPreview = {
  sheets: { name: string; rows: string[][] }[];
};

const HEADER_SCAN_ROWS = 30;
const PREVIEW_ROWS = 15;

export async function loadWorkbook(buffer: ArrayBuffer | Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as ArrayBuffer);
  return wb;
}

function cellText(ws: ExcelJS.Worksheet, row: number, col: number): string {
  return (ws.getRow(row).getCell(col).text ?? "").toString().trim();
}

function isContainerHeading(text: string): boolean {
  const t = text.toLowerCase();
  return /container|cntr|ctnr/.test(t) && !/seal|type|size|status|weight/.test(t);
}

function isSealHeading(text: string): boolean {
  return /seal/.test(text.toLowerCase());
}

export function detectLayout(wb: ExcelJS.Workbook): Layout | null {
  for (const ws of wb.worksheets) {
    const lastRow = Math.min(ws.rowCount, HEADER_SCAN_ROWS);
    for (let r = 1; r <= lastRow; r++) {
      let containerCol = 0;
      let sealCol = 0;
      for (let c = 1; c <= ws.columnCount; c++) {
        const text = cellText(ws, r, c);
        if (!text) continue;
        if (!containerCol && isContainerHeading(text)) containerCol = c;
        else if (!sealCol && isSealHeading(text)) sealCol = c;
      }
      if (containerCol && sealCol) {
        return { sheetName: ws.name, headerRow: r, containerCol, sealCol };
      }
    }
  }
  return null;
}

export function previewWorkbook(wb: ExcelJS.Workbook): SheetPreview {
  return {
    sheets: wb.worksheets.map((ws) => {
      const rows: string[][] = [];
      for (let r = 1; r <= Math.min(ws.rowCount, PREVIEW_ROWS); r++) {
        const cells: string[] = [];
        for (let c = 1; c <= ws.columnCount; c++) cells.push(cellText(ws, r, c));
        rows.push(cells);
      }
      return { name: ws.name, rows };
    }),
  };
}

export function readRows(wb: ExcelJS.Workbook, layout: Layout): ParsedSheet {
  const ws = wb.getWorksheet(layout.sheetName);
  if (!ws) throw new Error(`Sheet "${layout.sheetName}" not found`);

  const rows: SheetRow[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const containerRows = new Map<string, number[]>();
  const sealRows = new Map<string, number[]>();

  for (let r = layout.headerRow + 1; r <= ws.rowCount; r++) {
    const rawContainer = cellText(ws, r, layout.containerCol);
    if (!rawContainer) continue;
    const container = normalizeContainer(rawContainer);
    const sealText = normalizeSeal(cellText(ws, r, layout.sealCol));
    const seal = sealText || null;
    rows.push({ row: r, container, seal });

    const check = checkContainer(container);
    if (!check.ok) warnings.push(`Row ${r}: "${rawContainer}" - ${check.reason}`);
    containerRows.set(container, [...(containerRows.get(container) ?? []), r]);
    if (seal) sealRows.set(seal, [...(sealRows.get(seal) ?? []), r]);
  }

  for (const [container, at] of containerRows) {
    if (at.length > 1) {
      warnings.push(`${container} is listed ${at.length} times (rows ${at.join(", ")}). Seals will not be written to it until fixed.`);
    }
  }
  for (const [seal, at] of sealRows) {
    if (at.length > 1) errors.push(`Seal ${seal} already appears on rows ${at.join(", ")}. Fix the sheet and upload again.`);
  }
  if (rows.length === 0) errors.push("No container numbers found under the heading.");

  return { ...layout, rows, warnings, errors };
}

/** Writes the current seal state into the original file, keeping its formatting. */
export async function fillWorkbook(
  original: Buffer,
  layout: Layout,
  seals: { row: number; seal: string | null }[],
): Promise<Buffer> {
  const wb = await loadWorkbook(original);
  const ws = wb.getWorksheet(layout.sheetName);
  if (!ws) throw new Error(`Sheet "${layout.sheetName}" not found`);
  for (const { row, seal } of seals) {
    // Stored as text so seal numbers with leading zeros survive.
    ws.getRow(row).getCell(layout.sealCol).value = seal ?? null;
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

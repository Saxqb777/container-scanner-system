import JSZip from "jszip";

export type CellWrite = { row: number; value: string };

/**
 * Writes values into one column of one sheet by editing the sheet XML in place.
 * Every other part of the file (pivot tables, dropdowns, charts, formatting) is
 * left byte for byte as it was, which a full load/save through ExcelJS does not do.
 */
export async function patchColumn(original: Buffer, sheetName: string, col: number, writes: CellWrite[]): Promise<Buffer> {
  const zip = await JSZip.loadAsync(original);
  const sheetPath = await findSheetPath(zip, sheetName);
  let xml = await zip.file(sheetPath)!.async("string");

  const p = prefixOf(xml);
  const letter = colLetter(col);
  const sorted = [...writes].sort((a, b) => a.row - b.row);
  for (const w of sorted) xml = writeCell(xml, p, w.row, letter, col, w.value);
  zip.file(sheetPath, xml, { createFolders: false });

  // Formulas that read the seal column have cached results; ask Excel to recalculate on open.
  const wbXml = await zip.file("xl/workbook.xml")!.async("string");
  zip.file("xl/workbook.xml", forceRecalc(wbXml), { createFolders: false });

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/** All-digit seals without a leading zero are stored as numbers, like the rest of a typical sheet. */
export function isNumericSeal(value: string): boolean {
  return /^[1-9][0-9]{0,14}$/.test(value);
}

export function colLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function colNumber(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function findSheetPath(zip: JSZip, sheetName: string): Promise<string> {
  const wb = await zip.file("xl/workbook.xml")?.async("string");
  const rels = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
  if (!wb || !rels) throw new Error("Not a valid .xlsx file");
  for (const tag of wb.match(/<(?:\w+:)?sheet\b[^>]*>/g) ?? []) {
    const name = /\bname="([^"]*)"/.exec(tag)?.[1];
    const id = /\br:id="([^"]*)"/.exec(tag)?.[1];
    if (name === undefined || id === undefined || decodeXml(name) !== sheetName) continue;
    const rel = (rels.match(/<(?:\w+:)?Relationship\b[^>]*>/g) ?? []).find((r) => new RegExp(`\\bId="${escapeRe(id)}"`).test(r));
    const target = rel && /\bTarget="([^"]*)"/.exec(rel)?.[1];
    if (!target) break;
    return target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  }
  throw new Error(`Sheet "${sheetName}" not found`);
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Some writers use a namespace prefix such as "x:" on every element. */
function prefixOf(xml: string): string {
  return /<(\w+:)?sheetData\b/.exec(xml)?.[1] ?? "";
}

function cellXml(p: string, ref: string, style: string | null, value: string): string {
  const s = style ? ` s="${style}"` : "";
  if (isNumericSeal(value)) return `<${p}c r="${ref}"${s}><${p}v>${value}</${p}v></${p}c>`;
  return `<${p}c r="${ref}"${s} t="inlineStr"><${p}is><${p}t>${escapeXml(value)}</${p}t></${p}is></${p}c>`;
}

function writeCell(xml: string, p: string, row: number, letter: string, col: number, value: string): string {
  const ref = `${letter}${row}`;
  const rowRe = new RegExp(`<${p}row\\b[^>]*\\br="${row}"[^>]*?(?:/>|>[\\s\\S]*?</${p}row>)`);
  const rowMatch = rowRe.exec(xml);

  if (!rowMatch) {
    const style = styleAbove(xml, p, letter, row);
    const newRow = `<${p}row r="${row}">${cellXml(p, ref, style, value)}</${p}row>`;
    return insertRow(xml, p, row, newRow);
  }

  const rowXml = rowMatch[0];
  const open = /^<[^>]*?(\/?)>/.exec(rowXml)!;
  // spans is only a loading hint; drop it so a new cell outside the old span is never an issue.
  const rowOpen = open[0].replace(/\s+spans="[^"]*"/, "").replace(/\s*\/>$/, ">");
  const body = open[1] === "/" ? "" : rowXml.slice(open[0].length, rowXml.length - `</${p}row>`.length);

  const cellRe = new RegExp(`<${p}c\\b[^>]*?(?:/>|>[\\s\\S]*?</${p}c>)`, "g");
  const cells = body.match(cellRe) ?? [];
  let replaced = false;
  const out: string[] = [];
  let inserted = false;

  for (const cell of cells) {
    const cref = /\br="([A-Z]+)\d+"/.exec(cell)?.[1];
    const ccol = cref ? colNumber(cref) : 0;
    if (ccol === col) {
      const style = /\bs="(\d+)"/.exec(cell)?.[1] ?? null;
      out.push(cellXml(p, ref, style, value));
      replaced = true;
      continue;
    }
    if (!replaced && !inserted && ccol > col) {
      out.push(cellXml(p, ref, styleAbove(xml, p, letter, row), value));
      inserted = true;
    }
    out.push(cell);
  }
  if (!replaced && !inserted) out.push(cellXml(p, ref, styleAbove(xml, p, letter, row), value));

  const newRow = `${rowOpen}${out.join("")}</${p}row>`;
  return xml.slice(0, rowMatch.index) + newRow + xml.slice(rowMatch.index + rowXml.length);
}

/** A new cell borrows the style of the nearest cell above it in the same column, so borders and fonts match. */
function styleAbove(xml: string, p: string, letter: string, row: number): string | null {
  const re = new RegExp(`<${p}c\\b[^>]*\\br="${letter}(\\d+)"[^>]*>`, "g");
  let best: { row: number; style: string | null } | null = null;
  for (const m of xml.matchAll(re)) {
    const r = Number(m[1]);
    if (r < row && (!best || r > best.row)) best = { row: r, style: /\bs="(\d+)"/.exec(m[0])?.[1] ?? null };
  }
  return best?.style ?? null;
}

function insertRow(xml: string, p: string, row: number, newRow: string): string {
  const rowRe = new RegExp(`<${p}row\\b[^>]*\\br="(\\d+)"`, "g");
  for (const m of xml.matchAll(rowRe)) {
    if (Number(m[1]) > row) return xml.slice(0, m.index) + newRow + xml.slice(m.index);
  }
  const selfClosing = new RegExp(`<${p}sheetData\\s*/>`);
  if (selfClosing.test(xml)) return xml.replace(selfClosing, `<${p}sheetData>${newRow}</${p}sheetData>`);
  return xml.replace(`</${p}sheetData>`, `${newRow}</${p}sheetData>`);
}

function forceRecalc(wbXml: string): string {
  const calc = /<(\w+:)?calcPr\b[^>]*?\/?>/.exec(wbXml);
  if (calc) {
    if (/\bfullCalcOnLoad=/.test(calc[0])) return wbXml;
    const tag = calc[0].replace(/<(\w+:)?calcPr\b/, (t) => `${t} fullCalcOnLoad="1"`);
    return wbXml.replace(calc[0], tag);
  }
  const p = /<(\w+:)?workbook\b/.exec(wbXml)?.[1] ?? "";
  const tail = new RegExp(`(<${p}(?:oleSize|customWorkbookViews|pivotCaches|smartTagPr|smartTagTypes|webPublishing|fileRecoveryPr|webPublishObjects|extLst)\\b|</${p}workbook>)`);
  return wbXml.replace(tail, `<${p}calcPr fullCalcOnLoad="1"/>$1`);
}

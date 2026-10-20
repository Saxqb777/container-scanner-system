"use client";

import { useRef, useState } from "react";

export type WorkbookInfo = {
  id: number;
  name: string;
  sheet_name: string;
  header_row: number;
  container_col: number;
  seal_col: number;
  uploaded_at: string;
  total: number;
  sealed: number;
};

type Preview = { sheets: { name: string; rows: string[][] }[] };

type Mapping = { sheetName: string; headerRow: number; containerCol: number; sealCol: number };

function colLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export default function SheetPanel({
  workbook,
  onUploaded,
}: {
  workbook: WorkbookInfo | null | undefined;
  onUploaded: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);

  async function upload(f: File, map?: Mapping) {
    setBusy(true);
    setError("");
    setProblems([]);
    setWarnings([]);
    setNotice("");
    const form = new FormData();
    form.append("file", f);
    if (map) for (const [k, v] of Object.entries(map)) form.append(k, String(v));
    try {
      const res = await fetch("/api/workbook", { method: "POST", body: form });
      const data = await res.json();
      if (res.ok) {
        setFile(null);
        setPreview(null);
        setMapping(null);
        setWarnings(data.warnings ?? []);
        setNotice(
          `Loaded ${data.count} containers from "${data.layout.sheetName}". Container column ${colLetter(data.layout.containerCol)}, seal column ${colLetter(data.layout.sealCol)}, headings on row ${data.layout.headerRow}.` +
            (data.prefilled ? ` ${data.prefilled} already had a seal.` : "") +
            (data.otherSealCols?.length
              ? ` Seals in column ${data.otherSealCols.map(colLetter).join(", ")} also count as used.`
              : ""),
        );
        onUploaded();
        return;
      }
      setError(data.error ?? "Upload failed");
      setProblems(data.errors ?? []);
      setWarnings(data.warnings ?? []);
      if (data.needsMapping) {
        const p = data.preview as Preview;
        setPreview(p);
        setMapping({ sheetName: p.sheets[0]?.name ?? "", headerRow: 1, containerCol: 1, sealCol: 2 });
      }
    } catch {
      setError("Upload failed. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  function choose(f: File | undefined) {
    if (!f) return;
    if (
      workbook &&
      workbook.sealed > 0 &&
      !window.confirm(
        `The current sheet has ${workbook.sealed} seals written. Download it first if you need it.\n\nReplace it with "${f.name}"?`,
      )
    ) {
      return;
    }
    setFile(f);
    upload(f);
  }

  const sheet = preview?.sheets.find((s) => s.name === mapping?.sheetName);
  const headerCells = sheet?.rows[(mapping?.headerRow ?? 1) - 1] ?? [];

  return (
    <section className="panel" data-tour="sheet">
      <div className="panel-head">
        <h2>Base sheet</h2>
        {workbook === undefined && <span className="muted">Loading...</span>}
      </div>

      {workbook ? (
        <div className="sheet-info">
          <div>
            <div className="sheet-name">{workbook.name}</div>
            <div className="muted">
              Sheet "{workbook.sheet_name}", container column {colLetter(workbook.container_col)}, seal column{" "}
              {colLetter(workbook.seal_col)}
            </div>
          </div>
          <div className="progress-block">
            <div className="progress-label">
              <b>{workbook.sealed}</b> of {workbook.total} sealed
            </div>
            <div className="progress">
              <div style={{ width: `${workbook.total ? (100 * workbook.sealed) / workbook.total : 0}%` }} />
            </div>
          </div>
          <div className="actions">
            <a className="btn btn-primary" href="/api/workbook/export" data-tour="download">
              Download filled Excel
            </a>
            <button className="btn" onClick={() => input.current?.click()} disabled={busy}>
              {busy ? "Uploading..." : "Replace sheet"}
            </button>
          </div>
        </div>
      ) : (
        workbook === null && (
          <div className="empty">
            <p>Upload the base Excel sheet that lists the container numbers. It needs a Container column and a Seal column.</p>
            <button className="btn btn-primary" onClick={() => input.current?.click()} disabled={busy}>
              {busy ? "Uploading..." : "Upload .xlsx"}
            </button>
          </div>
        )
      )}

      <input
        ref={input}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        hidden
        onChange={(e) => {
          choose(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {notice && <p className="msg msg-ok">{notice}</p>}
      {error && (
        <div className="msg msg-error">
          <p>{error}</p>
          {problems.length > 0 && (
            <ul>
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {warnings.length > 0 && (
        <details className="msg msg-warn">
          <summary>
            {warnings.length} row{warnings.length === 1 ? "" : "s"} to look at in the sheet
          </summary>
          <ul>
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </details>
      )}

      {preview && mapping && file && (
        <div className="mapping">
          <h3>Pick the columns</h3>
          <div className="mapping-fields">
            <label>
              Sheet
              <select value={mapping.sheetName} onChange={(e) => setMapping({ ...mapping, sheetName: e.target.value })}>
                {preview.sheets.map((s) => (
                  <option key={s.name}>{s.name}</option>
                ))}
              </select>
            </label>
            <label>
              Headings row
              <select
                value={mapping.headerRow}
                onChange={(e) => setMapping({ ...mapping, headerRow: Number(e.target.value) })}
              >
                {sheet?.rows.map((r, i) => (
                  <option key={i} value={i + 1}>
                    {i + 1}: {r.filter(Boolean).slice(0, 4).join(" | ") || "(empty)"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Container column
              <select
                value={mapping.containerCol}
                onChange={(e) => setMapping({ ...mapping, containerCol: Number(e.target.value) })}
              >
                {headerCells.map((h, i) => (
                  <option key={i} value={i + 1}>
                    {colLetter(i + 1)}: {h || "(empty)"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Seal column
              <select value={mapping.sealCol} onChange={(e) => setMapping({ ...mapping, sealCol: Number(e.target.value) })}>
                {headerCells.map((h, i) => (
                  <option key={i} value={i + 1}>
                    {colLetter(i + 1)}: {h || "(empty)"}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="actions">
            <button className="btn" onClick={() => { setPreview(null); setFile(null); setError(""); }}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={busy || mapping.containerCol === mapping.sealCol}
              onClick={() => upload(file, mapping)}
            >
              Use these columns
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

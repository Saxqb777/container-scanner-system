"use client";

import { useEffect, useState } from "react";
import { formatContainer } from "@/lib/iso6346";

type Entry = {
  id: number;
  action: "write" | "undo" | "upload";
  container_no: string | null;
  seal_no: string | null;
  previous_seal: string | null;
  row_number: number | null;
  note: string | null;
  created_at: string;
  current: boolean;
};

export default function ActivityLog({ version, onChanged }: { version: number; onChanged: () => void }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    fetch("/api/log", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setEntries(d.entries ?? []))
      .catch(() => setError("Could not load activity"));
  }, [version, reload]);

  async function undo(e: Entry) {
    if (!window.confirm(`Remove seal ${e.seal_no} from ${e.container_no}? The cell goes back to empty.`)) return;
    setBusy(e.id);
    setError("");
    const res = await fetch("/api/undo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ container: e.container_no, seal: e.seal_no }),
    });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? "Undo failed");
    setBusy(null);
    setReload((n) => n + 1);
    onChanged();
  }

  // Only the newest write per container can be undone.
  const undoable = new Set<number>();
  const seen = new Set<string>();
  for (const e of entries) {
    if (!e.container_no || seen.has(e.container_no)) continue;
    seen.add(e.container_no);
    if (e.action === "write" && e.current) undoable.add(e.id);
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Activity</h2>
        <span className="hint">Last 50 changes to this sheet</span>
      </div>
      {error && <p className="msg msg-error">{error}</p>}
      {entries.length === 0 ? (
        <p className="muted">Nothing yet.</p>
      ) : (
        <ul className="log">
          {entries.map((e) => (
            <li key={e.id}>
              <time>{new Date(e.created_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}</time>
              <span className="log-text">
                {e.action === "write" && (
                  <>
                    Row {e.row_number}: <b className="mono">{formatContainer(e.container_no ?? "")}</b> sealed{" "}
                    <b className="mono">{e.seal_no}</b>
                  </>
                )}
                {e.action === "undo" && (
                  <>
                    Row {e.row_number}: removed seal <b className="mono">{e.previous_seal}</b> from{" "}
                    <b className="mono">{formatContainer(e.container_no ?? "")}</b>
                  </>
                )}
                {e.action === "upload" && <>Base sheet uploaded ({e.note})</>}
              </span>
              {undoable.has(e.id) && (
                <button className="btn btn-ghost btn-small" disabled={busy === e.id} onClick={() => undo(e)}>
                  Undo
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

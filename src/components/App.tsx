"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { checkContainer, formatContainer } from "@/lib/iso6346";
import type { SetResult } from "@/lib/validate";
import SheetPanel, { type WorkbookInfo } from "./SheetPanel";
import ActivityLog from "./ActivityLog";
import Tutorial from "./Tutorial";
import { tutorialDone } from "@/lib/tutorial";
import { downscale } from "./image";

type Kind = "container" | "seal" | "unclear";

type Photo = {
  id: string;
  batch: number;
  name: string;
  url: string;
  state: "reading" | "read" | "failed";
  kind: Kind;
  value: string | null;
  uncertain: boolean;
  note: string;
};

type PhotoSet = {
  id: string;
  batch: number;
  container: Photo | null;
  seal: Photo | null;
  /** Photos were not in a clean container/seal order, so the pairing is a guess. */
  pairingUnsure: boolean;
};

type Edit = { container?: string; seal?: string; reviewed?: boolean };

type RowState = SetResult & { written?: boolean };

const MAX_PARALLEL_READS = 3;

let counter = 0;
const nextId = () => `p${Date.now().toString(36)}${(counter++).toString(36)}`;

function makeSet(batch: number, container: Photo | null, seal: Photo | null, pairingUnsure: boolean): PhotoSet {
  return { id: `${container?.id ?? "-"}+${seal?.id ?? "-"}`, batch, container, seal, pairingUnsure };
}

/**
 * Pairs the photos of one drop. When kinds alternate cleanly (C,S,C,S or S,C,S,C)
 * neighbours are paired. Otherwise the n-th container gets the n-th seal and every
 * pair is flagged so a person checks it before anything is written.
 */
function pairBatch(batch: number, photos: Photo[]): PhotoSet[] {
  if (photos.some((p) => p.state === "reading")) {
    return photos.map((p) => makeSet(batch, p, null, false));
  }
  const known = photos.filter((p) => p.kind !== "unclear");
  const unclear = photos.filter((p) => p.kind === "unclear").map((p) => makeSet(batch, p, null, false));

  const alternates =
    known.length % 2 === 0 && known.every((p, i) => i === 0 || p.kind !== known[i - 1].kind);
  if (alternates) {
    const sets: PhotoSet[] = [];
    for (let i = 0; i < known.length; i += 2) {
      const [a, b] = [known[i], known[i + 1]];
      sets.push(a.kind === "container" ? makeSet(batch, a, b, false) : makeSet(batch, b, a, false));
    }
    return [...sets, ...unclear];
  }

  const containers = known.filter((p) => p.kind === "container");
  const seals = known.filter((p) => p.kind === "seal");
  const sets: PhotoSet[] = [];
  for (let i = 0; i < Math.max(containers.length, seals.length); i++) {
    sets.push(makeSet(batch, containers[i] ?? null, seals[i] ?? null, Boolean(containers[i] && seals[i])));
  }
  return [...sets, ...unclear];
}

/** Applies manual "this container goes with that seal photo" choices by swapping seals. */
function applyOverrides(sets: PhotoSet[], overrides: Record<string, string>): PhotoSet[] {
  const out = sets.slice();
  for (const [containerId, sealId] of Object.entries(overrides)) {
    const a = out.findIndex((s) => s.container?.id === containerId);
    const b = out.findIndex((s) => s.seal?.id === sealId);
    if (a < 0 || b < 0 || out[a].batch !== out[b].batch) continue;
    const sealA = out[a].seal;
    out[a] = makeSet(out[a].batch, out[a].container, out[b].seal, false);
    if (a !== b) out[b] = makeSet(out[b].batch, out[b].container, sealA, out[b].pairingUnsure);
  }
  return out;
}

function pairPhotos(photos: Photo[], overrides: Record<string, string>): PhotoSet[] {
  const batches = new Map<number, Photo[]>();
  for (const p of photos) batches.set(p.batch, [...(batches.get(p.batch) ?? []), p]);
  const sets = [...batches].flatMap(([batch, list]) => pairBatch(batch, list));
  return applyOverrides(sets, overrides);
}

export default function App() {
  const [workbook, setWorkbook] = useState<WorkbookInfo | null | undefined>(undefined);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, RowState>>({});
  const [checking, setChecking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [writing, setWriting] = useState(false);
  const [banner, setBanner] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [logVersion, setLogVersion] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [touring, setTouring] = useState(false);
  const tourChecked = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const queue = useRef<{ id: string; file: File }[]>([]);
  const active = useRef(0);

  const loadWorkbook = useCallback(async () => {
    const res = await fetch("/api/workbook", { cache: "no-store" });
    if (res.status === 401) return void (window.location.href = "/login");
    const data = await res.json();
    setWorkbook(data.workbook ?? null);
  }, []);

  useEffect(() => {
    loadWorkbook();
  }, [loadWorkbook]);

  // First visit: open the tour once the page has its real layout.
  useEffect(() => {
    if (workbook === undefined || tourChecked.current) return;
    tourChecked.current = true;
    if (!tutorialDone()) setTouring(true);
  }, [workbook]);

  const updatePhoto = (id: string, patch: Partial<Photo>) =>
    setPhotos((list) => list.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const pump = useCallback(() => {
    while (active.current < MAX_PARALLEL_READS && queue.current.length > 0) {
      const job = queue.current.shift()!;
      active.current++;
      (async () => {
        try {
          const image = await downscale(job.file);
          const res = await fetch("/api/read", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ image }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? "Read failed");
          updatePhoto(job.id, {
            state: "read",
            kind: data.kind,
            value: data.kind === "container" ? data.container : data.kind === "seal" ? data.seal : null,
            uncertain: data.uncertain || (data.kind === "container" && !data.containerValid),
            note: data.note ?? "",
          });
        } catch (err) {
          updatePhoto(job.id, {
            state: "failed",
            kind: "unclear",
            note: err instanceof Error ? err.message : "Could not read this photo",
          });
        } finally {
          active.current--;
          pump();
        }
      })();
    }
  }, []);

  function addFiles(files: FileList | File[]) {
    // Keep the order the photos were picked in; pairing checks that order before trusting it.
    const images = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    const batch = Date.now();
    const added: Photo[] = images.map((file) => {
      const id = nextId();
      queue.current.push({ id, file });
      return { id, batch, name: file.name, url: URL.createObjectURL(file), state: "reading", kind: "unclear", value: null, uncertain: false, note: "" };
    });
    setPhotos((list) => [...list, ...added]);
    setBanner(null);
    pump();
  }

  const sets = useMemo(() => pairPhotos(photos, overrides), [photos, overrides]);
  const sealChoices = useMemo(() => {
    const map = new Map<number, Photo[]>();
    for (const p of photos) if (p.state !== "reading" && p.kind === "seal") map.set(p.batch, [...(map.get(p.batch) ?? []), p]);
    return map;
  }, [photos]);

  const values = useMemo(
    () =>
      sets.map((s) => {
        const e = edits[s.id] ?? {};
        const container = e.container ?? s.container?.value ?? "";
        const seal = e.seal ?? s.seal?.value ?? "";
        const reading = s.container?.state === "reading" || s.seal?.state === "reading";
        const uncertain =
          (s.container?.uncertain && e.container === undefined) || (s.seal?.uncertain && e.seal === undefined);
        const local: string[] = [];
        if (!s.container) local.push("No container photo for this seal");
        if (!s.seal) local.push("No seal photo for this container");
        if (s.container && s.container.kind === "unclear" && e.container === undefined) local.push("Could not read the container photo");
        const reviewNotes = [s.container, s.seal]
          .filter((p) => p?.uncertain)
          .map((p) => p!.note || "Read with low confidence. Compare with the photo.");
        if (s.pairingUnsure) reviewNotes.unshift("Photos were not in container then seal order. Make sure this seal belongs to this container.");
        const needsReview = (Boolean(uncertain) || s.pairingUnsure) && !e.reviewed;
        return { set: s, container, seal, reading, needsReview, reviewNotes, local };
      }),
    [sets, edits],
  );

  const allRead = values.every((v) => !v.reading);
  const checkable = values.filter((v) => !v.reading && v.container && v.seal);
  const checkKey = JSON.stringify(checkable.map((v) => [v.set.id, v.container, v.seal]));

  // Re-check against the sheet whenever numbers change.
  useEffect(() => {
    if (!workbook || checkable.length === 0) return;
    const timer = setTimeout(async () => {
      setChecking(true);
      try {
        const res = await fetch("/api/check", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sets: checkable.map((v) => ({ id: v.set.id, container: v.container, seal: v.seal })) }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setResults((prev) => {
          const next = { ...prev };
          for (const r of data.results as SetResult[]) if (!prev[r.id]?.written) next[r.id] = r;
          return next;
        });
      } catch (err) {
        setBanner({ kind: "error", text: err instanceof Error ? err.message : "Check failed" });
      } finally {
        setChecking(false);
      }
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkKey, workbook?.id]);

  const rows = values.map((v) => {
    const r = results[v.set.id];
    const fresh = r && r.container === checkContainer(v.container).value && r.seal === v.seal.toUpperCase().replace(/[\s-]/g, "");
    let status: "reading" | "ready" | "done" | "error" | "review" | "written" | "pending";
    let issues: string[] = [...v.local];
    if (r?.written) status = "written";
    else if (v.reading) status = "reading";
    else if (v.local.length > 0) status = "error";
    else if (!fresh) status = "pending";
    else {
      issues = r.issues;
      status = r.status === "ready" && v.needsReview ? "review" : r.status;
    }
    return { ...v, result: fresh || r?.written ? r : undefined, status, issues };
  });

  const ready = rows.filter((r) => r.status === "ready");
  const counts = {
    ready: ready.length,
    done: rows.filter((r) => r.status === "done").length,
    written: rows.filter((r) => r.status === "written").length,
    problems: rows.filter((r) => r.status === "error" || r.status === "review").length,
  };

  async function write() {
    if (!workbook) return;
    setWriting(true);
    setBanner(null);
    try {
      const res = await fetch("/api/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workbookId: workbook.id,
          sets: ready.map((r) => ({ id: r.set.id, container: r.container, seal: r.seal })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const out = data.results as RowState[];
      setResults((prev) => {
        const next = { ...prev };
        for (const r of out) next[r.id] = r;
        return next;
      });
      const ok = out.filter((r) => r.written).length;
      const failed = out.length - ok;
      setBanner(
        failed === 0
          ? { kind: "ok", text: `Wrote ${ok} seal number${ok === 1 ? "" : "s"}.` }
          : { kind: "error", text: `Wrote ${ok}. ${failed} stopped, see the red rows.` },
      );
      await loadWorkbook();
      setLogVersion((n) => n + 1);
    } catch (err) {
      setBanner({ kind: "error", text: err instanceof Error ? err.message : "Write failed. Nothing was written." });
    } finally {
      setWriting(false);
      setConfirming(false);
    }
  }

  function removeSet(s: PhotoSet) {
    const ids = new Set([s.container?.id, s.seal?.id]);
    setPhotos((list) => list.filter((p) => !ids.has(p.id)));
    queue.current = queue.current.filter((j) => !ids.has(j.id));
  }

  function clearFinished() {
    const finished = new Set(rows.filter((r) => r.status === "written" || r.status === "done").flatMap((r) => [r.set.container?.id, r.set.seal?.id]));
    setPhotos((list) => list.filter((p) => !finished.has(p.id)));
  }

  function setKind(photo: Photo, kind: Kind) {
    updatePhoto(photo.id, { kind, value: null, uncertain: false });
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          Seal Register
        </div>
        <div className="topbar-actions">
          <button className="btn tour-help" onClick={() => setTouring(true)} aria-label="Show the tour" title="Show the tour">
            ?
          </button>
          <button className="btn btn-ghost" onClick={logout}>
            Log out
          </button>
        </div>
      </header>

      <main className="content">
        <SheetPanel
          workbook={workbook}
          onUploaded={() => {
            setResults({});
            loadWorkbook();
            setLogVersion((n) => n + 1);
          }}
        />

        {workbook && (
          <section className="panel" data-tour="scan">
            <div className="panel-head">
              <h2>Scan sets</h2>
              <span className="hint">Drop the container photo, then its seal photo. Many sets at once is fine.</span>
            </div>

            <div
              className={`dropzone${dragging ? " is-over" : ""}`}
              data-tour="dropzone"
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                addFiles(e.dataTransfer.files);
              }}
              onClick={() => fileInput.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInput.current?.click()}
            >
              <strong>Drop photos here</strong>
              <span>or tap to choose</span>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>

            {rows.length > 0 && (
              <div className="table-wrap">
                <table className="sets">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Container</th>
                      <th>Seal</th>
                      <th>Row</th>
                      <th>Status</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const locked = r.status === "written" || writing;
                      const containerCheck = r.container ? checkContainer(r.container) : null;
                      return (
                        <tr key={r.set.id} className={`row-${r.status}`}>
                          <td className="num set-no" data-label="Set">{i + 1}</td>
                          <td data-label="Container">
                            <Cell
                              photo={r.set.container}
                              value={r.container}
                              placeholder="MRSU4985257"
                              disabled={locked}
                              flag={containerCheck && !containerCheck.ok ? "Check digit" : undefined}
                              onChange={(value) => setEdits((e) => ({ ...e, [r.set.id]: { ...e[r.set.id], container: value } }))}
                              onKind={(k) => r.set.container && setKind(r.set.container, k)}
                            />
                          </td>
                          <td data-label="Seal">
                            <Cell
                              photo={r.set.seal}
                              value={r.seal}
                              placeholder="Seal no."
                              disabled={locked}
                              onChange={(value) => setEdits((e) => ({ ...e, [r.set.id]: { ...e[r.set.id], seal: value } }))}
                              onKind={(k) => r.set.seal && setKind(r.set.seal, k)}
                            />
                            {!locked &&
                              r.set.container &&
                              (r.set.pairingUnsure || overrides[r.set.container.id]) &&
                              (sealChoices.get(r.set.batch)?.length ?? 0) > 1 && (
                              <label className="pair-pick">
                                Seal photo
                                <select
                                  value={r.set.seal?.id ?? ""}
                                  onChange={(e) => {
                                    const containerId = r.set.container!.id;
                                    setOverrides((o) => ({ ...o, [containerId]: e.target.value }));
                                  }}
                                >
                                  {!r.set.seal && <option value="">None</option>}
                                  {sealChoices.get(r.set.batch)!.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.value || p.name}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            )}
                          </td>
                          <td className="num row-no" data-label="Row">{r.result?.row ?? "-"}</td>
                          <td className="status-cell" data-label="Status">
                            <StatusBadge status={r.status} />
                            {r.set.pairingUnsure && r.status === "error" && (
                              <p className="pair-note">Photos were not in container then seal order. Check the seal photo above.</p>
                            )}
                            {r.issues.length > 0 && (
                              <ul className="issues">
                                {r.issues.map((t) => (
                                  <li key={t}>{t}</li>
                                ))}
                              </ul>
                            )}
                            {r.status === "review" && (
                              <div className="review">
                                {r.reviewNotes.map((t) => (
                                  <p key={t}>{t}</p>
                                ))}
                                <button
                                  className="btn btn-small"
                                  onClick={() => setEdits((e) => ({ ...e, [r.set.id]: { ...e[r.set.id], reviewed: true } }))}
                                >
                                  Looks right
                                </button>
                              </div>
                            )}
                          </td>
                          <td className="row-actions">
                            {r.status !== "written" && (
                              <button className="btn btn-ghost btn-small" onClick={() => removeSet(r.set)} disabled={writing}>
                                Remove
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {banner && <p className={`msg msg-${banner.kind}`}>{banner.text}</p>}

            {rows.length > 0 && (
              <div className="actionbar">
                <div className="summary">
                  <span>
                    <b>{counts.ready}</b> ready
                  </span>
                  {counts.problems > 0 && (
                    <span className="t-error">
                      <b>{counts.problems}</b> need attention
                    </span>
                  )}
                  {counts.done > 0 && (
                    <span>
                      <b>{counts.done}</b> already in sheet
                    </span>
                  )}
                  {counts.written > 0 && (
                    <span className="t-ok">
                      <b>{counts.written}</b> written
                    </span>
                  )}
                  {(checking || !allRead) && <span className="muted">{allRead ? "Checking..." : "Reading photos..."}</span>}
                </div>
                <div className="actions">
                  {(counts.written > 0 || counts.done > 0) && (
                    <button className="btn" onClick={clearFinished} disabled={writing}>
                      Clear finished
                    </button>
                  )}
                  <button
                    className="btn btn-primary"
                    data-tour="write"
                    disabled={counts.ready === 0 || writing || checking || !allRead}
                    onClick={() => setConfirming(true)}
                  >
                    Write {counts.ready || ""} seal{counts.ready === 1 ? "" : "s"}
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {workbook && <ActivityLog version={logVersion} onChanged={() => { loadWorkbook(); setResults({}); }} />}
      </main>

      {confirming && (
        <div className="modal-backdrop" onClick={() => !writing && setConfirming(false)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3>Write these seal numbers?</h3>
            <table className="confirm-table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Container</th>
                  <th>Seal</th>
                </tr>
              </thead>
              <tbody>
                {ready.map((r) => (
                  <tr key={r.set.id}>
                    <td className="num">{r.result?.row}</td>
                    <td className="mono">{formatContainer(r.result?.container ?? r.container)}</td>
                    <td className="mono">{r.result?.seal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {counts.problems > 0 && (
              <p className="muted">{counts.problems} set{counts.problems === 1 ? "" : "s"} with problems will be skipped.</p>
            )}
            <div className="modal-actions">
              <button className="btn" onClick={() => setConfirming(false)} disabled={writing}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={write} disabled={writing}>
                {writing ? "Writing..." : "Write"}
              </button>
            </div>
          </div>
        </div>
      )}

      {touring && <Tutorial onClose={() => setTouring(false)} />}
    </div>
  );
}

function Cell(props: {
  photo: Photo | null;
  value: string;
  placeholder: string;
  disabled: boolean;
  flag?: string;
  onChange: (v: string) => void;
  onKind: (k: Kind) => void;
}) {
  const { photo } = props;
  return (
    <div className="cell">
      {photo ? (
        <a href={photo.url} target="_blank" rel="noreferrer" className="thumb" title={photo.name}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo.url} alt="" />
        </a>
      ) : (
        <div className="thumb thumb-empty">No photo</div>
      )}
      <div className="cell-body">
        {photo?.state === "reading" ? (
          <span className="muted">Reading...</span>
        ) : (
          <input
            className={`num-input${props.flag ? " is-bad" : ""}`}
            value={props.value}
            placeholder={props.placeholder}
            disabled={props.disabled}
            spellCheck={false}
            autoCapitalize="characters"
            onChange={(e) => props.onChange(e.target.value)}
          />
        )}
        {props.flag && <span className="flag">{props.flag}</span>}
        {photo && photo.state !== "reading" && photo.kind === "unclear" && !props.disabled && (
          <span className="kind-switch">
            Is this a
            <button onClick={() => props.onKind("container")}>container</button>
            or
            <button onClick={() => props.onKind("seal")}>seal</button>?
          </span>
        )}
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  reading: "Reading",
  pending: "Checking",
  ready: "Ready",
  done: "Already in sheet",
  error: "Problem",
  review: "Check numbers",
  written: "Written",
};

function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status]}</span>;
}

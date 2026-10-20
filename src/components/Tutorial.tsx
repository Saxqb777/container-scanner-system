"use client";

import { useCallback, useEffect, useId, useRef, useState, type DragEvent } from "react";
import { formatContainer } from "@/lib/iso6346";
import { PRACTICE_SETS, markTutorialDone, practiceResults, type PracticePhoto, type PracticeSet } from "@/lib/tutorial";

type Rect = { x: number; y: number; w: number; h: number };
type Layout = { holes: Rect[]; top: number | null; left: number | null };
type PhotoState = "tray" | "reading" | "read";
type SetStatus = "empty" | "waiting" | "reading" | "pending" | "ready" | "error" | "written";

const RESULTS = practiceResults();
const [SET1, SET2] = PRACTICE_SETS;
const STEP_COUNT = 5;
const READ_MS = 1100;
const CHECK_MS = 700;
const MOBILE = 720;

// Per step, the parts of the real screen to light up. Each inner list is tried in order.
const STEP_TARGETS: string[][][] = [
  [["sheet"]],
  [["dropzone"]],
  [["scan"]],
  [["write", "scan"]],
  [["download"], ["activity"]],
  [],
];

const BADGE: Partial<Record<SetStatus, string>> = {
  reading: "Reading",
  pending: "Checking",
  ready: "Ready",
  error: "Problem",
  written: "Written",
};

const photoKey = (set: PracticeSet, kind: PracticePhoto["kind"]) => `${set.id}:${kind}`;

function findTargets(groups: string[][]): Element[] {
  return groups.flatMap((names) => {
    for (const name of names) {
      const el = document.querySelector(`[data-tour="${name}"]`);
      if (el) return [el];
    }
    return [];
  });
}

function sameLayout(a: Layout, b: Layout) {
  return (
    a.top === b.top &&
    a.left === b.left &&
    a.holes.length === b.holes.length &&
    a.holes.every((h, i) => h.x === b.holes[i].x && h.y === b.holes[i].y && h.w === b.holes[i].w && h.h === b.holes[i].h)
  );
}

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function Tutorial({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [photos, setPhotos] = useState<Record<string, PhotoState>>(() =>
    Object.fromEntries(PRACTICE_SETS.flatMap((s) => [[photoKey(s, "container"), "tray"], [photoKey(s, "seal"), "tray"]])),
  );
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [confirming, setConfirming] = useState(false);
  const [written, setWritten] = useState(false);
  const [undone, setUndone] = useState(false);
  const [layout, setLayout] = useState<Layout>({ holes: [], top: null, left: null });
  const cardRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const timers = useRef<number[]>([]);
  const ids = useId();
  const maskId = `${ids}-mask`;

  const close = useCallback(() => {
    markTutorialDone();
    onClose();
  }, [onClose]);

  // Seen once is enough: even a reload halfway through should not bring it back on its own.
  useEffect(() => {
    markTutorialDone();
    const previous = document.activeElement as HTMLElement | null;
    const pending = timers.current;
    // Extra room at the bottom so short pages can still scroll a target up to the top.
    const body = document.body;
    const padding = body.style.paddingBottom;
    body.style.paddingBottom = "70vh";
    return () => {
      pending.forEach((t) => window.clearTimeout(t));
      body.style.paddingBottom = padding;
      previous?.focus?.();
    };
  }, []);

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  // Esc skips; Tab stays inside the card.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      const card = cardRef.current;
      if (e.key !== "Tab" || !card) return;
      const items = Array.from(
        card.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex="-1"])'),
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!card.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  // Bring the step's target into view and move focus to the new step's title.
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
    const [first] = findTargets(STEP_TARGETS[step]);
    if (!first) return;
    const offset = window.innerWidth < MOBILE ? 64 : 76;
    const top = first.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top: Math.max(0, top), behavior: reducedMotion() ? "auto" : "smooth" });
  }, [step]);

  // Follow the targets every frame so scrolling, resizing and smooth scroll all stay in sync.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const pad = 6;
      const holes = findTargets(STEP_TARGETS[step]).map((el) => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left - pad), y: Math.round(r.top - pad), w: Math.round(r.width + pad * 2), h: Math.round(r.height + pad * 2) };
      });
      let top: number | null = null;
      let left: number | null = null;
      const card = cardRef.current;
      if (card && holes.length > 0 && vw >= MOBILE) {
        const gap = 14;
        const margin = 16;
        const cw = card.offsetWidth;
        const ch = card.offsetHeight;
        const anchor = holes[0];
        if (anchor.y + anchor.h + gap + ch <= vh - margin) top = anchor.y + anchor.h + gap;
        else if (anchor.y - gap - ch >= margin) top = anchor.y - gap - ch;
        else top = Math.max(margin, vh - margin - ch);
        left = Math.min(Math.max(anchor.x, margin), vw - margin - cw);
      }
      const next = { holes, top, left };
      setLayout((prev) => (sameLayout(prev, next) ? prev : next));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step]);

  function statusOf(set: PracticeSet): SetStatus {
    const c = photos[photoKey(set, "container")];
    const s = photos[photoKey(set, "seal")];
    if (c === "tray" && s === "tray") return "empty";
    if (c === "reading" || s === "reading") return "reading";
    if (c === "tray" || s === "tray") return "waiting";
    if (!checked[set.id]) return "pending";
    if (set === SET1 && written && !undone) return "written";
    return RESULTS[set.id].status === "ready" ? "ready" : "error";
  }

  function place(set: PracticeSet, kind: PracticePhoto["kind"]) {
    const key = photoKey(set, kind);
    if (photos[key] !== "tray") return;
    const inFlight = Object.values(photos).filter((p) => p === "reading").length;
    setPhotos((p) => ({ ...p, [key]: "reading" }));
    later(() => setPhotos((p) => ({ ...p, [key]: "read" })), READ_MS + inFlight * 350);
  }

  // Once both photos of a set are read, "check" it against the practice sheet.
  const scheduled = useRef(new Set<string>());
  useEffect(() => {
    for (const set of PRACTICE_SETS) {
      const bothRead = photos[photoKey(set, "container")] === "read" && photos[photoKey(set, "seal")] === "read";
      if (!bothRead || scheduled.current.has(set.id)) continue;
      scheduled.current.add(set.id);
      later(() => setChecked((c) => ({ ...c, [set.id]: true })), CHECK_MS);
    }
  }, [photos]);

  const activeSet = step === 1 ? SET1 : step === 2 ? SET2 : null;
  const trayPhotos = activeSet
    ? [activeSet.container, activeSet.seal].filter((p) => photos[photoKey(activeSet, p.kind)] === "tray")
    : [];

  function placeAll() {
    if (!activeSet) return;
    for (const p of trayPhotos) place(activeSet, p.kind);
    boxRef.current?.focus();
  }

  function placeOne(p: PracticePhoto) {
    if (!activeSet) return;
    place(activeSet, p.kind);
    // The clicked tile disappears; keep focus somewhere useful.
    requestAnimationFrame(() => {
      const remaining = cardRef.current?.querySelector<HTMLElement>(".tour-sample");
      (remaining ?? boxRef.current)?.focus();
    });
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    e.currentTarget.classList.remove("is-over");
    if (!activeSet) return;
    const kind = e.dataTransfer.getData("text/plain");
    if (kind === "container" || kind === "seal") place(activeSet, kind);
    else placeAll();
  }

  const s1 = statusOf(SET1);
  const s2 = statusOf(SET2);
  const gate: Record<number, { ok: boolean; hint: string }> = {
    1: { ok: s1 === "ready" || s1 === "written", hint: "Tap both photos to continue" },
    2: { ok: s2 === "error", hint: "Drop set 2 to continue" },
    3: { ok: written, hint: "Press Write to continue" },
  };
  const blocked = gate[step] && !gate[step].ok;

  function goNext() {
    if (blocked) return;
    setConfirming(false);
    setStep((n) => n + 1);
  }

  const done = step === STEP_COUNT;
  const { holes } = layout;
  const anchored = !done && layout.top !== null && layout.left !== null;

  return (
    <div className="tour" data-step={step}>
      <svg className="tour-overlay" aria-hidden="true" width="100%" height="100%">
        <defs>
          <mask id={maskId}>
            <rect width="100%" height="100%" fill="white" />
            {holes.map((h, i) => (
              <rect key={i} x={h.x} y={h.y} width={h.w} height={h.h} rx="9" fill="black" />
            ))}
          </mask>
        </defs>
        <rect className="tour-dim" width="100%" height="100%" mask={`url(#${maskId})`} />
        {holes.map((h, i) => (
          <rect key={`${step}-${i}`} className="tour-ring" x={h.x} y={h.y} width={h.w} height={h.h} rx="9" />
        ))}
      </svg>

      <div
        ref={cardRef}
        className={`tour-card${anchored ? " is-anchored" : " is-center"}${done ? " is-done" : ""}`}
        style={anchored ? { top: layout.top!, left: layout.left! } : undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${ids}-title`}
        aria-describedby={`${ids}-body`}
      >
        {!done && (
          <div className="tour-head">
            <span className="tour-count">
              Step {step + 1} of {STEP_COUNT}
            </span>
            <button className="btn btn-ghost btn-small" onClick={close}>
              Skip tour
            </button>
          </div>
        )}
        {!done && (
          <div className="tour-progress" aria-hidden="true">
            {Array.from({ length: STEP_COUNT }, (_, i) => (
              <span key={i} className={i < step ? "is-past" : i === step ? "is-now" : ""} />
            ))}
          </div>
        )}

        <div className="tour-body" key={step}>
          {step === 0 && (
            <>
              <h2 id={`${ids}-title`} ref={titleRef} tabIndex={-1}>
                Start with the base sheet
              </h2>
              <p id={`${ids}-body`}>
                This is the loading plan Excel. Seal Register finds its Container and Seal columns and counts how many
                containers are sealed. Upload it once, then fill it from photos.
              </p>
              <p className="tour-aside">A one-minute tour with a practice round. Nothing you do here touches your sheet.</p>
            </>
          )}

          {step === 1 && (
            <>
              <h2 id={`${ids}-title`} ref={titleRef} tabIndex={-1}>
                Drop a container, then its seal
              </h2>
              <p id={`${ids}-body`}>
                Each set is two photos: the container door, then the seal on it. Try it with these two.
              </p>
            </>
          )}

          {step === 2 && (
            <>
              <h2 id={`${ids}-title`} ref={titleRef} tabIndex={-1}>
                Every set gets a status
              </h2>
              <p id={`${ids}-body`}>
                {s2 === "error"
                  ? "Problem sets are never written. This seal is already on row 9, so the photo is wrong or the seal was used twice. Fix the number or remove the set."
                  : "Set 1 matched row 14, so it is Ready. Set 2 hides a mistake. Drop it and see what happens."}
              </p>
            </>
          )}

          {step === 3 && (
            <>
              <h2 id={`${ids}-title`} ref={titleRef} tabIndex={-1}>
                Write, then confirm
              </h2>
              <p id={`${ids}-body`}>
                Write takes only the Ready sets. You get one last look at row, container and seal before the sheet
                changes.
              </p>
            </>
          )}

          {step === 4 && (
            <>
              <h2 id={`${ids}-title`} ref={titleRef} tabIndex={-1}>
                Download it, undo if needed
              </h2>
              <p id={`${ids}-body`}>
                Download filled Excel gives back your original file with the seals filled in. Every write lands in
                Activity, and Undo empties that cell again.
              </p>
            </>
          )}

          {done && (
            <div className="tour-done">
              <Stamp />
              <h2 id={`${ids}-title`} ref={titleRef} tabIndex={-1}>
                You&apos;re ready
              </h2>
              <ul id={`${ids}-body`} className="tour-recap">
                <li>Read a set and saw it turn Ready</li>
                <li>Caught a seal already used on another container</li>
                <li>Wrote a seal, then saw where to undo it</li>
              </ul>
              <p className="tour-aside">Replay this any time with the ? button at the top.</p>
            </div>
          )}

          {(step === 1 || step === 2) && (
            <div className="tour-practice" aria-live="polite">
              {trayPhotos.length > 0 && (
                <div className="tour-tray">
                  <span className="tour-label">{step === 1 ? "Sample photos" : "Set 2"}</span>
                  <div className="tour-samples">
                    {trayPhotos.map((p) => (
                      <button
                        key={p.kind}
                        className="tour-sample"
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/plain", p.kind);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onClick={() => placeOne(p)}
                        aria-label={`Drop ${p.kind} photo: ${p.alt}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.src} alt="" draggable={false} />
                        <span>{p.kind === "container" ? "Container" : "Seal"}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div
                ref={boxRef}
                className={`tour-drop${trayPhotos.length === 0 ? " is-full" : ""}`}
                role={trayPhotos.length > 0 ? "button" : undefined}
                tabIndex={0}
                aria-label={trayPhotos.length > 0 ? "Practice drop zone. Press Enter to drop the photos." : "Practice sets"}
                onClick={() => trayPhotos.length > 0 && placeAll()}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && trayPhotos.length > 0) {
                    e.preventDefault();
                    placeAll();
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.currentTarget.classList.add("is-over");
                }}
                onDragLeave={(e) => e.currentTarget.classList.remove("is-over")}
                onDrop={onDrop}
              >
                {s1 === "empty" && <span className="tour-drop-hint">Drop here, or tap a photo</span>}
                {s1 !== "empty" && <PracticeRow n={1} set={SET1} status={s1} photos={photos} />}
                {step === 2 && s2 !== "empty" && <PracticeRow n={2} set={SET2} status={s2} photos={photos} />}
                {step === 2 && s2 === "empty" && <span className="tour-drop-hint">Drop set 2 here</span>}
              </div>

              {step === 2 && (
                <dl className="tour-legend">
                  <div>
                    <dt><span className="badge badge-ready">Ready</span></dt>
                    <dd>Matches the sheet. Will be written.</dd>
                  </div>
                  <div>
                    <dt><span className="badge badge-review">Check numbers</span></dt>
                    <dd>Unsure read. Compare with the photo.</dd>
                  </div>
                  <div>
                    <dt><span className="badge badge-error">Problem</span></dt>
                    <dd>Blocked. The red text says why.</dd>
                  </div>
                  <div>
                    <dt><span className="badge badge-done">Already in sheet</span></dt>
                    <dd>Same seal is already there.</dd>
                  </div>
                </dl>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="tour-practice" aria-live="polite">
              {!written && !confirming && (
                <div className="tour-actionbar">
                  <span className="summary">
                    <span><b>1</b> ready</span>
                    <span className="t-error"><b>1</b> need attention</span>
                  </span>
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      setConfirming(true);
                      requestAnimationFrame(() => cardRef.current?.querySelector<HTMLElement>(".tour-confirm .btn-primary")?.focus());
                    }}
                  >
                    Write 1 seal
                  </button>
                </div>
              )}
              {confirming && (
                <div className="tour-confirm">
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
                      <tr>
                        <td className="num">{RESULTS[SET1.id].row}</td>
                        <td className="mono">{formatContainer(RESULTS[SET1.id].container)}</td>
                        <td className="mono">{RESULTS[SET1.id].seal}</td>
                      </tr>
                    </tbody>
                  </table>
                  <p className="muted">1 set with problems will be skipped.</p>
                  <div className="modal-actions">
                    <button className="btn btn-small" onClick={() => setConfirming(false)}>
                      Cancel
                    </button>
                    <button
                      className="btn btn-primary btn-small"
                      onClick={() => {
                        setConfirming(false);
                        setWritten(true);
                        requestAnimationFrame(() => nextRef.current?.focus());
                      }}
                    >
                      Write
                    </button>
                  </div>
                </div>
              )}
              {written && (
                <>
                  <div className="tour-drop is-full">
                    <PracticeRow n={1} set={SET1} status="written" photos={photos} />
                  </div>
                  <p className="msg msg-ok">Wrote 1 seal number. Practice only: your real sheet is unchanged.</p>
                </>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="tour-practice" aria-live="polite">
              <ul className="log tour-log">
                {undone && (
                  <li className="tour-log-new">
                    <span className="log-text">
                      Row {RESULTS[SET1.id].row}: removed seal <b className="mono">{RESULTS[SET1.id].seal}</b> from{" "}
                      <b className="mono">{formatContainer(RESULTS[SET1.id].container)}</b>
                    </span>
                  </li>
                )}
                <li>
                  <span className="log-text">
                    Row {RESULTS[SET1.id].row}: <b className="mono">{formatContainer(RESULTS[SET1.id].container)}</b> sealed{" "}
                    <b className="mono">{RESULTS[SET1.id].seal}</b>
                  </span>
                  {!undone && (
                    <button
                      className="btn btn-ghost btn-small"
                      onClick={() => {
                        setUndone(true);
                        requestAnimationFrame(() => nextRef.current?.focus());
                      }}
                    >
                      Undo
                    </button>
                  )}
                </li>
              </ul>
            </div>
          )}
        </div>

        <div className="tour-foot">
          {done ? (
            <button className="btn btn-primary tour-finish" onClick={close}>
              Start scanning
            </button>
          ) : (
            <>
              <span className="tour-hint">{blocked ? gate[step].hint : ""}</span>
              <div className="actions">
                {step > 0 && (
                  <button className="btn" onClick={() => { setConfirming(false); setStep((n) => n - 1); }}>
                    Back
                  </button>
                )}
                <button ref={nextRef} className="btn btn-primary" onClick={goNext} disabled={blocked}>
                  {step === STEP_COUNT - 1 ? "Finish" : "Next"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PracticeRow({
  n,
  set,
  status,
  photos,
}: {
  n: number;
  set: PracticeSet;
  status: SetStatus;
  photos: Record<string, PhotoState>;
}) {
  const result = RESULTS[set.id];
  const showResult = status === "ready" || status === "error" || status === "written";
  return (
    <div className={`tour-set row-${status}`}>
      <span className="tour-set-no num">{n}</span>
      <div className="tour-set-photos">
        {[set.container, set.seal].map((p) => {
          const state = photos[photoKey(set, p.kind)];
          return (
            <div key={p.kind} className="tour-slot">
              {state === "tray" ? (
                <span className="thumb thumb-empty">{p.kind === "container" ? "Container" : "Seal"}</span>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img className={`thumb${state === "reading" ? " is-reading" : ""}`} src={p.src} alt={p.alt} />
              )}
              <span className={state === "read" ? "mono tour-value" : "muted tour-value"}>
                {state === "read" ? (p.kind === "container" ? formatContainer(p.value) : p.value) : state === "reading" ? "Reading..." : "Waiting"}
              </span>
            </div>
          );
        })}
      </div>
      <div className="tour-set-status">
        {showResult && <span className="muted num">Row {result.row ?? "-"}</span>}
        {BADGE[status] && <span className={`badge badge-${status}`}>{BADGE[status]}</span>}
      </div>
      {status === "error" && (
        <ul className="issues tour-issues">
          {result.issues.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stamp() {
  return (
    <svg className="tour-stamp" viewBox="0 0 120 120" aria-hidden="true">
      <defs>
        <path id="tour-stamp-ring" d="M60 60 m-41 0 a41 41 0 1 1 82 0 a41 41 0 1 1 -82 0" />
      </defs>
      <circle cx="60" cy="60" r="55" className="tour-stamp-line" strokeWidth="3" />
      <circle cx="60" cy="60" r="31" className="tour-stamp-line" strokeWidth="1.5" />
      <text className="tour-stamp-text" textLength="250" lengthAdjust="spacing">
        <textPath href="#tour-stamp-ring" startOffset="0">
          SEAL REGISTER · CHECKED · READY · 
        </textPath>
      </text>
      <path d="M46 61 l10 10 l19 -22" className="tour-stamp-line tour-stamp-check" strokeWidth="6" />
    </svg>
  );
}

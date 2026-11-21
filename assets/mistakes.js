/* NevaIB mistake log — window.NB.mistakes. Needs assets/store.js (+ assets/
   profile.js for subject hiding, like the other app pages).

   Every wrong answer in a Quiz session is stored as a "q-errors" record by
   quiz-engine.js; this page is the browsable log over those records. Phase 2
   optional fields (written by the quiz engine / this page, never required):
     errorType?  "careless" | "misread" | "content" | "time" | "other" ("" = untagged)
     reflection? ≤500 chars
     retries?    [{ts, correct, conf?}] — capped at 20 by the quiz engine
     dueAt?      epoch ms — when the spaced retest next comes due (quiz engine);
                 shown on open rows, cleared when a due retest is answered right
     retired? / retiredReason? / retiredAt? — reversible soft-hide ("not relevant");
                 restore writes an explicit retired:false (dropping reason/at) and
                 bumps ts — the sync/backup merge reads a MISSING retired field as
                 "written by a client predating the feature" and preserves the other
                 side's retirement; records are never hard-deleted here or in merges.
   The page's own filter state lives in "mistakes-filters" (LOCAL_ONLY in
   assets/store.js — device-local, never synced, scoped per user). */
(function () {
  "use strict";
  const NB = window.NB = window.NB || {};
  if (NB.mistakes) return;
  const KEY = "q-errors";
  const FKEY = "mistakes-filters";
  const S = NB.store;
  const esc = (window.NB && window.NB.escapeHtml) || ((s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"));

  const ERROR_TYPES = [["careless", "Careless slip"], ["misread", "Misread the question"], ["content", "Didn't know the content"], ["time", "Ran out of time"], ["other", "Other"]];
  const STATUSES = [["open", "Unresolved"], ["recovered", "Recovered"], ["retired", "Retired"], ["all", "All"]];
  const typeLabel = (v) => (ERROR_TYPES.find(t => t[0] === v) || [v, ""])[1];
  const subjectLabel = (id) => {
    if (!id) return "";
    const reg = (NB.SUBJECTS || []).find(s => s.id === id || (NB.canonicalSubject && NB.canonicalSubject(id)) === s.id);
    return reg ? reg.label : id;
  };

  // ---------- storage ----------
  const errors = () => { const v = S.get(KEY, []); return Array.isArray(v) ? v : []; };
  const find = (errs, key) => errs.find(e => e && e.key === key);

  // "retired" (soft-hidden) beats "recovered" (answered right in a review) beats "open"
  function statusOf(e) { return e && e.retired ? "retired" : (e && e.resolved ? "recovered" : "open"); }

  function filterRecords(records, f) {
    f = f || {};
    const status = f.status || "open";
    const subject = f.subject || "";
    const q = String(f.q || "").trim().toLowerCase();
    return (records || []).filter(e => {
      if (!e || !e.key) return false;
      if (status !== "all" && statusOf(e) !== status) return false;
      if (subject && e.subject !== subject) return false;
      // per-user subject profile (assets/profile.js), like today.js: a missed
      // question from a subject the account doesn't take is not shown
      if (e.subject && NB.profile && NB.profile.hides(e.subject)) return false;
      if (q && (String(e.stem || "") + " " + String(e.topicLabel || "")).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }

  // open first, then recovered, then retired; most recently touched first within a status
  function sortRecords(list) {
    const rank = { open: 0, recovered: 1, retired: 2 };
    const at = (e) => String((e.lastAttempt > e.lastMissed ? e.lastAttempt : e.lastMissed) || "");
    return list.slice().sort((a, b) => (rank[statusOf(a)] - rank[statusOf(b)]) || (at(b) < at(a) ? -1 : at(b) > at(a) ? 1 : (b.ts || 0) - (a.ts || 0)));
  }

  // ---------- mutators (all go through S.set("q-errors", …) → synced + dirty-marked) ----------
  function retire(key, reason) {
    const errs = errors(); const e = find(errs, key);
    if (!e) return false;
    e.retired = true;
    e.retiredReason = String(reason || "").trim().slice(0, 200);
    e.retiredAt = Date.now();
    e.ts = Date.now();
    return S.set(KEY, errs) !== false;
  }
  function restore(key) {
    const errs = errors(); const e = find(errs, key);
    if (!e) return false;
    // retired stays as an explicit false sentinel, not deleted: the record merge
    // (assets/store.js errMerge) reads a record with NO retired field as written by a
    // client predating the feature, and preserves the other side's "not relevant" state.
    e.retired = false; delete e.retiredReason; delete e.retiredAt;
    e.ts = Date.now();
    return S.set(KEY, errs) !== false;
  }
  function saveReflection(key, text) {
    const errs = errors(); const e = find(errs, key);
    if (!e) return false;
    const t = String(text == null ? "" : text).trim().slice(0, 500);
    if (t) e.reflection = t; else delete e.reflection;
    e.ts = Date.now();
    return S.set(KEY, errs) !== false;
  }
  function saveErrorType(key, v) {
    const errs = errors(); const e = find(errs, key);
    if (!e) return false;
    if (ERROR_TYPES.some(t => t[0] === v)) e.errorType = v; else delete e.errorType;
    e.ts = Date.now();
    return S.set(KEY, errs) !== false;
  }

  // ---------- filter state (device-local, "mistakes-filters") ----------
  function loadFilters() {
    const f = S.get(FKEY, null);
    const d = { status: "open", subject: "", q: "" };
    if (f && typeof f === "object" && !Array.isArray(f)) {
      if (STATUSES.some(s => s[0] === f.status)) d.status = f.status;
      if (typeof f.subject === "string") d.subject = f.subject;
      if (typeof f.q === "string") d.q = f.q;
    }
    return d;
  }
  const saveFilters = (f) => { S.set(FKEY, f); };

  // ---------- formatting helpers ----------
  const fmtDay = (iso) => {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  };
  const fmtTs = (ts) => { const d = new Date(ts); return isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short" }); };
  // local YYYY-MM-DD from epoch ms (the quiz engine's dueAt schedule, shown as written)
  const isoDay = (ms) => { const d = new Date(ms); return isNaN(d.getTime()) ? "" : d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const lastRetry = (e) => { const r = (Array.isArray(e.retries) ? e.retries : []).filter(x => x && typeof x === "object"); return r.length ? r[r.length - 1] : null; };
  const excerpt = (s, n) => { s = String(s || ""); return s.length > n ? s.slice(0, n).trimEnd() + "…" : s; };

  // ---------- rendering (browser only) ----------
  const STATUS_LABEL = { open: "Open", recovered: "Recovered", retired: "Retired" };

  function rowHtml(e) {
    const st = statusOf(e);
    const retries = lastRetry(e);
    const missed = [fmtDay(e.firstMissed), fmtDay(e.lastMissed)].filter(Boolean);
    const missedTxt = missed.length === 2 && missed[0] !== missed[1] ? `Missed ${missed[0]} \u2192 ${missed[1]}` : (missed.length ? `Missed ${missed[missed.length - 1]}` : "");
    const attempts = e.attempts || 1;
    const retryTxt = retries ? `last retry ${retries.correct ? "correct" : "wrong"} ${fmtTs(retries.ts)}` : "";
    const dueTxt = st === "open" && e.dueAt != null ? `due ${isoDay(e.dueAt)}` : "";
    const typeTxt = typeLabel(e.errorType);
    const notes = (e.subject && e.topic)
      ? `<a class="btn" href="notes.html?subject=${encodeURIComponent(e.subject)}&topic=${encodeURIComponent(e.topic)}">Open topic notes</a>` : "";
    return `<div class="mk-row" data-key="${esc(e.key)}">
      <div class="mk-head">
        <span class="mk-badge mk-${st}">${STATUS_LABEL[st]}</span>
        ${e.topicLabel ? `<span class="mk-topic">${esc(String(e.topicLabel))}</span>` : ""}
        ${typeTxt ? `<span class="chip mk-type">${esc(typeTxt)}</span>` : ""}
      </div>
      <div class="mk-stem">${esc(excerpt(e.stem, 120))}</div>
      <div class="mk-meta muted">${[missedTxt, `${attempts} attempt${attempts === 1 ? "" : "s"}`, retryTxt, dueTxt].filter(Boolean).map(esc).join(" \u00b7 ")}</div>
      ${e.reflection ? `<div class="mk-reflect">${esc(String(e.reflection))}</div>` : ""}
      ${st === "retired" ? `<div class="mk-why muted">Not relevant${e.retiredReason ? ": " + esc(String(e.retiredReason)) : ""}.</div>` : ""}
      <div class="mk-actions">
        ${st === "retired" ? "" : `<a class="btn mk-retry" href="quiz.html?errkeys=${encodeURIComponent(e.key)}">Retry this question</a>`}
        ${notes}
        <button class="btn mk-edit">Edit</button>
        ${st === "retired"
          ? `<button class="btn mk-restore">Restore</button>`
          : `<button class="btn mk-retire">Not relevant\u2026</button>`}
      </div>
      <div class="mk-editor" hidden>
        <label>Error type
          <select class="mk-type-sel"><option value="">—</option>${ERROR_TYPES.map(t => `<option value="${t[0]}"${e.errorType === t[0] ? " selected" : ""}>${esc(t[1])}</option>`).join("")}</select>
        </label>
        <label>Reflection <span class="muted">(what to do differently, \u2264 500 characters)</span>
          <textarea class="mk-reflect-in" maxlength="500" rows="3">${esc(e.reflection || "")}</textarea>
        </label>
        <button class="btn primary mk-save">Save</button>
      </div>
    </div>`;
  }

  function wireRow(el, row, rerender) {
    const key = row.getAttribute("data-key");
    const editor = row.querySelector(".mk-editor");
    const editBtn = row.querySelector(".mk-edit");
    if (editBtn) editBtn.addEventListener("click", () => { editor.hidden = !editor.hidden; });
    const retireBtn = row.querySelector(".mk-retire");
    if (retireBtn) retireBtn.addEventListener("click", () => {
      const reason = typeof prompt === "function" ? prompt("Why is this one not relevant? (optional)") : "";
      if (reason === null) return;
      retire(key, reason); rerender();
    });
    const restoreBtn = row.querySelector(".mk-restore");
    if (restoreBtn) restoreBtn.addEventListener("click", () => { restore(key); rerender(); });
    const saveBtn = row.querySelector(".mk-save");
    if (saveBtn) saveBtn.addEventListener("click", () => {
      const sel = row.querySelector(".mk-type-sel"), txt = row.querySelector(".mk-reflect-in");
      saveErrorType(key, sel ? sel.value : "");
      saveReflection(key, txt ? txt.value : "");
      rerender();
    });
  }

  function renderList(el, f, rerender) {
    const box = el.querySelector("#mk-list");
    const all = errors();
    const rows = sortRecords(filterRecords(all, f));
    const EMPTY = {
      open: "No unresolved mistakes \u2014 nice.",
      recovered: "Nothing recovered yet \u2014 answer a missed question correctly in a review and it lands here.",
      retired: "Nothing is marked as not relevant.",
      all: "No mistakes recorded yet \u2014 they appear automatically when a Quiz answer is wrong."
    };
    box.innerHTML = rows.length
      ? rows.map(rowHtml).join("")
      : `<p class="muted">${EMPTY[f.status || "open"] || EMPTY.open}</p>`;
    box.querySelectorAll(".mk-row").forEach(row => wireRow(el, row, rerender));
  }

  function renderFilters(el, f, rerender) {
    const subjects = [];
    errors().forEach(e => { if (e && e.subject && subjects.indexOf(e.subject) < 0) subjects.push(e.subject); });
    if (f.subject && subjects.indexOf(f.subject) < 0) subjects.push(f.subject);
    const sel = el.querySelector("#mk-status"), sub = el.querySelector("#mk-subject"), q = el.querySelector("#mk-q");
    sel.innerHTML = STATUSES.map(s => `<option value="${s[0]}"${f.status === s[0] ? " selected" : ""}>${esc(s[1])}</option>`).join("");
    sub.innerHTML = `<option value="">All subjects</option>` +
      subjects.map(id => `<option value="${esc(id)}"${f.subject === id ? " selected" : ""}>${esc(subjectLabel(id))}</option>`).join("");
    q.value = f.q;
    const apply = () => {
      f.status = sel.value; f.subject = sub.value; f.q = q.value;
      saveFilters(f); rerender();
    };
    sel.addEventListener("change", apply);
    sub.addEventListener("change", apply);
    q.addEventListener("input", apply);
  }

  // mounted state: the panel element + live filters, so a store change can re-render
  let PANEL = null, FILTERS = null;

  function mount(el) {
    el.innerHTML = `
      <p class="muted">Every wrong answer in a Quiz session is kept here until a review answers it correctly. Tag why you missed it, write a short reflection, retry a single question, and file the ones that no longer matter as \u201cnot relevant\u201d \u2014 nothing is ever deleted, and retired questions can come back with Restore.</p>
      <div class="mk-filters">
        <label>Status <select id="mk-status"></select></label>
        <label>Subject <select id="mk-subject"></select></label>
        <label class="mk-q-label">Search <input id="mk-q" type="search" placeholder="stem or topic\u2026"></label>
      </div>
      <div id="mk-list"></div>`;
    PANEL = el;
    FILTERS = loadFilters();
    const redraw = () => renderList(el, FILTERS, redraw);
    renderFilters(el, FILTERS, redraw);
    redraw();
  }

  NB.mistakes = { ERROR_TYPES, statusOf, filterRecords, sortRecords, retire, restore, saveReflection, saveErrorType, mount };

  // re-render when q-errors changes (sync arriving, another tab, or this page's
  // edits) — same debounced watch as today.js; the storage event only fires in
  // OTHER tabs, where keys are physical ("<user>:q-errors"), hence the suffix match
  let timer = null;
  const rerender = () => { if (PANEL && FILTERS) renderList(PANEL, FILTERS, rerender); };
  const later = () => { clearTimeout(timer); timer = setTimeout(rerender, 300); };
  if (S && S.onChange) S.onChange((k) => { if (k === KEY) later(); });
  window.addEventListener("storage", (e) => { if (e && e.key && e.key.indexOf(KEY) >= 0) later(); });

  const boot = () => { const el = document.getElementById("mistakes-panel"); if (el && S) mount(el); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

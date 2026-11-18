/* NevaIB full backup + safe restore — window.NB.backup. Needs assets/store.js.

   Backup file: {format: "nevaib-backup", version: 3, schema, created, keys: {...}}
   with every progress key in this browser (quiz/cards progress, q-errors, quizlog,
   uploads, checklist rows chk:*, week:*, lists, res-*, settings) and any
   quarantined unreadable values. Never included: login token, API override,
   sync bookkeeping, safety snapshots.

   Restore reads that format, the older Cards export (version 1), the older
   author-page export (version 2) and the server's action=export file. It
   validates every key, shows a summary, takes a local safety snapshot first, and
   MERGES by default (nothing in this browser is lost; per-record newest-wins for
   progress, the current value wins other conflicts). "Replace" is an explicit
   opt-in that overwrites the keys contained in the file. */
(function () {
  "use strict";
  const NB = window.NB = window.NB || {};
  const S = NB.store, M = NB.merge;
  if (!S || !M || NB.backup) return;

  const FORMAT = "nevaib-backup", VERSION = 3;
  const isObj = M.isObj;
  const isStr = (v) => typeof v === "string";
  const arrOf = (pred) => (v) => Array.isArray(v) && v.every(pred);

  // ── validation ──────────────────────────────────────────────────────────
  // per key: type check for the whole value (fail → key rejected) and an optional
  // record filter (bad records dropped, counted as warnings)
  const RAG = ["", "r", "a", "g"];
  const SPEC = {
    "fc-state": { type: isObj, record: (r) => isObj(r) && typeof r.box === "number" && r.box >= 0 && r.box <= 5 && isStr(r.due), label: "flashcard progress" },
    "q-errors": { type: Array.isArray, record: (r) => isObj(r) && isStr(r.key) && r.key !== "", label: "missed questions" },
    "quizlog": { type: Array.isArray, record: (r) => isObj(r) && isStr(r.date), label: "quiz session log" },
    "fc-user": { type: Array.isArray, record: (r) => isObj(r) && isStr(r.id) && isStr(r.front) && isStr(r.back), label: "your own cards" },
    "fc-deleted": { type: arrOf(isStr), label: "deleted seeded cards" },
    "fc-edits": { type: isObj, label: "edited seeded cards" },
    "q-userbanks": { type: Array.isArray, record: (r) => isObj(r) && Array.isArray(r.items), label: "uploaded quiz banks" },
    "fc-userdecks": { type: Array.isArray, record: (r) => isObj(r) && Array.isArray(r.cards), label: "uploaded card decks" },
    "tok-objects": { type: (v) => isObj(v) && Array.isArray(v.items), label: "TOK object shortlist" },
    "ee-ideas": { type: (v) => isObj(v) && Array.isArray(v.items), label: "EE idea log" },
    "io-issues": { type: (v) => isObj(v) && Array.isArray(v.items), label: "IO issues list" },
    "ia-debriefs": { type: isObj, label: "IA debrief notes" },
    "res-bookmarks": { type: arrOf(isStr), label: "pinned resources" },
    "res-notes": { type: isObj, label: "resource notes" },
    "res-recent": { type: arrOf(isStr), label: "recently opened" },
    "pp-scores": { type: Array.isArray, record: (r) => isObj(r) && isStr(r.id) && r.id !== "" && (r.deleted === true || (isStr(r.date) && typeof r.score === "number" && typeof r.max === "number")), label: "past-paper scores" },
    "fc-theme": { type: (v) => v === "dark" || v === "light", label: "theme" },
    "lib-filters": { type: isObj, label: "library filters" }
  };
  function specFor(k) {
    if (SPEC[k]) return SPEC[k];
    if (/^chk:.+/.test(k)) return { type: (v) => isObj(v) && (v.c === undefined || typeof v.c === "boolean") && (v.r === undefined || RAG.indexOf(v.r) >= 0), label: "checklist rows", group: "chk" };
    if (/^week:\d+$/.test(k)) return { type: isStr, label: "this-week items", group: "week" };
    return null;
  }
  function cleanRecords(spec, v) {
    if (!spec.record) return { value: v, dropped: 0 };
    if (Array.isArray(v)) { const ok = v.filter(spec.record); return { value: ok, dropped: v.length - ok.length }; }
    const out = {}; let dropped = 0;
    Object.keys(v).forEach(id => { if (spec.record(v[id])) out[id] = v[id]; else dropped++; });
    return { value: out, dropped };
  }

  // ── reading the supported file formats ──────────────────────────────────
  const V2_MAP = { qUserBanks: "q-userbanks", fcUserDecks: "fc-userdecks", fcState: "fc-state", fcUser: "fc-user", fcDeleted: "fc-deleted", fcEdits: "fc-edits", quizlog: "quizlog" };
  const V1_MAP = { state: "fc-state", user: "fc-user", deleted: "fc-deleted", edits: "fc-edits" };
  function siteRows(ss, into) {
    if (!isObj(ss)) return;
    Object.entries(isObj(ss.checklists) ? ss.checklists : {}).forEach(([k, v]) => { into[k] = v; });
    Object.entries(isObj(ss.week) ? ss.week : {}).forEach(([k, v]) => { into[k] = v; });
  }

  function parse(text) {
    const res = { ok: false, errors: [], warnings: [], format: null, created: null, keys: {}, quarantine: null };
    let data;
    try { data = typeof text === "string" ? JSON.parse(text) : text; }
    catch (e) { res.errors.push("Not valid JSON: " + e.message); return res; }
    if (!isObj(data)) { res.errors.push("Not a NevaIB backup (expected a JSON object)."); return res; }
    let raw = {};
    if (data.format === FORMAT && isObj(data.keys)) {
      res.format = "full backup (v" + (data.version || "?") + ")"; res.created = data.created || null; raw = data.keys;
      if (typeof data.schema === "number" && data.schema > S.SCHEMA_VERSION) res.errors.push("This backup comes from a newer app version (data schema " + data.schema + "). Reload the app to update it first.");
      if (isObj(data.quarantine)) res.quarantine = data.quarantine;
    } else if (data.format === "nevaib-server-export" && (isObj(data.state) || data.state === null)) {
      res.format = "server export"; res.created = data.exported_at || null;
      Object.entries(data.state || {}).forEach(([k, v]) => { if (k === "site-state") siteRows(v, raw); else raw[k] = v; });
    } else if (data.version === 2 && Object.keys(V2_MAP).some(k => k in data)) {
      res.format = "author-page export (v2)"; res.created = data.exported || null;
      Object.keys(V2_MAP).forEach(k => { if (data[k] !== undefined) raw[V2_MAP[k]] = data[k]; });
    } else if ((data.version === 1 || data.version === undefined) && Object.keys(V1_MAP).some(k => k in data)) {
      res.format = "Cards export (v1)"; res.created = data.exported || null;
      Object.keys(V1_MAP).forEach(k => { if (data[k] !== undefined) raw[V1_MAP[k]] = data[k]; });
    } else {
      res.errors.push("Not a NevaIB backup: no recognised format.");
      return res;
    }
    Object.keys(raw).forEach(k => {
      const v = raw[k];
      if (S.isLocalOnly(k)) { res.warnings.push("Ignored \"" + k + "\" (never restored from a file)."); return; }
      const spec = specFor(k);
      if (!spec) { res.warnings.push("Ignored unknown key \"" + k + "\"."); return; }
      if (v === null || v === undefined) return;
      if (!spec.type(v)) { res.errors.push("\"" + k + "\" (" + spec.label + ") has the wrong shape — the file looks damaged."); return; }
      const c = cleanRecords(spec, v);
      if (c.dropped) res.warnings.push(c.dropped + " unreadable record(s) in \"" + k + "\" will be skipped.");
      res.keys[k] = c.value;
    });
    if (!res.errors.length && !Object.keys(res.keys).length) res.errors.push("The file contains no progress to restore.");
    res.ok = res.errors.length === 0;
    return res;
  }

  // ── building a backup ───────────────────────────────────────────────────
  function collect() {
    const keys = {};
    S.progressKeys().forEach(k => { const v = S.get(k, null); if (v !== null) keys[k] = v; });
    const quarantine = {};
    S.keys(S.CORRUPT_PREFIX).forEach(k => { quarantine[k] = S.getRaw(k); });
    const out = { format: FORMAT, version: VERSION, schema: S.SCHEMA_VERSION, created: new Date().toISOString(), app: "NevaIB", keys: keys };
    if (Object.keys(quarantine).length) out.quarantine = quarantine;
    return out;
  }
  function filename(d) {
    const p = (n) => String(n).padStart(2, "0");
    d = d || new Date();
    return "nevaib-backup-" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + ".json";
  }
  function download(obj, name) {
    const blob = new Blob([JSON.stringify(obj || collect(), null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name || filename();
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ── summary + restore ───────────────────────────────────────────────────
  function count(v) {
    if (Array.isArray(v)) return v.length;
    if (isObj(v) && Array.isArray(v.items)) return v.items.length;
    if (isObj(v)) return Object.keys(v).length;
    return v === null || v === undefined || v === "" ? 0 : 1;
  }
  function mergeOne(k, local, incoming) {
    if (local === null || local === undefined) return incoming;
    if (M.RECORDS[k]) return M.RECORDS[k](incoming, local); // newest wins; tie keeps the current value
    return M.union(k, local, incoming);                    // current value wins conflicts, gaps filled
  }
  function summarize(parsed) {
    const groups = {};
    Object.keys(parsed.keys).forEach(k => {
      const spec = specFor(k);
      const g = spec.group || k;
      const local = S.get(k, null), inc = parsed.keys[k];
      const row = groups[g] = groups[g] || { key: g, label: spec.label, incoming: 0, current: 0, changes: 0 };
      if (spec.group) { row.incoming += 1; row.current += local === null ? 0 : 1; }
      else { row.incoming = count(inc); row.current = count(local); }
      if (!M.same(mergeOne(k, local, inc), local)) row.changes += spec.group ? 1 : Math.max(1, Math.abs(count(mergeOne(k, local, inc)) - count(local)));
    });
    return Object.values(groups);
  }

  function restore(parsed, mode, opts) {
    opts = opts || {};
    if (!parsed || !parsed.ok) return { ok: false, error: "Nothing valid to restore." };
    const snap = S.snapshot("before restoring a backup (" + (mode === "replace" ? "replace" : "merge") + ")");
    if (!snap && !opts.withoutSnapshot) return { ok: false, needBackup: true, error: "Couldn't save a safety copy in this browser (storage full?)." };
    let changed = 0;
    const failed = [];
    Object.keys(parsed.keys).forEach(k => {
      const inc = parsed.keys[k];
      const next = mode === "replace" ? inc : mergeOne(k, S.get(k, null), inc);
      if (M.same(next, S.get(k, null))) return;
      if (S.set(k, next)) changed++; else failed.push(k); // non-silent → marked for sync
    });
    if (parsed.quarantine) Object.keys(parsed.quarantine).forEach(k => {
      if (k.indexOf(S.CORRUPT_PREFIX) === 0 && S.getRaw(k) === null) S.setRaw(k, String(parsed.quarantine[k]));
    });
    return { ok: failed.length === 0, changed, failed, snapshot: snap, error: failed.length ? "Could not write: " + failed.join(", ") : null };
  }

  function undoLast() {
    const s = S.snapshots().find(x => /^before restoring a backup/.test(x.reason || ""));
    if (!s) return { ok: false, error: "No safety copy from a restore in this browser." };
    const snap = S.getSnapshot(s.id);
    const keys = Object.keys(snap.keys || {});
    S.snapshot("before undoing a restore");
    // keys that didn't exist before the restore are left in place (never delete progress)
    keys.forEach(k => { const raw = snap.keys[k]; if (raw !== null) { try { S.set(k, JSON.parse(raw)); } catch (e) { S.setRaw(k, raw); } } });
    return { ok: true, restoredFrom: s.at, keys: keys.length };
  }

  // ── small UI: summary + mode + confirm, built with textContent only ─────
  function el(tag, text, attrs) {
    const e = document.createElement(tag);
    if (text !== undefined && text !== null) e.textContent = text;
    Object.entries(attrs || {}).forEach(([k, v]) => { if (k === "style") e.style.cssText = v; else e.setAttribute(k, v); });
    return e;
  }
  function openRestore(text, container, done) {
    container.innerHTML = "";
    const box = el("div", null, { class: "nb-restore", style: "border:1px solid #ccd;border-radius:10px;padding:.8rem;margin:.6rem 0" });
    container.appendChild(box);
    const parsed = parse(text);
    box.appendChild(el("h4", "Restore from backup", { style: "margin:.1rem 0 .4rem" }));
    if (parsed.format) box.appendChild(el("p", "File: " + parsed.format + (parsed.created ? " \u00b7 made " + parsed.created : ""), { class: "muted" }));
    parsed.errors.forEach(m => box.appendChild(el("p", "\u2717 " + m, { style: "color:#a12" })));
    if (!parsed.ok) { const c = el("button", "Close", { class: "btn" }); c.onclick = () => { container.innerHTML = ""; }; box.appendChild(c); return parsed; }
    const tbl = el("table", null, { class: "wt", style: "width:100%;font-size:.9rem" });
    const hr = el("tr"); ["What", "In file", "In this browser", "Changes on merge"].forEach(h => hr.appendChild(el("th", h)));
    tbl.appendChild(hr);
    summarize(parsed).forEach(r => {
      const tr = el("tr");
      [r.label, r.incoming, r.current, r.changes ? "+" + r.changes : "none"].forEach(c => tr.appendChild(el("td", String(c))));
      tbl.appendChild(tr);
    });
    box.appendChild(tbl);
    parsed.warnings.forEach(m => box.appendChild(el("p", "\u26a0 " + m, { class: "muted" })));
    const modes = el("div", null, { style: "margin:.6rem 0" });
    const mk = (val, label, checked) => {
      const l = el("label", null, { style: "display:block;margin:.2rem 0" });
      const r = el("input", null, { type: "radio", name: "nb-restore-mode", value: val });
      if (checked) r.setAttribute("checked", "checked");
      r.checked = !!checked;
      l.appendChild(r); l.appendChild(document.createTextNode(" " + label));
      modes.appendChild(l); return r;
    };
    const rMerge = mk("merge", "Merge into this browser (recommended \u2014 nothing here is lost)", true);
    const rReplace = mk("replace", "Replace: overwrite these items with the file's copy", false);
    box.appendChild(modes);
    box.appendChild(el("p", "A safety copy of this browser's data is saved first; \u201cUndo last restore\u201d brings it back.", { class: "muted" }));
    const go = el("button", "Restore", { class: "btn primary" });
    const cancel = el("button", "Cancel", { class: "btn", style: "margin-left:.4rem" });
    const out = el("p");
    box.appendChild(go); box.appendChild(cancel); box.appendChild(out);
    cancel.onclick = () => { container.innerHTML = ""; };
    go.onclick = () => {
      const mode = rReplace.checked ? "replace" : "merge";
      if (mode === "replace" && !window.confirm("Replace overwrites the matching items in this browser with the file's copy (a safety copy is kept). Continue?")) return;
      let r = restore(parsed, mode);
      if (!r.ok && r.needBackup) {
        if (!window.confirm("This browser is too full to keep a safety copy. Download a backup of the current data first, then restore?")) return;
        download(collect(), filename().replace("backup", "before-restore"));
        r = restore(parsed, mode, { withoutSnapshot: true });
      }
      go.disabled = true;
      out.textContent = r.ok ? "\u2713 Restored (" + r.changed + " item(s) updated). Reload the page to see everything." : "\u2717 " + r.error;
      if (r.ok) { const rl = el("button", "Reload now", { class: "btn", style: "margin-left:.4rem" }); rl.onclick = () => location.reload(); out.appendChild(rl); }
      if (done) done(r);
    };
    return parsed;
  }

  NB.backup = { FORMAT, VERSION, collect, parse, summarize, restore, undoLast, download, filename, openRestore };
})();

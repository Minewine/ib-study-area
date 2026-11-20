/* NevaIB resources — window.NB.resources. Needs assets/store.js (+ assets/
   profile.js for subject hiding, like the other app pages).

   Page-level "My resources": a title, subject, topic, type, link and an optional
   note, tagged to a syllabus topic. Stored in the SAME synced key the notes page
   uses for its per-note links ("my-res"), so one list powers both:
     {id: {note?, subject?, topic?, type?, comment?, label, url, t}}
   — note = a topic-note id (set by the notes page or the "also show on the topic
   note" checkbox), the rest are this page's tags. Deletions become
   {note?/subject?, deleted: true, t} tombstones so they win the per-item sync /
   backup merge (NB.merge.RECORDS["my-res"], newest t wins); assets/backup.js
   validates the extended shape. Nothing here is pre-seeded.

   Hard rules: a resource is a LINK only — url must be http(s):// or file://
   (≤2000 chars, same rule as notes.js safeUrl); file contents are never stored
   (no base64 PDFs in localStorage); and nothing in "my-res" is ever read by the
   quiz or card engines — resources can never become quiz content. */
(function () {
  "use strict";
  const NB = window.NB = window.NB || {};
  if (NB.resources) return;
  const KEY = "my-res";
  const S = NB.store;
  const esc = (window.NB && NB.escapeHtml) || ((s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"));

  const TYPES = [["website", "Website"], ["video", "Video"], ["doc", "Document / file"], ["practice", "Practice questions"], ["other", "Other"]];
  const typeLabel = (v) => (TYPES.find(t => t[0] === v) || [v, ""])[1];
  const subjectLabel = (id) => {
    if (!id) return "";
    const reg = (NB.SUBJECTS || []).find(s => s.id === id || (NB.canonicalSubject && NB.canonicalSubject(id)) === s.id);
    return reg ? reg.label : id;
  };
  const safeUrl = (u) => { const s = String(u || "").trim(); return /^(https?:\/\/|file:\/\/)\S+$/i.test(s) && s.length <= 2000 ? s : ""; };
  const newId = () => "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // ---------- storage ----------
  const all = () => { const v = S.get(KEY, {}); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; };

  // shared validation for add + edit; returns {rec} or {error}. opts.allowNoSubject
  // lets an edit keep a record that never had a subject (note-scoped links).
  function validate(input, opts) {
    const label = String(input.label == null ? "" : input.label).trim().slice(0, 200);
    if (!label) return { error: "Add a title." };
    const url = safeUrl(input.url);
    if (!url) return { error: "Links must start with http://, https:// or file:// (max 2000 characters)." };
    const subject = NB.canonicalSubject ? NB.canonicalSubject(String(input.subject || "").trim()) : String(input.subject || "").trim();
    if (!subject && !(opts && opts.allowNoSubject)) return { error: "Pick a subject." };
    const rec = { label: label, url: url, t: Date.now() };
    if (subject) rec.subject = subject;
    const topic = String(input.topic == null ? "" : input.topic).trim().slice(0, 120);
    if (topic) rec.topic = topic;
    if (TYPES.some(t => t[0] === input.type)) rec.type = input.type;
    const comment = String(input.comment == null ? "" : input.comment).trim().slice(0, 500);
    if (comment) rec.comment = comment;
    const note = String(input.note == null ? "" : input.note).trim();
    if (note) rec.note = note.slice(0, 120);
    return { rec: rec };
  }

  function add(input) {
    const v = validate(input);
    if (v.error) return v;
    const map = all();
    const id = newId();
    map[id] = v.rec;
    if (S.set(KEY, map) === false) return { error: "Could not save (storage full?)." };
    return { ok: true, id: id };
  }

  function update(id, input) {
    const map = all(), cur = map[id];
    if (!cur) return { error: "That resource no longer exists." };
    // the row editor sends no subject — an edit keeps the record's own subject
    // (and a note-scoped record stays note-scoped: allowNoSubject)
    const merged = Object.assign({}, input, { subject: input.subject === undefined ? cur.subject : input.subject });
    const v = validate(merged, { allowNoSubject: !cur.subject && input.subject === undefined });
    if (v.error) return v;
    const rec = v.rec;
    rec.t = Math.max(Date.now(), (cur.t || 0) + 1); // must beat the record this edit replaces
    rec.note = input.note === undefined ? cur.note : rec.note; // edits keep a note link unless the caller changed it
    map[id] = rec;
    if (S.set(KEY, map) === false) return { error: "Could not save (storage full?)." };
    return { ok: true, id: id };
  }

  function remove(id) {
    const map = all(), cur = map[id];
    if (!cur) return false;
    // tombstone keeps subject/note for context; deletion must win the merge
    const t = { deleted: true, t: Math.max(Date.now(), (cur.t || 0) + 1) };
    if (cur.note) t.note = cur.note;
    if (cur.subject) t.subject = cur.subject;
    map[id] = t;
    return S.set(KEY, map) !== false;
  }

  // ---------- topic index (for the datalist + the "also show on the note" link) ----------
  // {subjectId: [{key, code, title, id}]} from library/topic-notes/manifest.json
  let TOPICS = null;
  function setTopicIndex(manifest) {
    const out = {};
    ((manifest && manifest.notes) || []).forEach((n) => {
      if (!n || !n.subject || !n.file) return;
      const key = String(n.file).split("/").pop().replace(/\.json$/i, "");
      (out[n.subject] = out[n.subject] || []).push({ key: key, code: n.code || "", title: n.title || "", id: n.id || "" });
    });
    Object.keys(out).forEach((k) => out[k].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)));
    TOPICS = out;
    return out;
  }
  function loadTopics() {
    if (TOPICS) return Promise.resolve(TOPICS);
    const base = (typeof location !== "undefined" && String(location.pathname).includes("/app/")) ? "../" : "";
    return fetch(base + "library/topic-notes/manifest.json", { cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then((m) => setTopicIndex(m))
      .catch(() => { TOPICS = TOPICS || {}; return TOPICS; });
  }
  const topicsFor = (subject) => ((TOPICS || {})[subject] || []);
  const noteIdFor = (subject, topic) => {
    const hit = topicsFor(subject).find((t) => t.key === topic);
    return hit ? hit.id : "";
  };

  // ---------- filtering / sorting ----------
  function filterRecords(records, f) {
    f = f || {};
    const subject = f.subject || "";
    const type = f.type || "";
    const q = String(f.q || "").trim().toLowerCase();
    return Object.entries(records || {}).filter(([, r]) => {
      if (!r || r.deleted) return false;
      if (!r.label || !safeUrl(r.url)) return false;
      if (subject && r.subject !== subject) return false;
      if (type && r.type !== type) return false;
      // per-user subject profile (assets/profile.js), like mistakes.js
      if (r.subject && NB.profile && NB.profile.hides(r.subject)) return false;
      if (q && (String(r.label || "") + " " + String(r.topic || "") + " " + String(r.comment || "")).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  const sortRecords = (list) => list.slice().sort((a, b) => (b[1].t || 0) - (a[1].t || 0));

  // deep links a row offers: the topic's notes page and the Upload page's AI picker
  function notesUrl(rec) {
    return (rec.subject && rec.topic) ? `notes.html?subject=${encodeURIComponent(rec.subject)}&topic=${encodeURIComponent(rec.topic)}` : "";
  }
  function makeQuestionsUrl(rec) {
    if (!rec.subject) return "";
    return `author.html?ai-subject=${encodeURIComponent(rec.subject)}${rec.topic ? "&ai-topic=" + encodeURIComponent(rec.topic) : ""}`;
  }

  // ---------- rendering (browser only) ----------
  const fmtTs = (ts) => { const d = new Date(ts); return isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short" }); };

  function topicOptions(subject) {
    return topicsFor(subject).map((t) => ({ v: t.key, l: (t.code ? t.code + " " : "") + t.title }));
  }

  function rowHtml(rec, id) {
    const nu = notesUrl(rec), mu = makeQuestionsUrl(rec);
    return `<div class="res-row" data-id="${esc(id)}">
      <div class="res-head">
        <a class="res-link" href="${esc(safeUrl(rec.url))}" target="_blank" rel="noopener noreferrer">${esc(rec.label)}</a>
        ${rec.type ? `<span class="chip res-type">${esc(typeLabel(rec.type))}</span>` : ""}
      </div>
      <div class="res-meta muted">${[
        subjectLabel(rec.subject) ? esc(subjectLabel(rec.subject)) : "",
        rec.topic ? esc(rec.topic) : "",
        fmtTs(rec.t) ? "added " + fmtTs(rec.t) : ""
      ].filter(Boolean).join(" \u00b7 ")}</div>
      ${rec.comment ? `<div class="res-comment">${esc(rec.comment)}</div>` : ""}
      <div class="res-actions">
        ${nu ? `<a class="btn" href="${esc(nu)}">Topic notes</a>` : ""}
        ${mu ? `<a class="btn res-makeq" href="${esc(mu)}">Make questions\u2026</a>` : ""}
        <button type="button" class="btn res-edit">Edit</button>
        <button type="button" class="btn res-del">Delete</button>
      </div>
      <div class="res-editor" hidden>
        <label>Title <input class="res-e-label" maxlength="200" value="${esc(rec.label)}"></label>
        <label>Link <input class="res-e-url" maxlength="2000" value="${esc(rec.url)}"></label>
        <label>Type
          <select class="res-e-type"><option value="">—</option>${TYPES.map((t) => `<option value="${t[0]}"${rec.type === t[0] ? " selected" : ""}>${esc(t[1])}</option>`).join("")}</select>
        </label>
        <label>Topic <span class="muted">(syllabus code or key, e.g. a1-1)</span>
          <input class="res-e-topic" maxlength="120" value="${esc(rec.topic || "")}">
        </label>
        <label>Note <span class="muted">(what it is / why it helped, \u2264 500 characters)</span>
          <textarea class="res-e-comment" maxlength="500" rows="2">${esc(rec.comment || "")}</textarea>
        </label>
        <button type="button" class="btn primary res-save">Save</button>
      </div>
    </div>`;
  }

  function wireRow(panel, row, rerender) {
    const id = row.getAttribute("data-id");
    const editor = row.querySelector(".res-editor");
    const editBtn = row.querySelector(".res-edit");
    if (editBtn) editBtn.addEventListener("click", () => { editor.hidden = !editor.hidden; });
    const delBtn = row.querySelector(".res-del");
    if (delBtn) delBtn.addEventListener("click", () => {
      if (!remove(id)) {
        const msg = panel.querySelector("#res-msg");
        if (msg) msg.textContent = "Could not delete (storage full?).";
      }
      rerender();
    });
    const saveBtn = row.querySelector(".res-save");
    if (saveBtn) saveBtn.addEventListener("click", () => {
      const val = (c) => { const e = row.querySelector(c); return e ? e.value : ""; };
      const res = update(id, { label: val(".res-e-label"), url: val(".res-e-url"), type: val(".res-e-type"), topic: val(".res-e-topic"), comment: val(".res-e-comment"), note: undefined });
      const msg = panel.querySelector("#res-msg");
      if (res.error) { if (msg) msg.textContent = res.error; return; } // keep her in-progress editor open
      if (msg) msg.textContent = "";
      rerender();
    });
  }

  function renderList(panel, f, rerender) {
    const box = panel.querySelector("#res-list");
    const rows = sortRecords(filterRecords(all(), f));
    box.innerHTML = rows.length
      ? rows.map(([id, r]) => rowHtml(r, id)).join("")
      : `<p class="muted">No resources here yet${(f.subject || f.type || f.q) ? " for this filter" : ""} — add one above. Resources are your own links; they never turn into quiz questions.</p>`;
    box.querySelectorAll(".res-row").forEach((row) => wireRow(panel, row, rerender));
    const count = panel.querySelector("#res-count");
    if (count) count.textContent = rows.length ? `${rows.length} resource${rows.length === 1 ? "" : "s"}` : "";
  }

  // filter subjects come from the records (a subject with no resources has no row
  // to filter); the account's profile hides subjects it doesn't take
  function filterSubjects(f) {
    const subjects = [];
    Object.values(all()).forEach((r) => {
      if (r && !r.deleted && r.subject && subjects.indexOf(r.subject) < 0 && !(NB.profile && NB.profile.hides(r.subject))) subjects.push(r.subject);
    });
    if (f && f.subject && subjects.indexOf(f.subject) < 0) subjects.push(f.subject);
    subjects.sort();
    return subjects;
  }

  // options-only refresh (no listener rebinding): a sync can bring in a subject
  // the dropdown has never seen while the page is open
  function refreshFilterSubjects(panel, f) {
    const sel = panel.querySelector("#res-subject");
    if (!sel) return;
    sel.innerHTML = `<option value="">All subjects</option>` +
      filterSubjects(f).map((id) => `<option value="${esc(id)}"${f.subject === id ? " selected" : ""}>${esc(subjectLabel(id))}</option>`).join("");
  }

  function renderFilters(panel, f, rerender) {
    const sel = panel.querySelector("#res-subject"), typ = panel.querySelector("#res-type"), q = panel.querySelector("#res-q");
    sel.innerHTML = `<option value="">All subjects</option>` +
      filterSubjects(f).map((id) => `<option value="${esc(id)}"${f.subject === id ? " selected" : ""}>${esc(subjectLabel(id))}</option>`).join("");
    typ.innerHTML = `<option value="">All types</option>` +
      TYPES.map((t) => `<option value="${t[0]}"${f.type === t[0] ? " selected" : ""}>${esc(t[1])}</option>`).join("");
    q.value = f.q;
    const apply = () => { f.subject = sel.value; f.type = typ.value; f.q = q.value; renderList(panel, f, rerender); };
    sel.addEventListener("change", apply);
    typ.addEventListener("change", apply);
    q.addEventListener("input", apply);
  }

  function renderAddForm(panel, rerender) {
    const form = panel.querySelector("#res-add-form"), msg = panel.querySelector("#res-msg");
    const subject = panel.querySelector("#res-subject-add"), topic = panel.querySelector("#res-topic"), list = panel.querySelector("#res-topics");
    const noteWrap = panel.querySelector("#res-note-wrap"), noteChk = panel.querySelector("#res-note-link");
    const fillSubjects = () => {
      const allowed = (NB.SUBJECTS || []).filter((s) => !(NB.profile && NB.profile.hides(s.id)));
      subject.innerHTML = `<option value=""></option>` +
        allowed.map((s) => `<option value="${esc(s.id)}">${esc(s.label)}</option>`).join("");
    };
    const fillTopics = () => {
      const opts = topicOptions(subject.value);
      list.innerHTML = opts.map((t) => `<option value="${esc(t.v)}">${esc(t.l)}</option>`).join("");
      const has = topicsFor(subject.value).some((t) => t.key === topic.value.trim());
      noteWrap.hidden = !has;
      if (has) noteChk.checked = true;
    };
    subject.addEventListener("change", fillTopics);
    topic.addEventListener("input", fillTopics);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const note = noteChk.checked ? noteIdFor(subject.value, topic.value.trim()) : "";
      const res = add({
        label: panel.querySelector("#res-label").value,
        subject: subject.value,
        topic: topic.value,
        type: panel.querySelector("#res-type-add").value,
        url: panel.querySelector("#res-url").value,
        comment: panel.querySelector("#res-comment").value,
        note: note,
      });
      if (res.error) { msg.textContent = res.error; return; }
      msg.textContent = "";
      form.reset();
      fillTopics();
      rerender();
    });
    fillSubjects();
    loadTopics().then(fillTopics);
  }

  // mounted state: the panel element + live filters, so a store change can re-render
  let PANEL = null, FILTERS = null;

  function mount(el) {
    el.innerHTML = `
      <p class="muted">Your own collection of links for your subjects: class notes, videos, files on this device, practice pages. Each one is tagged to a subject and (optionally) a syllabus topic, and can also show on that topic's note. Resources are links only \u2014 they never become quiz questions or flashcards, and file contents are never uploaded or stored.</p>
      <div class="res-filters">
        <label>Subject <select id="res-subject"></select></label>
        <label>Type <select id="res-type"></select></label>
        <label class="res-q-label">Search <input id="res-q" type="search" placeholder="title, topic or note\u2026"></label>
        <span id="res-count" class="muted"></span>
      </div>
      <form id="res-add-form" class="res-add">
        <div class="res-grid">
          <label>Title <input id="res-label" maxlength="200" placeholder="e.g. My class notes on water"></label>
          <label>Subject <select id="res-subject-add"></select></label>
          <label>Topic <span class="muted">(syllabus code or key)</span> <input id="res-topic" maxlength="120" list="res-topics" placeholder="a1-1">
            <datalist id="res-topics"></datalist></label>
          <label>Type <select id="res-type-add">${TYPES.map((t) => `<option value="${t[0]}"${t[0] === "website" ? " selected" : ""}>${esc(t[1])}</option>`).join("")}</select></label>
          <label class="res-url-label">Link <input id="res-url" type="url" maxlength="2000" placeholder="https://\u2026 or file://\u2026"></label>
          <label>Note <span class="muted">(what it is / why it helped)</span> <input id="res-comment" maxlength="500" placeholder="e.g. the osmosis diagram at 4:30"></label>
        </div>
        <label id="res-note-wrap" hidden><input type="checkbox" id="res-note-link"> Also show on the topic note</label>
        <p><button type="submit" class="btn primary">Add resource</button> <span id="res-msg" class="res-msg" role="status"></span></p>
      </form>
      <div id="res-list"></div>`;
    PANEL = el;
    FILTERS = { subject: "", type: "", q: "" };
    const redraw = () => renderList(el, FILTERS, redraw);
    renderFilters(el, FILTERS, redraw);
    renderAddForm(el, redraw);
    redraw();
  }

  NB.resources = { TYPES, safeUrl, all, filterRecords, sortRecords, validate, add, update, remove, setTopicIndex, topicsFor, noteIdFor, notesUrl, makeQuestionsUrl, mount };

  // re-render when my-res changes (sync arriving, another tab, or this page's edits)
  let timer = null;
  const rerender = () => { if (PANEL && FILTERS) { refreshFilterSubjects(PANEL, FILTERS); renderList(PANEL, FILTERS, rerender); } };
  const later = () => { clearTimeout(timer); timer = setTimeout(rerender, 300); };
  if (S && S.onChange) S.onChange((k) => { if (k === KEY) later(); });
  window.addEventListener("storage", (e) => { if (e && e.key && e.key.indexOf(KEY) >= 0) later(); });

  const boot = () => { const el = document.getElementById("resources-panel"); if (el && S) mount(el); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

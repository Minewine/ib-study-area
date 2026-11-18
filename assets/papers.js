/* NevaIB past-paper score log — window.NB.papers. Needs assets/store.js.

   She sits real past papers through school; this only records the result.
   Storage key "pp-scores" (synced, in backups): an array of records
     {id, date: "YYYY-MM-DD", subject, paper, score, max, notes, ts}
   A deleted record becomes a tombstone {id, deleted: true, ts} so the deletion
   wins the per-record sync merge (NB.merge.RECORDS["pp-scores"], newest ts wins)
   instead of the record coming back from another device. */
(function () {
  "use strict";
  const NB = window.NB = window.NB || {};
  if (NB.papers) return;
  const KEY = "pp-scores";
  const S = NB.store;

  const SUBJECTS = [
    ["chemistry-hl", "Chemistry HL"], ["biology-hl", "Biology HL"], ["math-aa-sl", "Maths AA SL"],
    ["english-lit-hl", "English Lit HL"], ["french-a-langlit", "French A Lang & Lit SL"], ["history-sl", "History SL"],
    ["other", "Other"]
  ];
  const subjectLabel = (k) => (SUBJECTS.find(s => s[0] === k) || [k, k])[1];
  const isDate = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };

  // returns an error message, or "" when the entry is valid
  function check(r) {
    if (!r || typeof r !== "object") return "Nothing to save.";
    if (!isDate(r.date)) return "Pick a date.";
    if (!r.subject) return "Pick a subject.";
    if (!String(r.paper || "").trim()) return "Say which paper it was (e.g. Paper 1A, Nov 2024).";
    if (typeof r.max !== "number" || !isFinite(r.max) || r.max <= 0) return "Max must be a number above 0.";
    if (typeof r.score !== "number" || !isFinite(r.score) || r.score < 0 || r.score > r.max) return "Score must be between 0 and the max.";
    return "";
  }

  const raw = () => { const v = S.get(KEY, []); return Array.isArray(v) ? v : []; };
  // live records, newest paper date first
  function list() {
    return raw().filter(r => r && !r.deleted && r.id)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.ts || 0) - (a.ts || 0));
  }
  function add(entry) {
    const rec = {
      id: "pp-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7),
      date: entry.date, subject: String(entry.subject), paper: String(entry.paper || "").trim().slice(0, 80),
      score: Number(entry.score), max: Number(entry.max), notes: String(entry.notes || "").trim().slice(0, 500), ts: Date.now()
    };
    const err = check(rec);
    if (err) return { ok: false, error: err };
    const all = raw(); all.push(rec);
    const saved = S.set(KEY, all);
    return { ok: saved !== false, record: rec, error: saved === false ? "Could not save (storage full?)." : "" };
  }
  function remove(id) {
    const all = raw();
    const i = all.findIndex(r => r && r.id === id);
    if (i < 0) return false;
    all[i] = { id, deleted: true, ts: Math.max(Date.now(), (all[i].ts || 0) + 1) };
    return S.set(KEY, all) !== false;
  }
  const pct = (r) => r.max ? Math.round(100 * r.score / r.max) : 0;

  // per subject: number of papers, latest %, mean % of the last three
  function summary(records) {
    const by = {};
    (records || list()).forEach(r => { (by[r.subject] = by[r.subject] || []).push(r); });
    return Object.keys(by).map(k => {
      const rs = by[k]; // already newest first
      const last3 = rs.slice(0, 3);
      return { subject: k, label: subjectLabel(k), count: rs.length, latest: pct(rs[0]), recentMean: Math.round(last3.reduce((s, r) => s + pct(r), 0) / last3.length) };
    });
  }

  // ── UI (only when the page has #pp-panel) ────────────────────────────────
  function mount(el) {
    el.innerHTML = `
      <p class="muted">Log the real past papers you sit at school (your teacher marks them). Nothing from the papers is stored here, only your score.</p>
      <div class="setup-grid">
        <div><label for="pp-date">Date</label><input id="pp-date" type="date"></div>
        <div><label for="pp-subject">Subject</label><select id="pp-subject">${SUBJECTS.map(s => `<option value="${s[0]}">${esc(s[1])}</option>`).join("")}</select></div>
        <div><label for="pp-paper">Paper</label><input id="pp-paper" list="pp-paper-list" placeholder="e.g. Paper 1A, May 2024"><datalist id="pp-paper-list"><option value="Paper 1"><option value="Paper 1A"><option value="Paper 1B"><option value="Paper 2"><option value="Paper 3"></datalist></div>
        <div><label for="pp-score">Score</label><input id="pp-score" type="number" min="0" step="0.5"></div>
        <div><label for="pp-max">Out of</label><input id="pp-max" type="number" min="1" step="0.5"></div>
        <div><label for="pp-notes">Notes (optional)</label><input id="pp-notes" placeholder="what cost marks, what to revise"></div>
      </div>
      <div id="pp-error" class="pp-error"></div>
      <button id="pp-add" class="btn primary">Save score</button>
      <div id="pp-summary"></div>
      <div id="pp-list"></div>`;
    el.querySelector("#pp-date").value = today();
    el.querySelector("#pp-add").addEventListener("click", () => {
      const v = (id) => el.querySelector("#" + id).value;
      const num = (id) => v(id) === "" ? NaN : Number(v(id));
      const res = add({ date: v("pp-date"), subject: v("pp-subject"), paper: v("pp-paper"), score: num("pp-score"), max: num("pp-max"), notes: v("pp-notes") });
      el.querySelector("#pp-error").textContent = res.ok ? "" : res.error;
      if (res.ok) { ["pp-paper", "pp-score", "pp-max", "pp-notes"].forEach(id => { el.querySelector("#" + id).value = ""; }); render(el); }
    });
    render(el);
  }
  function render(el) {
    const rows = list();
    const sum = summary(rows);
    el.querySelector("#pp-summary").innerHTML = sum.length
      ? `<ul class="links">${sum.map(s => `<li><strong>${esc(s.label)}</strong>: ${s.count} paper${s.count === 1 ? "" : "s"} \u00b7 latest ${s.latest}% \u00b7 last ${Math.min(3, s.count)} average ${s.recentMean}%</li>`).join("")}</ul>` : "";
    el.querySelector("#pp-list").innerHTML = rows.length
      ? `<table class="pp-table"><thead><tr><th>Date</th><th>Subject</th><th>Paper</th><th>Score</th><th>Notes</th><th></th></tr></thead><tbody>${rows.map(r =>
        `<tr><td>${esc(r.date)}</td><td>${esc(subjectLabel(r.subject))}</td><td>${esc(r.paper)}</td><td>${esc(r.score)}/${esc(r.max)} (${pct(r)}%)</td><td>${esc(r.notes || "")}</td><td><button class="btn pp-del" data-id="${esc(r.id)}" title="Delete this entry">Delete</button></td></tr>`).join("")}</tbody></table>`
      : "<p class='muted'>No papers logged yet.</p>";
    el.querySelectorAll(".pp-del").forEach(b => b.addEventListener("click", () => {
      if (typeof confirm === "function" && !confirm("Delete this score?")) return;
      remove(b.getAttribute("data-id")); render(el);
    }));
  }

  NB.papers = { KEY, SUBJECTS, check, list, add, remove, summary, pct, mount };
  const boot = () => { const el = document.getElementById("pp-panel"); if (el && S) mount(el); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

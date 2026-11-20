/* NevaIB exam results & reflections — window.NB.papers. Needs assets/store.js.

   She sits real past papers through school; this only records the result, plus
   topic reflections without a score. Storage key "pp-scores" (synced, in backups):
   an array of records
     {id, date: "YYYY-MM-DD", subject, source: "teacher"|"self", paper?, topic?,
      score?, max?, notes, ts}
   score/max are optional — a scoreless record is a topic reflection; when either
   is given, both must be valid with max > 0. Older records without source/topic
   stay valid. A deleted record becomes a tombstone {id, deleted: true, ts} so the
   deletion wins the per-record sync merge (NB.merge.RECORDS["pp-scores"], newest
   ts wins) instead of the record coming back from another device. */
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
  const esc = (window.NB && window.NB.escapeHtml) || ((s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"));
  const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };

  // returns an error message, or "" when the entry is valid
  function check(r) {
    if (!r || typeof r !== "object") return "Nothing to save.";
    if (!isDate(r.date)) return "Pick a date.";
    if (!r.subject) return "Pick a subject.";
    if (!String(r.paper || "").trim() && !String(r.topic || "").trim()) return "Say which paper it was, or name a topic to reflect on.";
    if (r.source !== undefined && r.source !== "teacher" && r.source !== "self") return "Say whether it was teacher-marked or self-assessed.";
    const hasScore = typeof r.score === "number" && isFinite(r.score);
    const hasMax = typeof r.max === "number" && isFinite(r.max);
    if (hasScore || hasMax) {
      if (!hasScore || !hasMax) return "Score and out-of go together — fill in both, or leave both empty.";
      if (r.max <= 0) return "Max must be a number above 0.";
      if (r.score < 0 || r.score > r.max) return "Score must be between 0 and the max.";
    }
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
      notes: String(entry.notes || "").trim().slice(0, 500), ts: Date.now()
    };
    const topic = String(entry.topic || "").trim().slice(0, 120);
    if (topic) rec.topic = topic;
    // passed through so check() can reject an invalid value; absent → teacher-marked
    rec.source = entry.source === undefined ? "teacher" : entry.source;
    // score/max are optional: only carry them onto the record when either was
    // given, so check() can insist the pair is complete and valid
    const hasScore = typeof entry.score === "number" && isFinite(entry.score);
    const hasMax = typeof entry.max === "number" && isFinite(entry.max);
    if (hasScore || hasMax) { rec.score = Number(entry.score); rec.max = Number(entry.max); }
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

  // per subject: number of papers (score-bearing records), latest %, mean % of the
  // last three, and the count of scoreless topic reflections
  function summary(records) {
    const by = {};
    (records || list()).forEach(r => { (by[r.subject] = by[r.subject] || []).push(r); });
    return Object.keys(by).map(k => {
      const rs = by[k]; // already newest first
      const scored = rs.filter(r => typeof r.score === "number" && typeof r.max === "number");
      const last3 = scored.slice(0, 3);
      return { subject: k, label: subjectLabel(k), count: scored.length,
        latest: scored.length ? pct(scored[0]) : 0,
        recentMean: last3.length ? Math.round(last3.reduce((s, r) => s + pct(r), 0) / last3.length) : 0,
        reflections: rs.length - scored.length };
    });
  }

  // ── UI (only when the page has #pp-panel) ────────────────────────────────
  function mount(el) {
    el.innerHTML = `
      <p class="muted">Log the real past papers you sit at school, or a topic you want to reflect on — scores are optional, and each entry records whether it was teacher-marked or self-assessed. Nothing from the papers is stored here, only your score.</p>
      <div class="setup-grid">
        <div><label for="pp-date">Date</label><input id="pp-date" type="date"></div>
        <div><label for="pp-subject">Subject</label><select id="pp-subject">${SUBJECTS.map(s => `<option value="${s[0]}">${esc(s[1])}</option>`).join("")}</select></div>
        <div><label>Source</label><div class="pp-src-radios"><label><input type="radio" name="pp-source" value="teacher" checked> Teacher-marked (at school)</label><label><input type="radio" name="pp-source" value="self"> Self-assessed</label></div></div>
        <div><label for="pp-paper">Paper</label><input id="pp-paper" list="pp-paper-list" placeholder="e.g. Paper 1A, May 2024"><datalist id="pp-paper-list"><option value="Paper 1"><option value="Paper 1A"><option value="Paper 1B"><option value="Paper 2"><option value="Paper 3"></datalist></div>
        <div><label for="pp-topic">Topic (optional)</label><input id="pp-topic" placeholder="e.g. Enzymes — what to re-study"></div>
        <div><label for="pp-score">Score (optional)</label><input id="pp-score" type="number" min="0" step="0.5"></div>
        <div><label for="pp-max">Out of (optional)</label><input id="pp-max" type="number" min="1" step="0.5"></div>
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
      const src = el.querySelector('input[name="pp-source"]:checked');
      const res = add({ date: v("pp-date"), subject: v("pp-subject"), paper: v("pp-paper"), topic: v("pp-topic"), source: src ? src.value : "teacher", score: num("pp-score"), max: num("pp-max"), notes: v("pp-notes") });
      el.querySelector("#pp-error").textContent = res.ok ? "" : res.error;
      if (res.ok) {
        ["pp-paper", "pp-topic", "pp-score", "pp-max", "pp-notes"].forEach(id => { el.querySelector("#" + id).value = ""; });
        const t = el.querySelector('input[name="pp-source"][value="teacher"]');
        if (t) t.checked = true;
        render(el);
      }
    });
    render(el);
  }
  function render(el) {
    const rows = list();
    const sum = summary(rows);
    el.querySelector("#pp-summary").innerHTML = sum.length
      ? `<ul class="links">${sum.map(s => {
          const papers = s.count ? `${s.count} paper${s.count === 1 ? "" : "s"} \u00b7 latest ${s.latest}% \u00b7 last ${Math.min(3, s.count)} average ${s.recentMean}%` : "";
          const refs = s.reflections ? `${s.reflections} topic reflection${s.reflections === 1 ? "" : "s"}` : "";
          return `<li><strong>${esc(s.label)}</strong>: ${[papers, refs].filter(Boolean).join(" \u00b7 ")}</li>`;
        }).join("")}</ul>` : "";
    el.querySelector("#pp-list").innerHTML = rows.length
      ? `<table class="pp-table"><thead><tr><th>Date</th><th>Subject</th><th>Source</th><th>Paper / topic</th><th>Score</th><th>Notes</th><th></th></tr></thead><tbody>${rows.map(r => {
          const src = r.source === "self" ? "Self-assessed" : (r.source === "teacher" ? "Teacher-marked" : "\u2014");
          const paper = r.paper || r.topic || "";
          const scored = typeof r.score === "number" && typeof r.max === "number";
          const score = scored ? `${esc(r.score)}/${esc(r.max)} (${pct(r)}%)` : `<span class="muted">\u2014</span>`;
          return `<tr><td>${esc(r.date)}</td><td>${esc(subjectLabel(r.subject))}</td><td><span class="chip pp-src">${esc(src)}</span></td><td>${esc(paper)}</td><td>${score}</td><td>${esc(r.notes || "")}</td><td><button class="btn pp-del" data-id="${esc(r.id)}" title="Delete this entry">Delete</button></td></tr>`;
        }).join("")}</tbody></table>`
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

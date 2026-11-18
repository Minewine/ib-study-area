/* IB Study Area — topic notes viewer (app/notes.html).
   Notes: library/topic-notes/<subject>/<code>.json, listed in library/topic-notes/manifest.json
   (schema in docs/DEVELOPMENT.md, "Topic notes"). Subject > theme > topic; key ideas are
   recall-first (cue shown, answer revealed on demand). Links open the quiz / cards pages on
   exactly the question and card ids the note lists. Everything is rendered with textContent, except the My resources list,
   which is built from NB.escapeHtml-escaped strings and only allows http(s):// and file:// links. */
(function () {
  "use strict";

  const PATH_BASE = location.pathname.includes("/app/") ? "../" : "";
  const store = (window.NB && window.NB.store) || {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  };
  const $ = (id) => document.getElementById(id);
  const fileId = (f) => String(f).split("/").pop().replace(/\.json$/i, "");

  // el("div", {class: "x", onclick: fn}, "text", child…) — text only, never innerHTML
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (k === "class") n.className = v;
      else n.setAttribute(k, v === true ? "" : String(v));
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c instanceof Node ? c : String(c));
    return n;
  }
  const section = (title, ...kids) => el("section", { class: "card nt-sec" }, el("h3", {}, title), ...kids);

  let MAN = null;
  const cache = {};

  async function getJSON(path) {
    const res = await fetch(PATH_BASE + path + "?cb=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error(res.status + " " + path);
    return res.json();
  }

  function themesFor(subject) {
    const s = MAN.subjects[subject] || { themes: [] };
    const rows = MAN.notes.filter(n => n.subject === subject);
    const order = (s.themes || []).map(t => t.key);
    const groups = {};
    rows.forEach(r => { (groups[r.theme] = groups[r.theme] || { key: r.theme, label: r.themeLabel, notes: [] }).notes.push(r); });
    return Object.values(groups).sort((a, b) => {
      const ia = order.indexOf(a.key), ib = order.indexOf(b.key);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || String(a.key).localeCompare(String(b.key), undefined, { numeric: true });
    });
  }

  function renderSubjects(active) {
    const bar = $("nt-subjects");
    bar.textContent = "";
    Object.entries(MAN.subjects).forEach(([key, s]) => {
      const count = MAN.notes.filter(n => n.subject === key).length;
      if (!count) return;
      bar.append(el("button", { class: "btn" + (key === active ? " primary" : ""), "data-subject": key, onclick: () => go(key, null) }, `${s.label} (${count})`));
    });
  }

  function renderIndex(subject) {
    const box = $("nt-index");
    box.textContent = "";
    themesFor(subject).forEach(t => {
      box.append(el("h3", {}, (/^\d+$/.test(t.key) ? "Topic " : "") + t.key + " — " + t.label));
      const list = el("div", { class: "nt-list" });
      t.notes.forEach(n => list.append(el("a", { href: `?subject=${encodeURIComponent(subject)}&topic=${encodeURIComponent(fileId(n.file))}`, class: "nt-item", "data-note": n.id,
        onclick: (e) => { e.preventDefault(); go(subject, fileId(n.file)); } },
        el("strong", {}, n.code), " ", n.title, n.hlOnly ? el("span", { class: "chip nt-hl" }, "HL only") : null)));
      box.append(list);
    });
  }

  function practiceLinks(note) {
    const L = note.links || {};
    const label = encodeURIComponent(`${note.code} ${note.title}`);
    const q = (L.quizBanks || []).map(b => "from=" + encodeURIComponent(fileId(b.file) + (b.itemIds ? ":" + b.itemIds.join(",") : "")));
    const c = (L.decks || []).map(d => "from=" + encodeURIComponent(fileId(d.file) + (d.cardIds ? ":" + d.cardIds.join(",") : "")));
    const nq = (L.quizBanks || []).reduce((a, b) => a + (b.itemIds ? b.itemIds.length : 0), 0);
    const nc = (L.decks || []).reduce((a, d) => a + (d.cardIds ? d.cardIds.length : 0), 0);
    const wrap = el("div", { class: "nt-practice" });
    if (q.length) wrap.append(el("a", { class: "btn primary", id: "nt-quiz", href: `quiz.html?${q.join("&")}&label=${label}` }, "Quiz on this topic" + (nq ? ` (${nq} linked)` : " (whole bank)")));
    if (c.length) wrap.append(el("a", { class: "btn primary", id: "nt-cards", href: `cards.html?${c.join("&")}&label=${label}` }, "Flashcards for this topic" + (nc ? ` (${nc} linked)` : " (whole deck)")));
    if (!q.length && !c.length) wrap.append(el("span", { class: "muted" }, "No quiz questions or flashcards for this topic yet."));
    if (L.gap) wrap.append(el("p", { class: "muted" }, L.gap));
    return wrap;
  }

  function reveal(label, ...content) {
    const body = el("div", { class: "nt-answer", hidden: true }, ...content);
    const btn = el("button", { class: "btn nt-mini", onclick: () => { body.hidden = !body.hidden; btn.textContent = body.hidden ? label : "Hide"; } }, label);
    return [btn, body];
  }

  function keyIdeas(note) {
    const list = el("ol", { class: "nt-ideas" });
    (note.keyIdeas || []).forEach(k => {
      const [btn, body] = reveal("Show answer", k.answer);
      list.append(el("li", { class: "nt-idea" + (k.ahl ? " nt-ahl" : "") }, el("div", { class: "nt-cue" }, k.cue, k.ahl ? el("span", { class: "chip nt-hl" }, "AHL") : null, k.stmt ? el("span", { class: "nt-stmt" }, k.stmt) : null), btn, body));
    });
    const all = el("button", { class: "btn nt-mini", onclick: () => {
      const open = all.dataset.open !== "1";
      list.querySelectorAll(".nt-answer").forEach(a => { a.hidden = !open; });
      list.querySelectorAll(".nt-idea > button").forEach(b => { b.textContent = open ? "Hide" : "Show answer"; });
      all.dataset.open = open ? "1" : ""; all.textContent = open ? "Hide all answers" : "Show all answers";
    } }, "Show all answers");
    return section("Key ideas — answer each cue before you reveal it", el("p", { class: "muted" }, "Say or write your answer first; retrieval is what makes it stick."), all, list);
  }

  function addTermCard(note, t, btn) {
    const user = store.get("fc-user", []);
    const id = "u-note-" + note.id + "-" + String(t.term).toLowerCase().replace(/\W+/g, "-").slice(0, 40);
    if (user.some(c => c.id === id)) { btn.textContent = "In your cards"; btn.disabled = true; return; }
    user.push({ id, type: "term", subject: note.subject, topic: note.id, topicLabel: `${note.code} ${note.title}`, tags: ["from-notes"], front: String(t.term).slice(0, 160), back: String(t.def).slice(0, 400) });
    if (store.set("fc-user", user) !== false) { btn.textContent = "Added ✓"; btn.disabled = true; }
  }

  function keyTerms(note) {
    const have = new Set(store.get("fc-user", []).map(c => c.id));
    const dl = el("dl", { class: "nt-terms" });
    (note.keyTerms || []).forEach(t => {
      const id = "u-note-" + note.id + "-" + String(t.term).toLowerCase().replace(/\W+/g, "-").slice(0, 40);
      const btn = el("button", { class: "btn nt-mini", disabled: have.has(id), title: "Add as one of your flashcards" }, have.has(id) ? "In your cards" : "+ card");
      btn.addEventListener("click", () => addTermCard(note, t, btn));
      dl.append(el("dt", {}, t.term, " ", btn), el("dd", {}, t.def));
    });
    return section("Key terms", dl);
  }

  function workedExamples(note) {
    return section("Worked examples", ...(note.workedExamples || []).map(w => {
      const steps = el("ol", { class: "nt-steps" });
      let shown = 0;
      const next = el("button", { class: "btn nt-mini" }, "Next step");
      const ans = el("p", { class: "nt-answer", hidden: true }, el("strong", {}, "Answer: "), w.answer || "");
      next.addEventListener("click", () => {
        if (shown < (w.steps || []).length) steps.append(el("li", {}, w.steps[shown++]));
        if (shown >= (w.steps || []).length) { ans.hidden = false; next.disabled = true; next.textContent = "All steps shown"; }
      });
      return el("div", { class: "nt-example" }, el("h4", {}, w.title || "Example"), el("p", {}, w.prompt), steps, ans, next);
    }));
  }

  function misconceptions(note) {
    return section("Common mistakes", el("ul", { class: "nt-mis" }, (note.misconceptions || []).map(m =>
      el("li", {}, el("div", { class: "nt-wrong" }, "✗ ", m.wrong), el("div", { class: "nt-right" }, "✓ ", m.right)))));
  }

  function practice(note) {
    const items = (note.practice || []).map(p => {
      const [btn, body] = reveal("Show self-check points", el("ul", {}, (p.checkpoints || []).map(c => el("li", {}, c))));
      return el("div", { class: "nt-prompt" }, el("p", {}, el("strong", {}, `${p.commandTerm || ""}${p.marks ? ` [${p.marks}]` : ""} `), p.prompt, p.ahl ? el("span", { class: "chip nt-hl" }, "AHL") : null), btn, body);
    });
    return section("Practice prompts", el("p", { class: "nt-label" }, "Self-check points written for this site to help you mark your own answer — not IB markschemes, and not predictions of exam questions."), ...items);
  }

  function paper1A(note) {
    return section("Paper 1A style — no calculator", ...(note.paper1A || []).map((q, qi) => {
      const why = el("p", { class: "nt-answer", hidden: true }, q.why || "");
      const box = el("div", { class: "nt-mcq" }, el("p", {}, el("strong", {}, `${qi + 1}. `), q.stem));
      (q.choices || []).forEach((c, i) => box.append(el("button", { class: "nt-choice", onclick: (e) => {
        box.querySelectorAll(".nt-choice").forEach((b, j) => { b.disabled = true; if (j === q.answer) b.classList.add("correct"); });
        if (i !== q.answer) e.currentTarget.classList.add("wrong");
        why.hidden = false;
      } }, String.fromCharCode(65 + i) + ". " + c)));
      box.append(why);
      return box;
    }));
  }

  function paper1B(note) {
    return section("Paper 1B style — data-based", ...(note.paper1B || []).map(q => {
      const [btn, body] = reveal("Show worked answer", q.answer || "");
      return el("div", { class: "nt-prompt" }, el("p", { class: "nt-data" }, q.data || ""), el("p", {}, q.prompt), btn, body);
    }));
  }

  function booklet(note) {
    const kids = [];
    if (Array.isArray(note.dataBooklet) && note.dataBooklet.length) {
      kids.push(el("h4", {}, "Data booklet"), el("ul", {}, note.dataBooklet.map(d => typeof d === "string"
        ? el("li", {}, d) : el("li", {}, el("strong", {}, `Section ${d.section}${d.title ? " — " + d.title : ""}: `), d.use || ""))));
    }
    const f = note.formulaBooklet;
    if (f && typeof f === "object") {
      kids.push(el("h4", {}, "Formula booklet"));
      if ((f.given || []).length) kids.push(el("p", {}, el("strong", {}, "Given in the booklet: ")), el("ul", {}, f.given.map(g => el("li", {}, g))));
      if ((f.memorise || []).length) kids.push(el("p", {}, el("strong", {}, "Not in the booklet — learn it: ")), el("ul", {}, f.memorise.map(g => el("li", {}, g))));
      if (f.note) kids.push(el("p", { class: "muted" }, f.note));
    }
    return kids.length ? section("Booklet", ...kids) : null;
  }

  function errorHints(note) {
    return section("Where marks get lost", el("ul", {}, (note.errorHints || []).map(h => el("li", {}, el("strong", {}, (h.category || "") + ": "), h.hint))));
  }

  function linking(note) {
    return section("Linking questions", el("ul", {}, (note.linkingQuestions || []).map(l => {
      const target = MAN.notes.find(n => n.subject === note.subject && n.code === l.to);
      return el("li", {}, target ? el("a", { href: `?subject=${encodeURIComponent(note.subject)}&topic=${encodeURIComponent(fileId(target.file))}`,
        onclick: (e) => { e.preventDefault(); go(note.subject, fileId(target.file)); } }, l.to) : el("strong", {}, l.to || ""), " — ", l.prompt);
    })));
  }

  // ── My resources: her own links per note, synced key "my-res" ───────────
  // {itemId: {note, label, url, t}} — a deleted link becomes {note, deleted: true, t} so the
  // deletion wins the per-item sync/restore merge (NB.merge.RECORDS["my-res"]). Nothing is pre-seeded.
  const RES_KEY = "my-res";
  const esc = (window.NB && window.NB.escapeHtml) || ((s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"));
  const safeUrl = (u) => { const s = String(u || "").trim(); return /^(https?:\/\/|file:\/\/)\S+$/i.test(s) && s.length <= 2000 ? s : ""; };
  const resAll = () => { const v = store.get(RES_KEY, {}); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; };
  const resFor = (noteId) => Object.entries(resAll()).filter(([, r]) => r && !r.deleted && r.note === noteId && safeUrl(r.url))
    .sort((a, b) => (a[1].t || 0) - (b[1].t || 0));

  function myResources(note) {
    const list = el("ul", { class: "nt-res", id: "nt-res-list" });
    const msg = el("p", { class: "nt-err", role: "status" });
    function draw() {
      const rows = resFor(note.id);
      list.innerHTML = rows.length ? rows.map(([id, r]) =>
        `<li><a href="${esc(safeUrl(r.url))}" target="_blank" rel="noopener noreferrer">${esc(r.label)}</a> ` +
        `<button type="button" class="btn nt-mini" data-del="${esc(id)}" aria-label="Delete ${esc(r.label)}">Delete</button></li>`).join("")
        : `<li class="muted">${esc("No links yet. Add your own notes, videos or files for this topic.")}</li>`;
    }
    list.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-del]");
      if (!b) return;
      const all = resAll(), id = b.getAttribute("data-del"), cur = all[id];
      if (!cur) return;
      all[id] = { note: cur.note, deleted: true, t: Math.max(Date.now(), (cur.t || 0) + 1) };
      store.set(RES_KEY, all);
      draw();
    });
    const label = el("input", { type: "text", id: "nt-res-label", placeholder: "Label, e.g. My class notes", maxlength: 200 });
    const url = el("input", { type: "url", id: "nt-res-url", placeholder: "https://… or file://…", maxlength: 2000 });
    const form = el("form", { class: "nt-res-form", onsubmit: (e) => {
      e.preventDefault();
      const l = label.value.trim(), u = safeUrl(url.value);
      if (!l) { msg.textContent = "Add a label."; return; }
      if (!u) { msg.textContent = "Links must start with http://, https:// or file://."; return; }
      const all = resAll();
      all["r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)] = { note: note.id, label: l.slice(0, 200), url: u, t: Date.now() };
      if (store.set(RES_KEY, all) === false) { msg.textContent = "Could not save (storage full?)."; return; }
      msg.textContent = ""; label.value = ""; url.value = "";
      draw();
    } }, label, url, el("button", { type: "submit", class: "btn nt-mini primary" }, "Add link"));
    draw();
    return section("My resources", el("p", { class: "muted" }, "Your own links for this topic (class notes, videos, files on this device). Saved with your progress and synced when you are logged in."), list, form, msg);
  }

  async function renderNote(subject, topic) {
    const view = $("nt-note");
    const row = MAN.notes.find(n => n.subject === subject && fileId(n.file) === topic);
    view.textContent = "";
    if (!row) { view.append(el("p", { class: "muted" }, "Pick a topic.")); return; }
    let note;
    try { note = cache[row.file] = cache[row.file] || await getJSON(row.file); }
    catch (e) { view.append(el("p", { class: "nt-err" }, "Could not load this note: " + e.message)); return; }
    const meta = [note.hlOnly ? "HL only" : null, note.taughtStatus ? "School: " + note.taughtStatus : null, note.status === "draft" ? "draft" : null].filter(Boolean).join(" · ");
    view.append(
      el("div", { class: "card nt-head" },
        el("a", { href: `?subject=${encodeURIComponent(subject)}`, class: "nt-back", onclick: (e) => { e.preventDefault(); go(subject, null); } }, "← All " + (MAN.subjects[subject] || {}).label + " topics"),
        el("h2", { id: "nt-title" }, `${note.code} ${note.title}`),
        el("p", { class: "muted" }, `${note.themeLabel || ""}${note.levelLabel ? " · " + note.levelLabel : ""}${meta ? " · " + meta : ""}`),
        note.bigPicture ? el("p", { class: "nt-big" }, note.bigPicture) : null,
        practiceLinks(note)),
      myResources(note),
      note.keyIdeas && note.keyIdeas.length ? keyIdeas(note) : null,
      note.keyTerms && note.keyTerms.length ? keyTerms(note) : null,
      note.misconceptions && note.misconceptions.length ? misconceptions(note) : null,
      note.workedExamples && note.workedExamples.length ? workedExamples(note) : null,
      note.practice && note.practice.length ? practice(note) : null,
      note.paper1A && note.paper1A.length ? paper1A(note) : null,
      note.paper1B && note.paper1B.length ? paper1B(note) : null,
      note.errorHints && note.errorHints.length ? errorHints(note) : null,
      booklet(note),
      note.linkingQuestions && note.linkingQuestions.length ? linking(note) : null,
      el("p", { class: "muted nt-foot" }, (note.assessmentNote ? note.assessmentNote + " " : "") +
        "Original study notes written for this site, organised by the official topic codes. They are not IB material, not IB markschemes, and do not predict exam questions. Check details against your teacher and the school's copy of the guide.")
    );
  }

  function go(subject, topic, replace) {
    const url = "?subject=" + encodeURIComponent(subject) + (topic ? "&topic=" + encodeURIComponent(topic) : "");
    if (replace) history.replaceState(null, "", url); else history.pushState(null, "", url);
    store.set("notes-last", { subject, topic: topic || null });
    show(subject, topic);
  }

  function show(subject, topic) {
    renderSubjects(subject);
    $("nt-index").hidden = !!topic;
    $("nt-note").hidden = !topic;
    if (topic) renderNote(subject, topic).then(() => window.scrollTo(0, 0));
    else renderIndex(subject);
  }

  async function init() {
    try { MAN = await getJSON("library/topic-notes/manifest.json"); }
    catch (e) { $("nt-index").textContent = "Could not load the notes list: " + e.message; return; }
    const p = new URLSearchParams(location.search);
    const last = store.get("notes-last", null) || {};
    const first = Object.keys(MAN.subjects).find(k => MAN.notes.some(n => n.subject === k));
    let subject = p.get("subject") || last.subject || first;
    if (!MAN.subjects[subject]) subject = first;
    const topic = p.get("subject") ? p.get("topic") : null;
    show(subject, topic);
    window.addEventListener("popstate", () => { const q = new URLSearchParams(location.search); show(q.get("subject") || first, q.get("topic")); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

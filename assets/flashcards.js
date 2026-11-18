/* IB Study Area — flashcard module.
   Decks: library/flashcards/*.json, registered in library/flashcards/manifest.json
   (same subject/topic keys as the question banks). Leitner boxes 1–5 with
   1/2/4/8/16-day intervals; state in localStorage. Fully local — no accounts. */
(function () {
  "use strict";

  const PATH_BASE = location.pathname.includes("/app/") ? "../" : "";

  const FALLBACK_REGISTRY = [
    { file: "library/flashcards/bio-unity-diversity-cells.json", subject: "biology-hl", subjectLabel: "Biology HL" },
    { file: "library/flashcards/bio-c1-1-enzymes-metabolism.json", subject: "biology-hl", subjectLabel: "Biology HL" },
    { file: "library/flashcards/bio-water-potential-origin-cells.json", subject: "biology-hl", subjectLabel: "Biology HL" },
    { file: "library/flashcards/bio-respiration-protein-synthesis.json", subject: "biology-hl", subjectLabel: "Biology HL" },
    { file: "library/flashcards/chem-structure-3-1-periodicity.json", subject: "chemistry-hl", subjectLabel: "Chemistry HL" },
    { file: "library/flashcards/chem-structure-1-stoichiometry.json", subject: "chemistry-hl", subjectLabel: "Chemistry HL" },
    { file: "library/flashcards/chem-reactivity-1-energetics.json", subject: "chemistry-hl", subjectLabel: "Chemistry HL" },
    { file: "library/flashcards/chem-reactivity-2-kinetics-equilibrium.json", subject: "chemistry-hl", subjectLabel: "Chemistry HL" },
    { file: "library/flashcards/chem-reactivity-3-redox-acids-bases.json", subject: "chemistry-hl", subjectLabel: "Chemistry HL" },
    { file: "library/flashcards/chem-structure-2-bonding.json", subject: "chemistry-hl", subjectLabel: "Chemistry HL" },
    { file: "library/flashcards/chem-organic-chemistry.json", subject: "chemistry-hl", subjectLabel: "Chemistry HL" },
    { file: "library/flashcards/math-number-algebra.json", subject: "math-aa-sl", subjectLabel: "Math AA SL" },
    { file: "library/flashcards/math-functions-2-4-to-2-5.json", subject: "math-aa-sl", subjectLabel: "Math AA SL" }
  ];
  const INTERVALS = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16 };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  // NB.store (assets/store.js) is the storage layer; the literal below is only a
  // fallback for a stale cached page that didn't load store.js.
  const store = (window.NB && window.NB.store) || {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
      try { if (window.Auth && window.Auth.queueSync) window.Auth.queueSync(); } catch (e) {}
    }
  };
  const todayISO = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };

  let REGISTRY = [];
  let DECKS = [];
  let CARDS = [];
  let session = null;

  async function loadRegistry() {
    try {
      const res = await fetch(PATH_BASE + "library/flashcards/manifest.json?cb=" + Date.now(), { cache: "no-store" });
      if (!res.ok) throw new Error(res.status);
      REGISTRY = await res.json();
      return true;
    } catch (e) { console.warn("flashcards manifest load failed \u2014 using built-in fallback", e); REGISTRY = FALLBACK_REGISTRY; return false; }
  }

  async function loadDecks() {
    await loadRegistry();
    DECKS = [];
    // Fetch all decks in parallel (was one-by-one, which left the dropdowns
    // empty for several seconds); keep manifest order in the result.
    const loaded = await Promise.all(REGISTRY.map(async (r) => {
      try {
        const res = await fetch(PATH_BASE + r.file + "?cb=" + Date.now(), { cache: "no-store" });
        if (!res.ok) throw new Error(res.status + " " + r.file);
        const d = await res.json();
        return { id: String(r.file).split("/").pop().replace(/\.json$/i, ""), subject: d.subject || r.subject, subjectLabel: r.subjectLabel, topic: d.topic, topicLabel: d.topicLabel, cards: d.cards || [] };
      } catch (e) { console.warn("deck failed:", r.file, e); return null; }
    }));
    loaded.forEach(d => { if (d) DECKS.push(d); });
    store.get("fc-userdecks", []).forEach(ud => {
      DECKS.push({ subject: ud.subject, subjectLabel: ud.subjectLabel || ud.subject, topic: ud.topic, topicLabel: ud.topicLabel || ud.topic, cards: ud.cards || [] });
    });
    rebuild();
  }

  function rebuild() {
    const { user, deleted, edits } = loadState();
    CARDS = [];
    for (const d of DECKS) {
      for (const c of d.cards) {
        // retired cards (off-syllabus) stay in the deck file and keep their fc-state, but are not studied
        if (c.retired === true) continue;
        if (deleted.includes(c.id)) continue;
        const e = edits[c.id];
        CARDS.push(Object.assign({}, c, e || {}, { deck: d.id || null, subject: d.subject, subjectLabel: d.subjectLabel, topic: d.topic, topicLabel: d.topicLabel, seed: true }));
      }
    }
    for (const c of user) {
      if (deleted.includes(c.id)) continue;
      const lbl = c.topicLabel || (c.topic || "user cards");
      CARDS.push(Object.assign({}, c, { subject: c.subject || "user", subjectLabel: "My cards", topic: c.topic || "user", topicLabel: lbl, seed: false }));
    }
  }

  function loadState() {
    return {
      state: store.get("fc-state", {}),
      user: store.get("fc-user", []),
      deleted: store.get("fc-deleted", []),
      edits: store.get("fc-edits", {})
    };
  }

  function groups() {
    const g = {};
    for (const c of CARDS) {
      const key = c.subject + "::" + c.topic;
      g[key] = g[key] || { subject: c.subject, subjectLabel: c.subjectLabel, topic: c.topic, topicLabel: c.topicLabel, cards: [] };
      g[key].cards.push(c);
    }
    const st = store.get("fc-state", {});
    return Object.values(g).map(x => {
      const due = x.cards.filter(c => { const s = st[c.id]; return s && s.due <= todayISO(); }).length;
      const fresh = x.cards.filter(c => !st[c.id]).length;
      const mastered = x.cards.filter(c => { const s = st[c.id]; return s && s.box >= 4; }).length;
      return Object.assign(x, { due, fresh, mastered, total: x.cards.length, pct: x.cards.length ? Math.round(100 * mastered / x.cards.length) : 0 });
    });
  }

  // ---------- session ----------
  function buildQueue() {
    const subj = $("fc-subject").value;
    const topic = $("fc-topic").value;
    const mode = $("fc-mode").value;
    const cap = parseInt($("fc-length").value, 10);
    const st = store.get("fc-state", {});
    let pool = CARDS.filter(c => (subj === "*" || c.subject === subj) && (topic === "*" || (c.subject + "::" + c.topic) === topic));
    const due = pool.filter(c => st[c.id] && st[c.id].due <= todayISO());
    const fresh = pool.filter(c => !st[c.id]);
    let queue;
    if (mode === "due") queue = due;
    else if (mode === "new") queue = fresh;
    else if (mode === "all") queue = shuffle(pool.slice());
    else queue = due.concat(shuffle(fresh));
    queue = queue.slice(0, cap || 20);
    if (mode === "all") queue = shuffle(queue);
    return queue;
  }

  // Deep link from a topic note: cards.html?from=<deckId>[:id1,id2…]&from=…&label=…&n=20
  // Due cards first, then new ones, then the rest (lowest box first).
  function linkQueue(params) {
    const wanted = params.getAll("from").map(f => { const [deck, ids] = f.split(":"); return { deck, ids: ids ? ids.split(",").filter(Boolean) : null }; });
    const n = Math.max(1, parseInt(params.get("n") || "20", 10) || 20);
    const st = store.get("fc-state", {});
    const pool = CARDS.filter(c => wanted.some(w => c.deck === w.deck && (!w.ids || w.ids.includes(c.id))));
    const due = pool.filter(c => st[c.id] && st[c.id].due <= todayISO());
    const fresh = shuffle(pool.filter(c => !st[c.id]));
    const rest = pool.filter(c => st[c.id] && st[c.id].due > todayISO()).sort((a, b) => st[a.id].box - st[b.id].box);
    return due.concat(fresh, rest).slice(0, n);
  }

  function startSession(e, linked) {
    const queue = linked || buildQueue();
    if (!queue.length) { $("fc-error").textContent = "Nothing to study for that filter \u2014 try another mode or topic."; return; }
    $("fc-error").textContent = "";
    session = { queue, idx: 0, flipped: false, ratings: { again: 0, hard: 0, easy: 0 } };
    $("setup").style.display = "none";
    $("editor").style.display = "none";
    $("runner").style.display = "";
    renderCard();
  }

  function renderCard() {
    const c = session.queue[session.idx];
    session.flipped = false;
    $("fc-progress").textContent = `Card ${session.idx + 1} / ${session.queue.length}`;
    $("fc-topicline").textContent = (c.topicLabel || "") + " \u00b7 " + (c.type === "term" ? "term \u2192 definition" : "question \u2192 answer") + (c.tags && c.tags.length ? " \u00b7 " + c.tags.join(", ") : "");
    $("fc-card").className = "fc-card";
    $("fc-front").innerHTML = esc(c.front);
    $("fc-back").innerHTML = esc(c.back);
    $("fc-back").style.display = "none";
    $("fc-hint").style.display = "";
    $("fc-rate").style.display = "none";
    $("fc-card").onclick = flip;
  }

  function flip() {
    if (!session || session.flipped) return;
    session.flipped = true;
    $("fc-back").style.display = "";
    $("fc-hint").style.display = "none";
    $("fc-rate").style.display = "";
    $("fc-card").classList.add("flipped");
  }

  function rate(r) {
    if (!session || !session.flipped) return;
    const c = session.queue[session.idx];
    const st = store.get("fc-state", {});
    const s = st[c.id] || { box: 0, due: todayISO(), seen: 0 };
    s.seen++;
    if (r === "again") { s.box = 1; s.due = addDays(1); }
    else if (r === "hard") { s.box = Math.max(1, s.box); s.due = addDays(INTERVALS[s.box]); }
    else { s.box = Math.min(5, s.box + 1); s.due = addDays(INTERVALS[s.box]); }
    s.t = Date.now(); // last-review timestamp — lets auth.js merge devices per card (newest wins)
    st[c.id] = s;
    store.set("fc-state", st);
    session.ratings[r]++;
    session.idx++;
    if (session.idx < session.queue.length) { renderCard(); return; }
    summarize();
  }

  function summarize() {
    $("runner").style.display = "none";
    const s = session.ratings;
    $("summary").innerHTML = `
      <h3>Session done</h3>
      <div class="fc-statline"><span class="fc-pill again">Again ${s.again}</span>
      <span class="fc-pill hard">Hard ${s.hard}</span>
      <span class="fc-pill easy">Easy ${s.easy}</span></div>
      <p class="muted">Again cards return tomorrow; Easy cards move up a box (1 \u2192 2 \u2192 4 \u2192 8 \u2192 16 day intervals). Mastery = box 4+.</p>
      <div class="q-actions"><button class="btn primary" id="fc-back-to-setup">Back to decks</button></div>`;
    $("summary").style.display = "";
    $("fc-back-to-setup").addEventListener("click", () => { $("summary").style.display = "none"; $("setup").style.display = ""; renderProgress(); });
    session = null;
    renderProgress();
  }

  // ---------- editor ----------
  function renderEditor() {
    const sel = $("ed-deck");
    sel.innerHTML = "";
    groups().forEach((g) => {
      const o = document.createElement("option");
      o.value = g.subject + "::" + g.topic;
      o.textContent = g.subjectLabel + " \u2014 " + g.topicLabel + ` (${g.total})`;
      sel.appendChild(o);
    });
    const mine = CARDS.filter(c => !c.seed);
    if (mine.length) {
      const o = document.createElement("option");
      o.value = "*user*"; o.textContent = "My created cards (" + mine.length + ")";
      sel.appendChild(o);
    }
    renderEditorList();
  }

  function renderEditorList() {
    const key = $("ed-deck").value;
    const list = $("ed-list");
    const cards = key === "*user*" ? CARDS.filter(c => !c.seed) : CARDS.filter(c => (c.subject + "::" + c.topic) === key);
    $("ed-formwrap").style.display = "none";
    list.innerHTML = cards.map(c =>
      `<div class="fc-edrow" data-id="${esc(c.id)}"><div class="fc-edtext"><strong>${esc(c.front)}</strong><br><span class="muted">${esc(c.back)}</span></div>
       <div class="fc-edbtns"><button class="btn fc-mini" data-act="edit" data-id="${esc(c.id)}">Edit</button>
       <button class="btn fc-mini" data-act="del" data-id="${esc(c.id)}">Delete</button></div></div>`).join("")
      || "<p class='muted'>No cards here yet.</p>";
    list.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
      const id = b.dataset.id;
      const c = CARDS.find(x => x.id === id);
      if (!c) return;
      if (b.dataset.act === "del") {
        const { user, deleted } = loadState();
        if (c.seed) { deleted.push(id); store.set("fc-deleted", deleted); }
        else { store.set("fc-user", user.filter(x => x.id !== id)); }
        rebuild(); renderEditor(); renderProgress();
      } else {
        $("ed-formwrap").style.display = "";
        $("ed-id").value = c.id;
        $("ed-front").value = c.front;
        $("ed-back").value = c.back;
        $("ed-tags").value = (c.tags || []).join(", ");
        $("ed-topic").value = c.topic;
        $("ed-topiclabel").value = c.topicLabel || "";
      }
    }));
    $("ed-add").onclick = () => {
      $("ed-formwrap").style.display = "";
      $("ed-id").value = "";
      $("ed-front").value = ""; $("ed-back").value = ""; $("ed-tags").value = "definition";
      const g = groups()[0];
      $("ed-topic").value = g ? g.topic : "";
      $("ed-topiclabel").value = g ? g.topicLabel : "";
    };
    $("ed-save").onclick = () => {
      const id = $("ed-id").value;
      const card = {
        id: id || ("u-" + Date.now()), type: "qa",
        subject: (keySubject() || "user"), topic: $("ed-topic").value.trim() || "user",
        topicLabel: $("ed-topiclabel").value.trim() || $("ed-topic").value.trim(),
        tags: $("ed-tags").value.split(",").map(s => s.trim()).filter(Boolean),
        front: $("ed-front").value.trim(), back: $("ed-back").value.trim()
      };
      if (!card.front || !card.back) { alert("Front and back are both required."); return; }
      const { user, deleted, edits } = loadState();
      if (id && CARDS.find(x => x.id === id && x.seed)) { edits[id] = { front: card.front, back: card.back, tags: card.tags }; store.set("fc-edits", edits); }
      else if (id && CARDS.find(x => x.id === id)) { store.set("fc-user", user.map(x => x.id === id ? card : x)); }
      else { user.push(card); store.set("fc-user", user); }
      rebuild(); renderEditor(); renderProgress();
      $("ed-formwrap").style.display = "none";
    };
    $("ed-cancel").onclick = () => { $("ed-formwrap").style.display = "none"; };
  }

  function keySubject() { const v = $("ed-deck").value; return v === "*user*" ? null : v.split("::")[0]; }

  // ---------- progress ----------
  function renderProgress() {
    const wrap = $("fc-progress-panel");
    if (!wrap) return;
    const st = store.get("fc-state", {});
    const dueToday = CARDS.filter(c => st[c.id] && st[c.id].due <= todayISO()).length;
    const fresh = CARDS.filter(c => !st[c.id]).length;
    wrap.innerHTML = `<div class="fc-statline"><span class="fc-pill due">Due today: ${dueToday}</span>
      <span class="fc-pill">New: ${fresh}</span>
      <span class="fc-pill">Total: ${CARDS.length}</span></div>`
      + groups().map(g => `<div class="fc-grouprow"><strong>${esc(g.subjectLabel)}</strong> \u2014 ${esc(g.topicLabel)}
          <span class="muted">${g.due} due \u00b7 ${g.fresh} new \u00b7 mastery ${g.pct}% (${g.mastered}/${g.total})</span>
          <div class="bar mini" style="--pct:${g.pct}%"></div></div>`).join("");
  }

  // ---------- backup / restore (assets/backup.js) ----------
  // Full backup of every progress key; restore validates, summarises, snapshots and
  // merges by default — replaces the old v1 export/import that overwrote 4 keys blindly.
  const BK = () => window.NB && window.NB.backup;
  function needReload() { alert("Reload the page to use backup and restore."); }
  function doExport() {
    if (!BK()) return needReload();
    const data = BK().collect();
    $("fc-io").value = JSON.stringify(data, null, 1);
    BK().download(data);
  }
  function afterRestore(r) { if (r && r.ok) { rebuild(); renderProgress(); renderEditor(); } }
  function doImport() {
    if (!BK()) return needReload();
    BK().openRestore($("fc-io").value, $("fc-restore"), afterRestore);
  }
  function doImportFile(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (!BK()) return needReload();
    const reader = new FileReader();
    reader.onload = () => BK().openRestore(String(reader.result), $("fc-restore"), afterRestore);
    reader.readAsText(f);
    e.target.value = "";
  }
  function doUndo() {
    if (!BK()) return needReload();
    if (!confirm("Bring back this browser's data from just before the last restore?")) return;
    const r = BK().undoLast();
    if (r.ok) { alert("Done \u2014 restored the safety copy from " + r.restoredFrom + ". The page will reload."); location.reload(); }
    else alert(r.error);
  }

  // ---------- theme ----------
  function applyTheme() {
    const saved = store.get("fc-theme", null) || (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.dataset.fcTheme = saved;
    const btn = $("fc-theme-btn");
    if (btn) btn.textContent = saved === "dark" ? "Light mode" : "Dark mode";
  }
  function toggleTheme() {
    const next = document.documentElement.dataset.fcTheme === "dark" ? "light" : "dark";
    store.set("fc-theme", next);
    applyTheme();
  }

  // ---------- keyboard + rating buttons ----------
  document.addEventListener("keydown", (e) => {
    if (!session || $("runner").style.display === "none") return;
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); if (!session.flipped) flip(); return; }
    if (session.flipped) {
      if (e.key === "1") rate("again");
      if (e.key === "2") rate("hard");
      if (e.key === "3") rate("easy");
    }
  });

  document.querySelectorAll(".fc-ratebtns button").forEach(b => b.addEventListener("click", () => rate(b.dataset.r)));

  // ---------- init ----------
  function fillSetup() {
    const subj = $("fc-subject");
    subj.innerHTML = '<option value="*">All subjects</option>';
    const seen = new Set();
    DECKS.forEach(d => {
      if (seen.has(d.subject)) return;
      seen.add(d.subject);
      const o = document.createElement("option"); o.value = d.subject; o.textContent = d.subjectLabel; subj.appendChild(o);
    });
    subj.addEventListener("change", fillTopics);
    fillTopics();
    $("fc-start").addEventListener("click", startSession);
    $("fc-open-editor").addEventListener("click", () => { $("setup").style.display = "none"; $("editor").style.display = ""; renderEditor(); });
    $("fc-export").addEventListener("click", doExport);
    $("fc-import").addEventListener("click", doImport);
    if ($("fc-import-file")) $("fc-import-file").addEventListener("change", doImportFile);
    if ($("fc-undo")) $("fc-undo").addEventListener("click", doUndo);
    $("fc-theme-btn").addEventListener("click", toggleTheme);
    applyTheme();
    renderProgress();
  }
  function fillTopics() {
    const subj = $("fc-subject").value;
    const topic = $("fc-topic");
    topic.innerHTML = '<option value="*">All topics in this selection</option>';
    DECKS.filter(d => subj === "*" || d.subject === subj).forEach(d => {
      const o = document.createElement("option"); o.value = d.subject + "::" + d.topic; o.textContent = d.subjectLabel + " \u2014 " + d.topicLabel; topic.appendChild(o);
    });
  }

  function fromLink() {
    const params = new URLSearchParams(location.search);
    if (!params.getAll("from").length) return;
    const q = linkQueue(params);
    if (!q.length) { $("fc-error").textContent = "None of the cards linked from that note could be found."; return; }
    startSession(null, q);
  }
  // test hook (node --test loads this file in a vm)
  window.NB = window.NB || {};
  window.NB.flashcards = { loadDecks, cards: () => CARDS };

  const boot = () => {
    ["fc-subject", "fc-topic"].forEach(id => { const el = $(id); if (el && !el.options.length) el.innerHTML = '<option value="">Loading decks\u2026</option>'; });
    return loadDecks().then(fillSetup).then(fromLink);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

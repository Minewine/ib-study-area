/* IB Study Area — practice session engine.
   20-question sessions from JSON banks: MCQ auto-marking, written answers
   self-marked against the markscheme, post-session gap analysis + tactics. */
(function () {
  "use strict";

  const PATH_BASE = location.pathname.includes("/app/") ? "../" : "";

  const $ = (id) => document.getElementById(id);
  const esc = (window.NB && window.NB.escapeHtml) || ((s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"));
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  // Re-render helper: dropping the child nodes explicitly (not just the innerHTML
  // string) is what makes fillTopics/syncSetSelect/panel re-renders idempotent —
  // the picker rebuilds itself several times (init, late teaching metadata,
  // subject change, override change).
  const clearEl = (el) => { [...el.children].forEach(k => k.remove()); el.innerHTML = ""; };

  // Bank id = file name without folder/extension ("library/questions/bio-x.json" -> "bio-x");
  // inline (uploaded) banks get "user:<label>". Used for topic fallback + error keys.
  const bankIdFor = (b) => b.file
    ? String(b.file).split("/").pop().replace(/\.json$/i, "")
    : "user:" + String(b.label || b.topicLabel || "bank").toLowerCase().replace(/\W+/g, "-");

  // Options that refer to other options by position ("Both A and B", "All of the above")
  // must keep their authored order; everything else is shuffled at render time.
  const POSITIONAL = /\b(all|none|both|neither) of the above\b|\b(both|neither|only)\s+[A-D]\s+(and|nor|or)\s+[A-D]\b|^\s*[A-D]\s+(and|or)\s+[A-D]\s*$/i;
  function choiceOrder(it) {
    const idx = (it.choices || []).map((_, i) => i);
    if (it.fixedOrder || (it.choices || []).some(c => POSITIONAL.test(String(c)))) return idx;
    return shuffle(idx);
  }

  // "retired": true marks an item that stays in its bank (so its id, q-errors records and
  // note links remain valid) but is no longer served in new sessions.
  const isActive = (it) => !(it && it.retired === true);

  // Item difficulty vocabulary (mirrors assets/bank-schema.js, which validates it):
  // DIFFICULTIES are the selectable values; an absent/unknown difficulty ranks as
  // "unrated" at the bottom of the ordinal DIFFICULTY_ORDER scale.
  const DIFFICULTIES = ["easy", "standard", "hard"];
  const DIFFICULTY_ORDER = ["unrated", "easy", "standard", "hard"];

  let session = null;
  let BANKS = {};
  // confidence helpers (assets/confidence.js); the no-op fallback only covers a stale cached page
  const C = (window.NB && window.NB.conf) || { tally: () => ({ sure: 0, sureRight: 0, guess: 0, guessRight: 0 }), confidentWrong: () => [], logField: () => null, describe: () => "", applyToError: (r) => r, confidentWrongErrors: () => [] };

const FALLBACK_BANKS = {
    "biology-hl": { label: "Biology HL", banks: [
      { file: "library/questions/bio-unity-diversity-cells.json", label: "Unity & diversity — Cells & membranes" },
      { file: "library/questions/bio-c1-1-enzymes-metabolism.json", label: "C1.1 — Enzymes & metabolism (Nov unit)" },
      { file: "library/questions/bio-water-potential-origin-cells.json", label: "D2.3 — Water potential & A2.1 — Origin of cells (Jan unit)" },
      { file: "library/questions/bio-respiration-protein-synthesis.json", label: "C1.2 — Cell respiration & D1.2 — Protein synthesis (Feb–Mar unit)" },
    ]},
    "chemistry-hl": { label: "Chemistry HL", banks: [
      { file: "library/questions/chem-structure-1-stoichiometry.json", label: "Structure 1 — Stoichiometry (notes 1)" },
      { file: "library/questions/chem-structure-3-1-periodicity.json", label: "Structure 3.1 — Periodicity (Nov unit)" },
{ file: "library/questions/chem-reactivity-1-energetics.json", label: "Reactivity 1 — Energetics (Dec–Jan unit)" },
{ file: "library/questions/chem-reactivity-2-kinetics-equilibrium.json", label: "Reactivity 2 — Kinetics & equilibrium (Feb–Mar unit)" },
{ file: "library/questions/chem-reactivity-3-redox-acids-bases.json", label: "Reactivity 3 — Redox & acids/bases (Apr–Jun unit)" },
{ file: "library/questions/chem-structure-2-bonding.json", label: "Structure 2 — Bonding (DP2: Oct–Nov unit)" },
{ file: "library/questions/chem-organic-chemistry.json", label: "Organic chemistry (DP2: Nov–Mar unit)" },
    ]},
    "math-aa-sl": { label: "Math AA SL", banks: [
      { file: "library/questions/math-aa-number-algebra.json", label: "Number & algebra (1.1–1.3)" },
      { file: "library/questions/math-aa-functions-2-1-to-2-3.json", label: "Functions (2.1–2.3) — linear, quadratic & toolkit" },
      { file: "library/questions/math-functions-2-4-to-2-5.json", label: "Functions 2.4–2.5 — further functions & transformations (next unit)" }
    ]}
  };

  async function loadManifest() {
    try {
      const res = await fetch(PATH_BASE + "library/questions/manifest.json?cb=" + Date.now(), { cache: "no-store" });
      if (!res.ok) throw new Error(res.status);
      const manifest = await res.json();
      BANKS = {};
      manifest.forEach(m => {
        // Per-user subject profile (assets/profile.js): banks for subjects the
        // account doesn't take never reach the dropdown. hides() — not !allows() —
        // keeps non-registry subjects (the ia-skills coursework bank) for everyone.
        if (window.NB && window.NB.profile && window.NB.profile.hides(m.subject)) return;
        BANKS[m.subject] = BANKS[m.subject] || { label: m.subjectLabel, banks: [] };
        // meta = the parsed manifest entry (topics/codes/set/… — every field
        // optional): feeds the topic picker without fetching the bank files.
        BANKS[m.subject].banks.push({ file: m.file, label: m.label, meta: m });
      });
      return true;
    } catch (e) {
      console.warn("quiz manifest load failed — using built-in fallback", e);
      // the fallback gets the same profile filter as the manifest path above: a
      // restricted student must not see other subjects' banks just because the
      // manifest fetch failed. hides() (not !allows()) keeps any non-registry
      // fallback key for everyone, same as ia-skills in the manifest.
      BANKS = {};
      Object.keys(FALLBACK_BANKS).forEach((key) => {
        if (window.NB && window.NB.profile && window.NB.profile.hides(key)) return;
        BANKS[key] = FALLBACK_BANKS[key];
      });
      return false;
    }
  }

async function init() {
    await loadManifest();
    store.get("q-userbanks", []).forEach(b => {
      BANKS[b.subject] = BANKS[b.subject] || { label: b.subjectLabel || b.subject, banks: [] };
      BANKS[b.subject].banks.push({
        file: null, label: b.label || b.topicLabel || "My bank",
        items: b.items, topicLabel: b.topicLabel || b.label || "My bank", inline: true,
        topic: b.topic, set: b.set, setOrder: b.setOrder, codes: b.codes
      });
    });
    const subj = $("q-subject");
    Object.entries(BANKS).forEach(([key, b]) => {
      const o = document.createElement("option"); o.value = key; o.textContent = b.label; subj.appendChild(o);
    });
    subj.addEventListener("change", fillTopics);
    const topicSel = $("q-topic");
    if (topicSel) topicSel.addEventListener("change", syncSetSelect);
    fillTopics();
    // teaching-status hints (note codes + class schedule) load in the background:
    // a slow/failed fetch never blocks setup; fillTopics re-renders when they land.
    loadTeachingMeta();
    $("q-start").addEventListener("click", startSession);
    const rbtn = $("q-review-btn");
    if (rbtn) {
      rbtn.addEventListener("click", () => startReview(false));
      updateReviewUI();
    }
    renderLog();
    const params = new URLSearchParams(location.search);
    if (params.getAll("from").length) await startFromLink(params);
    else if (params.get("errkeys")) startFromErrKeys(params);
  }

  // ── topic picker: teaching-status inputs (loaded in the background) ──────
  // library/topic-notes/manifest.json gives note id → syllabus code (a topic
  // whose key equals a note id inherits that code for the teaching suggestion);
  // library/class-schedule.json gives "covered by a finished unit" suggestions.
  // Both are best-effort: on failure the maps stay empty and every topic shows
  // as "unknown" instead of blocking setup.
  let NOTE_CODES = {}; // {note id: code}
  let SCHEDULE = null; // parsed class schedule | null while loading/failed

  async function loadTeachingMeta() {
    const getJSON = async (path) => {
      const res = await fetch(PATH_BASE + path + "?cb=" + Date.now(), { cache: "no-store" });
      if (!res.ok) throw new Error(res.status + " " + path);
      return res.json();
    };
    const [notes, schedule] = await Promise.all([
      getJSON("library/topic-notes/manifest.json").catch(() => null),
      getJSON("library/class-schedule.json").catch(() => null)
    ]);
    const codes = {};
    if (notes && Array.isArray(notes.notes)) notes.notes.forEach(n => { if (n && n.id && n.code) codes[n.id] = n.code; });
    NOTE_CODES = codes;
    SCHEDULE = schedule || null;
    try { fillTopics(); } catch (e) { /* the late refresh must never break setup */ }
  }

  // Topic nodes for one subject's banks; note-code inheritance lives here
  // because it needs the fetched manifest (buildTopics itself is pure).
  function subjectTopics(key) {
    const s = BANKS[key];
    const nodes = buildTopics(s ? s.banks : []);
    nodes.forEach(n => {
      const c = NOTE_CODES[n.topicKey];
      if (c && n.codes.indexOf(c) < 0) n.codes.push(c);
    });
    return nodes;
  }

  function fillTopics() {
    const key = $("q-subject").value;
    const topic = $("q-topic");
    if (!topic) return;
    const prev = topic.value;
    clearEl(topic);
    const all = document.createElement("option");
    all.value = "*"; all.textContent = "Mixed — all topics (revision)";
    topic.appendChild(all);
    let nodes = [];
    try { nodes = subjectTopics(key); } catch (e) { nodes = []; }
    const overrides = store.get("topic-taught", {});
    nodes.forEach(n => {
      const st = taughtState(n.topicKey, n.codes, SCHEDULE, key, today(), overrides);
      const o = document.createElement("option");
      o.value = n.topicKey; // NOT the bank index any more — sets resolve through the model
      o.textContent = `${n.label} · ${n.count == null ? "?" : n.count} Qs` + (st.state === "taught" ? " · taught" : st.state === "not-taught" ? " · not yet taught" : "");
      topic.appendChild(o);
    });
    // keep the current selection across re-renders (subject change → new list → Mixed)
    topic.value = (prev && [...topic.children].some(c => c.value === prev)) ? prev : "*";
    syncSetSelect();
    renderTaughtPanel();
  }

  // The Set dropdown narrows one topic to a single practice set; hidden (and
  // disabled, so its stale value can never reach startSession) while Mixed is
  // selected. Set option values are indexes into the node's sorted sets list.
  function syncSetSelect() {
    const sel = $("q-set");
    if (!sel) return; // pages without the new markup (legacy quiz.html) keep working
    const key = $("q-subject").value;
    const pick = $("q-topic") ? $("q-topic").value : "*";
    if (pick === "*") { sel.value = "*"; sel.disabled = true; sel.style.display = "none"; return; }
    let nodes = [];
    try { nodes = subjectTopics(key); } catch (e) { nodes = []; }
    const node = nodes.find(n => n.topicKey === pick);
    const prev = sel.value; // keep the choice across re-renders (late teaching metadata, override change)
    clearEl(sel);
    const all = document.createElement("option");
    all.value = "*"; all.textContent = "All sets in this topic";
    sel.appendChild(all);
    (node ? node.sets : []).forEach((s, i) => {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = `${s.name} · ${s.count == null ? "?" : s.count} Qs` + paperBadge(s);
      sel.appendChild(o);
    });
    if (prev && [...sel.children].some(c => c.value === prev)) sel.value = prev;
    sel.disabled = false; sel.style.display = "";
  }

  // Paper badge suffix for a set option (paperStyle/calculatorFree come from the manifest).
  // 1B is checked FIRST: a 1B bank that also sets calculatorFree must still badge as 1B.
  function paperBadge(s) {
    if (s.paperStyle === "1B") return s.calculatorFree ? " — Paper 1B" : " — Paper 1B · data practice (calculator allowed)";
    if (s.paperStyle === "1A" || s.calculatorFree) return " — Paper 1A · calculator-free";
    return "";
  }

  // "Topics & teaching status" panel: per topic an Auto/Taught/Not-yet override.
  // The whole build is wrapped in try/catch — a bug here must never break session setup.
  function renderTaughtPanel() {
    const panel = $("q-taught-panel");
    const list = $("q-taught-list");
    if (!panel || !list) return;
    try {
      const key = $("q-subject").value;
      const overrides = store.get("topic-taught", {});
      clearEl(list);
      let nodes = [];
      try { nodes = subjectTopics(key); } catch (e) { nodes = []; }
      if (!nodes.length) {
        const p = document.createElement("p"); p.className = "muted"; p.textContent = "No topics available for this subject.";
        list.appendChild(p); return;
      }
      nodes.forEach(n => {
        const st = taughtState(n.topicKey, n.codes, SCHEDULE, key, today(), overrides);
        const ov = overrides && overrides[n.topicKey];
        const row = document.createElement("div"); row.className = "q-taught-row";
        const name = document.createElement("span"); name.className = "q-taught-name";
        name.textContent = `${n.label} · ${n.count == null ? "?" : n.count} Qs`;
        row.appendChild(name);
        const hint = document.createElement("span"); hint.className = "q-taught-hint";
        hint.textContent = st.source === "schedule" ? "suggested from class schedule" : (ov && typeof ov.taught === "boolean" ? "set by you" : "");
        row.appendChild(hint);
        const sel = document.createElement("select");
        [["auto", "Auto"], ["taught", "Taught"], ["not-taught", "Not yet"]].forEach(([v, t]) => {
          const o = document.createElement("option"); o.value = v; o.textContent = t; sel.appendChild(o);
        });
        sel.value = ov && typeof ov.taught === "boolean" ? (ov.taught ? "taught" : "not-taught") : "auto";
        sel.addEventListener("change", () => setTaughtOverride(n.topicKey, sel.value));
        row.appendChild(sel);
        list.appendChild(row);
      });
    } catch (e) { clearEl(list); }
  }

  // Read-modify-write of the whole "topic-taught" map: Auto deletes the override,
  // Taught/Not-yet store {taught, t} (the sync merge is newest-t per topic).
  function setTaughtOverride(topicKey, value) {
    let map = store.get("topic-taught", {});
    if (!map || typeof map !== "object" || Array.isArray(map)) map = {};
    if (value === "auto") delete map[topicKey];
    else map[topicKey] = { taught: value === "taught", t: Date.now() };
    store.set("topic-taught", map);
    fillTopics(); // option suffixes + the panel itself re-render from the new map
  }

  // ── pure topic model (exported for tests; no DOM, no fetches) ─────────────
  /* buildTopics(banks) → ordered topic nodes for the picker.
     banks: seeded entries {file, label, meta?} (meta = the parsed manifest
     entry; every field on it is optional) and inline uploads
     {inline: true, items, label, topicLabel, topic?, set?, setOrder?, codes?}.
     Node: {topicKey, label, count, difficulties {unrated,easy,standard,hard},
     codes, sets: [{ref, name, order, count, paperStyle, calculatorFree}]}.
     - Seeded WITH meta: the pre-aggregated meta.topics[] entries drive the nodes
       (bank files are never fetched here); the bank itself appears as a set of
       every topic it contributes to, with the per-topic count.
     - Seeded WITHOUT meta (offline fallback): the bank is its own topic; its
       size is unknown → count null (the picker shows "?").
     - Inline uploads: items are aggregated in memory exactly like bankItems()
       maps them (effective topic = it.topic || bank.topic || bankId; retired
       skipped; difficulty = valid value else "unrated").
     Contributions merge across banks by topicKey; set names within a topic are
     NOT deduped (dupes are suggested away at upload time). Labels: first
     non-null wins — inline banks are processed last, so seeded labels win. */
  function buildTopics(banks) {
    const byKey = {};
    const nodes = [];
    const nodeFor = (topicKey, label) => {
      let n = byKey[topicKey];
      if (!n) {
        n = byKey[topicKey] = { topicKey, label: null, count: 0, countKnown: true, difficulties: { unrated: 0, easy: 0, standard: 0, hard: 0 }, codes: [], sets: [] };
        nodes.push(n);
      }
      if (label && n.label == null) n.label = label;
      return n;
    };
    const bump = (n, count) => { if (count == null) n.countKnown = false; else n.count += count; };
    const addCodes = (n, codes) => (Array.isArray(codes) ? codes : []).forEach(c => { if (typeof c === "string" && c && n.codes.indexOf(c) < 0) n.codes.push(c); });

    (Array.isArray(banks) ? banks : []).forEach(b => {
      if (!b) return;
      if (!b.inline && !b.file) return; // neither a seeded bank (file) nor an upload (inline)
      const meta = b.meta || null;
      const topics = !b.inline && meta && Array.isArray(meta.topics) ? meta.topics : null;
      if (!b.inline) {
        if (topics && topics.length) {
          topics.forEach(e => {
            if (!e || typeof e.topic !== "string" || !e.topic) return;
            const n = nodeFor(e.topic, e.topicLabel || meta.topicLabel || null);
            bump(n, typeof e.count === "number" ? e.count : null);
            Object.keys(n.difficulties).forEach(k => { n.difficulties[k] += (e.difficulty && typeof e.difficulty[k] === "number") ? e.difficulty[k] : 0; });
            // bank-level codes describe the bank's DECLARED topic — attach them only
            // to that node (or when the bank has a single effective topic). Otherwise
            // a multi-topic bank's codes would land on every node and keep per-code
            // topics "not yet taught" forever; per-code nodes inherit their precise
            // code from the topic-notes manifest (note-id matching in subjectTopics).
            if (topics.length === 1 || (meta.topic && e.topic === meta.topic)) addCodes(n, meta.codes);
            n.sets.push({ ref: b, name: b.set || meta.set || meta.label || b.label, order: b.setOrder != null ? b.setOrder : (meta.setOrder != null ? meta.setOrder : null), count: typeof e.count === "number" ? e.count : null, paperStyle: meta.paperStyle || null, calculatorFree: !!meta.calculatorFree });
          });
          return;
        }
        // offline fallback: the bank is its own topic; count unknown without
        // fetching the file (which the picker deliberately never does)
        const n = nodeFor(bankIdFor(b), b.label || null);
        bump(n, null);
        n.sets.push({ ref: b, name: b.label, order: b.setOrder != null ? b.setOrder : null, count: null, paperStyle: null, calculatorFree: false });
        return;
      }
      // inline upload: aggregate its items exactly like bankItems() maps them
      const bid = bankIdFor(b);
      const perTopic = {}; // topicKey → {label, count, difficulties}
      (Array.isArray(b.items) ? b.items : []).forEach(it => {
        if (!it || it.retired === true) return;
        const tk = String(it.topic || b.topic || bid);
        const t = perTopic[tk] = perTopic[tk] || { label: null, count: 0, difficulties: { unrated: 0, easy: 0, standard: 0, hard: 0 } };
        const tl = it.topicLabel || b.topicLabel || null;
        if (tl && t.label == null) t.label = tl;
        t.count++;
        t.difficulties[DIFFICULTIES.indexOf(it.difficulty) >= 0 ? it.difficulty : "unrated"]++;
      });
      Object.keys(perTopic).forEach(tk => {
        const t = perTopic[tk];
        const n = nodeFor(tk, t.label);
        bump(n, t.count);
        Object.keys(t.difficulties).forEach(k => { n.difficulties[k] += t.difficulties[k]; });
        // same rule as the meta path: bank codes describe the declared bank topic
        if (Object.keys(perTopic).length === 1 || tk === b.topic) addCodes(n, b.codes);
        n.sets.push({ ref: b, name: b.set || b.label || b.topicLabel, order: b.setOrder != null ? b.setOrder : null, count: t.count, paperStyle: null, calculatorFree: false });
      });
    });

    const nameCmp = (x, y) => String(x.name || "").localeCompare(String(y.name || ""), undefined, { numeric: true, sensitivity: "base" });
    nodes.forEach(n => {
      if (n.label == null) n.label = n.topicKey; // unlabelled topics still need readable option text
      n.sets.sort((x, y) => {
        if (x.order == null && y.order == null) return nameCmp(x, y);
        if (x.order == null) return 1;  // sets without an order sort last
        if (y.order == null) return -1;
        return x.order !== y.order ? x.order - y.order : nameCmp(x, y);
      });
      n.count = n.countKnown ? n.count : null; // any unknown contributor → "?" for the whole node
      delete n.countKnown;
    });
    nodes.sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, { numeric: true, sensitivity: "base" }));
    return nodes;
  }

  /* taughtState(topicKey, codes, schedule, subjectId, todayISO, overrides):
     1. a stored "topic-taught" override with a boolean taught wins → source "you";
     2. else with non-empty codes AND schedule units for the subject: taught iff
        EVERY code is covered by at least one unit that has already finished
        (unit.to <= todayISO) → source "schedule";
     3. otherwise "unknown" (no codes, no schedule for the subject, malformed
        input). Never throws — any doubt falls back to unknown. */
  function taughtState(topicKey, codes, schedule, subjectId, todayISO, overrides) {
    try {
      if (overrides && typeof overrides === "object" && !Array.isArray(overrides)) {
        const ov = overrides[topicKey];
        if (ov && typeof ov.taught === "boolean") return { state: ov.taught ? "taught" : "not-taught", source: "you" };
      }
      const cs = Array.isArray(codes) ? codes.filter(c => typeof c === "string" && c) : [];
      const units = scheduleUnits(schedule, subjectId);
      if (cs.length && units.length) {
        const taught = cs.every(c => units.some(u => u && typeof u.to === "string" && u.to <= todayISO && Array.isArray(u.codes) && u.codes.indexOf(c) >= 0));
        return { state: taught ? "taught" : "not-taught", source: "schedule" };
      }
    } catch (e) { /* malformed input → unknown below */ }
    return { state: "unknown", source: "none" };
  }

  // Units of the schedule's entry for subjectId. Accepts the whole schedule
  // ({subjects: {…}}) or a single subject entry ({units: […]}) directly.
  // Subject ids compare canonically when profile.js is loaded — in BOTH
  // directions, since class-schedule.json still keys the old id ("maths-aa-sl")
  // while callers pass the registry id ("math-aa-sl").
  function scheduleUnits(schedule, subjectId) {
    if (!schedule || typeof schedule !== "object") return [];
    let entry = null;
    if (schedule.subjects && typeof schedule.subjects === "object" && !Array.isArray(schedule.subjects)) {
      const canon = (window.NB && window.NB.canonicalSubject) || ((x) => x);
      const id = subjectId == null ? null : String(subjectId);
      if (id) {
        entry = schedule.subjects[id] || schedule.subjects[canon(id)] || null;
        if (!entry) {
          const key = Object.keys(schedule.subjects).find(k => canon(k) === canon(id));
          entry = key ? schedule.subjects[key] : null;
        }
      }
    } else if (Array.isArray(schedule.units)) {
      entry = schedule;
    }
    return entry && Array.isArray(entry.units) ? entry.units : [];
  }

  // Difficulty-range filter for session items. Items without a valid difficulty
  // rank as "unrated" (the bottom of DIFFICULTY_ORDER). If min > max the two
  // selects were crossed over — the bounds are swapped so the filter stays
  // meaningful instead of silently matching nothing.
  function difficultyPass(it, min, max) {
    const lo = Math.max(0, DIFFICULTY_ORDER.indexOf(min));
    const hi = Math.max(0, DIFFICULTY_ORDER.indexOf(max));
    const a = Math.min(lo, hi), b = Math.max(lo, hi);
    const d = DIFFICULTIES.indexOf(it && it.difficulty) >= 0 ? it.difficulty : "unrated";
    const r = DIFFICULTY_ORDER.indexOf(d);
    return r >= a && r <= b;
  }

  async function bankItems(b) {
    const bid = bankIdFor(b);
    if (b.inline) return (b.items || []).filter(isActive).map(it => ({ ...it, topic: it.topic || b.topic || bid, topicLabel: it.topicLabel || b.topicLabel, bank: b.label, bankId: bid }));
    const res = await fetch(PATH_BASE + b.file + "?cb=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error(res.status + " " + b.file);
    const data = await res.json();
    // untagged items inherit the bank's topic (else they'd all pool under "undefined").
    // Retired items (off-syllabus, kept so ids and progress stay valid) never enter a session.
    // Item-level topicLabel (mixed-topic banks such as the Paper 1A/1B sets) wins over the bank's.
    return data.items.filter(isActive).map(it => ({ ...it, topic: it.topic || data.topic || bid, topicLabel: it.topicLabel || data.topicLabel, bank: b.label, bankId: bid, paperStyle: it.paperStyle || data.paperStyle || null, calculatorFree: !!(it.calculatorFree || data.calculatorFree) }));
  }

  // Deep link from a topic note: quiz.html?from=<bankId>[:id1,id2…]&from=…&label=…&n=20
  // (no ids = the whole bank). Unknown banks/ids are skipped and reported.
  async function startFromLink(params) {
    const wanted = params.getAll("from").map(f => { const [bank, ids] = f.split(":"); return { bank, ids: ids ? ids.split(",").filter(Boolean) : null }; });
    const n = Math.max(1, parseInt(params.get("n") || "20", 10) || 20);
    let items = [], subject = null, missing = 0;
    try {
      for (const w of wanted) {
        let found = null;
        for (const [key, s] of Object.entries(BANKS)) { const b = s.banks.find(x => !x.inline && bankIdFor(x) === w.bank); if (b) { found = b; subject = subject || key; break; } }
        if (!found) { missing += w.ids ? w.ids.length : 1; continue; }
        const all = await bankItems(found);
        const pick = w.ids ? all.filter(it => w.ids.includes(it.id)) : all;
        if (w.ids) missing += w.ids.length - pick.length;
        items = items.concat(pick);
      }
    } catch (e) { $("q-error").textContent = "Could not load question bank: " + e.message; return false; }
    if (!items.length) { $("q-error").textContent = "None of the questions linked from that note could be found."; return false; }
    migrateErrorKeys(items);
    shuffle(items);
    const use = items.slice(0, n);
    const label = (params.get("label") || "Topic quiz").slice(0, 80);
    const bits = [`${label}: ${use.length} of ${items.length} linked question${items.length === 1 ? "" : "s"}.`];
    if (missing) bits.push(`${missing} linked item(s) not found.`);
    session = { items: use, idx: 0, results: [], subject, label, requested: use.length, fromLink: true, notice: bits.join(" ") };
    $("setup").style.display = "none";
    $("runner").style.display = "";
    renderQuestion();
    return true;
  }

  // Deep link from the Mistakes log: quiz.html?errkeys=<encodeURIComponent("bank#id")>[, …]
  // (keys contain "#" and will arrive percent-encoded; each is decoded separately).
  // Runs through startReview({keys}), so session.review semantics apply: a correct
  // answer marks the record resolved. Unknown keys are skipped and reported.
  function startFromErrKeys(params) {
    const keys = params.getAll("errkeys").join(",").split(",").map(k => decodeURIComponent(k)).filter(Boolean);
    if (keys.length) startReview({ keys });
  }

  async function startSession() {
    const key = $("q-subject").value;
    const pick = $("q-topic") ? $("q-topic").value : "*";
    const format = $("q-format").value;
    const n = parseInt($("q-length").value, 10);
    $("q-error").textContent = "";
    let nodes = [];
    try { nodes = subjectTopics(key); } catch (e) { nodes = []; }
    // "*" = Mixed/revision: every topic node. Taught-only keeps taught topics and
    // ALWAYS includes "unknown" ones (no schedule/override → never excluded); a
    // specifically picked topic is kept regardless of the checkbox.
    const taughtOnlyEl = $("q-taught-only");
    const taughtOnly = !!(taughtOnlyEl && taughtOnlyEl.checked);
    const overrides = store.get("topic-taught", {});
    const chosen = pick === "*"
      ? nodes.filter(n => !taughtOnly || taughtState(n.topicKey, n.codes, SCHEDULE, key, today(), overrides).state !== "not-taught")
      : nodes.filter(n => n.topicKey === pick);
    const setSel = $("q-set");
    const wantSet = setSel && !setSel.disabled && setSel.value && setSel.value !== "*" ? setSel.value : null;
    // Per chosen bank, the topic keys its items must match in this session
    // (null = take the whole bank). Multi-topic banks (the Paper 1A/1B sets span
    // many item topics) must not leak other topics' items — a "chem-s1-1 · N Qs"
    // option or a taught-only session would otherwise serve the whole bank.
    // Fallback banks (offline, no meta) are taken whole: their node key is the
    // filename stem, while their items carry the bank's own data.topic, so
    // key-matching would wrongly empty an offline session.
    const seen = new Set(), chosenBanks = [];
    const want = new Map(); // bankRef → Set(topicKeys) | null
    chosen.forEach(n => n.sets.forEach((s, i) => {
      if (wantSet != null && String(i) !== wantSet) return;
      const ref = s.ref;
      if (!seen.has(ref)) { seen.add(ref); chosenBanks.push(ref); } // multi-topic banks appear in several nodes — fetch once
      if (want.get(ref) === null) return; // already taken whole from another node
      if (!ref.inline && !ref.meta) { want.set(ref, null); return; }
      const keys = want.get(ref) || new Set();
      keys.add(n.topicKey);
      want.set(ref, keys);
    }));
    let items = [];
    try {
      for (const b of chosenBanks) {
        const arr = await bankItems(b); // bankItems sets effective topic = it.topic || data.topic || bid
        const keys = want.get(b);
        items = items.concat(keys == null ? arr : arr.filter(it => keys.has(String(it.topic))));
      }
    } catch (e) { $("q-error").textContent = "Could not load question bank: " + e.message; return; }
    migrateErrorKeys(items);
    // empty values (select present but without options — e.g. a stale page) count
    // as the defaults, exactly like missing selects do
    const dminEl = $("q-diff-min"), dmaxEl = $("q-diff-max");
    const dmin = dminEl && dminEl.value ? dminEl.value : "unrated";
    const dmax = dmaxEl && dmaxEl.value ? dmaxEl.value : "hard";
    if (dmin !== "unrated" || dmax !== "hard") items = items.filter(it => difficultyPass(it, dmin, dmax));
    if (format !== "mixed") items = items.filter(it => it.format === format);
    shuffle(items);
    const use = items.slice(0, n);
    if (!use.length) { $("q-error").textContent = "No questions match those filters — try widening the difficulty range or including not-yet-taught topics."; return; }
    session = { items: use, idx: 0, results: [], subject: key, label: BANKS[key].label, requested: n, notice: items.length < n ? `Bank has ${items.length} matching questions (asked for ${n}) — short session.` : "" };
    $("setup").style.display = "none";
    $("runner").style.display = "";
    renderQuestion();
  }

  function renderQuestion() {
    const it = session.items[session.idx];
    const prog = $("q-progress");
    prog.textContent = (session.fromLink ? session.label + " · " : "") + `Question ${session.idx + 1} / ${session.items.length}`;
    const box = $("q-box");
    const style = it.calculatorFree ? " · calculator-free practice" : (it.paperStyle === "1B" ? " · data-based practice (calculator allowed)" : "");
    const topicTag = `<div class="q-topic">${esc(it.topicLabel || "")} · ${it.format === "mcq" ? "multiple choice" : `written — ${esc(it.marks)} marks`}${style}</div>`;
    let html = topicTag + `<div class="q-stem">${esc(it.stem)}</div>`;
    if (it.format === "mcq") {
      // data-i is always the ORIGINAL choice index, so marking, stored answers and
      // q-errors.userAnswer keep the authored indexing; only the display order changes.
      const order = choiceOrder(it);
      html += `<div class="q-choices">` + order.map((i, pos) =>
        `<button class="choice" data-i="${i}">${String.fromCharCode(65 + pos)}. ${esc(it.choices[i])}</button>`).join("") + `</div>` +
        `<div class="q-conf" id="q-conf"><span class="muted">Pick an answer, then say how sure you are:</span> ` +
        `<button id="q-sure" class="btn" disabled>Check \u2014 I'm sure</button><button id="q-guess" class="btn" disabled>Check \u2014 I'm guessing</button></div>`;
    } else {
      html += `<textarea id="q-answer" rows="4" placeholder="Work through it here, then self-mark against the markscheme…"></textarea>
               <div class="q-actions q-conf"><span class="muted">Before you look: how sure are you of your answer?</span> <button id="q-reveal" class="btn">Reveal \u2014 I'm sure</button><button id="q-reveal-guess" class="btn">Reveal \u2014 I'm guessing</button></div>
               <div id="q-ms" class="q-ms" style="display:none">
                 <ol>${it.markscheme.map(m => `<li>${esc(m)}</li>`).join("")}</ol>
                 <p class="muted">Self-score honestly — the gap analysis only works if you don't inflate.</p>
                 <div class="q-score">Score: <select id="q-selfscore">${Array.from({ length: (it.marks || 1) + 1 }, (_, k) => `<option value="${k}">${k} / ${esc(it.marks)}</option>`).join("")}</select></div>
                 <div class="q-actions"><button id="q-fc" class="btn">＋ Flashcard</button><button id="q-next" class="btn primary">Next question</button></div>
               </div>`;
    }
    box.innerHTML = html;

    if (it.format === "mcq") {
      let picked = null;
      const choices = box.querySelectorAll(".choice");
      choices.forEach(btn => {
        btn.addEventListener("click", () => {
          picked = parseInt(btn.dataset.i, 10);
          choices.forEach(b => b.classList.toggle("picked", b === btn));
          $("q-sure").disabled = false; $("q-guess").disabled = false;
        });
      });
      const check = (conf) => {
        if (picked === null) return;
        const chosen = picked;
        const right = chosen === it.answer;
        $("q-sure").disabled = true; $("q-guess").disabled = true;
        $("q-conf").style.display = "none";
        choices.forEach((b) => {
          const i = parseInt(b.dataset.i, 10);
          b.disabled = true;
          b.classList.remove("picked");
          if (i === it.answer) b.classList.add("correct");
          if (i === chosen && !right) b.classList.add("wrong");
        });
        session.results.push(resultFor(it, "mcq", right ? 1 : 0, 1, conf));
        if (session.review) markReviewResult(it, right, conf);
        else if (!right) recordError(it, { userChoice: chosen, conf });
        const after = document.createElement("div");
        after.className = "q-note" + (right ? " good" : " bad");
        after.innerHTML = (right ? "\u2713 Correct. " : "\u2717 Not quite. ") + (!right && conf === "sure" ? "<strong>You were sure \u2014 this goes on your \u201cconfident but wrong\u201d list.</strong> " : "") + esc(it.note || "") +
          `<div class="q-actions"><button id="q-fc" class="btn">\uff0b Flashcard</button><button id="q-next" class="btn primary">Next question</button></div>`;
        box.appendChild(after);
        $("q-next").addEventListener("click", nextQuestion);
        const fcBtn = document.getElementById("q-fc");
        if (fcBtn) fcBtn.addEventListener("click", () => { fcSaveFromQuiz(it); fcBtn.textContent = "\u2713 Saved to Cards"; fcBtn.disabled = true; });
      };
      $("q-sure").addEventListener("click", () => check("sure"));
      $("q-guess").addEventListener("click", () => check("guess"));
    } else {
      let conf = null;
      const reveal = (c) => {
        conf = c;
        $("q-ms").style.display = "";
        $("q-reveal").disabled = true; $("q-reveal-guess").disabled = true;
      };
      $("q-reveal").addEventListener("click", () => reveal("sure"));
      $("q-reveal-guess").addEventListener("click", () => reveal("guess"));
      const fcBtn = document.getElementById("q-fc");
      if (fcBtn) fcBtn.addEventListener("click", () => { fcSaveFromQuiz(it); fcBtn.textContent = "\u2713 Saved to Cards"; fcBtn.disabled = true; });
      $("q-next").addEventListener("click", () => {
        const got = parseInt($("q-selfscore").value, 10);
        session.results.push(resultFor(it, "written", got, it.marks, conf));
        if (session.review) markReviewResult(it, got >= it.marks, conf);
        else if (got < it.marks) recordError(it, { selfScore: got, conf });
        nextQuestion();
      });
    }
  }

  // one result per answered question; conf is "sure" | "guess" (null only for a stale page)
  function resultFor(it, format, got, max, conf) {
    return { id: it.id, key: errKeyFor(it), stem: String(it.stem || ""), topic: it.topic, topicLabel: it.topicLabel, format, got, max, note: format === "mcq" ? it.note : "", tactic: it.tactic || "", conf: conf || null };
  }

  function nextQuestion() {
    session.idx++;
    if (session.idx < session.items.length) { renderQuestion(); return; }
    summarize();
  }

  function summarize() {
    $("runner").style.display = "none";
    $("summary").style.display = "";
    const res = session.results;
    const got = res.reduce((s, r) => s + r.got, 0);
    const max = res.reduce((s, r) => s + r.max, 0);
    const pct = max ? Math.round(100 * got / max) : 0;

    const byTopic = {};
    res.forEach(r => {
      byTopic[r.topic] = byTopic[r.topic] || { label: r.topicLabel || r.topic, got: 0, max: 0 };
      byTopic[r.topic].got += r.got; byTopic[r.topic].max += r.max;
    });
    const flags = Object.entries(byTopic)
      .filter(([, v]) => v.max >= 2 && (100 * v.got / v.max) < 70)
      .map(([k, v]) => `<li><strong>Study ${esc(v.label)}</strong> — ${v.got}/${v.max} (${Math.round(100 * v.got / v.max)}%)</li>`);
    const okTopics = Object.entries(byTopic)
      .filter(([, v]) => v.max >= 2 && (100 * v.got / v.max) >= 70)
      .map(([k, v]) => `<li>${esc(v.label)} — ${v.got}/${v.max} (${Math.round(100 * v.got / v.max)}%) ✓</li>`);

    const missedTactics = [...new Set(res.filter(r => r.got < r.max && r.tactic).map(r => r.tactic))];
    const mcqPct = (() => { const m = res.filter(r => r.format === "mcq"); return m.length ? Math.round(100 * m.reduce((s, r) => s + r.got, 0) / m.length) : null; })();
    const wrPct = (() => { const w = res.filter(r => r.format === "written"); return w.length ? Math.round(100 * w.reduce((s, r) => s + r.got, 0) / w.reduce((s, r) => s + r.max, 0)) : null; })();

    const advice = [];
    if (mcqPct !== null && mcqPct < 70) advice.push("Re-drill this topic's notes PDF, then run the same session again in 3 days (spaced repetition).");
    if (wrPct !== null && wrPct < 70) advice.push("For written questions: redo the missed ones with the markscheme open, then once closed. Command terms decide where marks sit.");
    if (mcqPct !== null && mcqPct >= 70 && wrPct !== null && wrPct < 70) advice.push("MCQs are solid — your gap is written communication. Practise verb-shaped answers (state vs explain vs evaluate).");
    if (!advice.length && pct >= 70) advice.push("Solid session — move the topic green in the subject checklist and turn 2 tricky items into flashcards anyway.");
    advice.push("Missed questions are saved automatically \u2014 retry them with \u201cReview past errors\u201d in a few days.");

    const t = C.tally(res);
    const calib = (t.sure + t.guess)
      ? `<p class="muted">Confidence: ${C.describe(t)}.</p>` : "";
    const falseConf = C.confidentWrong(res);
    const falseHtml = falseConf.length
      ? `<div class="currency"><strong>Confident but wrong (${falseConf.length}):</strong> you marked these \u201csure\u201d and lost marks. They are the best ones to re-study first.<ul class="links">${falseConf.map(r => `<li>${esc(r.topicLabel || "")}${r.topicLabel ? " \u2014 " : ""}${esc(String(r.stem).slice(0, 140))}</li>`).join("")}</ul></div>`
      : ((t.sure) ? `<p>\u2713 Everything you marked \u201csure\u201d was right.</p>` : "");

    $("summary").innerHTML = `
      <h3>Session summary — ${esc(session.label)}</h3>
      <div class="big">${got} / ${max} <span class="muted">(${pct}%)</span></div>
      ${session.notice ? `<p class="muted">${esc(session.notice)}</p>` : ""}
      ${calib}${falseHtml}
      <h3>Topic breakdown</h3>
      <ul class="links">${okTopics.join("") || "<li class='muted'>—</li>"}</ul>
      ${flags.length ? `<div class="currency"><strong>Weak-topic flags:</strong><ul class="links">${flags.join("")}</ul></div>` : `<p>✓ No topic fell below 70% this session.</p>`}
      ${missedTactics.length ? `<h3>Tactics for the questions you missed</h3><ul>${missedTactics.map(t => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
      <h3>What to do next</h3><ul>${advice.map(a => `<li>${esc(a)}</li>`).join("")}</ul>
      <div class="q-actions"><button class="btn primary" id="q-again">New session</button></div>`;
    $("q-again").addEventListener("click", reset);
    saveLog(pct, got, max, session.label, byTopic, session.subject, C.logField(res));
    renderLog();
    updateReviewUI();
  }

  function saveLog(pct, got, max, label, byTopic, subject, conf) {
    const log = store.get("quizlog", []);
    // per-topic breakdown {topic: {l: label, g: got, m: max}} feeds the parent weekly summary
    const topics = {};
    Object.entries(byTopic || {}).forEach(([k, v]) => { if (k && k !== "undefined") topics[k] = { l: v.label, g: v.got, m: v.max }; });
    const entry = { date: today(), label, pct, got, max, ts: Date.now() }; // local date; ts keeps two identical sessions distinct in the sync merge
    if (subject) entry.subject = subject;
    if (Object.keys(topics).length) entry.topics = topics;
    if (conf) entry.conf = conf; // {sure, sureRight, guess, guessRight}; absent on older entries
    log.unshift(entry);
    store.set("quizlog", log.slice(0, 20));
  }
  function renderLog() {
    const el = $("q-log");
    if (!el) return;
    const log = store.get("quizlog", []);
    el.innerHTML = log.length
      ? log.slice(0, 8).map(e => { const c = C.describe(e.conf); return `<li>${esc(e.date)} — ${esc(e.label)}: <strong>${esc(e.got)}/${esc(e.max)} (${esc(e.pct)}%)</strong>${c ? ` <span class="muted">(${esc(c)})</span>` : ""}</li>`; }).join("")
      : "<li class='muted'>No sessions yet.</li>";
  }

  // NB.store (assets/store.js) is the storage layer; the literal below is only a
  // fallback for a stale cached page that didn't load store.js.
  const store = (window.NB && window.NB.store) || {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
      try { if (window.Auth && window.Auth.queueSync) window.Auth.queueSync(); } catch (e) {}
    }
  };

  function getErrors() { return store.get("q-errors", []); }

  const stemKey = (stem) => "stem-" + String(stem).slice(0, 48).replace(/\W+/g, "-").toLowerCase();

  // Error key = "<bankId>#<itemId>" (ids are only unique per bank file). Legacy records
  // keyed by bare id / stem hash are kept and renamed by migrateErrorKeys() when their bank loads.
  function errKeyFor(it) {
    if (it.errKey) return it.errKey;
    if (it.bankId && it.id) return it.bankId + "#" + it.id;
    return (it.bankId ? it.bankId + "#" : "") + (it.id || stemKey(it.stem));
  }

  // One-time, idempotent rename of legacy q-errors keys (bare "b01" or "stem-…") to bank-scoped
  // keys. A legacy record is only claimed by an item with the same id (or stem hash) AND the same
  // stem, so a collided id ("b01" exists in several banks) maps to the bank it really came from.
  // Records that never match stay as they are and remain reviewable (they carry their own copy).
  function migrateErrorKeys(items) {
    const errs = store.get("q-errors", []);
    if (!errs.length) return;
    let changed = false;
    items.forEach(it => {
      if (!it.bankId) return;
      const newKey = errKeyFor(it);
      const legacyKeys = [it.id, stemKey(it.stem)].filter(Boolean);
      const idx = errs.findIndex(e => e && legacyKeys.includes(e.key) && e.key.indexOf("#") < 0 && String(e.stem) === String(it.stem));
      if (idx < 0) return;
      const legacy = errs[idx];
      const existing = errs.find(e => e && e.key === newKey);
      if (existing) {
        existing.attempts = (existing.attempts || 0) + (legacy.attempts || 0);
        if ((legacy.firstMissed || "") && (!existing.firstMissed || legacy.firstMissed < existing.firstMissed)) existing.firstMissed = legacy.firstMissed;
        if ((legacy.lastMissed || "") > (existing.lastMissed || "")) existing.lastMissed = legacy.lastMissed;
        if (legacy.resolved === false) existing.resolved = false;
        existing.ts = Math.max(existing.ts || 0, legacy.ts || 0, Date.now());
        errs.splice(idx, 1);
      } else {
        legacy.legacyKey = legacy.key;
        legacy.key = newKey;
        legacy.bankId = it.bankId;
        legacy.ts = Date.now();
      }
      changed = true;
    });
    if (changed) store.set("q-errors", errs);
  }

  // local calendar date (was UTC via toISOString — wrong between midnight and 01:00/02:00 in Zurich)
  function today() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }

  // retries: one {ts, correct, conf?} entry per attempt outcome, capped at 20 (the
  // attempts counter keeps the true total); absent on records never re-attempted.
  const pushRetry = (e, correct, conf) => {
    const r = { ts: Date.now(), correct: !!correct };
    if (conf) r.conf = conf;
    e.retries = (Array.isArray(e.retries) ? e.retries : []).concat([r]).slice(-20);
  };

  function recordError(it, extra) {
    const errs = store.get("q-errors", []);
    const key = errKeyFor(it);
    const existing = errs.find(x => x.key === key);
    if (existing) {
      existing.attempts = (existing.attempts || 0) + 1;
      existing.lastMissed = today();
      existing.resolved = false;
      existing.ts = Date.now();
      pushRetry(existing, false);
      if (extra && extra.userChoice !== undefined) existing.userAnswer = extra.userChoice; // latest wrong choice
      C.applyToError(existing, extra && extra.conf, true);
    } else {
      errs.push({
        key, id: it.id || null, bankId: it.bankId || null, subject: session.subject, topic: it.topic || "",
        topicLabel: it.topicLabel || "", format: it.format, stem: it.stem,
        choices: it.choices || null, answer: (typeof it.answer === "number" ? it.answer : null),
        userAnswer: (extra && extra.userChoice !== undefined) ? extra.userChoice : null,
        note: it.note || "", marks: it.marks || null, markscheme: it.markscheme || null,
        tactic: it.tactic || "", attempts: 1, firstMissed: today(), lastMissed: today(), resolved: false,
        ts: Date.now()
      });
      C.applyToError(errs[errs.length - 1], extra && extra.conf, true);
    }
    store.set("q-errors", errs);
  }

  function markReviewResult(it, correct, conf) {
    const errs = store.get("q-errors", []);
    const e = errs.find(x => x.key === it.errKey);
    if (e) {
      e.attempts = (e.attempts || 0) + 1;
      e.lastAttempt = today();
      if (correct) e.resolved = true;
      pushRetry(e, correct, conf);
      C.applyToError(e, conf, !correct);
      e.ts = Date.now();
      store.set("q-errors", errs);
    }
  }

  // retired records are soft-hidden ("not relevant") — they no longer count as waiting work
  function unresolvedCount() { return getErrors().filter(e => !e.resolved && !e.retired).length; }

  function updateReviewUI() {
    const btn = $("q-review-btn");
    const c = $("q-review-count");
    const n = unresolvedCount();
    if (btn) btn.disabled = n === 0;
    if (c) c.textContent = n ? (n + " missed question(s) waiting for review") : "no missed questions waiting";
    renderConfidentWrong();
  }

  // setup panel: unresolved misses that were answered "sure" (false confidence to target)
  function renderConfidentWrong() {
    const box = $("q-confwrong");
    if (!box) return;
    const list = C.confidentWrongErrors(getErrors()).filter(e => !e.retired);
    if (!list.length) { box.innerHTML = "<p class='muted'>Nothing here. When you mark an answer \u201csure\u201d and get it wrong, it is listed here until you get it right in a review.</p>"; return; }
    box.innerHTML = `<p class="muted">${list.length} question(s) you were sure about but got wrong. Review these first.</p>` +
      `<ul class="links">${list.slice(0, 8).map(e => `<li>${esc(String(e.topicLabel || ""))}${e.topicLabel ? " \u2014 " : ""}${esc(String(e.stem || "").slice(0, 120))}</li>`).join("")}</ul>` +
      (list.length > 8 ? `<p class="muted">\u2026and ${list.length - 8} more.</p>` : "") +
      `<button id="q-confwrong-btn" class="btn">Review confident-but-wrong (${list.length})</button>`;
    $("q-confwrong-btn").addEventListener("click", () => startReview(true));
  }

  // Review session. Back-compat: the argument is either the legacy boolean
  // (true = confident-but-wrong only) or an options object:
  //   {confidentOnly: bool} — as above;
  //   {keys: ["bank#id", …]} — build the session ONLY from the stored error records
  //     with those keys (Mistakes page deep link, quiz.html?errkeys=…). Unknown keys
  //     are skipped and reported with the same notice pattern startFromLink uses.
  // Retired records ("not relevant") are never served by the automatic review paths.
  function startReview(confidentOnly) {
    const opts = (confidentOnly && typeof confidentOnly === "object") ? confidentOnly : { confidentOnly: confidentOnly === true };
    let errs = null, bits = [];
    if (opts.keys) {
      const want = new Set(opts.keys);
      errs = getErrors().filter(e => e && e.key && want.has(e.key));
      const missing = opts.keys.length - errs.length;
      if (missing) bits.push(`${missing} linked item(s) not found.`);
      if (!errs.length) { $("q-error").textContent = "None of the questions picked from the mistake log could be found."; return false; }
    } else if (opts.confidentOnly) {
      errs = C.confidentWrongErrors(getErrors()).filter(e => !e.retired);
    } else {
      errs = getErrors().filter(e => !e.resolved && !e.retired);
    }
    if (!errs.length) { $("q-error").textContent = "No missed questions to review \u2014 well done!"; return false; }
    const items = shuffle(errs).map(e => ({
      id: e.id, errKey: e.key, format: e.format, stem: e.stem,
      choices: e.choices, answer: e.answer, note: e.note,
      marks: e.marks, markscheme: e.markscheme, tactic: e.tactic,
      topic: e.topic, topicLabel: e.topicLabel, subject: e.subject || null, isReview: true
    }));
    const label = opts.keys ? "Mistake review" : (opts.confidentOnly ? "Confident-but-wrong review" : "Error review");
    const notice = opts.keys
      ? "Reviewing the questions you picked from the mistake log." + (bits.length ? " " + bits.join(" ") : "")
      : (opts.confidentOnly ? "Reviewing questions you were sure about but got wrong." : "Reviewing questions you previously missed.");
    session = { items, idx: 0, results: [], review: true, subject: null, label, requested: items.length, notice };
    $("setup").style.display = "none";
    $("runner").style.display = "";
    renderQuestion();
    return true;
  }

  function fcSaveFromQuiz(it) {
    const user = store.get("fc-user", []);
    user.push({ id: "u-" + Date.now(), type: "qa", subject: session.subject || it.subject || "user", topic: it.topic, topicLabel: it.topicLabel || "", tags: ["from-quiz"], front: String(it.stem).slice(0, 160), back: String(it.note || (it.markscheme || []).join(" ") || "").slice(0, 400) });
    store.set("fc-user", user);
  }
  function reset() {
    $("summary").style.display = "none";
    $("setup").style.display = "";
    session = null;
  }

  // test hook (node --test loads this file in a vm); the pure picker model
  // (buildTopics/taughtState/difficultyPass) is exported for the node tests
  window.NB = window.NB || {};
  window.NB.quizEngine = { isActive, bankItems, buildTopics, taughtState, difficultyPass, DIFFICULTY_ORDER };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

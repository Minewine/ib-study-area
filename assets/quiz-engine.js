/* IB Study Area — practice session engine.
   20-question sessions from JSON banks: MCQ auto-marking, written answers
   self-marked against the markscheme, post-session gap analysis + tactics. */
(function () {
  "use strict";

  const PATH_BASE = location.pathname.includes("/app/") ? "../" : "";

  const $ = (id) => document.getElementById(id);
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

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
        BANKS[m.subject] = BANKS[m.subject] || { label: m.subjectLabel, banks: [] };
        BANKS[m.subject].banks.push({ file: m.file, label: m.label });
      });
      return true;
    } catch (e) { console.warn("quiz manifest load failed — using built-in fallback", e); BANKS = FALLBACK_BANKS; return false; }
  }

async function init() {
    await loadManifest();
    store.get("q-userbanks", []).forEach(b => {
      BANKS[b.subject] = BANKS[b.subject] || { label: b.subjectLabel || b.subject, banks: [] };
      BANKS[b.subject].banks.push({
        file: null, label: b.label || b.topicLabel || "My bank",
        items: b.items, topicLabel: b.topicLabel || b.label || "My bank", inline: true
      });
    });
    const subj = $("q-subject");
    Object.entries(BANKS).forEach(([key, b]) => {
      const o = document.createElement("option"); o.value = key; o.textContent = b.label; subj.appendChild(o);
    });
    subj.addEventListener("change", fillTopics);
    fillTopics();
    $("q-start").addEventListener("click", startSession);
    const rbtn = $("q-review-btn");
    if (rbtn) {
      rbtn.addEventListener("click", () => startReview(false));
      updateReviewUI();
    }
    renderLog();
    const params = new URLSearchParams(location.search);
    if (params.getAll("from").length) await startFromLink(params);
  }

  function fillTopics() {
    const key = $("q-subject").value;
    const topic = $("q-topic");
    topic.innerHTML = "";
    const all = document.createElement("option");
    all.value = "*"; all.textContent = "Mixed — all available topics";
    topic.appendChild(all);
    (BANKS[key] ? BANKS[key].banks : []).forEach((b, i) => {
      const o = document.createElement("option"); o.value = String(i); o.textContent = b.label; topic.appendChild(o);
    });
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

  async function startSession() {
    const key = $("q-subject").value;
    const pick = $("q-topic").value;
    const format = $("q-format").value;
    const n = parseInt($("q-length").value, 10);
    const chosen = BANKS[key].banks.filter((_, i) => pick === "*" || String(i) === pick);
    $("q-error").textContent = "";
    let items = [];
    try {
      for (const b of chosen) items = items.concat(await bankItems(b));
    } catch (e) { $("q-error").textContent = "Could not load question bank: " + e.message; return; }
    migrateErrorKeys(items);
    if (format !== "mixed") items = items.filter(it => it.format === format);
    shuffle(items);
    const use = items.slice(0, n);
    if (!use.length) { $("q-error").textContent = "No questions match that filter yet — pick another combination."; return; }
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
    const topicTag = `<div class="q-topic">${esc(it.topicLabel || "")} · ${it.format === "mcq" ? "multiple choice" : `written — ${it.marks} marks`}${style}</div>`;
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
                 <div class="q-score">Score: <select id="q-selfscore">${Array.from({ length: (it.marks || 1) + 1 }, (_, k) => `<option value="${k}">${k} / ${it.marks}</option>`).join("")}</select></div>
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
    saveLog(pct, got, max, session.label, C.logField(res));
    renderLog();
    updateReviewUI();
  }

  function saveLog(pct, got, max, label, conf) {
    const log = store.get("quizlog", []);
    const entry = { date: today(), label, pct, got, max, ts: Date.now() }; // local date; ts keeps two identical sessions distinct in the sync merge
    if (conf) entry.conf = conf; // {sure, sureRight, guess, guessRight}; absent on older entries
    log.unshift(entry);
    store.set("quizlog", log.slice(0, 20));
  }
  function renderLog() {
    const el = $("q-log");
    if (!el) return;
    const log = store.get("quizlog", []);
    el.innerHTML = log.length
      ? log.slice(0, 8).map(e => { const c = C.describe(e.conf); return `<li>${esc(String(e.date))} — ${esc(String(e.label))}: <strong>${e.got}/${e.max} (${e.pct}%)</strong>${c ? ` <span class="muted">(${esc(c)})</span>` : ""}</li>`; }).join("")
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

  function recordError(it, extra) {
    const errs = store.get("q-errors", []);
    const key = errKeyFor(it);
    const existing = errs.find(x => x.key === key);
    if (existing) {
      existing.attempts = (existing.attempts || 0) + 1;
      existing.lastMissed = today();
      existing.resolved = false;
      existing.ts = Date.now();
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
      C.applyToError(e, conf, !correct);
      e.ts = Date.now();
      store.set("q-errors", errs);
    }
  }

  function unresolvedCount() { return getErrors().filter(e => !e.resolved).length; }

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
    const list = C.confidentWrongErrors(getErrors());
    if (!list.length) { box.innerHTML = "<p class='muted'>Nothing here. When you mark an answer \u201csure\u201d and get it wrong, it is listed here until you get it right in a review.</p>"; return; }
    box.innerHTML = `<p class="muted">${list.length} question(s) you were sure about but got wrong. Review these first.</p>` +
      `<ul class="links">${list.slice(0, 8).map(e => `<li>${esc(String(e.topicLabel || ""))}${e.topicLabel ? " \u2014 " : ""}${esc(String(e.stem || "").slice(0, 120))}</li>`).join("")}</ul>` +
      (list.length > 8 ? `<p class="muted">\u2026and ${list.length - 8} more.</p>` : "") +
      `<button id="q-confwrong-btn" class="btn">Review confident-but-wrong (${list.length})</button>`;
    $("q-confwrong-btn").addEventListener("click", () => startReview(true));
  }

  function startReview(confidentOnly) {
    const errs = confidentOnly === true ? C.confidentWrongErrors(getErrors()) : getErrors().filter(e => !e.resolved);
    if (!errs.length) { $("q-error").textContent = "No missed questions to review \u2014 well done!"; return; }
    const items = shuffle(errs).map(e => ({
      id: e.id, errKey: e.key, format: e.format, stem: e.stem,
      choices: e.choices, answer: e.answer, note: e.note,
      marks: e.marks, markscheme: e.markscheme, tactic: e.tactic,
      topic: e.topic, topicLabel: e.topicLabel, subject: e.subject || null, isReview: true
    }));
    const label = confidentOnly === true ? "Confident-but-wrong review" : "Error review";
    session = { items, idx: 0, results: [], review: true, subject: null, label, requested: items.length, notice: confidentOnly === true ? "Reviewing questions you were sure about but got wrong." : "Reviewing questions you previously missed." };
    $("setup").style.display = "none";
    $("runner").style.display = "";
    renderQuestion();
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

  // test hook (node --test loads this file in a vm)
  window.NB = window.NB || {};
  window.NB.quizEngine = { isActive, bankItems };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

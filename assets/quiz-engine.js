/* IB Study Area — practice session engine.
   20-question sessions from JSON banks: MCQ auto-marking, written answers
   self-marked against the markscheme, post-session gap analysis + tactics. */
(function () {
  "use strict";

  const PATH_BASE = location.pathname.includes("/app/") ? "../" : "";

  const $ = (id) => document.getElementById(id);
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  let session = null;
  let BANKS = {};

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
    renderLog();
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

  async function startSession() {
    const key = $("q-subject").value;
    const pick = $("q-topic").value;
    const format = $("q-format").value;
    const n = parseInt($("q-length").value, 10);
    const chosen = BANKS[key].banks.filter((_, i) => pick === "*" || String(i) === pick);
    $("q-error").textContent = "";
    let items = [];
    try {
      for (const b of chosen) {
        if (b.inline) {
          items = items.concat((b.items || []).map(it => ({ ...it, topicLabel: it.topicLabel || b.topicLabel, bank: b.label })));
          continue;
        }
        const res = await fetch(PATH_BASE + b.file + "?cb=" + Date.now(), { cache: "no-store" });
        if (!res.ok) throw new Error(res.status + " " + b.file);
        const data = await res.json();
        items = items.concat(data.items.map(it => ({ ...it, topicLabel: data.topicLabel, bank: b.label })));
      }
    } catch (e) { $("q-error").textContent = "Could not load question bank: " + e.message; return; }
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
    prog.textContent = `Question ${session.idx + 1} / ${session.items.length}`;
    const box = $("q-box");
    const topicTag = `<div class="q-topic">${esc(it.topicLabel || "")} · ${it.format === "mcq" ? "multiple choice" : `written — ${it.marks} marks`}</div>`;
    let html = topicTag + `<div class="q-stem">${esc(it.stem)}</div>`;
    if (it.format === "mcq") {
      html += `<div class="q-choices">` + it.choices.map((c, i) =>
        `<button class="choice" data-i="${i}">${String.fromCharCode(65 + i)}. ${esc(c)}</button>`).join("") + `</div>`;
    } else {
      html += `<textarea id="q-answer" rows="4" placeholder="Work through it here, then self-mark against the markscheme…"></textarea>
               <div class="q-actions"><button id="q-reveal" class="btn">Reveal markscheme</button></div>
               <div id="q-ms" class="q-ms" style="display:none">
                 <ol>${it.markscheme.map(m => `<li>${esc(m)}</li>`).join("")}</ol>
                 <p class="muted">Self-score honestly — the gap analysis only works if you don't inflate.</p>
                 <div class="q-score">Score: <select id="q-selfscore">${Array.from({ length: (it.marks || 1) + 1 }, (_, k) => `<option value="${k}">${k} / ${it.marks}</option>`).join("")}</select></div>
                 <div class="q-actions"><button id="q-fc" class="btn">＋ Flashcard</button><button id="q-next" class="btn primary">Next question</button></div>
               </div>`;
    }
    box.innerHTML = html;

    if (it.format === "mcq") {
      box.querySelectorAll(".choice").forEach(btn => {
        btn.addEventListener("click", () => {
          const chosen = parseInt(btn.dataset.i, 10);
          const right = chosen === it.answer;
          box.querySelectorAll(".choice").forEach((b, i) => {
            b.disabled = true;
            if (i === it.answer) b.classList.add("correct");
            if (i === chosen && !right) b.classList.add("wrong");
          });
          session.results.push({ id: it.id, topic: it.topic, topicLabel: it.topicLabel, format: "mcq", got: right ? 1 : 0, max: 1, note: it.note });
          const after = document.createElement("div");
          after.className = "q-note" + (right ? " good" : " bad");
          after.innerHTML = (right ? "✓ Correct. " : "✗ Not quite. ") + esc(it.note || "") +
            `<div class="q-actions"><button id="q-fc" class="btn">＋ Flashcard</button><button id="q-next" class="btn primary">Next question</button></div>`;
          box.appendChild(after);
          $("q-next").addEventListener("click", nextQuestion);
    const fcBtn = document.getElementById("q-fc");
    if (fcBtn) fcBtn.addEventListener("click", () => { fcSaveFromQuiz(it); fcBtn.textContent = "\u2713 Saved to Cards"; fcBtn.disabled = true; });

        });
      });
    } else {
      $("q-reveal").addEventListener("click", () => {
        $("q-ms").style.display = "";
        $("q-reveal").disabled = true;
    const fcBtn = document.getElementById("q-fc");
    if (fcBtn) fcBtn.addEventListener("click", () => { fcSaveFromQuiz(it); fcBtn.textContent = "\u2713 Saved to Cards"; fcBtn.disabled = true; });

        $("q-next").addEventListener("click", () => {
          const got = parseInt($("q-selfscore").value, 10);
          session.results.push({ id: it.id, topic: it.topic, topicLabel: it.topicLabel, format: "written", got, max: it.marks, note: "" });
          nextQuestion();
        });
      });
    }
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
    if (!advice.length && pct >= 70) advice.push("Solid session — move the topic green in the subject checklist and log 2 tricky items in the error log anyway.");
    advice.push("Log every lost mark in the practice page error log with a topic tag.");

    $("summary").innerHTML = `
      <h3>Session summary — ${esc(session.label)}</h3>
      <div class="big">${got} / ${max} <span class="muted">(${pct}%)</span></div>
      ${session.notice ? `<p class="muted">${esc(session.notice)}</p>` : ""}
      <h3>Topic breakdown</h3>
      <ul class="links">${okTopics.join("") || "<li class='muted'>—</li>"}</ul>
      ${flags.length ? `<div class="currency"><strong>Weak-topic flags:</strong><ul class="links">${flags.join("")}</ul></div>` : `<p>✓ No topic fell below 70% this session.</p>`}
      ${missedTactics.length ? `<h3>Tactics for the questions you missed</h3><ul>${missedTactics.map(t => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
      <h3>What to do next</h3><ul>${advice.map(a => `<li>${esc(a)}</li>`).join("")}</ul>
      <div class="q-actions"><button class="btn primary" id="q-again">New session</button></div>`;
    $("q-again").addEventListener("click", reset);
    saveLog(pct, got, max, session.label);
    renderLog();
  }

  function saveLog(pct, got, max, label) {
    const log = store.get("quizlog", []);
    log.unshift({ date: new Date().toISOString().slice(0, 10), label, pct, got, max });
    store.set("quizlog", log.slice(0, 20));
  }
  function renderLog() {
    const el = $("q-log");
    if (!el) return;
    const log = store.get("quizlog", []);
    el.innerHTML = log.length
      ? log.slice(0, 8).map(e => `<li>${e.date} — ${esc(e.label)}: <strong>${e.got}/${e.max} (${e.pct}%)</strong></li>`).join("")
      : "<li class='muted'>No sessions yet.</li>";
  }

  const store = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  function fcSaveFromQuiz(it) {
    const user = store.get("fc-user", []);
    user.push({ id: "u-" + Date.now(), type: "qa", subject: session.subject, topic: it.topic, topicLabel: it.topicLabel || "", tags: ["from-quiz"], front: String(it.stem).slice(0, 160), back: String(it.note || (it.markscheme || []).join(" ") || "").slice(0, 400) });
    store.set("fc-user", user);
  }
  function reset() {
    $("summary").style.display = "none";
    $("setup").style.display = "";
    session = null;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

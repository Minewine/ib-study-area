/* Ask an AI on a topic note: copy a prompt from library/ai-prompts.json and open the preferred assistant.
   Click a mode → clipboard + new tab; she pastes with Ctrl+V. Pref (ai-pref) is device-local, not synced. */
(function () {
  "use strict";
  const NB = window.NB = window.NB || {};
  const PATH_BASE = location.pathname.includes("/app/") ? "../" : "";
  const PREF_KEY = "ai-pref";
  const KNOWN = ["subject", "level", "topic", "understandings", "keyterms", "wrong_questions"];
  const esc = NB.escapeHtml || ((s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"));
  const fileId = (f) => String(f).split("/").pop().replace(/\.json$/i, "");
  const tidy = (s) => String(s || "").replace(/[ \t]+\n/g, "\n").replace(/ {2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  const httpsUrl = (u) => { const s = String(u || "").trim(); return /^https:\/\/[^\s<]+$/i.test(s) ? s : ""; };

  let cfg = null, loadP = null;

  function getPref() { try { return localStorage.getItem(PREF_KEY) || ""; } catch (e) { return ""; } }
  function setPref(id) { try { localStorage.setItem(PREF_KEY, String(id || "")); } catch (e) {} }

  function subjectLevel(note) {
    const m = String(note.subject || "").match(/^(.*)-(hl|sl)$/i);
    if (m) {
      const name = m[1].replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()).replace(/\bAa\b/, "AA");
      return { subject: name, level: m[2].toUpperCase() };
    }
    return { subject: String(note.subject || "this subject"), level: note.hlOnly ? "HL" : "" };
  }

  function understandings(note) {
    const rows = (note.keyIdeas || []).map(k => {
      const line = [k.stmt, k.cue].filter(Boolean).join(": ");
      return line ? ((k.ahl ? "[AHL] " : "") + line) : "";
    }).filter(Boolean);
    if (rows.length) return rows.map(r => "- " + r).join("\n");
    const stmts = ((note.statements || {}).SL || []).concat((note.statements || {}).AHL || []);
    if (stmts.length) return stmts.join(", ");
    return note.bigPicture || "the official syllabus points for this topic";
  }

  function keyterms(note) {
    const rows = (note.keyTerms || []).map(t => t && t.term ? (t.def ? t.term + ": " + t.def : t.term) : "").filter(Boolean);
    return rows.length ? rows.join("; ") : "none listed in the topic note";
  }

  function wrongQuestions(note) {
    let errs = [];
    try { errs = JSON.parse(localStorage.getItem("q-errors") || "[]"); } catch (e) { errs = []; }
    if (!Array.isArray(errs)) errs = [];
    const allow = new Map();
    ((note.links && note.links.quizBanks) || []).forEach(b => { if (b && b.file) allow.set(fileId(b.file), b.itemIds ? new Set(b.itemIds) : null); });
    const stems = [], seen = {};
    errs.forEach(e => {
      if (!e || e.resolved) return;
      const key = String(e.key || ""), hash = key.indexOf("#");
      const bank = e.bankId || (hash >= 0 ? key.slice(0, hash) : "");
      const id = e.id || (hash >= 0 ? key.slice(hash + 1) : "");
      if (!allow.has(bank)) return;
      const ids = allow.get(bank);
      if (ids && id && !ids.has(id)) return;
      const stem = String(e.stem || "").replace(/\s+/g, " ").trim().slice(0, 300);
      if (!stem || seen[stem]) return;
      seen[stem] = true;
      stems.push("- " + stem);
    });
    return stems.length ? stems.slice(0, 8).join("\n") : "No missed questions are recorded for this topic yet.";
  }

  function values(note) {
    const sl = subjectLevel(note || {});
    const codeTitle = [note && note.code, note && note.title].filter(Boolean).join(" ");
    const theme = note && note.themeLabel ? " (" + note.themeLabel + ")" : "";
    return { subject: sl.subject, level: sl.level, topic: (codeTitle || "this topic") + theme, understandings: understandings(note || {}), keyterms: keyterms(note || {}), wrong_questions: wrongQuestions(note || {}) };
  }

  function fill(template, vals) {
    return String(template || "").replace(/\{([a-z_]+)\}/g, (all, k) => (Object.prototype.hasOwnProperty.call(vals, k) ? String(vals[k]) : all));
  }

  function build(note, modeId, config) {
    const c = config || cfg || {};
    const mode = (c.modes || []).find(m => m.id === modeId);
    return tidy(fill((c.preamble || "") + "\n\n" + ((mode && mode.template) || ""), values(note)));
  }

  function fallbackCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } finally { ta.remove(); }
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () { fallbackCopy(text); });
    }
    fallbackCopy(text);
    return Promise.resolve();
  }

  function toast(msg) {
    let t = document.getElementById("nt-ai-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "nt-ai-toast";
      t.className = "nt-ai-toast";
      t.setAttribute("role", "status");
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 3500);
  }

  function load() {
    if (loadP) return loadP;
    loadP = fetch(PATH_BASE + "library/ai-prompts.json?cb=" + Date.now(), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) { cfg = j; return j; });
    return loadP;
  }

  function render(note) {
    const box = document.createElement("section");
    box.className = "card nt-sec nt-ai";
    box.id = "nt-ai";
    const h = document.createElement("h3"); h.textContent = "Ask an AI"; box.appendChild(h);
    const help = document.createElement("p"); help.className = "muted";
    help.textContent = "Copies a prompt for this topic and opens your preferred assistant. Paste with Ctrl+V (Cmd+V on a Mac).";
    box.appendChild(help);
    const modes = document.createElement("div"); modes.className = "nt-ai-modes"; modes.id = "nt-ai-modes";
    const picker = document.createElement("label"); picker.className = "nt-ai-pref";
    picker.appendChild(document.createTextNode("Open in "));
    const sel = document.createElement("select"); sel.id = "nt-ai-pref"; sel.setAttribute("aria-label", "Preferred AI");
    picker.appendChild(sel);
    const status = document.createElement("p"); status.className = "muted"; status.id = "nt-ai-status";
    function draw() {
      modes.textContent = ""; sel.textContent = "";
      if (!cfg) { status.textContent = "Could not load AI prompts."; return; }
      status.textContent = "";
      const pref = getPref();
      (cfg.assistants || []).forEach(function (a) {
        const o = document.createElement("option");
        o.value = a.id; o.textContent = a.name;
        if (a.id === (pref || cfg.default_ai)) o.selected = true;
        sel.appendChild(o);
      });
      (cfg.modes || []).forEach(function (m) {
        const b = document.createElement("button");
        b.type = "button"; b.className = "btn nt-mini"; b.dataset.mode = m.id;
        b.textContent = m.label;
        b.addEventListener("click", function () {
          setPref(sel.value);
          const a = (cfg.assistants || []).find(function (x) { return x.id === sel.value; }) || (cfg.assistants || [])[0];
          const url = a && httpsUrl(a.url);
          if (url) window.open(url, "_blank", "noopener");
          const text = NB.aiPrompt.lastText = build(note, m.id);
          copyText(text).then(function () { toast("Prompt copied — press Ctrl+V in the new tab"); });
        });
        modes.appendChild(b);
      });
    }
    sel.addEventListener("change", function () { setPref(sel.value); });
    box.appendChild(modes); box.appendChild(picker); box.appendChild(status);
    load().then(draw).catch(draw);
    return box;
  }

  NB.aiPrompt = { load: load, build: build, values: values, render: render, KNOWN: KNOWN, PREF_KEY: PREF_KEY, lastText: "" };
})();

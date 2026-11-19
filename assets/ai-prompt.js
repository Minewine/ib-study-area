/* Ask an AI on a topic note: copy a prompt from library/ai-prompts.json and open the preferred assistant.
   Click a mode → the prompt is copied synchronously while this page still has focus, then the assistant
   opens in a new tab; she pastes with Ctrl+V. Pref (ai-pref) is device-local, not synced. */
(function () {
  "use strict";
  const NB = window.NB = window.NB || {};
  const PATH_BASE = location.pathname.includes("/app/") ? "../" : "";
  const PREF_KEY = "ai-pref";
  const KNOWN = ["subject", "level", "topic", "understandings", "keyterms", "wrong_questions"];
  const fileId = (f) => String(f).split("/").pop().replace(/\.json$/i, "");
  const tidy = (s) => String(s || "").replace(/[ \t]+\n/g, "\n").replace(/ {2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  const httpsUrl = (u) => { const s = String(u || "").trim(); return /^https:\/\/[^\s<]+$/i.test(s) ? s : ""; };

  let cfg = null, loadP = null;

  function getPref() { try { return localStorage.getItem(PREF_KEY) || ""; } catch (e) { return ""; } }
  function setPref(id) { try { localStorage.setItem(PREF_KEY, String(id || "")); } catch (e) {} }

  function subjectLevel(note, config) {
    const raw = String(note.subject || "");
    const names = (config && config.subjectNames) || {};
    const m = raw.match(/^(.*)-(hl|sl)$/i);
    if (Object.prototype.hasOwnProperty.call(names, raw)) return { subject: names[raw], level: m ? m[2].toUpperCase() : (note.hlOnly ? "HL" : "") };
    if (m) {
      const name = m[1].replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()).replace(/\bAa\b/, "AA");
      return { subject: name, level: m[2].toUpperCase() };
    }
    return { subject: raw || "this subject", level: note.hlOnly ? "HL" : "" };
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
    if (NB.store) errs = NB.store.get("q-errors", []); // scoped per account
    else { try { errs = JSON.parse(localStorage.getItem("q-errors") || "[]"); } catch (e) { errs = []; } } // stale-cache fallback
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

  function values(note, config) {
    const sl = subjectLevel(note || {}, config);
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
    return tidy(fill((c.preamble || "") + "\n\n" + ((mode && mode.template) || ""), values(note, c)));
  }

  function fallbackCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.appendChild(ta);
    ta.select();
    if (typeof ta.setSelectionRange === "function") ta.setSelectionRange(0, text.length); // iOS Safari ignores select()
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; } finally { ta.remove(); }
    return ok;
  }

  // Copy while this page still has focus; it must run BEFORE window.open — once
  // the new tab takes focus, browsers refuse clipboard writes. execCommand is the
  // primary path (synchronous, completes inside the click); the async Clipboard
  // API is the backup when execCommand is refused, so callers get "maybe" and the
  // toast hedges instead of claiming a copy that may not have happened (its
  // rejection is expected once the tab steals focus).
  function copyText(text) {
    try { if (fallbackCopy(text)) return "copied"; } catch (e) { /* try the async API */ }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        const p = navigator.clipboard.writeText(text);
        if (p && p.catch) p.catch(function () {});
        return "maybe";
      }
    } catch (e) { /* fall through */ }
    return "failed";
  }

  function clickMsg(res, opened, hasUrl) {
    if (res === "failed") return "Could not copy the prompt — try again";
    if (!opened) {
      if (!hasUrl) {
        return res === "copied"
          ? "Prompt copied, but no assistant link is configured in library/ai-prompts.json"
          : "Copy attempted, but no assistant link is configured in library/ai-prompts.json";
      }
      return "Your browser blocked the new tab — allow pop-ups for this site, then try again";
    }
    if (res === "copied") return "Prompt copied — press Ctrl+V in the new tab";
    return "Tab opened — if the paste comes up empty, come back and press “Copy the prompt again”";
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
    loadP = fetch(PATH_BASE + "library/ai-prompts.json", { cache: "no-store" })
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
    const again = document.createElement("button");
    again.type = "button"; again.className = "btn nt-mini"; again.id = "nt-ai-again";
    again.textContent = "Copy the prompt again";
    again.hidden = true;
    again.addEventListener("click", function () {
      if (!NB.aiPrompt.lastText || NB.aiPrompt.lastNote !== note.id) return;
      const res = copyText(NB.aiPrompt.lastText);
      if (res === "failed") status.textContent = "Could not copy — try again";
      else status.textContent = "";
      toast(res === "copied" ? "Prompt copied — switch to your AI and paste"
           : res === "maybe" ? "Copy attempted — if the paste comes up empty, try again"
           : "Could not copy — try again");
    });
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
        let lastThis = 0;
        b.addEventListener("click", function () {
          const now = Date.now();
          if (now - lastThis < 600) return; // same button twice fast = accidental double-click; a different mode stays clickable
          lastThis = now;
          setPref(sel.value);
          const a = (cfg.assistants || []).find(function (x) { return x.id === sel.value; }) || (cfg.assistants || [])[0];
          const url = a && httpsUrl(a.url);
          const text = NB.aiPrompt.lastText = build(note, m.id);
          NB.aiPrompt.lastNote = note.id;
          again.hidden = false;
          const res = copyText(text);
          let opened = null;
          if (res !== "failed" && url) {
            opened = window.open(url, "_blank");
            if (opened) opened.opener = null; // manual noopener — and lets us tell a blocked tab from an opened one
          }
          const msg = clickMsg(res, !!opened, !!url);
          toast(msg);
          status.textContent = (res === "failed" || !opened) ? msg : ""; // failure stays visible after she returns
        });
        modes.appendChild(b);
      });
      again.hidden = NB.aiPrompt.lastNote !== note.id; // resets on another note: no stale cross-note copy
      modes.appendChild(again);
    }
    sel.addEventListener("change", function () { setPref(sel.value); });
    box.appendChild(modes); box.appendChild(picker); box.appendChild(status);
    load().then(draw).catch(draw);
    return box;
  }

  NB.aiPrompt = { load: load, build: build, values: values, render: render, copyText: copyText, clickMsg: clickMsg, KNOWN: KNOWN, PREF_KEY: PREF_KEY, lastText: "", lastNote: "" };
})();

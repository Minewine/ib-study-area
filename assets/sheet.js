/* NevaIB weekly retrieval sheet — window.NB.sheet, wired on app/index.html.
   "Print weekly retrieval sheet" builds one printable page: up to 10 questions to
   answer on paper, no screen — due missed questions first (q-errors records carry
   the full item: stem/choices/answer/markscheme), then due flashcards (fc-state due
   dates, deck files fetched lazily) — with an answer key on a second page.
   Read-only: reads storage, fetches decks only when the sheet is built. The item
   selectors are pure and exported for the node tests. */
(function () {
  "use strict";
  const NB = window.NB = window.NB || {};
  if (NB.sheet) return;

  const PATH_BASE = location.pathname.includes("/app/") ? "../" : "";
  const SHEET_N = 10;      // questions on the sheet
  const MAX_MISTAKES = 6;  // …of which at most this many are missed questions

  const store = (window.NB && window.NB.store) || {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v === null ? d : v; } catch (e) { return d; } }
  };

  const pad = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const todayISO = () => isoDate(new Date());
  const fileId = (f) => String(f).split("/").pop().replace(/\.json$/i, "");

  // ---------- pure selectors (exported for tests) ----------

  // Open (unresolved, unretired) mistakes whose spaced retest is due; a missing
  // dueAt (legacy record) counts as due. Earliest due first, then most recently
  // missed. hides(subjectId) drops subjects the account doesn't take.
  function dueErrorRecords(errors, nowMs, hides) {
    const now = nowMs == null ? Date.now() : nowMs;
    return (Array.isArray(errors) ? errors : [])
      .filter(e => e && e.key && !e.resolved && !e.retired
        && !(e.subject && hides && hides(e.subject))
        && (e.dueAt == null || e.dueAt <= now))
      .sort((a, b) => ((a.dueAt || 0) - (b.dueAt || 0))
        || String(b.lastMissed || "").localeCompare(String(a.lastMissed || ""))
        || ((b.ts || 0) - (a.ts || 0)));
  }

  // Due cards (deck cards + own fc-user cards) as {id, front, back, deck}.
  function dueCardList(cards, userCards, state, today, deleted) {
    const del = new Set(deleted || []);
    const st = state || {};
    return (Array.isArray(cards) ? cards : []).concat(Array.isArray(userCards) ? userCards : [])
      .filter(c => c && c.id && !del.has(c.id) && c.retired !== true && st[c.id] && st[c.id].due && st[c.id].due <= today)
      .map(c => ({ id: c.id, front: String(c.front || ""), back: String(c.back || ""), deck: c.deck || null }));
  }

  // The sheet: up to MAX_MISTAKES due mistakes, then due cards filling to max.
  function selectSheet(errors, cards, userCards, state, deleted, today, nowMs, hides, max) {
    max = max || SHEET_N;
    const mistakes = dueErrorRecords(errors, nowMs, hides).slice(0, Math.min(MAX_MISTAKES, max));
    const due = dueCardList(cards, userCards, state, today, deleted);
    const cardsOut = due.slice(0, Math.max(0, max - mistakes.length));
    return { mistakes, cards: cardsOut, dueCardTotal: due.length };
  }

  // ---------- rendering (browser only) ----------
  const el = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v === null || v === undefined || v === false) return;
      if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (k === "class") n.className = v;
      else n.setAttribute(k, v === true ? "" : String(v));
    });
    kids.flat().forEach(k => { if (k === null || k === undefined || k === false) return; n.append(typeof k === "string" ? document.createTextNode(k) : k); });
    return n;
  };

  const FETCH_TIMEOUT = 10000;
  const getJSON = (path) => {
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), FETCH_TIMEOUT) : null;
    const clear = () => { if (timer !== null) clearTimeout(timer); };
    return fetch(PATH_BASE + path, { cache: "no-cache", signal: ctrl ? ctrl.signal : undefined }).then(
      (r) => { clear(); if (!r.ok) throw new Error(r.status + " " + path); return r.json(); },
      (e) => { clear(); throw e; }
    );
  };

  // All library deck cards, keyed for due lookup. Subjects the account doesn't
  // take are skipped before their files are fetched (mirrors today.js).
  async function loadDeckCards() {
    const hides = (id) => !!(NB.profile && NB.profile.hides && NB.profile.hides(id));
    const registry = await getJSON("library/flashcards/manifest.json").catch(() => []);
    const visible = (Array.isArray(registry) ? registry : []).filter(r => r && r.file && !(r.subject && hides(r.subject)));
    const decks = await Promise.all(visible.map(r => getJSON(r.file)
      .then(d => (d && Array.isArray(d.cards) ? d.cards : []).map(c => ({ id: c.id, front: c.front, back: c.back, retired: c.retired === true, deck: fileId(r.file) })))
      .catch(() => [])));
    return [].concat(...decks);
  }

  function ensureOverlay() {
    let ov = document.getElementById("sheet-print");
    if (!ov) { ov = el("div", { id: "sheet-print" }); document.body.appendChild(ov); }
    return ov;
  }

  async function openSheet() {
    const ov = ensureOverlay();
    ov.textContent = "";
    ov.classList.add("open");
    const close = () => { ov.classList.remove("open"); ov.textContent = ""; };
    ov.append(el("div", { id: "sheet-bar" },
      el("strong", {}, "Weekly retrieval sheet"),
      el("button", { type: "button", onclick: () => window.print() }, "Print"),
      el("button", { type: "button", onclick: close }, "Close")));
    ov.append(el("p", { class: "muted" }, "Building the sheet…"));
    let sel;
    try {
      const hides = (id) => !!(NB.profile && NB.profile.hides && NB.profile.hides(id));
      const today = todayISO();
      const deckCards = await loadDeckCards();
      sel = selectSheet(store.get("q-errors", []), deckCards, store.get("fc-user", []),
        store.get("fc-state", {}), store.get("fc-deleted", []), today, Date.now(), hides, SHEET_N);
    } catch (e) {
      ov.textContent = "";
      ov.append(el("div", { id: "sheet-bar" }, el("button", { type: "button", onclick: close }, "Close")));
      ov.append(el("p", { class: "nt-err" }, "Could not build the sheet (" + ((e && e.message) || "error") + ")."));
      return;
    }
    const n = sel.mistakes.length + sel.cards.length;
    ov.textContent = "";
    ov.append(el("div", { id: "sheet-bar" },
      el("strong", {}, "Weekly retrieval sheet"),
      el("button", { type: "button", onclick: () => window.print() }, "Print"),
      el("button", { type: "button", onclick: close }, "Close")));
    ov.append(el("h1", {}, "Weekly retrieval sheet — " + todayISO()));
    if (!n) {
      ov.append(el("p", { class: "muted" }, "Nothing is due right now — no sheet to print. Run a quiz or review some cards first."));
      return;
    }
    ov.append(el("p", { class: "muted" },
      "Answer on paper, no screen. " + n + " question" + (n === 1 ? "" : "s") + ": "
      + sel.mistakes.length + " due missed question" + (sel.mistakes.length === 1 ? "" : "s") + ", "
      + sel.cards.length + " due card" + (sel.cards.length === 1 ? "" : "s")
      + (sel.dueCardTotal > sel.cards.length ? " (" + (sel.dueCardTotal - sel.cards.length) + " more due cards did not fit)" : "")
      + ". The answer key prints on page 2."));
    const ol = el("ol", { class: "sheet-qs" });
    let i = 0;
    sel.mistakes.forEach(m => {
      i++;
      const li = el("li", { class: "sheet-q" },
        el("div", { class: "sheet-stem" }, el("strong", {}, i + ". "), String(m.stem || "(no stem saved)"),
          m.format === "written" && m.marks ? " [" + m.marks + " marks]" : "",
          m.topicLabel ? el("div", { class: "muted" }, String(m.topicLabel)) : null));
      if (m.format === "mcq" && Array.isArray(m.choices)) {
        const cl = el("div", { class: "sheet-choices" });
        m.choices.forEach((c, j) => cl.append(el("div", {}, String.fromCharCode(65 + j) + ". " + c)));
        li.append(cl);
      } else {
        li.append(el("div", { class: "sheet-lines" }, el("div", {}), el("div", {}), el("div", {})));
      }
      ol.append(li);
    });
    sel.cards.forEach(c => {
      i++;
      ol.append(el("li", { class: "sheet-q" },
        el("div", { class: "sheet-stem" }, el("strong", {}, i + ". "), c.front,
          el("div", { class: "muted" }, c.deck ? "card · " + c.deck : "your own card"))));
    });
    ov.append(ol);
    const key = el("div", { class: "sheet-key" }, el("h2", {}, "Answer key"));
    const kl = el("ol", {});
    let k = 0;
    sel.mistakes.forEach(m => {
      k++;
      const bits = [];
      if (m.format === "mcq" && typeof m.answer === "number" && Array.isArray(m.choices)) bits.push(String.fromCharCode(65 + m.answer) + " — " + (m.choices[m.answer] || ""));
      else if (Array.isArray(m.markscheme) && m.markscheme.length) bits.push(m.markscheme.join(" · "));
      if (m.note) bits.push(String(m.note));
      kl.append(el("li", {}, k + ". " + (bits.join(" ") || "(re-read the topic note linked from this question)")));
    });
    sel.cards.forEach(c => { k++; kl.append(el("li", {}, k + ". " + c.back)); });
    key.append(kl);
    ov.append(key);
    document.body.classList.add("sheet-printing");
    window.addEventListener("afterprint", () => { document.body.classList.remove("sheet-printing"); }, { once: true });
    window.print();
  }

  function wire() {
    const today = document.getElementById("today");
    if (!today || document.getElementById("sheet-open")) return;
    today.append(el("div", { class: "td-block" },
      el("p", {},
        el("button", { id: "sheet-open", type: "button", onclick: () => { openSheet(); } }, "Print weekly retrieval sheet"),
        " ",
        el("span", { class: "muted" }, "— up to " + SHEET_N + " due questions on one A4 page, answer key on page 2."))));
  }

  NB.sheet = { dueErrorRecords, dueCardList, selectSheet, SHEET_N, MAX_MISTAKES };

  if (typeof document === "undefined" || !document.getElementById || !document.getElementById("today")) return;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();

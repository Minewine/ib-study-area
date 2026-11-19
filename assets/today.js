/* IB Study Area — "Today" panel on the practice home page.
   Three suggestions, no streaks or scores: (1) flashcards due today (Leitner state in
   fc-state), (2) a short quiz on the weakest topic (unresolved q-errors first, then
   note-linked quizlog results), (3) what is being taught in class this week
   (library/class-schedule.json, approximate) with links to its notes, quiz and cards.
   Read-only: this file never writes to storage. */
(function () {
  "use strict";

  const PATH_BASE = location.pathname.includes("/app/") ? "../" : "";
  const NB = window.NB || {};
  // Per-user subjects (assets/profile.js): the account's canonical subject ids
  // with registry labels. The literal below is only the stale-cache fallback
  // for a page that didn't load profile.js. Subjects the class schedule
  // doesn't track (history/french/english today) drop out at render time, so
  // a default-all profile adds no empty rows.
  const SUBJECTS = NB.profile
    ? NB.profile.subjects().map(id => [id, ((NB.SUBJECTS || []).find(s => s.id === id) || {}).label || id])
    : [["biology-hl", "Biology HL"], ["chemistry-hl", "Chemistry HL"], ["maths-aa-sl", "Maths AA SL"]];
  // canonical subject ids both sides: class-schedule.json and this file's own
  // subjectForCode predate the id scheme ("maths-aa-sl") while NB.profile
  // stores "math-aa-sl" — the alias map makes the two spellings one id
  const canon = NB.canonicalSubject || ((x) => x);
  const QUIZ_N = 6;
  const WEAK_PCT = 70;

  const store = (window.NB && window.NB.store) || {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v === null ? d : v; } catch (e) { return d; } }
  };
  const pad = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const fileId = (f) => String(f).split("/").pop().replace(/\.json$/i, "");
  const shuffle = (a, rnd) => { rnd = rnd || Math.random; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // ---------- pure logic (exported for tests) ----------

  // cards: [{id, deck, retired}] from the seeded decks. Due = has Leitner state with due <= today.
  function dueCards(cards, state, today, deleted) {
    const del = new Set(deleted || []);
    const byDeck = {};
    let total = 0, fresh = 0;
    (cards || []).forEach(c => {
      if (!c || !c.id || c.retired === true || del.has(c.id)) return;
      const s = state && state[c.id];
      if (!s) { fresh++; return; }
      if (s.due && s.due <= today) { total++; byDeck[c.deck] = (byDeck[c.deck] || 0) + 1; }
    });
    return { total, fresh, byDeck };
  }

  // Own cards (fc-user) have no deck, so they are counted separately.
  function dueUserCards(user, state, today, deleted) {
    const del = new Set(deleted || []);
    return (user || []).filter(c => c && c.id && !del.has(c.id) && state && state[c.id] && state[c.id].due && state[c.id].due <= today).length;
  }

  const CODE_RE = /^([A-D][1-4]\.\d|[SR][1-3]\.\d|[1-5]\.\d{1,2})\b/;
  function subjectForCode(code) {
    if (/^[A-D]/.test(code)) return "biology-hl";
    if (/^[SR]/.test(code)) return "chemistry-hl";
    return "maths-aa-sl";
  }

  // Weakest topic. 1) Unresolved missed questions (q-errors), grouped by bank + topic:
  //    most unresolved first, then the most recently missed. 2) Otherwise the quiz log:
  //    note-linked quizzes are labelled "<code> <title>"; the code with the lowest
  //    average score (below 70%) over the logged sessions.
  function weakestTopic(errors, log) {
    const groups = {};
    (errors || []).forEach(e => {
      if (!e || e.resolved || !e.bankId || String(e.bankId).startsWith("user:")) return;
      // per-user subject profile: a missed question from a subject the account
      // doesn't take is not a weak spot to re-quiz (unknown subjects stay)
      if (e.subject && NB.profile && NB.profile.hides(e.subject)) return;
      const key = e.bankId + "|" + (e.topic || "");
      const g = groups[key] = groups[key] || { source: "errors", key, bankId: e.bankId, topic: e.topic || "", topicLabel: e.topicLabel || e.topic || e.bankId, subject: e.subject || null, ids: [], count: 0, last: "" };
      g.count++;
      if (e.id && !g.ids.includes(e.id)) g.ids.push(e.id);
      if ((e.lastMissed || "") > g.last) g.last = e.lastMissed || "";
    });
    const ranked = Object.values(groups).sort((a, b) => (b.count - a.count) || (b.last < a.last ? -1 : b.last > a.last ? 1 : 0) || (a.key < b.key ? -1 : 1));
    if (ranked.length) return ranked[0];

    const byCode = {};
    (log || []).forEach(e => {
      if (!e || typeof e.pct !== "number") return;
      const m = CODE_RE.exec(String(e.label || ""));
      if (!m) return;
      const c = byCode[m[1]] = byCode[m[1]] || { source: "quizlog", code: m[1], label: String(e.label), subject: subjectForCode(m[1]), pcts: [] };
      c.pcts.push(e.pct);
    });
    const weak = Object.values(byCode)
      .map(c => Object.assign(c, { pct: Math.round(c.pcts.reduce((s, p) => s + p, 0) / c.pcts.length) }))
      .filter(c => c.pct < WEAK_PCT)
      .filter(c => !(NB.profile && NB.profile.hides(c.subject))) // per-user subject profile
      .sort((a, b) => (a.pct - b.pct) || (a.code < b.code ? -1 : 1));
    return weak[0] || null;
  }

  // Up to half the session from the topic's missed questions, the rest from other
  // (active) items of the same topic, else of the whole bank.
  function pickQuizIds(items, weak, n, rnd) {
    n = n || QUIZ_N;
    const active = (items || []).filter(it => it && it.id && it.retired !== true);
    const ids = new Set(active.map(it => it.id));
    const missed = ((weak && weak.ids) || []).filter(id => ids.has(id)).slice(0, Math.ceil(n / 2));
    const sameTopic = active.filter(it => weak && weak.topic && it.topic === weak.topic);
    const pool = (sameTopic.length >= n ? sameTopic : active).filter(it => !missed.includes(it.id)).map(it => it.id);
    return missed.concat(shuffle(pool, rnd)).slice(0, n);
  }

  // Units taught on `date` for one subject, the break (if any) covering it, and the next unit.
  // The schedule key is found by canonical id (see `canon` above), so callers may
  // pass either spelling of a subject id.
  function unitsFor(schedule, subject, date) {
    const subs = (schedule && schedule.subjects) || {};
    const key = Object.keys(subs).find(k => canon(k) === canon(subject));
    const s = key ? subs[key] : null;
    const units = (s && s.units || []).slice().sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
    const brk = ((schedule && schedule.breaks) || []).find(b => b.from <= date && date <= b.to) || null;
    const current = brk ? [] : units.filter(u => u.from <= date && date <= u.to);
    const next = units.find(u => u.from > date) || null;
    return { current, brk, next };
  }

  const fromParam = (id, ids) => "from=" + encodeURIComponent(id + (ids && ids.length ? ":" + ids.join(",") : ""));
  function quizHref(bankId, ids, label, n) {
    return "quiz.html?" + fromParam(bankId, ids) + "&n=" + (n || QUIZ_N) + "&label=" + encodeURIComponent(label);
  }
  function dueCardsHref(byDeck, total) {
    const decks = Object.keys(byDeck || {}).filter(d => d && d !== "null" && byDeck[d] > 0);
    if (!decks.length) return null;
    // cards.html deep links put due cards first, so n = due count gives exactly the due set
    return "cards.html?" + decks.map(d => fromParam(d)).join("&") + "&n=" + total + "&label=" + encodeURIComponent("Due today");
  }
  function noteLinks(note) {
    const L = (note && note.links) || {};
    const label = `${note.code} ${note.title}`;
    const q = (L.quizBanks || []).map(b => fromParam(fileId(b.file), b.itemIds));
    const c = (L.decks || []).map(d => fromParam(fileId(d.file), d.cardIds));
    return {
      notes: `notes.html?subject=${encodeURIComponent(note.subject)}&topic=${encodeURIComponent(fileId(note.file || note.id))}`,
      quiz: q.length ? `quiz.html?${q.join("&")}&n=10&label=${encodeURIComponent(label)}` : null,
      cards: c.length ? `cards.html?${c.join("&")}&label=${encodeURIComponent(label)}` : null
    };
  }

  // ---------- rendering (browser only) ----------
  const el = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => { if (v === null || v === undefined || v === false) return; if (k === "class") n.className = v; else n.setAttribute(k, v); });
    kids.flat().forEach(k => { if (k === null || k === undefined || k === false) return; n.append(typeof k === "string" ? document.createTextNode(k) : k); });
    return n;
  };
  const getJSON = (path) => fetch(PATH_BASE + path, { cache: "no-cache" }).then(r => { if (!r.ok) throw new Error(r.status + " " + path); return r.json(); });
  const fmtDay = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short" }); };

  let DATA = null; // { schedule, manifest, notes: {subject|code: note}, cards: [...] }

  async function load() {
    const [schedule, manifest, registry] = await Promise.all([
      getJSON("library/class-schedule.json").catch(() => null),
      getJSON("library/topic-notes/manifest.json").catch(() => null),
      getJSON("library/flashcards/manifest.json").catch(() => [])
    ]);
    const today = isoDate(new Date());
    const wanted = [];
    SUBJECTS.forEach(([s]) => unitsFor(schedule, s, today).current.forEach(u => u.codes.forEach(c => wanted.push([s, c]))));
    const entries = (manifest && manifest.notes) || [];
    const notes = {};
    const decks = await Promise.all([
      Promise.all(wanted.map(([s, c]) => {
        const m = entries.find(n => n.subject === s && n.code === c);
        return m ? getJSON(m.file).then(n => { notes[s + "|" + c] = Object.assign({ file: m.file }, n); }).catch(() => {}) : null;
      })),
      Promise.all((registry || []).map(r => getJSON(r.file).then(d => (d.cards || []).map(c => ({ id: c.id, deck: fileId(r.file), retired: c.retired === true }))).catch(() => [])))
    ]).then(([, d]) => d);
    DATA = { schedule, manifest, entries, notes, cards: [].concat(...decks) };
  }

  function renderCards(box, today) {
    const st = store.get("fc-state", {});
    const deleted = store.get("fc-deleted", []);
    const d = dueCards(DATA.cards, st, today, deleted);
    const own = dueUserCards(store.get("fc-user", []), st, today, deleted);
    const href = dueCardsHref(d.byDeck, d.total);
    const sec = el("div", { class: "td-block" }, el("h4", {}, "1. Flashcards"));
    if (d.total) sec.append(el("p", {}, `${d.total} card${d.total === 1 ? "" : "s"} due today. `), href ? el("a", { class: "td-btn", href }, "Start due cards") : null);
    else sec.append(el("p", {}, "Nothing due today. ", d.fresh ? `There are ${d.fresh} cards you haven't started; the class topics below link to the right deck.` : ""));
    if (own) sec.append(el("p", { class: "muted" }, `Plus ${own} of your own card${own === 1 ? "" : "s"} due. They're on the `, el("a", { href: "cards.html" }, "Cards"), " page."));
    box.append(sec);
  }

  async function renderQuiz(box) {
    const sec = el("div", { class: "td-block" }, el("h4", {}, "2. Short quiz"));
    box.append(sec);
    const weak = weakestTopic(store.get("q-errors", []), store.get("quizlog", []));
    if (!weak) { sec.append(el("p", {}, "No weak spots recorded yet. Use one of this week's class quizzes below.")); return; }
    if (weak.source === "errors") {
      sec.append(el("p", {}, "Weakest topic right now: ", el("strong", {}, weak.topicLabel), ` (${weak.count} missed question${weak.count === 1 ? "" : "s"} not yet fixed).`));
      let ids = null;
      try {
        const qm = await getJSON("library/questions/manifest.json");
        const m = (qm || []).find(b => fileId(b.file) === weak.bankId);
        if (m) ids = pickQuizIds((await getJSON(m.file)).items, weak, QUIZ_N);
      } catch (e) { ids = null; }
      sec.append(el("a", { class: "td-btn", href: quizHref(weak.bankId, ids, "Today: " + weak.topicLabel, QUIZ_N) }, `Start a ${QUIZ_N}-question quiz`));
    } else {
      const m = (DATA.entries || []).find(n => n.subject === weak.subject && n.code === weak.code);
      sec.append(el("p", {}, "Lowest recent quiz score: ", el("strong", {}, weak.label), ` (average ${weak.pct}%).`));
      if (m) {
        try {
          const note = Object.assign({ file: m.file }, await getJSON(m.file));
          const L = (note.links && note.links.quizBanks) || [];
          if (L.length) {
            const b = L[0];
            const ids = shuffle((b.itemIds || []).slice()).slice(0, QUIZ_N);
            sec.append(el("a", { class: "td-btn", href: quizHref(fileId(b.file), ids, "Today: " + weak.label, QUIZ_N) }, `Start a ${QUIZ_N}-question quiz`));
          }
        } catch (e) { /* link omitted */ }
      }
    }
  }

  function renderClass(box, today) {
    const sec = el("div", { class: "td-block" }, el("h4", {}, "3. This week in class"));
    if (!DATA.schedule) { sec.append(el("p", { class: "muted" }, "The class schedule could not be loaded.")); box.append(sec); return; }
    // only subjects the schedule actually tracks get a row: a default-all profile
    // (all six subjects) must not add three empty "no unit listed" rows for the
    // subjects class-schedule.json doesn't cover; canonical compare — see `canon`
    const tracked = Object.keys(DATA.schedule.subjects || {}).map(canon);
    SUBJECTS.forEach(([s, label]) => {
      if (tracked.indexOf(canon(s)) < 0) return;
      const u = unitsFor(DATA.schedule, s, today);
      const row = el("div", { class: "td-subj" }, el("strong", {}, label + ": "));
      if (u.brk) row.append(`${u.brk.label}.`, u.next ? ` Next: ${u.next.unit} from ${fmtDay(u.next.from)}.` : "");
      else if (!u.current.length) row.append("No unit listed for this week.", u.next ? ` Next: ${u.next.unit} from ${fmtDay(u.next.from)}.` : "");
      else {
        u.current.forEach((cu, i) => {
          row.append((i ? "; " : "") + cu.unit, cu.codes.length ? ` (${cu.codes.join(", ")})` : "");
        });
        const links = el("ul", { class: "links td-links" });
        const seen = new Set();
        u.current.forEach(cu => cu.codes.forEach(c => {
          if (seen.has(c)) return; seen.add(c);
          const note = DATA.notes[s + "|" + c];
          if (!note) return;
          const L = noteLinks(note);
          links.append(el("li", {}, el("a", { href: L.notes }, `${c} ${note.title}`),
            L.quiz ? [" · ", el("a", { href: L.quiz }, "quiz")] : null,
            L.cards ? [" · ", el("a", { href: L.cards }, "cards")] : null));
        }));
        if (links.childNodes.length) row.append(links);
        else row.append(el("span", { class: "muted" }, " No notes written for these codes yet."));
      }
      sec.append(row);
    });
    sec.append(el("p", { class: "muted" }, "Class weeks are estimates from the school's course calendars and can shift. Your teacher's plan always wins."));
    box.append(sec);
  }

  let rendering = false;
  async function render() {
    const box = document.getElementById("today-body");
    if (!box || rendering) return;
    rendering = true;
    try {
      if (!DATA) await load();
      const today = isoDate(new Date());
      const out = el("div", {});
      renderCards(out, today);
      const quizDone = renderQuiz(out);
      renderClass(out, today);
      box.textContent = "";
      box.append(out);
      await quizDone;
    } catch (e) {
      box.textContent = "Today's plan could not be loaded. The Quiz and Cards pages still work.";
    } finally { rendering = false; }
  }

  window.NB = window.NB || {};
  window.NB.today = { dueCards, dueUserCards, weakestTopic, pickQuizIds, unitsFor, quizHref, dueCardsHref, noteLinks };

  if (typeof document === "undefined" || !document.getElementById || !document.getElementById("today-body")) return;
  // re-render when synced progress arrives (login on a new device) or changes in another tab
  const WATCH = ["fc-state", "fc-deleted", "fc-user", "q-errors", "quizlog"];
  let timer = null;
  const later = () => { clearTimeout(timer); timer = setTimeout(render, 300); };
  if (window.NB.store && window.NB.store.onChange) window.NB.store.onChange((k) => { if (WATCH.includes(k)) later(); });
  window.addEventListener("storage", (e) => { if (!e || WATCH.includes(e.key)) later(); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();

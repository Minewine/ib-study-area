/* IB Study Area — "Today" panel on the practice home page.
   Blocks, no streaks or scores: (1) flashcards due today (Leitner state in
   fc-state), (2) a short quiz on the weakest topic (unresolved q-errors first, then
   note-linked quizlog results), (3) what is being taught in class this week
   (library/class-schedule.json, approximate) with links to its notes, quiz and cards,
   (4) dated items coming up — school deadlines (NB.deadlines, exported by
   assets/deadlines.js) and coursework stage dates — near-term now, longer-range ones
   as "Start thinking about" once inside the long lead window, and (5) up to three
   suggested next steps, tiered: imminent dates and unit closes first, then work
   that is due, then optional enrichment — each with a reason and a direct link.
   Blocks with nothing to show are not rendered at all. External data (schedule,
   deadlines, coursework) is never trusted: malformed records are skipped, not fatal.
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
  // Lead times for dated items (days from today): items within LEAD_DAYS are near
  // term; items beyond that but within LONG_LEAD_DAYS get the "Start thinking
  // about" heads-up instead. An active unit ending within UNIT_CLOSE_DAYS counts
  // as closing this week. (Constants, not settings — change here if needed.)
  const LEAD_DAYS = 21;
  // 120 (not 60): events just after the summer break are > 60 days away for most of
  // May–June, and the early heads-up is exactly what this window exists for.
  const LONG_LEAD_DAYS = 120;
  const UNIT_CLOSE_DAYS = 7;
  // Post-holiday planning: today inside a scheduled break, or the next unit
  // starting within BREAK_LEAD_DAYS, gets a "plan ahead" suggestion.
  const BREAK_LEAD_DAYS = 7;
  const MISTAKE_KEYS_MAX = 20; // keys packed into one quiz.html?errkeys= retry link
  // actions the "Suggested next step" block shows (tiered — see suggestActions)
  const MAX_SUGGESTIONS = 3;

  const store = (window.NB && window.NB.store) || {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v === null ? d : v; } catch (e) { return d; } }
  };
  const pad = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const fileId = (f) => String(f).split("/").pop().replace(/\.json$/i, "");
  const shuffle = (a, rnd) => { rnd = rnd || Math.random; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // External data (schedule, deadlines, coursework) is never trusted: a date field
  // is only used after this guard, so a malformed record skips itself instead of
  // throwing and taking the whole panel down. Everything after it string-compares
  // "YYYY-MM-DD" values.
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const isISO = (s) => {
    if (typeof s !== "string" || !ISO_DATE.test(s)) return false;
    const [y, m, d] = s.split("-").map(Number);
    const t = new Date(y, m - 1, d, 12);
    return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d;
  };
  const addDays = (iso, n) => { const [y, m, d] = iso.split("-").map(Number); const t = new Date(y, m - 1, d, 12); t.setDate(t.getDate() + n); return isoDate(t); };
  const clip = (s, n) => { s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s; };
  // label key for dedupe: ignore case and punctuation, so "Biology: IA experiment
  // day (group 1)" and "Biology IA experiment day (group 1)" are the same event
  const labelKey = (s) => String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]/g, "");
  const relDay = (date, today) => {
    const d = Math.round((new Date(date + "T12:00:00") - new Date(today + "T12:00:00")) / 86400000);
    return d === 0 ? "today" : d === 1 ? "tomorrow" : "in " + d + " days";
  };

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

  // Weak spots from UPLOADED banks can't serve the "Start a quiz" link: the link
  // resolves library banks only (quiz-engine startFromLink matches the questions
  // manifest), so their records are excluded here — their bankId is the explicit
  // "ub-…" id uploads carry now, the stored bank's file-name stem (uploads saved
  // with a name) or the legacy "user:<label-slug>" written before banks carried a
  // name. All spellings must be excluded or the link would resolve nothing.
  function uploadedBankIds(banks) {
    const ids = new Set();
    (banks || []).forEach(b => {
      if (!b) return;
      if (b.id) ids.add(b.id);
      if (b.name) ids.add(fileId(b.name));
      ids.add("user:" + String(b.label || b.topicLabel || "My bank").toLowerCase().replace(/\W+/g, "-"));
    });
    return ids;
  }

  // Weakest topic. 1) Unresolved missed questions (q-errors), grouped by bank + topic:
  //    most unresolved first, then the most recently missed. 2) Otherwise the quiz log:
  //    note-linked quizzes are labelled "<code> <title>"; the code with the lowest
  //    average score (below 70%) over the logged sessions.
  function weakestTopic(errors, log, uploaded) {
    const up = uploaded && typeof uploaded.has === "function" ? uploaded : new Set(uploaded || []);
    const groups = {};
    (errors || []).forEach(e => {
      if (!e || e.resolved || e.retired || !e.bankId || String(e.bankId).startsWith("user:") || up.has(e.bankId)) return;
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
  // pass either spelling of a subject id. Malformed units/breaks (non-ISO dates,
  // missing fields) are skipped, not fatal.
  function unitsFor(schedule, subject, date) {
    const subs = (schedule && schedule.subjects) || {};
    const key = Object.keys(subs).find(k => canon(k) === canon(subject));
    const s = key ? subs[key] : null;
    const units = (Array.isArray(s && s.units) ? s.units : []).slice().sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
    const brk = (Array.isArray(schedule && schedule.breaks) ? schedule.breaks : []).find(b => b && isISO(b.from) && isISO(b.to) && b.from <= date && date <= b.to) || null;
    const current = brk ? [] : units.filter(u => u && isISO(u.from) && isISO(u.to) && u.from <= date && date <= u.to);
    const next = units.find(u => u && isISO(u.from) && u.from > date) || null;
    return { current, brk, next };
  }

  // Active units across the profile's subjects: today within [from,to] (the class
  // schedule is approximate — see class-schedule.json). Returns
  // [{subject, label, unit}] so suggestions can point at what is being taught now.
  function activeUnits(schedule, subjects, today) {
    const out = [];
    (Array.isArray(subjects) ? subjects : []).forEach(row => {
      const [s, label] = row || [];
      unitsFor(schedule, s, today).current.forEach(u => {
        if (u && isISO(u.from) && isISO(u.to)) out.push({ subject: s, label: label || s, unit: u });
      });
    });
    return out;
  }

  // The next unit (after today) for each of the profile's subjects — the
  // post-holiday "plan ahead" suggestion points at what comes next. unitsFor
  // skips malformed records; a subject the schedule doesn't track yields nothing.
  function nextUnits(schedule, subjects, today) {
    const out = [];
    (Array.isArray(subjects) ? subjects : []).forEach(row => {
      const [s, label] = row || [];
      const n = unitsFor(schedule, s, today).next;
      if (n) out.push({ subject: s, label: label || s, unit: n });
    });
    return out;
  }

  // Open (unresolved, unretired) missed questions grouped by topic label, most open
  // first, then the most recently missed. The input for the mistakes suggestion:
  // each group carries the record keys for a quiz.html?errkeys= retry link. Records
  // whose scheduled retest (optional dueAt, epoch ms — assets/quiz-engine.js) has not
  // come around yet stay off the panel (the mistake log still lists them); records
  // without dueAt — legacy ones — are always shown. nowMs is injectable for tests.
  function openMistakes(errors, hides, nowMs) {
    const now = nowMs == null ? Date.now() : nowMs;
    const groups = {};
    (Array.isArray(errors) ? errors : []).forEach(e => {
      if (!e || e.resolved || e.retired || typeof e.key !== "string" || !e.key) return;
      if (e.dueAt != null && e.dueAt > now) return;
      if (e.subject && hides && hides(e.subject)) return;
      const label = [e.topicLabel, e.topic, e.bankId].find(v => typeof v === "string" && v) || "your mistakes";
      const g = groups[label] = groups[label] || { label, keys: [], count: 0, last: "" };
      g.count++;
      g.keys.push(e.key);
      if (isISO(e.lastMissed) && e.lastMissed > g.last) g.last = e.lastMissed;
    });
    return Object.values(groups).sort((a, b) => (b.count - a.count) || (b.last < a.last ? -1 : b.last > a.last ? 1 : 0) || (a.label < b.label ? -1 : 1));
  }

  // Dated items the panel knows about, normalized to {date, label, href, where}:
  // the school deadline calendar (NB.deadlines, exported by assets/deadlines.js —
  // records {d, t, tag, subject?}) and coursework stage dates (tracks[].stages[]
  // .dates[] in library/coursework/coursework.json). Sorted defensively like
  // deadlines.js does; entries with a subject the profile hides are dropped, and
  // records without a real date or label are skipped.
  function datedItems(deadlines, coursework, hides) {
    const out = [];
    (Array.isArray(deadlines) ? deadlines : []).forEach(x => {
      if (!x || !isISO(x.d) || typeof x.t !== "string" || !x.t) return;
      if (x.subject && hides && hides(x.subject)) return;
      out.push({ date: x.d, label: x.t, href: "../deadlines.html", where: "calendar" });
    });
    (coursework && Array.isArray(coursework.tracks) ? coursework.tracks : []).forEach(tr => {
      if (!tr || (tr.subject && hides && hides(tr.subject))) return;
      (Array.isArray(tr.stages) ? tr.stages : []).forEach(st => {
        (st && Array.isArray(st.dates) ? st.dates : []).forEach(dv => {
          if (!dv || !isISO(dv.date)) return;
          const label = [dv.label, st.title, tr.label].find(v => typeof v === "string" && v);
          if (!label) return;
          out.push({ date: dv.date, label: label, href: "coursework.html", where: "planner" });
        });
      });
    });
    // the deadline calendar and the coursework planner share events (the sciences
    // IA days) under slightly different labels — dedupe by date + normalized label
    // (bare date is not enough: distinct events can share one)
    const seen = new Set();
    return out.filter(x => {
      const k = x.date + "|" + labelKey(x.label);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  // Near-term dated items: today (inclusive) through today + leadDays.
  function nearTermItems(items, today, leadDays) {
    const horizon = addDays(today, leadDays);
    return (Array.isArray(items) ? items : []).filter(x => x && isISO(x.date) && today <= x.date && x.date <= horizon);
  }

  // Longer-range dated items: past the near-term window, inside the long lead
  // window — shown as "Start thinking about …", never earlier.
  function startThinkingItems(items, today, leadDays, longLeadDays) {
    const nearEnd = addDays(today, leadDays), farEnd = addDays(today, longLeadDays);
    return (Array.isArray(items) ? items : []).filter(x => x && isISO(x.date) && x.date > nearEnd && x.date <= farEnd);
  }

  // Up to MAX_SUGGESTIONS suggested next steps, tiered: (A) urgency and planning
  // — the earliest near-term deadline, a unit closing this week, post-holiday
  // work to plan for; (B) review that is due — cards, open mistakes, own cards;
  // (C) enrichment — candidates the render path passes in inp.enrich (weak-topic
  // quiz, read-ahead), each carrying its subject for the profile check. Output
  // is strictly A → B → C and capped: a full tier A pushes lower priorities out.
  // Every suggestion carries a visible reason and a direct link (existing link
  // formats only); without data behind it, nothing is suggested. Malformed dates
  // skip themselves; past dates never suggest.
  function suggestActions(inp) {
    inp = inp || {};
    const today = inp.today;
    if (!isISO(today)) return [];
    const hidden = (id) => !!(id && inp.hides && inp.hides(id));
    const out = [];
    const push = (s) => { if (s && s.title && s.reason && s.href) out.push(s); };

    // Tier A — the earliest near-term deadline or assessment (nearItems is
    // sorted; the past-date check is repeated here — suggestActions is pure)
    const next = (Array.isArray(inp.nearItems) ? inp.nearItems : [])[0];
    if (next && isISO(next.date) && today <= next.date) {
      push({
        title: "Deadline ahead",
        reason: clip(next.label, 60) + " — " + fmtDay(next.date) + " (" + relDay(next.date, today) + ")",
        href: next.href || "../deadlines.html", link: next.where === "planner" ? "Open planner" : "Open calendar"
      });
    }
    // Tier A — the earliest unit closing within UNIT_CLOSE_DAYS. A unit whose
    // note yields no link no longer drops out: it falls back to the subject's
    // notes page, so a closing unit is always acted on.
    const closings = (Array.isArray(inp.units) ? inp.units : [])
      .filter(u => u && u.subject && !hidden(u.subject) && isISO(u.unit && u.unit.to) && today <= u.unit.to && u.unit.to <= addDays(today, UNIT_CLOSE_DAYS))
      .sort((a, b) => (a.unit.to < b.unit.to ? -1 : a.unit.to > b.unit.to ? 1 : 0));
    if (closings.length) {
      const cu = closings[0];
      const code = (cu.unit && Array.isArray(cu.unit.codes) ? cu.unit.codes : [])[0];
      const note = cu.subject && code ? ((inp.notes || {})[canon(cu.subject) + "|" + code]) : null;
      const L = note ? noteLinks(note) : null;
      push({
        title: cu.unit.to === today ? "Unit closes today" : "Unit closes this week",
        reason: clip(cu.unit.unit, 60) + " ends " + fmtDay(cu.unit.to) + " (class schedule, approximate)",
        href: (L && (L.quiz || L.notes)) || "notes.html?subject=" + encodeURIComponent(canon(cu.subject)),
        link: L && L.quiz ? "Quiz the unit" : "Open notes"
      });
    }
    // Tier A — post-holiday planning: today inside a scheduled break, or the
    // next unit of a taken subject starting within BREAK_LEAD_DAYS — shown early
    // enough to plan for it, linking the unit's first topic note or, without
    // one, the subject's notes page.
    const inBreak = (Array.isArray(inp.breaks) ? inp.breaks : []).some(b => b && isISO(b.from) && isISO(b.to) && b.from <= today && today <= b.to);
    const starts = (Array.isArray(inp.nextUnits) ? inp.nextUnits : [])
      .filter(n => n && n.subject && n.unit && isISO(n.unit.from) && n.unit.from >= today && (inBreak || n.unit.from <= addDays(today, BREAK_LEAD_DAYS)) && !hidden(n.subject))
      .sort((a, b) => (a.unit.from < b.unit.from ? -1 : a.unit.from > b.unit.from ? 1 : 0));
    if (starts.length) {
      const su = starts[0];
      const code = (su.unit && Array.isArray(su.unit.codes) ? su.unit.codes : [])[0];
      const note = su.subject && code ? ((inp.notes || {})[canon(su.subject) + "|" + code]) : null;
      const L = note ? noteLinks(note) : null;
      push({
        title: "Next unit",
        reason: clip(su.unit.unit, 60) + " starts " + fmtDay(su.unit.from) + " — plan ahead",
        href: (L && L.notes) || "notes.html?subject=" + encodeURIComponent(canon(su.subject)),
        link: "Open notes"
      });
    }

    // Tier B — review that is due
    const due = inp.due || 0;
    if (due > 0) {
      push({ title: due + " card" + (due === 1 ? "" : "s") + " due", reason: "your review schedule says so", href: inp.dueHref || "cards.html", link: "Review them" });
    }
    const m = openMistakes(inp.errors, inp.hides)[0];
    if (m) {
      push({
        title: "Open mistakes on " + clip(m.label, 40),
        reason: m.count + " missed question" + (m.count === 1 ? "" : "s") + " not yet fixed",
        href: "quiz.html?errkeys=" + m.keys.slice(0, MISTAKE_KEYS_MAX).map(encodeURIComponent).join(","),
        link: "Retry them"
      });
    }
    if ((inp.own || 0) > 0) {
      push({ title: inp.own + " of your own cards due", reason: "your review schedule says so", href: "cards.html", link: "Review them" });
    }

    // Tier C — enrichment candidates, only in the slots left over
    (Array.isArray(inp.enrich) ? inp.enrich : []).forEach(c => { if (c && !hidden(c.subject)) push(c); });

    return out.slice(0, MAX_SUGGESTIONS);
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
  // Every fetch gets a hard timeout: a request that never settles must not leave
  // the panel stuck on "Loading today's plan…" (the render guard can't reset until
  // load() settles, so a hung fetch would also block all re-renders).
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
  const fmtDay = (iso) => {
    if (!isISO(iso)) return String(iso == null ? "" : iso);
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  };

  let DATA = null; // { schedule, manifest, notes: {canonicalSubject|code: note}, cards: [...] }

  async function load() {
    const failed = { decks: false, notes: false }; // surfaced as error states, not silent "empty" panels
    // All manifests are fetched once here and cached in DATA — re-renders (storage
    // events from other tabs) must not re-fetch.
    const [schedule, manifest, registry, coursework, qmanifest] = await Promise.all([
      getJSON("library/class-schedule.json").catch(() => null),
      getJSON("library/topic-notes/manifest.json").catch(() => { failed.notes = true; return null; }),
      getJSON("library/flashcards/manifest.json").catch(() => { failed.decks = true; return []; }),
      getJSON("library/coursework/coursework.json").catch(() => null),
      getJSON("library/questions/manifest.json").catch(() => null)
    ]);
    const today = isoDate(new Date());
    const wanted = [];
    SUBJECTS.forEach(([s]) => unitsFor(schedule, s, today).current.forEach(u => (Array.isArray(u.codes) ? u.codes : []).forEach(c => wanted.push([s, c]))));
    const entries = (manifest && manifest.notes) || [];
    const notes = {};
    // Per-user subject profile (assets/profile.js): decks for subjects the account
    // doesn't take are dropped before their files are fetched (mirrors flashcards.js).
    const visible = (registry || []).filter(r => !(NB.profile && NB.profile.hides(r.subject)));
    const decks = await Promise.all([
      Promise.all(wanted.map(([s, c]) => {
        // the topic-notes manifest predates the id scheme ("maths-aa-sl") —
        // canon-compare both sides and key notes by the canonical subject id
        const m = entries.find(n => canon(n.subject) === canon(s) && n.code === c);
        return m ? getJSON(m.file).then(n => { notes[canon(s) + "|" + c] = Object.assign({ file: m.file }, n); }).catch(() => {}) : null;
      })),
      Promise.all(visible.map(r => getJSON(r.file).then(d => (d.cards || []).map(c => ({ id: c.id, deck: fileId(r.file), retired: c.retired === true }))).catch(() => { failed.decks = true; return []; })))
    ]).then(([, d]) => d);
    DATA = { schedule, manifest, entries, notes, cards: [].concat(...decks), failed, coursework, qmanifest, qbanks: {} };
  }

  function renderCards(box, today) {
    const failedDecks = !!(DATA.failed && DATA.failed.decks);
    const st = store.get("fc-state", {});
    const deleted = store.get("fc-deleted", []);
    // Uploaded decks (fc-userdecks) are not in the library manifest; their cards
    // live in storage, so they are counted without a fetch. deck: null → they add
    // to the total but never to the per-deck deep link (dueCardsHref skips it).
    const uploaded = store.get("fc-userdecks", []).map(d => (d.cards || []).map(c => ({ id: c.id, deck: null, retired: c.retired === true })));
    const d = dueCards(DATA.cards.concat(...uploaded), st, today, deleted);
    const own = dueUserCards(store.get("fc-user", []), st, today, deleted);
    const href = dueCardsHref(d.byDeck, d.total);
    const sec = el("div", { class: "td-block" }, el("h4", {}, "1. Flashcards"));
    if (d.total) {
      sec.append(el("p", {}, `${d.total} card${d.total === 1 ? "" : "s"} due today. `), href ? el("a", { class: "td-btn", href }, "Start due cards") : null);
      if (failedDecks) sec.append(el("p", { class: "muted" }, "Some card decks could not be loaded, so this count may be low."));
    } else {
      sec.append(el("p", {}, failedDecks
        ? "Card decks could not be loaded — the Cards page still works."
        : "Nothing due today. " + (d.fresh ? `There are ${d.fresh} cards you haven't started; the class topics below link to the right deck.` : "")));
    }
    if (own) sec.append(el("p", { class: "muted" }, `Plus ${own} of your own card${own === 1 ? "" : "s"} due. They're on the `, el("a", { href: "cards.html" }, "Cards"), " page."));
    box.append(sec);
    // counts for the "suggested next step" block (same data, one computation)
    return { total: d.total, own: own, href: d.total ? (href || "cards.html") : (own ? "cards.html" : null) };
  }

  async function renderQuiz(box) {
    const sec = el("div", { class: "td-block" }, el("h4", {}, "2. Short quiz"));
    box.append(sec);
    const weak = weakestTopic(store.get("q-errors", []), store.get("quizlog", []), uploadedBankIds(store.get("q-userbanks", [])));
    if (!weak) { sec.append(el("p", {}, "No weak spots recorded yet. Use one of this week's class quizzes below.")); return; }
    if (weak.source === "errors") {
      sec.append(el("p", {}, "Weakest topic right now: ", el("strong", {}, weak.topicLabel), ` (${weak.count} missed question${weak.count === 1 ? "" : "s"} not yet fixed).`));
      let ids = null;
      try {
        // DATA.qmanifest / DATA.qbanks are cached in load() — a storage-event
        // re-render must not re-fetch the manifest or the bank file
        const m = (DATA.qmanifest || []).find(b => fileId(b.file) === weak.bankId);
        if (m) {
          const fid = fileId(m.file);
          if (!DATA.qbanks[fid]) DATA.qbanks[fid] = ((await getJSON(m.file)) || {}).items || [];
          ids = pickQuizIds(DATA.qbanks[fid], weak, QUIZ_N);
        }
      } catch (e) { ids = null; }
      sec.append(el("a", { class: "td-btn", href: quizHref(weak.bankId, ids, "Today: " + weak.topicLabel, QUIZ_N) }, `Start a ${QUIZ_N}-question quiz`));
    } else {
      const m = (DATA.entries || []).find(n => n.subject === weak.subject && n.code === weak.code);
      sec.append(el("p", {}, "Lowest recent quiz score: ", el("strong", {}, weak.label), ` (average ${weak.pct}%).`));
      if (m) {
        try {
          DATA.noteCache = DATA.noteCache || {};
          const note = DATA.noteCache[m.file] || (DATA.noteCache[m.file] = Object.assign({ file: m.file }, await getJSON(m.file)));
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
          const cs = Array.isArray(cu.codes) ? cu.codes : [];
          row.append((i ? "; " : "") + cu.unit, cs.length ? ` (${cs.join(", ")})` : "");
        });
        const links = el("ul", { class: "links td-links" });
        const seen = new Set();
        u.current.forEach(cu => (Array.isArray(cu.codes) ? cu.codes : []).forEach(c => {
          if (seen.has(c)) return; seen.add(c);
          const note = DATA.notes[canon(s) + "|" + c];
          if (!note) return;
          const L = noteLinks(note);
          links.append(el("li", {}, el("a", { href: L.notes }, `${c} ${note.title}`),
            L.quiz ? [" · ", el("a", { href: L.quiz }, "quiz")] : null,
            L.cards ? [" · ", el("a", { href: L.cards }, "cards")] : null));
        }));
        if (links.childNodes.length) row.append(links);
        else row.append(el("span", { class: "muted" }, (DATA.failed && DATA.failed.notes) ? " Notes could not be loaded." : " No notes written for these codes yet."));
      }
      sec.append(row);
    });
    sec.append(el("p", { class: "muted" }, "Class weeks are estimates from the school's course calendars and can shift. Your teacher's plan always wins."));
    box.append(sec);
  }

  // (4) dated items ahead: school deadlines (NB.deadlines, exported by
  // assets/deadlines.js) + coursework stage dates. Near-term within LEAD_DAYS;
  // longer-range items only once inside the long lead window, labelled
  // "Start thinking about". With nothing in either window the block is not
  // rendered at all.
  function renderDates(box, today) {
    const items = datedItems(NB.deadlines, DATA.coursework, (id) => !!(NB.profile && NB.profile.hides && NB.profile.hides(id)));
    const near = nearTermItems(items, today, LEAD_DAYS);
    const think = startThinkingItems(items, today, LEAD_DAYS, LONG_LEAD_DAYS);
    if (!near.length && !think.length) return { near: near };
    const sec = el("div", { class: "td-block" }, el("h4", {}, "4. Coming up"));
    const list = el("ul", { class: "links td-links" });
    near.forEach(x => list.append(el("li", {},
      el("strong", {}, fmtDay(x.date)), " — ", el("a", { href: x.href }, clip(x.label, 80)),
      el("span", { class: "muted" }, " (" + relDay(x.date, today) + ")"))));
    sec.append(list);
    if (think.length) {
      const tl = el("ul", { class: "links td-links" });
      think.forEach(x => tl.append(el("li", {}, "Start thinking about ",
        el("a", { href: x.href }, clip(x.label, 80)), el("span", { class: "muted" }, " (" + fmtDay(x.date) + ")"))));
      sec.append(tl);
    }
    sec.append(el("p", { class: "muted" }, "From the school deadline calendar and the coursework planner — both approximate."));
    box.append(sec);
    return { near: near };
  }

  // (5) up to MAX_SUGGESTIONS suggested next steps, tiered by suggestActions
  // (urgency and planning → review due → enrichment). No data behind a
  // suggestion → no suggestion (and no block).
  function renderSuggest(box, today, inp) {
    const hides = (id) => !!(NB.profile && NB.profile.hides && NB.profile.hides(id));
    // tier C candidates, built here where DATA lives and then filtered, ordered
    // and capped by suggestActions: a fresh quiz on the weakest topic (the same
    // weakestTopic logic as block 2) and a read-ahead link for what is being
    // taught now. Without a resolvable link the candidate is left out.
    const enrich = [];
    const weak = weakestTopic(store.get("q-errors", []), store.get("quizlog", []), uploadedBankIds(store.get("q-userbanks", [])));
    if (weak) {
      if (weak.source === "errors") {
        enrich.push({ subject: weak.subject || null,
          title: "Weakest topic: " + clip(weak.topicLabel, 40),
          reason: weak.count + " missed question" + (weak.count === 1 ? "" : "s") + " not yet fixed — a fresh quiz locks it in",
          href: quizHref(weak.bankId, null, "Today: " + weak.topicLabel, QUIZ_N), link: "Start a quiz" });
      } else {
        const m = (DATA.entries || []).find(n => canon(n.subject) === canon(weak.subject) && n.code === weak.code);
        if (m) enrich.push({ subject: weak.subject,
          title: "Weakest topic: " + clip(weak.label, 40),
          reason: "average " + weak.pct + "% on recent quizzes — re-read the topic notes",
          href: "notes.html?subject=" + encodeURIComponent(canon(weak.subject)) + "&topic=" + encodeURIComponent(fileId(m.file)),
          link: "Open notes" });
      }
    }
    const au = (Array.isArray(inp.units) ? inp.units : [])[0];
    if (au) {
      const code = (Array.isArray(au.unit.codes) ? au.unit.codes : [])[0];
      const note = au.subject && code ? DATA.notes[canon(au.subject) + "|" + code] : null;
      const L = note ? noteLinks(note) : null;
      enrich.push({ subject: au.subject,
        title: "Read ahead: " + clip(au.unit.unit, 40),
        reason: au.label + " class is on " + clip(au.unit.unit, 60) + " now (class schedule, approximate)",
        href: (L && L.notes) || "notes.html?subject=" + encodeURIComponent(canon(au.subject)),
        link: "Open notes" });
    }
    const suggestions = suggestActions({
      today: today,
      due: inp.total, dueHref: inp.href, own: inp.own,
      errors: store.get("q-errors", []),
      hides: hides,
      units: inp.units, notes: DATA.notes, nearItems: inp.near,
      breaks: DATA.schedule && Array.isArray(DATA.schedule.breaks) ? DATA.schedule.breaks : [],
      nextUnits: nextUnits(DATA.schedule, SUBJECTS, today),
      enrich: enrich
    });
    if (!suggestions.length) return;
    const sec = el("div", { class: "td-block" }, el("h4", {}, "5. Suggested next step"));
    suggestions.forEach(s => sec.append(el("div", { class: "td-subj" },
      el("strong", {}, s.title), " — " + s.reason + " ", el("a", { class: "td-btn", href: s.href }, s.link || "Open"))));
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
      const cards = renderCards(out, today);
      const quizDone = renderQuiz(out);
      renderClass(out, today);
      const dated = renderDates(out, today);
      renderSuggest(out, today, {
        total: cards.total, own: cards.own, href: cards.href,
        units: activeUnits(DATA.schedule, SUBJECTS, today), near: dated.near
      });
      box.textContent = "";
      box.append(out);
      await quizDone;
    } catch (e) {
      box.textContent = "";
      box.append(el("p", { class: "muted" }, "Today's plan could not be loaded (" + ((e && e.message) || "error") + "). The Quiz and Cards pages still work."));
    } finally { rendering = false; }
  }

  window.NB = window.NB || {};
  window.NB.today = { dueCards, dueUserCards, weakestTopic, pickQuizIds, unitsFor, quizHref, dueCardsHref, noteLinks,
    isISO, addDays, activeUnits, nextUnits, openMistakes, datedItems, nearTermItems, startThinkingItems, suggestActions };

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

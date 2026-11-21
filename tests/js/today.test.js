// node --test tests/js — assets/today.js: due-card count, weakest-topic choice,
// quiz picking and the class-week schedule lookup (pure functions, no DOM),
// plus the per-user subject profile (assets/profile.js) cases: the class-week
// section only lists allowed subjects and weak topics skip other subjects.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { makeEnv, plain } = require("./harness");

const REPO = path.join(__dirname, "..", "..");
const J = JSON.stringify;
const T = () => makeEnv({ readyState: "loading" }).load("store.js").load("today.js").NB.today;
// with profile.js loaded (store.js first): NB.profile decides the subject list
const TP = (profile) => {
  const env = makeEnv({ readyState: "loading", data: profile ? { profile: J({ subjects: profile }) } : {} });
  env.load("store.js").load("profile.js").load("today.js");
  return env.NB.today;
};
// fetch serving the real library files from the repo (query strings stripped)
const repoFetch = () => (url) => {
  const p = path.join(REPO, String(url).split("?")[0].replace(/^.*?(library\/)/, "$1"));
  return Promise.resolve({ ok: true, json: async () => JSON.parse(fs.readFileSync(p, "utf8")) });
};
const SCHEDULE = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "library", "class-schedule.json"), "utf8"));

test("dueCards: counts due seeded cards per deck; skips new, future, retired and deleted cards", () => {
  const t = T();
  const cards = [
    { id: "a", deck: "d1" }, { id: "b", deck: "d1" }, { id: "c", deck: "d2" },
    { id: "d", deck: "d2", retired: true }, { id: "e", deck: "d2" }, { id: "f", deck: "d2" }
  ];
  const st = { a: { box: 1, due: "2026-11-18" }, b: { box: 2, due: "2026-11-30" }, c: { box: 3, due: "2026-11-01" }, d: { box: 1, due: "2026-11-01" }, e: { box: 1, due: "2026-11-02" } };
  const r = plain(t.dueCards(cards, st, "2026-11-18", ["e"]));
  assert.deepEqual(r, { total: 2, fresh: 1, byDeck: { d1: 1, d2: 1 } });
  const href = t.dueCardsHref(r.byDeck, r.total);
  assert.match(href, /^cards\.html\?from=d1&from=d2&n=2&/);
  assert.equal(t.dueCardsHref({}, 0), null);
  assert.equal(t.dueUserCards([{ id: "u1" }, { id: "u2" }], { u1: { due: "2026-11-10" }, u2: { due: "2026-12-01" } }, "2026-11-18", []), 1);
});

test("weakestTopic: most unresolved misses wins; ties go to the most recent; resolved and user banks ignored", () => {
  const t = T();
  const errs = [
    { key: "chem-x#1", id: "1", bankId: "chem-x", topic: "s3-1", topicLabel: "Periodicity", lastMissed: "2026-11-01" },
    { key: "chem-x#2", id: "2", bankId: "chem-x", topic: "s3-1", topicLabel: "Periodicity", lastMissed: "2026-11-02" },
    { key: "bio-y#1", id: "1", bankId: "bio-y", topic: "c1-1", topicLabel: "Enzymes", lastMissed: "2026-11-15" },
    { key: "bio-y#2", id: "2", bankId: "bio-y", topic: "c1-1", topicLabel: "Enzymes", lastMissed: "2026-11-16" },
    { key: "bio-y#3", id: "3", bankId: "bio-y", topic: "c1-1", resolved: true },
    { key: "user:z#1", id: "1", bankId: "user:z", topic: "u" }, { key: "user:z#2", id: "2", bankId: "user:z", topic: "u" }, { key: "user:z#3", id: "3", bankId: "user:z", topic: "u" }
  ];
  const w = plain(t.weakestTopic(errs, []));
  assert.equal(w.source, "errors");
  assert.equal(w.bankId, "bio-y", "2 vs 2 unresolved: the more recently missed topic");
  assert.deepEqual(w.ids, ["1", "2"]);
  errs.push({ key: "chem-x#3", id: "3", bankId: "chem-x", topic: "s3-1", lastMissed: "2026-10-01" });
  assert.equal(t.weakestTopic(errs, []).bankId, "chem-x", "3 unresolved beats 2");
});

test("weakestTopic: without misses, falls back to note-linked quiz scores below 70%", () => {
  const t = T();
  const log = [
    { label: "S3.1 The periodic table", pct: 50 }, { label: "S3.1 The periodic table", pct: 70 },
    { label: "C1.1 Enzymes and metabolism", pct: 55 }, { label: "2.1 Lines", pct: 90 },
    { label: "Biology HL", pct: 10 } // a subject-wide session: no topic code, ignored
  ];
  const w = plain(t.weakestTopic([{ bankId: "x", resolved: true }], log));
  assert.equal(w.source, "quizlog");
  assert.equal(w.code, "C1.1"); assert.equal(w.subject, "biology-hl"); assert.equal(w.pct, 55);
  assert.equal(t.weakestTopic([], [{ label: "2.1 Lines", pct: 90 }]), null, "nothing weak");
  assert.equal(t.weakestTopic(undefined, undefined), null);
});

test("pickQuizIds: missed first (at most half), then same-topic items; retired never picked", () => {
  const t = T();
  const items = [];
  for (let i = 1; i <= 10; i++) items.push({ id: "q" + i, topic: i <= 8 ? "a" : "b" });
  items.push({ id: "old", topic: "a", retired: true });
  const ids = t.pickQuizIds(items, { ids: ["q2", "old", "q9", "q5", "q7", "gone"], topic: "a" }, 6, () => 0.5);
  assert.equal(ids.length, 6);
  assert.deepEqual(ids.slice(0, 3), ["q2", "q9", "q5"]);
  assert.ok(!ids.includes("old"));
  assert.equal(new Set(ids).size, 6);
  assert.ok(ids.slice(3).every(id => items.find(i => i.id === id).topic === "a"));
});

test("unitsFor: current unit, breaks and the next unit", () => {
  const t = T();
  const nov18 = (s) => plain(t.unitsFor(SCHEDULE, s, "2026-11-18"));
  assert.deepEqual(nov18("biology-hl").current.map(u => u.codes), [["C1.1"]]);
  assert.equal(nov18("chemistry-hl").current[0].unit, "Stoichiometry");
  assert.equal(nov18("maths-aa-sl").current[0].unit, "Differentiation");
  assert.equal(nov18("maths-aa-sl").next.unit, "Circular trigonometry");
  const hol = plain(t.unitsFor(SCHEDULE, "biology-hl", "2026-12-28"));
  assert.equal(hol.brk.label, "Winter holiday"); assert.deepEqual(hol.current, []);
  assert.equal(hol.next.from, "2027-01-11");
  const gap = plain(t.unitsFor(SCHEDULE, "maths-aa-sl", "2027-02-17"));
  assert.deepEqual(gap.current, []); assert.equal(gap.brk, null); assert.equal(gap.next.unit, "Trigonometric equations and functions");
  const after = plain(t.unitsFor(SCHEDULE, "chemistry-hl", "2027-08-01"));
  assert.deepEqual(after.current, []); assert.equal(after.next, null);
  assert.deepEqual(plain(t.unitsFor(null, "biology-hl", "2026-11-18")), { current: [], brk: null, next: null });
});

test("class-schedule.json: valid ISO ranges, known subjects, codes in IB format, no copied text fields", () => {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const codeRe = { "biology-hl": /^[A-D][1-4]\.\d$/, "chemistry-hl": /^[SR][1-3]\.\d$/, "maths-aa-sl": /^[1-5]\.\d{1,2}$/ };
  assert.equal(SCHEDULE.approximate, true);
  for (const b of SCHEDULE.breaks) { assert.match(b.from, iso); assert.match(b.to, iso); assert.ok(b.from <= b.to); }
  assert.deepEqual(Object.keys(SCHEDULE.subjects).sort(), Object.keys(codeRe).sort());
  for (const [s, v] of Object.entries(SCHEDULE.subjects)) {
    for (const u of v.units) {
      assert.deepEqual(Object.keys(u).sort(), ["codes", "from", "to", "unit"], `${s} ${u.unit}: only dates, codes and a short name`);
      assert.match(u.from, iso); assert.match(u.to, iso); assert.ok(u.from <= u.to, `${s} ${u.unit}`);
      assert.ok(u.unit.length <= 60);
      u.codes.forEach(c => assert.match(c, codeRe[s], `${s} ${c}`));
    }
  }
});

test("noteLinks: notes, quiz and cards deep links in the notes.js format", () => {
  const t = T();
  const L = plain(t.noteLinks({ subject: "chemistry-hl", file: "library/topic-notes/chemistry-hl/s1-4.json", code: "S1.4", title: "Counting particles",
    links: { quizBanks: [{ file: "library/questions/chem-s1.json", itemIds: ["a", "b"] }], decks: [{ file: "library/flashcards/chem-s1.json" }] } }));
  assert.equal(L.notes, "notes.html?subject=chemistry-hl&topic=s1-4");
  assert.equal(L.quiz, "quiz.html?from=chem-s1%3Aa%2Cb&n=10&label=S1.4%20Counting%20particles");
  assert.equal(L.cards, "cards.html?from=chem-s1&label=S1.4%20Counting%20particles");
  assert.equal(t.noteLinks({ subject: "x", file: "n.json", code: "1", title: "t" }).quiz, null);
});

test("profile: weakest topics from subjects outside the profile are skipped", () => {
  // quizlog branch — subjectForCode maps topic codes to subjects
  const t = TP(["biology-hl"]);
  const w = plain(t.weakestTopic([], [
    { label: "S3.1 The periodic table", pct: 50 }, // chemistry — not her subject
    { label: "C1.1 Enzymes and metabolism", pct: 60 } // biology — kept
  ]));
  assert.equal(w.source, "quizlog");
  assert.equal(w.code, "C1.1", "chemistry weak topic skipped, biology chosen");
  // errors branch — records carry the bank's subject
  const errs = [
    { key: "chem-x#1", id: "1", bankId: "chem-x", subject: "chemistry-hl", topic: "s3-1", topicLabel: "Periodicity", lastMissed: "2026-11-02" },
    { key: "bio-y#1", id: "1", bankId: "bio-y", subject: "biology-hl", topic: "c1-1", topicLabel: "Enzymes", lastMissed: "2026-11-01" }
  ];
  assert.equal(t.weakestTopic(errs, []).bankId, "bio-y", "the chemistry misses are not a weak spot for her");
  // unknown subjects (no id recorded) are never hidden
  const tAll = TP(undefined);
  assert.equal(plain(tAll.weakestTopic([], [{ label: "S3.1 The periodic table", pct: 50 }])).code, "S3.1", "no profile → chemistry still shown");
});

test("profile: the class-week section lists only allowed subjects the schedule tracks", async () => {
  const boot = async (profile) => {
    const env = makeEnv({ fetch: repoFetch(), readyState: "complete", data: profile ? { profile: J({ subjects: profile }) } : {} });
    env.load("store.js").load("profile.js");
    const box = env.document.createElement("div");
    box.id = "today-body";
    env.document.body.appendChild(box);
    env.load("today.js"); // readyState complete → render() runs now, DATA loads async
    await new Promise(r => setTimeout(r, 80));
    assert.doesNotMatch(box.textContent, /could not be loaded/, "today.js load error surfaced");
    // only the "3. This week in class" block — the suggestions block reuses .td-subj
    const blocks = [];
    (function walk(el) { (el.children || []).forEach(c => { if (c.className === "td-block") blocks.push(c); walk(c); }); })(box);
    const rows = [];
    blocks.filter(b => b.children[0] && allText(b.children[0]).startsWith("3."))
      .forEach(b => b.children.forEach(x => { if (x.className === "td-subj") rows.push(x); }));
    return rows.map(r => r.children[0].children[0].textContent);
  };
  assert.deepEqual(plain(await boot(["biology-hl"])), ["Biology HL: "],
    "one row — allowed and actually tracked by class-schedule.json");
  assert.deepEqual(plain(await boot(undefined)), ["Biology HL: ", "Chemistry HL: ", "Math AA SL: "],
    "default-all profile adds no empty rows for the untracked subjects");
});

// ---------- Phase 0 (20 Nov 2026): loading must never stick, failures must look failed ----------

// fake DOM: append() never updates textContent — read the subtree instead
const allText = (el) => (el.textContent || "") + (el.children || []).map(allText).join("");
// boot the real render path with an injectable fetch; returns { box, env }
const bootRender = async (opts) => {
  const env = makeEnv(Object.assign({ readyState: "complete", fetch: repoFetch() }, opts || {}));
  env.load("store.js").load("profile.js");
  const box = env.document.createElement("div");
  box.id = "today-body";
  env.document.body.appendChild(box);
  env.load("today.js"); // readyState complete → render() runs now, DATA loads async
  await new Promise(r => setTimeout(r, 80));
  return { box, env };
};

test("today panel: failed deck / notes manifests show error states, not silent 'empty' panels", async () => {
  const { box } = await bootRender({
    fetch: (url) => {
      const u = String(url);
      if (u.includes("flashcards/manifest")) return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
      if (u.includes("topic-notes/manifest")) return Promise.reject(new Error("offline"));
      return repoFetch()(url);
    }
  });
  assert.match(allText(box), /Card decks could not be loaded/, "deck failure says so instead of 'Nothing due today'");
  assert.match(allText(box), /Notes could not be loaded/, "notes failure says so instead of 'no notes written'");
  assert.match(allText(box), /class schedule could not be loaded|This week in class/, "schedule section renders");
  assert.doesNotMatch(allText(box), /Nothing due today/, "the misleading empty state must not appear");
});

test("today panel: a hung fetch times out and the panel still renders (never stuck on Loading)", async () => {
  // fast-fire only the fetch-abort timers (>= 10s); the 300ms debounce stays real
  const fastTimeout = (fn, ms) => (ms >= 10000 ? setTimeout(fn, 0) : setTimeout(fn, ms));
  // a fetch that never settles on its own but honours the abort signal, as real fetch does
  const hung = (url, init) => new Promise((res, rej) => {
    if (init && init.signal) init.signal.addEventListener("abort", () => rej(new Error("This operation was aborted")));
  });
  const { box, env } = await bootRender({ setTimeout: fastTimeout, fetch: hung });
  assert.doesNotMatch(allText(box), /Loading today's plan/, "the panel must not sit on Loading forever");
  assert.match(allText(box), /Card decks could not be loaded/, "aborted fetches degrade to per-section error states");
  // a failed/hung first render must not block later re-renders (rendering guard resets)
  env.NB.store.set("fc-user", [{ id: "u-1", front: "F", back: "B" }]);
  env.NB.store.set("fc-state", { "u-1": { box: 1, due: "2026-01-01", seen: 1, t: 0 } });
  await new Promise(r => setTimeout(r, 500));
  assert.match(allText(box), /Plus 1 of your own card/, "onChange re-render ran after the degraded load");
});

test("today panel: uploaded decks (fc-userdecks) count towards due cards", async () => {
  const { box, env } = await bootRender();
  env.NB.store.set("fc-userdecks", [{ name: "my-deck.json", subject: "biology-hl", cards: [{ id: "my-1", front: "F", back: "B" }] }]);
  env.NB.store.set("fc-state", { "my-1": { box: 1, due: "2026-01-01", seen: 1, t: 0 } });
  await new Promise(r => setTimeout(r, 500));
  assert.match(allText(box), /1 card due today/, "uploaded-deck card due today is counted");
});

test("profile: decks for subjects outside the profile are not fetched at all", async () => {
  const urls = [];
  const fetch = (u) => { urls.push(String(u)); return repoFetch()(u); };
  const { box } = await bootRender({ data: { profile: J({ subjects: ["math-aa-sl"] }) }, fetch });
  assert.ok(urls.some(u => u.includes("library/flashcards/manifest")), "manifest itself is fetched");
  assert.ok(!urls.some(u => /library\/flashcards\/(bio|chem)-/.test(u)), "hidden subjects' deck files are skipped");
  assert.match(allText(box), /Nothing due today/, "panel still renders normally");
});

// ---------- Phase 1 (20 Nov 2026): active units, dated items, lead times, suggestions ----------

test("isISO/addDays: padded calendar dates only, day arithmetic crosses months", () => {
  const t = T();
  assert.equal(t.isISO("2026-11-20"), true);
  assert.equal(t.isISO("2026-2-3"), false, "unpadded");
  assert.equal(t.isISO("2026-02-30"), false, "impossible day");
  assert.equal(t.isISO("2026-13-01"), false, "impossible month");
  assert.equal(t.isISO("garbage"), false);
  assert.equal(t.isISO(42), false); assert.equal(t.isISO(null), false); assert.equal(t.isISO(undefined), false);
  assert.equal(t.addDays("2026-11-20", 21), "2026-12-11");
  assert.equal(t.addDays("2026-11-20", 60), "2027-01-19");
  assert.equal(t.addDays("2026-12-31", 1), "2027-01-01");
});

test("activeUnits: from/to boundary dates inclusive; malformed units skipped", () => {
  const t = T();
  const sched = { subjects: { "biology-hl": { units: [
    { from: "2026-11-01", to: "2026-11-20", codes: ["C1.1"], unit: "Enzymes" },
    { from: "2026-11-21", to: "2026-11-30", codes: ["A2.2"], unit: "Next" },
    { from: "2026-12-01", codes: ["X"], unit: "no-to" },
    { to: "2026-12-05", unit: "no-from" },
    { from: "2027-02-30", to: "2027-03-05", codes: ["X"], unit: "bad-date" },
    { from: "2026-01-01", to: "2027-12-31", codes: "junk", unit: "Wide" }
  ] } } };
  const at = (date) => plain(t.activeUnits(sched, [["biology-hl", "Biology HL"]], date)).map(u => u.unit.unit);
  assert.deepEqual(at("2026-11-01"), ["Wide", "Enzymes"], "from boundary included");
  assert.deepEqual(at("2026-11-20"), ["Wide", "Enzymes"], "to boundary included");
  assert.deepEqual(at("2026-11-21"), ["Wide", "Next"], "day after the close is the next unit");
  assert.deepEqual(at("2026-12-01"), ["Wide"], "malformed units (missing dates, impossible date) skipped");
  assert.deepEqual(plain(t.activeUnits(null, [["biology-hl", "B"]], "2026-12-01")), []);
  assert.deepEqual(plain(t.activeUnits(sched, [], "2026-12-01")), []);
});

test("datedItems: deadlines + coursework stage dates, profile-hidden subjects dropped, malformed skipped, sorted", () => {
  const t = T();
  const dl = [
    { d: "2026-12-08", t: "English commentary", subject: "english-lit-hl" },
    { d: "not-a-date", t: "broken date" },
    { d: "2026-11-25" }, // no label
    { d: "2026-11-25", t: "CAS thing" },
    null
  ];
  const cw = { tracks: [
    { id: "bio", subject: "biology-hl", label: "Biology", stages: [
      { id: "data", title: "Data", dates: [{ date: "2027-06-15", label: "IA experiment day" }, { date: "nope", label: "x" }] },
      { id: "draft", title: "Draft", dates: "junk" }
    ] },
    { id: "fr", subject: "french-a-langlit", label: "French", stages: [{ id: "s", title: "S", dates: [{ date: "2027-01-05", label: "hidden by profile" }] }] }
  ] };
  const hides = (id) => id === "english-lit-hl" || id === "french-a-langlit";
  const items = plain(t.datedItems(dl, cw, hides));
  assert.deepEqual(items.map(x => [x.date, x.label]), [["2026-11-25", "CAS thing"], ["2027-06-15", "IA experiment day"]]);
  assert.equal(items[0].href, "../deadlines.html", "deadline rows link the calendar");
  assert.equal(items[1].href, "coursework.html", "coursework rows link the planner");
  assert.deepEqual(plain(t.datedItems(null, null, hides)), []);
  assert.deepEqual(plain(t.datedItems([], {}, hides)), []);
});

test("nearTermItems / startThinkingItems: windows and boundaries; far-future items appear only in the long lead window", () => {
  const t = T();
  const today = "2026-11-20";
  const mk = (date, label) => ({ date, label, href: "x.html", where: "calendar" });
  const items = [
    mk("2026-11-19", "past"),
    mk(today, "today"),
    mk("2026-12-11", "lead-edge"),   // today + 21
    mk("2026-12-12", "just-out"),    // today + 22 → start thinking
    mk("2027-01-19", "long-edge"),   // today + 60
    mk("2027-01-20", "too-far"),     // today + 61 → hidden
    mk("2027-02-17", "ee-launch"),   // far future → hidden today
    mk("2026-13-01", "bad-month"), mk("nope", "bad"), mk(null, "null")
  ];
  assert.deepEqual(plain(t.nearTermItems(items, today, 21)).map(x => x.label), ["today", "lead-edge"]);
  assert.deepEqual(plain(t.startThinkingItems(items, today, 21, 60)).map(x => x.label), ["just-out", "long-edge"]);
  // a Feb 2027 item shows up in the long lead window once within 60 days of it
  const later = "2027-01-10";
  const feb = [mk("2027-02-17", "ee-launch"), mk("2026-13-01", "bad")];
  assert.deepEqual(plain(t.nearTermItems(feb, later, 21)).map(x => x.label), [], "still not near-term in January");
  assert.deepEqual(plain(t.startThinkingItems(feb, later, 21, 60)).map(x => x.label), ["ee-launch"], "EE launch enters the long lead window");
});

test("suggestActions: ranked cards → mistakes → unit close → deadline prep; reason + href on each; at most two", () => {
  const t = T();
  const today = "2026-11-20";
  const notes = { "biology-hl|C1.1": { subject: "biology-hl", file: "library/topic-notes/biology-hl/c1-1.json", code: "C1.1", title: "Enzymes and metabolism",
    links: { quizBanks: [{ file: "library/questions/bio-c1-1.json", itemIds: ["a"] }] } } };
  const units = [{ subject: "biology-hl", label: "Biology HL", unit: { from: "2026-11-02", to: "2026-11-27", codes: ["C1.1"], unit: "Enzymes and metabolism" } }];
  const near = [{ date: "2026-12-08", label: "English A Lit HL: practice commentary", href: "../deadlines.html", where: "calendar" }];
  const errs = [
    { key: "bio-y#1", bankId: "bio-y", topicLabel: "Enzymes", lastMissed: "2026-11-02" },
    { key: "bio-y#2", bankId: "bio-y", topicLabel: "Enzymes" },
    { key: "chem-x#1", bankId: "chem-x", topicLabel: "Periodicity", resolved: true }
  ];
  const all = plain(t.suggestActions({ today, due: 12, dueHref: "cards.html?from=d1&n=12&label=Due", own: 0, errors: errs, units, notes, nearItems: near }));
  assert.equal(all.length, 2, "at most two suggestions");
  assert.match(all[0].title, /12 cards due/); assert.match(all[0].href, /^cards\.html\?/); assert.ok(all[0].reason);
  assert.match(all[1].title, /Open mistakes on Enzymes/); assert.ok(all[1].reason);
  assert.equal(all[1].href, "quiz.html?errkeys=bio-y%231,bio-y%232",
    "retry link packs the group's keys — each key encoded, raw commas between them (quiz-engine splits on ',')");

  const noCards = plain(t.suggestActions({ today, due: 0, own: 0, errors: [], units, notes, nearItems: near }));
  assert.equal(noCards.length, 2);
  assert.match(noCards[0].title, /Unit closes this week/, "unit closing within 7 days is suggested");
  assert.match(noCards[0].href, /^quiz\.html\?from=/, "unit close links the note's quiz bank");
  assert.match(noCards[0].reason, /27 Nov.*approximate/, "fmtDay renders en-GB like deadlines.js");
  assert.match(noCards[1].title, /Deadline ahead/); assert.match(noCards[1].reason, /8 Dec/);

  assert.deepEqual(plain(t.suggestActions({ today, due: 0, own: 0, errors: [], units, notes: {}, nearItems: [] })),
    [], "unit close without a note link is not invented");
  const farUnit = [{ subject: "biology-hl", label: "Biology HL", unit: { from: today, to: "2027-02-17", codes: ["C1.1"], unit: "X" } }];
  assert.deepEqual(plain(t.suggestActions({ today, due: 0, own: 0, errors: [], units: farUnit, notes, nearItems: [] })),
    [], "unit not closing this week → no suggestion");
  const ownOnly = plain(t.suggestActions({ today, due: 0, own: 3, errors: [], units: [], nearItems: [] }));
  assert.match(ownOnly[0].title, /3 of your own cards due/); assert.equal(ownOnly[0].href, "cards.html");
  const singular = plain(t.suggestActions({ today, due: 1, dueHref: "cards.html", own: 0, errors: [], units: [], nearItems: [] }));
  assert.match(singular[0].title, /^1 card due/, "singular wording");
  assert.deepEqual(plain(t.suggestActions({ today: "garbage", due: 5 })), [], "a bad today yields nothing");
  assert.deepEqual(plain(t.suggestActions(null)), []);
  // hides filters mistakes from subjects outside the profile
  const profiled = plain(t.suggestActions({ today, due: 0, own: 0,
    errors: [{ key: "chem-x#1", bankId: "chem-x", subject: "chemistry-hl", topicLabel: "Periodicity" }],
    hides: (id) => id === "chemistry-hl", units: [], nearItems: [] }));
  assert.deepEqual(profiled, [], "hidden subjects' mistakes are not suggested");
});

// panel-level: coming-up block, empty-block hiding, bad data, suggestion rendering

// boot the real render path with NB.deadlines preset (deadlines.js export stand-in)
const bootDl = async (deadlines, opts) => {
  const env = makeEnv(Object.assign({ readyState: "complete", fetch: repoFetch() }, opts || {}));
  env.load("store.js").load("profile.js");
  const box = env.document.createElement("div");
  box.id = "today-body";
  env.document.body.appendChild(box);
  env.NB.deadlines = deadlines; // read at render time, before the async load settles
  env.load("today.js");
  await new Promise(r => setTimeout(r, 80));
  return { box, env };
};
// coursework.json replaced by an empty planner so the dates tested are exactly the injected deadlines
const noCoursework = (url) => (String(url).includes("coursework")
  ? Promise.resolve({ ok: true, json: async () => ({ tracks: [] }) })
  : repoFetch()(url));
const isoOffset = (n) => { const d = new Date(); d.setDate(d.getDate() + n);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };

test("today panel: dated items render near-term, start-thinking label for the long lead window (120 days); empty data hides the block entirely", async () => {
  const { box } = await bootDl([
    { d: isoOffset(0), t: "Good thing now" },
    { d: isoOffset(30), t: "Think piece" },
    { d: isoOffset(90), t: "Start of summer term" },
    { d: isoOffset(130), t: "Too far out" }
  ], { fetch: noCoursework });
  assert.match(allText(box), /4\. Coming up/);
  assert.match(allText(box), /Good thing now/, "near-term item shown");
  assert.match(allText(box), /\(today\)/, "dated today reads as today");
  assert.match(allText(box), /Start thinking about Think piece/, "long-lead item labelled 'Start thinking about'");
  assert.match(allText(box), /Start thinking about Start of summer term/, "90 days out is inside the 120-day window (post-summer events need the heads-up)");
  assert.doesNotMatch(allText(box), /Too far out/, "beyond the long lead window → not shown");

  const empty = await bootDl([], { fetch: noCoursework });
  assert.doesNotMatch(allText(empty.box), /4\. Coming up/, "empty block renders nothing at all");
  assert.doesNotMatch(allText(empty.box), /Start thinking about/, "no stub for the empty block either");
});

test("today panel: one malformed record skips itself; schedule, deadlines and the panel still render", async () => {
  const sched = { subjects: { "biology-hl": { units: [
    { from: "2000-01-01", to: "2099-12-31", codes: "C1.1", unit: "Wide unit" }, // codes not an array
    { from: "oops", to: "2099-01-01", codes: [], unit: "Broken unit" },
    { from: "2027-02-30", to: "2027-03-01", codes: [], unit: "Impossible date" }
  ] } }, breaks: [{ from: "x", to: "y", label: "Bad break" }] };
  const fetch = (url) => (String(url).includes("class-schedule")
    ? Promise.resolve({ ok: true, json: async () => sched }) : noCoursework(url));
  const { box } = await bootDl([{ d: "garbage", t: "Bad row" }, { d: isoOffset(3), t: "Near thing" }], { fetch });
  assert.doesNotMatch(allText(box), /could not be loaded/, "no malformed record blanks the panel");
  assert.match(allText(box), /3\. This week in class/, "schedule section renders");
  assert.match(allText(box), /Wide unit/, "the valid unit shows (codes guard exercised)");
  assert.doesNotMatch(allText(box), /Broken unit/, "missing from skipped");
  assert.doesNotMatch(allText(box), /Impossible date/, "impossible date skipped");
  assert.doesNotMatch(allText(box), /Bad break/, "malformed break skipped");
  assert.match(allText(box), /4\. Coming up/, "dates block survives the bad deadline row");
  assert.match(allText(box), /Near thing/, "the valid deadline still shows");
  assert.doesNotMatch(allText(box), /Bad row/, "the malformed deadline row is gone");
});

test("today panel: suggestions render ranked with reason and direct link (cards first, then mistakes)", async () => {
  const data = {
    "fc-userdecks": J([{ name: "d", subject: "biology-hl", cards: [{ id: "my-1", front: "F", back: "B" }] }]),
    "fc-state": J({ "my-1": { box: 1, due: "2026-01-01" } }),
    "q-errors": J([{ key: "bank-x#7", bankId: "bank-x", subject: "biology-hl", topic: "t1", topicLabel: "Enzymes", lastMissed: "2026-11-01" }])
  };
  const { box } = await bootDl([{ d: isoOffset(2), t: "Prep thing" }], { data, fetch: noCoursework });
  const text = allText(box);
  assert.match(text, /5\. Suggested next step/);
  const blocks = [];
  (function walk(el) { (el.children || []).forEach(c => { if (c.className === "td-block") blocks.push(c); walk(c); }); })(box);
  const sugg = blocks.find(b => b.children[0] && allText(b.children[0]).startsWith("5."));
  assert.ok(sugg, "suggestions block found");
  const rows = sugg.children.filter(x => x.className === "td-subj");
  assert.deepEqual(rows.map(r => allText(r.children[0])).map(s => s.trim()), ["1 card due", "Open mistakes on Enzymes"],
    "ranked: cards due first, then open mistakes; deadline prep pushed out by the two-item cap");
  const hrefs = [];
  (function walk(el) { if (el.tagName === "A" && el.attrs && el.attrs.href) hrefs.push(el.attrs.href); (el.children || []).forEach(walk); })(sugg);
  assert.ok(hrefs.some(h => h.startsWith("cards.html")), "cards suggestion carries a direct link");
  assert.ok(hrefs.some(h => h.startsWith("quiz.html?errkeys=")), "mistakes suggestion carries the retry link");
});

test("today panel: question manifest and bank files are fetched once, not on every render", async () => {
  const REPO_Q = path.join(REPO, "library", "questions");
  const man = JSON.parse(fs.readFileSync(path.join(REPO_Q, "manifest.json"), "utf8"));
  const bankFile = man[0].file;
  const bankId = bankFile.split("/").pop().replace(/\.json$/, "");
  const first = JSON.parse(fs.readFileSync(path.join(REPO, bankFile), "utf8")).items[0];
  const urls = [];
  const fetch = (u) => { urls.push(String(u)); return repoFetch()(u); };
  const env = makeEnv({ readyState: "complete", fetch, data: {
    "q-errors": J([{ key: bankId + "#" + first.id, id: first.id, bankId: bankId, topic: first.topic, topicLabel: "Cache check", lastMissed: "2026-11-01" }])
  } });
  env.load("store.js").load("profile.js");
  const box = env.document.createElement("div");
  box.id = "today-body";
  env.document.body.appendChild(box);
  env.load("today.js");
  await new Promise(r => setTimeout(r, 80));
  env.NB.store.set("quizlog", []); // watched key → debounced re-render
  await new Promise(r => setTimeout(r, 500));
  assert.match(allText(box), /Start a 6-question quiz/, "panel re-rendered with the weak topic");
  assert.equal(urls.filter(u => u.includes("library/questions/manifest.json")).length, 1,
    "questions manifest fetched once across renders (was: every render)");
  assert.equal(urls.filter(u => u.includes(bankFile.split("/").pop())).length, 1,
    "bank file fetched once across renders (was: every render)");
});

test("suggestActions: a closing unit without a note does not suppress one that has a link", () => {
  const t = T();
  const today = "2026-11-20";
  const notes = { "biology-hl|C1.1": { subject: "biology-hl", file: "library/topic-notes/biology-hl/c1-1.json", code: "C1.1", title: "Enzymes and metabolism",
    links: { quizBanks: [{ file: "library/questions/bio-c1-1.json" }] } } };
  const units = [
    { subject: "math-aa-sl", label: "Math AA SL", unit: { from: "2026-11-16", to: today, codes: ["5.1"], unit: "Differentiation" } }, // closes today, no note
    { subject: "biology-hl", label: "Biology HL", unit: { from: "2026-11-02", to: "2026-11-27", codes: ["C1.1"], unit: "Enzymes and metabolism" } }
  ];
  const s = plain(t.suggestActions({ today, due: 0, own: 0, errors: [], units, notes, nearItems: [] }));
  assert.equal(s.length, 1);
  assert.match(s[0].title, /Unit closes this week/);
  assert.match(s[0].reason, /Enzymes and metabolism/, "the linkable closing unit is used");
  assert.match(s[0].href, /^quiz\.html\?from=/);
});

test("datedItems: the same event in the calendar and the planner is listed once; distinct same-day events are kept", () => {
  const t = T();
  const dl = [
    { d: "2027-06-15", t: "Biology: IA experiment day (group 1)" },
    { d: "2027-01-12", t: "Revision-only homework window begins" }
  ];
  const cw = { tracks: [{ id: "bio", subject: "biology-hl", label: "Biology", stages: [
    { id: "data", title: "Data", dates: [
      { date: "2027-06-15", label: "Biology IA experiment day (group 1)" }, // same event, different punctuation
      { date: "2027-06-15", label: "Something else entirely" }              // distinct event, same day
    ] }
  ] }] };
  const items = plain(t.datedItems(dl, cw, null));
  assert.deepEqual(items.map(x => [x.date, x.label]), [
    ["2027-01-12", "Revision-only homework window begins"],
    ["2027-06-15", "Biology: IA experiment day (group 1)"],
    ["2027-06-15", "Something else entirely"]
  ], "duplicate event dropped (first source wins), distinct same-day events kept");
});

test("maths notes resolve across the manifest's legacy 'maths-aa-sl' spelling and a canonical profile", async () => {
  const sched = { subjects: { "maths-aa-sl": { units: [
    { from: "2000-01-01", to: isoOffset(3), codes: ["5.1"], unit: "Differentiation" } // closes this week
  ] } } };
  const manifest = { notes: [{ subject: "maths-aa-sl", code: "5.1", file: "library/topic-notes/maths-aa-sl/5-1.json" }] };
  const note = { code: "5.1", title: "Differentiation basics", links: { quizBanks: [{ file: "library/questions/math-aa-1.json", itemIds: [] }] } };
  const fetch = (url) => {
    const u = String(url);
    if (u.includes("class-schedule")) return Promise.resolve({ ok: true, json: async () => sched });
    if (u.includes("topic-notes/manifest")) return Promise.resolve({ ok: true, json: async () => manifest });
    if (u.includes("topic-notes/maths-aa-sl")) return Promise.resolve({ ok: true, json: async () => note });
    return repoFetch()(url);
  };
  const { box } = await bootRender({ fetch, data: { profile: J({ subjects: ["math-aa-sl"] }) } });
  const text = allText(box);
  assert.match(text, /5\.1 Differentiation basics/, "note found via canon-compare despite the legacy manifest spelling");
  assert.doesNotMatch(text, /No notes written for these codes yet/, "not treated as noteless");
  assert.match(text, /Unit closes this week/, "the closing maths unit produces a suggestion");
  assert.match(text, /Differentiation ends/, "suggestion reason names the unit");
  const hrefs = [];
  (function walk(el) { if (el.tagName === "A" && el.attrs && el.attrs.href) hrefs.push(el.attrs.href); (el.children || []).forEach(walk); })(box);
  assert.ok(hrefs.some(h => h.startsWith("quiz.html?from=math-aa-1")), "suggestion links the note's quiz bank");
});
test("weakestTopic: uploaded banks keyed by their stored name are excluded too — the Today link resolves library banks only", () => {
  const t = T();
  const errs = [
    { key: "ai-photosynthesis#p01", id: "1", bankId: "ai-photosynthesis", topic: "p", topicLabel: "Photosynthesis", lastMissed: "2026-11-15" },
    { key: "bio-y#1", id: "1", bankId: "bio-y", topic: "c1-1", topicLabel: "Enzymes", lastMissed: "2026-11-10" },
  ];
  const up = ["ai-photosynthesis", "user:photosynthesis"];
  assert.equal(t.weakestTopic(errs, [], up).bankId, "bio-y", "name-keyed uploaded-bank records are excluded like the old user:* ones");
  assert.equal(t.weakestTopic(errs, [], []).bankId, "ai-photosynthesis", "the caller must supply the uploaded list — without it nothing is excluded");
  // uploads now carry an explicit "ub-…" id — its error records must be excluded as well
  const idErrs = [
    { key: "ub-mc2x#p01", id: "1", bankId: "ub-mc2x", topic: "p", topicLabel: "Photosynthesis", lastMissed: "2026-11-15" },
    { key: "bio-y#1", id: "1", bankId: "bio-y", topic: "c1-1", topicLabel: "Enzymes", lastMissed: "2026-11-10" },
  ];
  assert.equal(t.weakestTopic(idErrs, [], ["ub-mc2x"]).bankId, "bio-y", "id-keyed uploaded-bank records are excluded like the name/user:* ones");
});

// The Today panel's mistake suggestion packs record keys into a quiz.html?errkeys=
// link (openMistakes → suggestActions): retired records must never be packed in —
// the deep link would skip them — and an all-retired log suggests nothing at all.
test("suggestActions: the mistakes retry link carries only unretired keys; an all-retired log suggests nothing", () => {
  const t = T();
  const today = "2026-11-20";
  const errs = [
    { key: "bio-y#1", bankId: "bio-y", topicLabel: "Enzymes", lastMissed: "2026-11-02" },
    { key: "bio-y#2", bankId: "bio-y", topicLabel: "Enzymes", retired: true, retiredReason: "off-syllabus" },
  ];
  const s = plain(t.suggestActions({ today, due: 0, own: 0, errors: errs, units: [], nearItems: [] }));
  assert.equal(s.length, 1);
  assert.equal(s[0].href, "quiz.html?errkeys=bio-y%231", "the retired key is left out of the packed link");
  assert.deepEqual(plain(t.suggestActions({ today, due: 0, own: 0,
    errors: [{ key: "bio-y#1", bankId: "bio-y", topicLabel: "Enzymes", retired: true }], units: [], nearItems: [] })),
    [], "nothing open → no mistakes suggestion at all");
});

test("startThinkingItems: the exact far-end date is the last start-thinking day (May → September); the near-end date belongs to the near list", () => {
  const t = T();
  const mk = (date, label) => ({ date, label, href: "x.html", where: "calendar" });
  // fixed literal today (no Date mocking): a May 4 "today" puts the exact 120-day
  // far end on Sep 1 — post-summer deadlines get their heads-up from May onwards
  const today = "2027-05-04";
  assert.equal(t.addDays(today, 120), "2027-09-01", "the documented May → September span");
  const items = [mk(today, "today"), mk("2027-05-25", "near-end"), mk("2027-09-01", "far-end"), mk("2027-09-02", "past-end")];
  assert.deepEqual(plain(t.startThinkingItems(items, today, 21, 120)).map(x => x.label), ["far-end"],
    "farEnd inclusive, farEnd+1 excluded");
  assert.deepEqual(plain(t.nearTermItems(items, today, 21)).map(x => x.label), ["today", "near-end"],
    "nearEnd inclusive in the near list — and exactly there, not in start-thinking");
});

// render path with the PRODUCTION constants (today.js LEAD_DAYS/LONG_LEAD_DAYS are
// not exported, so the panel is the only place the real 21/120 windows are exercised):
// the boundaries are exact — day 21 near-term, day 22 starts thinking, day 120 in, 121 out.
test("today panel: the production lead windows are exact — day 21 near-term, day 22 starts thinking, day 120 in, day 121 out", async () => {
  const { box } = await bootDl([
    { d: isoOffset(21), t: "Lead edge" },
    { d: isoOffset(22), t: "First think day" },
    { d: isoOffset(120), t: "Far edge" },
    { d: isoOffset(121), t: "Beyond the window" },
  ], { fetch: noCoursework });
  const text = allText(box);
  assert.match(text, /4\. Coming up/);
  assert.match(text, /Lead edge/, "today + LEAD_DAYS (21) is still near-term");
  assert.match(text, /Start thinking about First think day/, "today + 22 opens the long lead window");
  assert.match(text, /Start thinking about Far edge/, "today + LONG_LEAD_DAYS (120) still shows");
  assert.doesNotMatch(text, /Beyond the window/, "today + 121 is out of both windows");
});

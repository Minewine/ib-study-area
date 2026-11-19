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
    const rows = [];
    (function walk(el) { (el.children || []).forEach(c => { if (c.className === "td-subj") rows.push(c); walk(c); }); })(box);
    return rows.map(r => r.children[0].children[0].textContent);
  };
  assert.deepEqual(plain(await boot(["biology-hl"])), ["Biology HL: "],
    "one row — allowed and actually tracked by class-schedule.json");
  assert.deepEqual(plain(await boot(undefined)), ["Biology HL: ", "Chemistry HL: ", "Math AA SL: "],
    "default-all profile adds no empty rows for the untracked subjects");
});

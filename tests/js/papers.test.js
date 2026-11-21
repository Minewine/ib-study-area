// node --test tests/js — past-paper score log (assets/papers.js): validation,
// persistence in the synced "pp-scores" key, per-record merge with deletions,
// backup export / restore, the sync push, and the by-topic / per-subject
// summaries with trends.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeEnv, FakeStorage, plain } = require("./harness");
const { FakeServer } = require("./fake-server");

const J = JSON.stringify;
const tick = (ms) => new Promise(r => setTimeout(r, ms || 15));
const env = (data, storage) => makeEnv({ storage: storage || new FakeStorage(data) }).load("store.js").load("backup.js").load("papers.js");
const OK = { date: "2026-11-12", subject: "chemistry-hl", paper: "Paper 1A, May 2024", score: 28, max: 40, notes: "redox slips" };

test("pp-scores is a synced key (not local-only) and has a record merger", () => {
  const e = env();
  assert.ok(e.NB.store.SYNCED_KEYS.includes("pp-scores"));
  assert.equal(typeof e.NB.merge.RECORDS["pp-scores"], "function");
});

test("add validates input and persists to localStorage", () => {
  const e = env();
  const P = e.NB.papers;
  assert.match(P.add(Object.assign({}, OK, { score: 41 })).error, /between 0 and the max/);
  assert.match(P.add(Object.assign({}, OK, { date: "" })).error, /date/);
  assert.match(P.add(Object.assign({}, OK, { paper: " " })).error, /paper/i);
  assert.match(P.add(Object.assign({}, OK, { max: 0 })).error, /Max/);
  assert.match(P.add(Object.assign({}, OK, { max: NaN })).error, /together/, "score without out-of is rejected");
  assert.match(P.add(Object.assign({}, OK, { score: NaN })).error, /together/, "out-of without score is rejected");
  assert.match(P.add(Object.assign({}, OK, { paper: " ", topic: "" })).error, /paper.*topic/s, "paper or topic is required");
  const r = P.add(OK);
  assert.ok(r.ok);
  const stored = JSON.parse(e.storage.getItem("pp-scores"));
  assert.equal(stored.length, 1);
  assert.equal(stored[0].paper, "Paper 1A, May 2024");
  assert.equal(stored[0].score, 28); assert.ok(stored[0].id && stored[0].ts);
  assert.equal(stored[0].source, "teacher", "source defaults to teacher-marked");
  assert.ok(plain(e.NB.store.dirty())["pp-scores"], "marked dirty for the next sync");
  assert.equal(P.pct(stored[0]), 70);
});

test("scoreless topic reflection: paper optional, score/max omitted, source and topic stored", () => {
  const e = env();
  const P = e.NB.papers;
  const r = P.add({ date: "2026-11-14", subject: "biology-hl", topic: "Enzymes — what to re-study", source: "self", notes: "cofactors" });
  assert.ok(r.ok, r.error);
  const rec = JSON.parse(e.storage.getItem("pp-scores"))[0];
  assert.equal(rec.source, "self");
  assert.equal(rec.topic, "Enzymes — what to re-study");
  assert.ok(!("score" in rec) && !("max" in rec), "scoreless record omits both fields");
  assert.match(P.check(rec), /^$/, "the stored record passes its own validation");
  const long = P.add({ date: "2026-11-14", subject: "biology-hl", topic: "x".repeat(130) });
  assert.equal(long.ok, true);
  assert.equal(long.record.topic.length, 120, "topic is capped at 120 chars");
  const badSrc = P.add({ date: "2026-11-14", subject: "biology-hl", topic: "t", source: "coach" });
  assert.equal(badSrc.ok, false);
});

test("list newest first; remove leaves a tombstone; summary per subject", () => {
  const e = env();
  const P = e.NB.papers;
  P.add(OK);
  P.add(Object.assign({}, OK, { date: "2026-11-15", score: 30 }));
  const third = P.add(Object.assign({}, OK, { date: "2026-10-01", subject: "biology-hl", score: 20, max: 50 })).record;
  P.add({ date: "2026-11-16", subject: "chemistry-hl", topic: "Periodicity", source: "self", notes: "revisit buffers" }); // reflection, no score
  assert.deepEqual(plain(P.list()).map(r => r.date), ["2026-11-16", "2026-11-15", "2026-11-12", "2026-10-01"]);
  const s = plain(P.summary()).find(x => x.subject === "chemistry-hl");
  assert.deepEqual([s.count, s.latest, s.recentMean], [2, 75, 73], "averages/latest use score-bearing records only");
  assert.equal(s.reflections, 1, "scoreless records counted as reflections");
  assert.equal(plain(P.summary()).find(x => x.subject === "biology-hl").reflections, 0);
  assert.ok(P.remove(third.id));
  assert.equal(P.list().length, 3);
  const raw = JSON.parse(e.storage.getItem("pp-scores"));
  assert.ok(raw.find(r => r.id === third.id && r.deleted === true), "tombstone kept for sync");
});

test("merge: union by id, newest ts wins, a deletion is not undone by an older copy", () => {
  const M = env().NB.merge;
  const a = [{ id: "x", date: "2026-11-01", subject: "s", paper: "P1", score: 1, max: 2, ts: 10 }, { id: "y", deleted: true, ts: 30 }];
  const b = [{ id: "y", date: "2026-11-02", subject: "s", paper: "P2", score: 2, max: 2, ts: 20 }, { id: "z", date: "2026-11-03", subject: "s", paper: "P3", score: 1, max: 1, ts: 5 }];
  const m = plain(M.RECORDS["pp-scores"](a, b));
  assert.deepEqual(m.map(r => r.id).sort(), ["x", "y", "z"]);
  assert.equal(m.find(r => r.id === "y").deleted, true);
  assert.deepEqual(plain(M.union("pp-scores", b, a)).find(r => r.id === "y").deleted, true);
});

test("backup: export includes pp-scores; restore merges and drops malformed records", () => {
  const a = env();
  a.NB.papers.add(OK);
  const file = plain(a.NB.backup.collect());
  assert.ok(Array.isArray(file.keys["pp-scores"]) && file.keys["pp-scores"].length === 1);
  file.keys["pp-scores"].push(
    { id: "bad" }, "nope",
    { id: "refl", date: "2026-11-01", subject: "math-aa-sl", source: "self", topic: "Quadratics", ts: 2 } // scoreless reflection survives the SPEC
  );
  const b = env({ "pp-scores": J([{ id: "local", date: "2026-09-01", subject: "math-aa-sl", paper: "P1", score: 50, max: 80, ts: 1 }]) });
  const p = b.NB.backup.parse(J(file));
  assert.ok(p.ok);
  assert.ok(plain(p.warnings).some(w => /2 unreadable record.*pp-scores/.test(w)), "malformed records reported");
  b.NB.backup.restore(p, "merge");
  const merged = plain(b.NB.papers.list());
  assert.ok(merged.some(r => r.id === "local"), "local record kept");
  assert.ok(merged.some(r => r.paper === "Paper 1A, May 2024"), "restored record merged in");
  const refl = merged.find(r => r.id === "refl");
  assert.ok(refl, "scoreless reflection record restored");
  assert.equal(refl.topic, "Quadratics");
  assert.ok(!("score" in refl) && !("max" in refl));
});

test("sync: a logged-in device pushes pp-scores to the server; another device receives it", async () => {
  const server = new FakeServer({ rev: 1, state: { quizlog: [] } });
  const login = { "nb-token": "tok-1", "nb-sync": J({ user: "tester", rev: 1, legacy: false }), quizlog: "[]" };
  const mk = async (data) => { const e = makeEnv({ storage: new FakeStorage(data), fetch: (...x) => server.fetchFor()(...x) }); e.load("store.js").load("auth.js").load("papers.js"); await tick(30); return e; };
  const a = await mk(login);
  a.NB.papers.add(OK);
  a.fire("window", "pagehide");
  await tick(40);
  assert.ok(Array.isArray(server.state["pp-scores"]) && server.state["pp-scores"][0].paper === OK.paper, "on the server");
  const b = await mk(Object.assign({}, login, { "nb-sync": J({ user: "tester", rev: server.rev, legacy: false }) }));
  await tick(40);
  assert.equal(plain(b.NB.papers.list())[0].paper, OK.paper, "second device got it");
});

test("topicSummary groups by subject and topic; scoreless-only groups never invent a denominator", () => {
  const e = env();
  const P = e.NB.papers;
  P.add({ date: "2026-10-05", subject: "chemistry-hl", paper: "Paper 1A", topic: "Periodicity", score: 6, max: 10, notes: "" });
  P.add({ date: "2026-11-01", subject: "chemistry-hl", paper: "Paper 1A", topic: "Periodicity", score: 8, max: 10, notes: "" });
  P.add({ date: "2026-11-10", subject: "chemistry-hl", topic: "Periodicity", source: "self", notes: "revisit buffers" }); // reflection, no score
  P.add({ date: "2026-11-02", subject: "chemistry-hl", paper: "Paper 2", score: 12, max: 20, notes: "" }); // no topic
  P.add({ date: "2026-11-14", subject: "biology-hl", topic: "Enzymes", source: "self", notes: "" }); // scoreless-only group
  const rows = plain(P.topicSummary());
  assert.deepEqual(rows.map(r => `${r.subject}|${r.topicLabel}`),
    ["biology-hl|Enzymes", "chemistry-hl|(whole paper)", "chemistry-hl|Periodicity"], "rows sort by subject then topic");
  const none = rows[0];
  assert.equal(none.topic, "Enzymes");
  assert.deepEqual([none.scored, none.reflections], [0, 1]);
  assert.equal(none.latest, null, "no denominator invented");
  assert.deepEqual(none.points, []);
  const whole = rows[1];
  assert.equal(whole.topic, null);
  assert.deepEqual([whole.scored, whole.reflections], [1, 0]);
  assert.deepEqual(whole.latest, { score: 12, max: 20, pct: 60, date: "2026-11-02" });
  const per = rows[2];
  assert.deepEqual([per.scored, per.reflections], [2, 1], "scored and scoreless counted separately");
  assert.deepEqual(per.latest, { score: 8, max: 10, pct: 80, date: "2026-11-01" }, "latest is the newest scored record");
  assert.deepEqual(per.points, [
    { date: "2026-10-05", score: 6, max: 10, pct: 60 },
    { date: "2026-11-01", score: 8, max: 10, pct: 80 }
  ], "points ascending by date");
});

test("topicSummary keeps per-point denominators and caps the chain at the last 5", () => {
  const recs = [];
  for (let i = 1; i <= 6; i++) recs.push({ id: "r" + i, date: "2026-01-0" + i, subject: "math-aa-sl", paper: "Paper 1", score: i * 2, max: i === 1 ? 25 : 20, ts: i });
  const g = plain(env().NB.papers.topicSummary(recs))[0];
  assert.equal(g.points.length, 5, "capped at 5");
  assert.deepEqual(g.points.map(p => p.score), [4, 6, 8, 10, 12], "oldest dropped, ascending kept");
  assert.deepEqual(g.points.map(p => p.max), [20, 20, 20, 20, 20], "each point keeps the max of its own record");
  assert.deepEqual(g.latest, { score: 12, max: 20, pct: 60, date: "2026-01-06" });
});

test("subjectTrend: ascending scored chain capped at 5, reflections counted, no quiz scores", () => {
  const recs = [
    { id: "a", date: "2026-09-01", subject: "chemistry-hl", paper: "P1", score: 10, max: 20, ts: 1 },
    { id: "b", date: "2026-10-01", subject: "chemistry-hl", paper: "P1", score: 12, max: 20, ts: 2 },
    { id: "c", date: "2026-10-20", subject: "chemistry-hl", paper: "P2", score: 15, max: 25, ts: 3 },
    { id: "d", date: "2026-11-01", subject: "chemistry-hl", paper: "P2", score: 16, max: 25, ts: 4 },
    { id: "e", date: "2026-11-05", subject: "chemistry-hl", paper: "P2", score: 18, max: 25, ts: 5 },
    { id: "f", date: "2026-11-08", subject: "chemistry-hl", paper: "P3", score: 20, max: 25, ts: 6 },
    { id: "g", date: "2026-11-10", subject: "chemistry-hl", topic: "Periodicity", source: "self", ts: 7 },
    { id: "h", date: "2026-10-02", subject: "biology-hl", topic: "Genetics", source: "self", ts: 8 }
  ];
  const t = plain(env().NB.papers.subjectTrend(recs));
  assert.deepEqual(t.map(x => x.subject), ["biology-hl", "chemistry-hl"], "subjects sorted");
  const bio = t[0];
  assert.deepEqual([bio.scored, bio.reflections, bio.points], [0, 1, []]);
  const chem = t[1];
  assert.deepEqual([chem.scored, chem.reflections], [6, 1]);
  assert.deepEqual(chem.points.map(p => `${p.score}/${p.max}`), ["12/20", "15/25", "16/25", "18/25", "20/25"],
    "ascending, oldest dropped, each point keeps its own denominator");
  assert.deepEqual(chem.points.map(p => p.pct), [60, 60, 64, 72, 80]);
});

test("practice-quiz sessions (quizlog) never leak into the paper summaries", () => {
  const e = env({ "quizlog": J([
    { date: "2026-11-01", label: "Practice: Enzymes", pct: 90, got: 9, max: 10 },
    { date: "2026-11-02", label: "Practice: Enthalpy", pct: 40, got: 4, max: 10, subject: "chemistry-hl", topics: ["Enthalpy"] }
  ]) });
  const P = e.NB.papers;
  P.add({ date: "2026-11-03", subject: "chemistry-hl", topic: "Enthalpy", source: "self", notes: "" });
  const rows = plain(P.topicSummary());
  assert.equal(rows.length, 1, "only the paper record group — quiz sessions are invisible here");
  const g = rows[0];
  assert.equal(g.subject, "chemistry-hl");
  assert.deepEqual([g.scored, g.reflections, g.latest, g.points], [0, 1, null, []]);
  const t = plain(P.subjectTrend());
  assert.deepEqual(t.map(x => x.subject), ["chemistry-hl"], "no extra subject invented from quizlog");
  assert.deepEqual([t[0].scored, t[0].reflections, t[0].points], [0, 1, []], "practice-quiz scores stay in the quiz history");
});

test("render: trend line and by-topic table carry score/max denominators; hidden when empty", () => {
  const e = env();
  const P = e.NB.papers;
  const kids = {};
  const panel = {
    innerHTML: "",
    querySelector(sel) { return kids[sel] || (kids[sel] = { innerHTML: "", value: "", listeners: {}, addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); } }); },
    querySelectorAll() { return []; }
  };
  P.mount(panel);
  assert.equal(kids["#pp-trends"].innerHTML, "", "no trend block with zero records");
  assert.equal(kids["#pp-topics"].innerHTML, "", "no by-topic block with zero records");
  P.add(OK);
  P.add(Object.assign({}, OK, { date: "2026-11-18", score: 30 }));
  P.add({ date: "2026-11-16", subject: "chemistry-hl", topic: "Periodicity", source: "self", notes: "" });
  P.mount(panel);
  const trend = kids["#pp-trends"].innerHTML;
  assert.match(trend, /<h3>Score trend<\/h3>/);
  assert.match(trend, /<strong>Chemistry HL<\/strong>: 28\/40 \(70%\) on 12 Nov \u2192 30\/40 \(75%\) on 18 Nov/,
    "every point shows score/max (pct%), never a bare percentage");
  assert.ok(!/\d+% on/.test(trend.replace(/\(\d+%\) on/g, "")), "no percentage appears outside a score/max pair");
  const topics = kids["#pp-topics"].innerHTML;
  assert.match(topics, /<h3>By topic<\/h3>/);
  assert.match(topics, /<th>Subject<\/th><th>Topic<\/th><th>Scored<\/th><th>Reflections<\/th><th>Latest<\/th><th>Trend<\/th>/);
  assert.match(topics, /28\/40 \(70%\)/, "records-table score pattern reused");
  assert.match(topics, /Periodicity/);
  assert.match(topics, /class="muted">\u2014<\/span>/, "scoreless-only rows show an em dash, not a percentage");
});

// node --test tests/js — past-paper score log (assets/papers.js): validation,
// persistence in the synced "pp-scores" key, per-record merge with deletions,
// backup export / restore, and the sync push.
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
  const r = P.add(OK);
  assert.ok(r.ok);
  const stored = JSON.parse(e.storage.getItem("pp-scores"));
  assert.equal(stored.length, 1);
  assert.equal(stored[0].paper, "Paper 1A, May 2024");
  assert.equal(stored[0].score, 28); assert.ok(stored[0].id && stored[0].ts);
  assert.ok(plain(e.NB.store.dirty())["pp-scores"], "marked dirty for the next sync");
  assert.equal(P.pct(stored[0]), 70);
});

test("list newest first; remove leaves a tombstone; summary per subject", () => {
  const e = env();
  const P = e.NB.papers;
  P.add(OK);
  P.add(Object.assign({}, OK, { date: "2026-11-15", score: 30 }));
  const third = P.add(Object.assign({}, OK, { date: "2026-10-01", subject: "biology-hl", score: 20, max: 50 })).record;
  assert.deepEqual(plain(P.list()).map(r => r.date), ["2026-11-15", "2026-11-12", "2026-10-01"]);
  const s = plain(P.summary()).find(x => x.subject === "chemistry-hl");
  assert.deepEqual([s.count, s.latest, s.recentMean], [2, 75, 73]);
  assert.ok(P.remove(third.id));
  assert.equal(P.list().length, 2);
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
  file.keys["pp-scores"].push({ id: "bad" }, "nope");
  const b = env({ "pp-scores": J([{ id: "local", date: "2026-09-01", subject: "math-aa-sl", paper: "P1", score: 50, max: 80, ts: 1 }]) });
  const p = b.NB.backup.parse(J(file));
  assert.ok(p.ok);
  assert.ok(plain(p.warnings).some(w => /2 unreadable record.*pp-scores/.test(w)), "malformed records reported");
  b.NB.backup.restore(p, "merge");
  assert.deepEqual(plain(b.NB.papers.list()).map(r => r.paper).sort(), ["P1", "Paper 1A, May 2024"]);
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

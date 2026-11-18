// node --test tests/js — coursework planner progress ("cw-progress"): helpers in
// assets/coursework.js, sync registration, per-record merge (store.js), backup and
// restore (backup.js), and a two-device sync round trip through auth.js.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeEnv, FakeStorage, plain } = require("./harness");
const { FakeServer } = require("./fake-server");

const J = JSON.stringify;
const tick = (ms) => new Promise(r => setTimeout(r, ms || 15));
const CW = () => makeEnv({ readyState: "loading" }).load("store.js").load("coursework.js");

test("cw-progress is a synced key; a tick marks it dirty for the next push", () => {
  const env = CW();
  const S = env.NB.store, C = env.NB.coursework;
  assert.ok(S.SYNCED_KEYS.includes("cw-progress"));
  assert.ok(S.isSynced("cw-progress"));
  assert.ok(!S.isLocalOnly("cw-progress"));
  S.set(C.KEY, C.setCheck({}, "bio.topic.c1", true, 100));
  assert.ok(plain(S.dirty())["cw-progress"]);
  assert.equal(C.isChecked(S.get(C.KEY), "bio.topic.c1"), true);
});

test("helpers: ticks, unticks, notes and dates are timestamped records; counts and upcoming dates", () => {
  const C = CW().NB.coursework;
  let p = C.setCheck(undefined, "bio.rq.c1", true, 10);
  p = C.setCheck(p, "bio.rq.c2", true, 11);
  p = C.setCheck(p, "bio.rq.c2", false, 12);
  p = C.setNote(p, "bio.rq", "ask about range", 13);
  p = C.setDate(p, "bio.rq", "2027-03-01", 14);
  p = C.setDate(p, "bio.final", "not a date", 15);
  assert.deepEqual(plain(p.checks["bio.rq.c2"]), { c: false, t: 12 }, "untick kept as a record");
  assert.equal(C.noteText(p, "bio.rq"), "ask about range");
  assert.equal(C.ownDate(p, "bio.final"), "", "invalid dates are stored empty");
  const track = { id: "bio", stages: [
    { id: "rq", title: "RQ", checks: [{ id: "c1" }, { id: "c2" }], dates: [] },
    { id: "data", title: "Data", checks: [{ id: "c1" }], dates: [{ date: "2027-06-15", when: "15 Jun", label: "Experiment day", source: "ISL" }, { date: "2026-01-01", label: "past", source: "ISL" }] }
  ] };
  assert.deepEqual(plain(C.stageCount(p, track, track.stages[0])), { done: 1, total: 2 });
  assert.deepEqual(plain(C.trackCount(p, track)), { done: 1, total: 3 });
  const up = plain(C.upcoming(p, track, "2026-11-18"));
  assert.deepEqual(up.map(u => [u.date, u.own]), [["2027-03-01", true], ["2027-06-15", false]]);
});

test("merge: per record, newest edit wins in both directions; nothing is dropped", () => {
  const env = CW();
  const M = env.NB.merge;
  const local = { checks: { "a": { c: true, t: 5 }, "b": { c: false, t: 9 } }, notes: { "x": { s: "mine", t: 7 } } };
  const server = { checks: { "a": { c: false, t: 6 }, "b": { c: true, t: 3 }, "c": { c: true, t: 1 } }, dates: { "x": { d: "2027-01-01", t: 2 } } };
  const m = plain(M.RECORDS["cw-progress"](local, server));
  assert.deepEqual(m.checks, { a: { c: false, t: 6 }, b: { c: false, t: 9 }, c: { c: true, t: 1 } });
  assert.deepEqual(m.notes, { x: { s: "mine", t: 7 } });
  assert.deepEqual(m.dates, { x: { d: "2027-01-01", t: 2 } });
  assert.deepEqual(plain(M.union("cw-progress", local, server)), m, "first-login union uses the same record rules");
  assert.deepEqual(plain(M.RECORDS["cw-progress"](null, server)), server);
});

test("backup: cw-progress is collected, validated and merged on restore (newer local edits kept)", () => {
  const mk = (data) => makeEnv({ storage: new FakeStorage(data) }).load("store.js").load("backup.js");
  const a = mk({ "cw-progress": J({ checks: { "chem.rq.c1": { c: true, t: 50 }, "chem.rq.c2": { c: true, t: 50 } } }) });
  const file = J(a.NB.backup.collect());
  assert.ok(JSON.parse(file).keys["cw-progress"]);
  const b = mk({ "cw-progress": J({ checks: { "chem.rq.c2": { c: false, t: 80 } }, notes: { "chem.rq": { s: "keep me", t: 81 } } }) });
  const p = b.NB.backup.parse(file);
  assert.equal(p.ok, true, p.errors.join("; "));
  assert.equal(b.NB.backup.restore(p, "merge").ok, true);
  const got = plain(b.NB.store.get("cw-progress"));
  assert.deepEqual(got.checks, { "chem.rq.c1": { c: true, t: 50 }, "chem.rq.c2": { c: false, t: 80 } });
  assert.equal(got.notes["chem.rq"].s, "keep me");
  const bad = b.NB.backup.parse(J({ format: "nevaib-backup", version: 3, keys: { "cw-progress": { checks: [] } } }));
  assert.ok(!bad.keys || !bad.keys["cw-progress"], "malformed planner data is rejected");
});

async function device(server, data) {
  const env = makeEnv({ storage: new FakeStorage(data), fetch: (...a) => server.fetchFor()(...a) });
  env.load("store.js").load("auth.js").load("coursework.js");
  await tick(30);
  return env;
}
const loggedIn = (rev, extra) => Object.assign({ "nb-token": "tok-1", "nb-sync": J({ user: "tester", rev: rev, legacy: false }) }, extra || {});

test("sync: a stale second device merges record by record — both devices' edits reach the server and each device", async () => {
  const server = new FakeServer({ rev: 1, state: { "cw-progress": { checks: { "math.topic.c1": { c: true, t: 1 } } } } });
  const seed = J(server.state["cw-progress"]);
  const a = await device(server, loggedIn(1, { "cw-progress": seed }));
  const b = await device(server, loggedIn(1, { "cw-progress": seed }));
  const C = a.NB.coursework;
  a.NB.store.set(C.KEY, C.setCheck(a.NB.store.get(C.KEY), "math.rq.c1", true, 100));
  assert.equal(await a.ctx.window.Auth.pushNow(true), true);
  b.NB.store.set(C.KEY, C.setCheck(b.NB.store.get(C.KEY), "math.topic.c1", false, 200));
  assert.equal(await b.ctx.window.Auth.pushNow(true), true, "B is stale: 409, merge, retry");
  const s = server.state["cw-progress"].checks;
  assert.deepEqual(s["math.rq.c1"], { c: true, t: 100 }, "device A's tick survived B's stale save (409 → merge)");
  assert.deepEqual(s["math.topic.c1"], { c: false, t: 200 }, "device B's newer untick wins");
  const a2 = await device(server, a.storage.dump());
  const got = plain(a2.NB.store.get("cw-progress")).checks;
  assert.equal(got["math.topic.c1"].c, false);
  assert.equal(got["math.rq.c1"].c, true);
});

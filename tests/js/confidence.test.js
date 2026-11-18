// node --test tests/js — confidence ratings (assets/confidence.js) and their
// compatibility with old quizlog / q-errors records in sync merge and backups.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeEnv, FakeStorage, plain } = require("./harness");

const J = JSON.stringify;
const env = (data) => makeEnv({ storage: new FakeStorage(data) }).load("store.js").load("backup.js").load("confidence.js");

const RESULTS = [
  { key: "b#1", stem: "sure right", got: 1, max: 1, conf: "sure" },
  { key: "b#2", stem: "sure wrong", got: 0, max: 1, conf: "sure" },
  { key: "b#3", stem: "sure, part marks", got: 2, max: 3, conf: "sure" },
  { key: "b#4", stem: "guess right", got: 1, max: 1, conf: "guess" },
  { key: "b#5", stem: "guess wrong", got: 0, max: 1, conf: "guess" },
  { key: "b#6", stem: "unrated (old page)", got: 0, max: 1 }
];

test("tally counts sure/guessing and how many were right; unrated results are ignored", () => {
  const C = env().NB.conf;
  assert.deepEqual(plain(C.tally(RESULTS)), { sure: 3, sureRight: 1, guess: 2, guessRight: 1 });
  assert.equal(C.describe(C.tally(RESULTS)), "sure 1/3 right \u00b7 guessing 1/2 right");
});

test("confident-but-wrong = rated sure and not full marks (written part marks count)", () => {
  const C = env().NB.conf;
  assert.deepEqual(plain(C.confidentWrong(RESULTS)).map(r => r.key), ["b#2", "b#3"]);
});

test("old records: no conf field → no quizlog field, empty description, nothing listed", () => {
  const C = env().NB.conf;
  const old = [{ got: 0, max: 1 }, { got: 1, max: 1 }];
  assert.equal(C.logField(old), null);
  assert.equal(C.describe(undefined), "");
  assert.equal(C.describe({ date: "2026-10-01" }.conf), "");
  assert.deepEqual(plain(C.confidentWrong(old)), []);
  assert.deepEqual(plain(C.confidentWrongErrors([{ key: "b01", stem: "legacy", resolved: false }])), []);
  assert.deepEqual(plain(C.confidentWrongErrors(null)), []);
});

test("applyToError records the latest rating and counts sure-but-wrong attempts", () => {
  const C = env().NB.conf;
  const rec = { key: "b#1", attempts: 1 };
  C.applyToError(rec, "sure", true);
  C.applyToError(rec, "sure", true);
  assert.equal(rec.lastConf, "sure"); assert.equal(rec.sureWrong, 2);
  C.applyToError(rec, "guess", true);
  assert.equal(rec.lastConf, "guess"); assert.equal(rec.sureWrong, 2);
  const legacy = { key: "b02" };
  C.applyToError(legacy, null, true); // stale page without ratings: record untouched
  assert.deepEqual(legacy, { key: "b02" });
});

test("confidentWrongErrors: unresolved, latest miss rated sure, newest first", () => {
  const C = env().NB.conf;
  const errs = [
    { key: "a", lastConf: "sure", resolved: false, lastMissed: "2026-11-10" },
    { key: "b", lastConf: "sure", resolved: true, lastMissed: "2026-11-17" },
    { key: "c", lastConf: "guess", resolved: false, lastMissed: "2026-11-17" },
    { key: "d", lastConf: "sure", resolved: false, lastMissed: "2026-11-15" },
    { key: "e", resolved: false, lastMissed: "2026-11-18" }
  ];
  assert.deepEqual(plain(C.confidentWrongErrors(errs)).map(e => e.key), ["d", "a"]);
});

test("quizlog sync merge keeps old entries and new entries with conf side by side", () => {
  const e = env();
  const old = [{ date: "2026-10-01", label: "old", got: 1, max: 2, pct: 50 }];
  const fresh = [{ date: "2026-11-18", label: "new", got: 3, max: 4, pct: 75, ts: 9, conf: { sure: 3, sureRight: 2, guess: 1, guessRight: 1 } }];
  const m = plain(e.NB.merge.RECORDS.quizlog(fresh, old));
  assert.equal(m.length, 2);
  assert.deepEqual(m[0].conf, fresh[0].conf);
  assert.equal(m[1].conf, undefined);
});

test("q-errors merge keeps lastConf / sureWrong; backup accepts old and new records", () => {
  const e = env();
  const local = [{ key: "b#1", stem: "s", attempts: 2, ts: 20, lastConf: "sure", sureWrong: 1 }];
  const server = [{ key: "b#1", stem: "s", attempts: 1, ts: 10 }, { key: "b02", stem: "legacy", attempts: 1 }];
  const m = plain(e.NB.merge.RECORDS["q-errors"](local, server));
  assert.equal(m.find(x => x.key === "b#1").sureWrong, 1);
  assert.ok(m.find(x => x.key === "b02"));
  const p = e.NB.backup.parse(J({ format: "nevaib-backup", version: 3, keys: { "q-errors": m, quizlog: [{ date: "2026-10-01", label: "old", got: 1, max: 2, pct: 50 }, { date: "2026-11-18", label: "new", got: 1, max: 1, pct: 100, conf: { sure: 1, sureRight: 1, guess: 0, guessRight: 0 } }] } }));
  assert.ok(p.ok, J(p.errors));
  assert.deepEqual(plain(p.warnings).filter(w => /unreadable/i.test(w)), []);
  e.NB.backup.restore(p, "merge");
  assert.equal(plain(e.NB.store.get("quizlog", [])).length, 2);
  assert.equal(plain(e.NB.store.get("q-errors", [])).find(x => x.key === "b#1").lastConf, "sure");
});

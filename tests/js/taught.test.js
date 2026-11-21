// node --test tests/js — the "topic-taught" store key: sync registration, per-user
// scoping, dirty marking, the RECORDS merge (per-topic newest t wins) and the
// backup.js shape validator.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeEnv, plain } = require("./harness");

const J = JSON.stringify;

function env(data) { return makeEnv({ data }).load("store.js"); }
function backupEnv(data) { return makeEnv({ data }).load("store.js").load("backup.js"); }

test("topic-taught is a synced key and round-trips through NB.store", () => {
  const e = env({});
  const s = e.NB.store;
  assert.ok(s.SYNCED_KEYS.indexOf("topic-taught") >= 0, "listed in SYNCED_KEYS");
  assert.ok(s.isSynced("topic-taught"), "isSynced");
  assert.equal(s.set("topic-taught", { "bio-a1-1": { taught: true, t: 5 } }), true);
  assert.deepEqual(plain(s.get("topic-taught", {})), { "bio-a1-1": { taught: true, t: 5 } });
  assert.ok(s.dirty()["topic-taught"] > 0, "a non-silent write marks the key for sync");
});

test("topic-taught stays per-user scoped", () => {
  const e = env({});
  const s = e.NB.store;
  assert.equal(s.setScope("u1"), true);
  assert.equal(s.set("topic-taught", { t1: { taught: true, t: 1 } }), true);
  assert.equal(e.storage.getItem("u1:topic-taught"), J({ t1: { taught: true, t: 1 } }), "physically scoped");
  assert.equal(e.storage.getItem("topic-taught"), null, "nothing under the plain key");
  assert.equal(s.setScope("u2"), true);
  assert.deepEqual(plain(s.get("topic-taught", {})), {}, "u2 does not see u1's overrides");
  assert.equal(s.setScope("u1"), true);
  assert.deepEqual(plain(s.get("topic-taught", {})), { t1: { taught: true, t: 1 } }, "switching back restores them");
});

test("NB.merge RECORDS: per-topic newest t wins; every topic survives", () => {
  const merge = (a, b) => plain(env({}).NB.merge.RECORDS["topic-taught"](a, b));
  // local {A: taught true, t 5} vs server {A: taught false, t 9; B: taught true, t 1}
  assert.deepEqual(merge({ A: { taught: true, t: 5 } }, { A: { taught: false, t: 9 }, B: { taught: true, t: 1 } }),
    { A: { taught: false, t: 9 }, B: { taught: true, t: 1 } }, "A from the server (newer t); B kept");
  assert.deepEqual(merge({ A: { taught: false, t: 9 } }, { A: { taught: true, t: 5 } }),
    { A: { taught: false, t: 9 } }, "local wins when its t is newer");
  assert.deepEqual(merge({ A: { taught: true, t: 5 } }, { A: { taught: false, t: 5 } }),
    { A: { taught: false, t: 5 } }, "tie → b wins (the RECORDS convention)");
});

test("NB.merge RECORDS: missing t ranks as t=0; non-object input never crashes", () => {
  const merge = (a, b) => plain(env({}).NB.merge.RECORDS["topic-taught"](a, b));
  assert.deepEqual(merge({ A: { taught: true } }, { A: { taught: false, t: 9 } }),
    { A: { taught: false, t: 9 } }, "untimed local record loses to a timed one");
  assert.deepEqual(merge({ A: { taught: true, t: 3 } }, { A: { taught: false } }),
    { A: { taught: true, t: 3 } }, "timed local record beats an untimed one");
  assert.deepEqual(merge({ A: "junk" }, { A: { taught: true, t: 3 } }), { A: { taught: true, t: 3 } }, "non-object record side loses, no crash");
  assert.deepEqual(merge({ A: { taught: true, t: 3 } }, { A: "junk" }), { A: { taught: true, t: 3 } });
  assert.deepEqual(merge(5, { A: { taught: true, t: 1 } }), { A: { taught: true, t: 1 } }, "non-object whole value → other side");
  assert.deepEqual(merge({ A: { taught: true, t: 1 } }, "x"), { A: { taught: true, t: 1 } });
  assert.deepEqual(merge(undefined, { A: { taught: true, t: 1 } }), { A: { taught: true, t: 1 } });
});

test("NB.merge RECORDS: a status on the older side fills into a status-less newest winner", () => {
  const merge = (a, b) => plain(env({}).NB.merge.RECORDS["topic-taught"](a, b));
  assert.deepEqual(merge({ A: { taught: true, t: 2 } }, { A: { taught: true, status: "learning", t: 1 } }),
    { A: { taught: true, status: "learning", t: 2 } },
    "an old client's bool-only record must not erase a learning/ready status set elsewhere");
  assert.deepEqual(merge({ A: { taught: false, t: 2 } }, { A: { taught: false, status: "not-taught", t: 1 } }),
    { A: { taught: false, status: "not-taught", t: 2 } }, "not-taught implies taught:false → carried over");
  assert.deepEqual(merge({ A: { taught: false, t: 2 } }, { A: { taught: true, status: "learning", t: 1 } }),
    { A: { taught: false, t: 2 } }, "a status contradicting the winner's taught is dropped");
  assert.deepEqual(merge({ A: { taught: true, t: 2 } }, { A: { taught: true, status: "garbage", t: 1 } }),
    { A: { taught: true, t: 2 } }, "a garbage status is never filled");
  assert.deepEqual(merge({ A: { taught: true, status: "ready", t: 2 } }, { A: { taught: true, status: "learning", t: 1 } }),
    { A: { taught: true, status: "ready", t: 2 } }, "a winner that already has a status is untouched");
  assert.deepEqual(merge({ A: { taught: true, t: 2 } }, { A: { taught: false, t: 1 } }),
    { A: { taught: true, t: 2 } }, "no status on either side → plain newest-wins, unchanged");
});

test("backup: topic-taught is collected, validated and restored record-by-record", () => {
  const a = backupEnv({});
  a.NB.store.set("topic-taught", { t1: { taught: true, t: 5 }, bad: "junk", bad2: { taught: "yes" } });
  const file = J(a.NB.backup.collect());
  assert.ok(Object.keys(JSON.parse(file).keys).indexOf("topic-taught") >= 0, "collect includes the key");

  const b = backupEnv({});
  const p = b.NB.backup.parse(file);
  assert.equal(p.ok, true, p.errors.join("; "));
  assert.ok(p.warnings.some(w => /topic-taught/.test(w)), "dropped records are counted as warnings");
  const r = b.NB.backup.restore(p, "merge");
  assert.equal(r.ok, true);
  assert.deepEqual(plain(b.NB.store.get("topic-taught", {})), { t1: { taught: true, t: 5 } }, "bad records dropped, good ones kept");

  const c = backupEnv({});
  const bad = c.NB.backup.parse(J({ format: "nevaib-backup", version: 3, keys: { "topic-taught": [1, 2] } }));
  assert.equal(bad.ok, false, "a non-object whole value is rejected as a damaged file");
  assert.match(bad.errors.join(" "), /wrong shape/);
});

test("backup: topic-taught records accept the optional status; bogus ones are dropped, good ones round-trip", () => {
  const a = backupEnv({});
  a.NB.store.set("topic-taught", {
    t1: { taught: true, status: "learning", t: 5 },
    t2: { taught: false, status: "not-taught" },
    bad: { taught: true, status: "bogus", t: 7 }
  });
  const file = J(a.NB.backup.collect());
  assert.ok(Object.keys(JSON.parse(file).keys).indexOf("topic-taught") >= 0, "collect includes the key");

  const b = backupEnv({});
  const p = b.NB.backup.parse(file);
  assert.equal(p.ok, true, p.errors.join("; "));
  assert.ok(p.warnings.some(w => /topic-taught/.test(w)), "the bogus-status record is dropped as a warning");
  const r = b.NB.backup.restore(p, "merge");
  assert.equal(r.ok, true);
  assert.deepEqual(plain(b.NB.store.get("topic-taught", {})),
    { t1: { taught: true, status: "learning", t: 5 }, t2: { taught: false, status: "not-taught" } },
    "valid records restore with their status intact");
});

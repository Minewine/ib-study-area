// node --test tests/js   — NB.store (assets/store.js): get/set, quarantine, quota,
// dirty markers, snapshots, schema migrations, merge rules.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeEnv, FakeStorage, plain } = require("./harness");

const boot = (data, quota) => makeEnv({ data, quota }).load("store.js");

test("get/set round-trip; default for missing; set is a no-op when unchanged", () => {
  const env = boot();
  const s = env.NB.store;
  assert.equal(s.get("nope", 7), 7);
  assert.equal(s.set("fc-state", { a: { box: 1 } }), true);
  assert.deepEqual(plain(s.get("fc-state", {})), { a: { box: 1 } });
  let calls = 0; s.onChange(() => calls++);
  s.set("fc-state", { a: { box: 1 } });
  assert.equal(calls, 0, "unchanged value fires no change");
  s.set("fc-state", { a: { box: 2 } });
  assert.equal(calls, 1);
});

test("existing data written by the old helpers reads back unchanged", () => {
  const old = { "fc-state": JSON.stringify({ c1: { box: 3, due: "2026-11-20", seen: 4 } }), "quizlog": "[]", "chk:bio::x": "{\"c\":true,\"r\":\"g\"}" };
  const env = boot(old);
  assert.deepEqual(plain(env.NB.store.get("fc-state")), { c1: { box: 3, due: "2026-11-20", seen: 4 } });
  assert.deepEqual(plain(env.NB.store.get("chk:bio::x")), { c: true, r: "g" });
  assert.equal(env.storage.getItem("fc-state"), old["fc-state"], "reading never rewrites");
});

test("corrupt JSON is quarantined (raw kept), default returned, banner shown", () => {
  const env = boot({ "fc-state": "{not json" });
  const s = env.NB.store;
  assert.deepEqual(plain(s.get("fc-state", {})), {});
  assert.equal(env.storage.getItem("fc-state"), null, "moved out of the way");
  const q = JSON.parse(env.storage.getItem("nb-corrupt:fc-state"));
  assert.equal(q[0].raw, "{not json");
  assert.match(env.bannerText(), /set aside/);
  // the same corrupt text arriving again is not duplicated
  env.storage.setItem("fc-state", "{not json");
  s.get("fc-state", {});
  assert.equal(JSON.parse(env.storage.getItem("nb-corrupt:fc-state")).length, 1);
});

test("corrupt value is left untouched when it can't be quarantined (storage full)", () => {
  const raw = "{broken" + "x".repeat(50);
  const env = makeEnv({ storage: new FakeStorage({ "q-errors": raw }, raw.length + 20 + 12) }).load("store.js");
  env.NB.store.get("q-errors", []);
  assert.equal(env.storage.getItem("q-errors"), raw);
  assert.match(env.bannerText(), /left untouched/);
});

test("quota exceeded: set returns false, value unchanged, visible banner", () => {
  const env = boot({}, 200);
  const s = env.NB.store;
  assert.equal(s.set("fc-user", [{ id: "u1" }]), true);
  assert.equal(s.set("fc-user", [{ id: "u1", big: "y".repeat(500) }]), false);
  assert.deepEqual(plain(s.get("fc-user")), [{ id: "u1" }]);
  assert.match(env.bannerText(), /Storage is full/);
});

test("synced writes are marked dirty with a timestamp; silent and local-only writes are not", () => {
  const env = boot();
  const s = env.NB.store;
  s.set("fc-state", { a: 1 });
  s.set("chk:bio::a", { c: true, r: "" });
  s.set("chk:bio::b", { c: false, r: "" }, { silent: true });
  s.set("fc-theme", "dark");
  s.set("week:2", "revise");
  const d = plain(s.dirty());
  assert.deepEqual(Object.keys(d).sort(), ["chk:bio::a", "fc-state", "week:2"]);
  assert.ok(d["fc-state"] > 0);
  assert.ok(env.storage.getItem("nb-dirty"), "markers persisted in localStorage");
});

test("clearDirty only clears markers at or before the given time", () => {
  const env = boot({ "nb-dirty": JSON.stringify({ a: 100, b: 300 }) });
  env.NB.store.clearDirty(["a", "b"], 200);
  assert.deepEqual(plain(env.NB.store.dirty()), { b: 300 });
});

test("snapshots: ring of 3, raw values kept, local-only keys excluded", () => {
  const env = boot({ "fc-state": "{\"a\":1}", "nb-token": "secret", "q-errors": "[]" });
  const s = env.NB.store;
  const ids = [1, 2, 3, 4].map(i => s.snapshot("test " + i));
  assert.ok(ids.every(Boolean));
  const list = s.snapshots();
  assert.equal(list.length, 3);
  assert.equal(list[0].reason, "test 4");
  const snap = s.getSnapshot(list[0].id);
  assert.equal(snap.keys["fc-state"], "{\"a\":1}");
  assert.equal(snap.keys["nb-token"], undefined);
  const only = s.snapshot("one key", ["q-errors"]);
  assert.deepEqual(Object.keys(s.getSnapshot(only).keys), ["q-errors"]);
});

test("schema: fresh and legacy stores are stamped v1; migrations run in order once", () => {
  const env = boot({ "fc-state": "{}" });
  const s = env.NB.store;
  assert.equal(env.storage.getItem("nb-schema"), "1");
  env.storage.setItem("x-count", "0");
  const order = [];
  const steps = [
    { to: 2, touches: ["x-count"], run(st) { order.push(2); st.set("x-count", st.get("x-count") + 1, { silent: true }); } },
    { to: 3, touches: [], run() { order.push(3); } }
  ];
  assert.equal(s.migrate(steps), 3);
  assert.equal(s.migrate(steps), 3, "idempotent");
  assert.deepEqual(order, [2, 3]);
  assert.equal(env.storage.getItem("x-count"), "1");
  assert.ok(s.snapshots().some(x => x.reason === "before migration to v2"), "touched keys snapshotted first");
});

test("schema: a failing migration stops the chain and keeps the version", () => {
  const env = boot();
  const s = env.NB.store;
  const v = s.migrate([{ to: 2, run() { throw new Error("boom"); } }, { to: 3, run() {} }]);
  assert.equal(v, 1);
  assert.equal(env.storage.getItem("nb-schema"), "1");
  assert.match(env.bannerText(), /failed/);
});

test("schema: data from a newer app version is not touched", () => {
  const env = boot({ "nb-schema": "99" });
  assert.equal(env.storage.getItem("nb-schema"), "99");
  assert.match(env.bannerText(), /newer version/);
});

test("merge.union keeps everything from both sides", () => {
  const { union } = boot().NB.merge;
  assert.deepEqual(plain(union("fc-user", [{ id: "u1", front: "A" }], [{ id: "u1", front: "B" }, { id: "u2" }])), [{ id: "u1", front: "A" }, { id: "u2" }]);
  assert.deepEqual(plain(union("fc-deleted", ["a"], ["b", "a"])), ["a", "b"]);
  assert.deepEqual(plain(union("tok-objects", { items: [{ t: "x" }] }, { items: [{ t: "y" }, { t: "x", done: true }] })), { items: [{ t: "x" }, { t: "y" }] });
  assert.deepEqual(plain(union("ia-debriefs", { nov: { rd: "mine" } }, { nov: { rd: "theirs", da: "d" }, jan: {} })), { nov: { rd: "mine", da: "d" }, jan: {} });
  assert.deepEqual(plain(union("chk:a", { c: false, r: "" }, { c: true, r: "g" })), { c: true, r: "g" }, "default row loses");
  assert.deepEqual(plain(union("chk:a", { c: false, r: "r" }, { c: true, r: "g" })), { c: false, r: "r" }, "a real choice wins");
  assert.equal(union("week:1", "", "plan"), "plan");
  assert.deepEqual(plain(union("q-errors", null, [{ key: "k" }])), [{ key: "k" }]);
  // field-aware q-errors merge: a wins, the loser's unique fields fill in
  assert.deepEqual(plain(union("q-errors",
    [{ key: "k", ts: 9, reflection: "watch the sign" }],
    [{ key: "k", ts: 3, errorType: "misread", retries: [{ ts: 1, correct: false }] }])),
    [{ key: "k", ts: 9, reflection: "watch the sign", errorType: "misread", retries: [{ ts: 1, correct: false }] }]);
});

test("merge.RECORDS.quizlog: union, newest first, never truncates below input size", () => {
  const { RECORDS } = boot().NB.merge;
  const a = [{ date: "2026-11-18", label: "A", got: 1, max: 2, pct: 50 }];
  const b = [{ date: "2026-11-17", label: "B", got: 2, max: 2, pct: 100 }, a[0]];
  assert.deepEqual(plain(RECORDS.quizlog(a, b)).map(e => e.label), ["A", "B"]);
});

// ── per-user scope layer (setScope/scope) ──────────────────────────────────

test("scope: get/set/remove/keys translate through the active user", () => {
  const env = boot();
  const s = env.NB.store;
  assert.equal(s.scope(), null, "legacy view before any login");
  assert.equal(s.setScope("bad name!"), false, "invalid username refused");
  assert.equal(s.setScope("u1"), true);
  assert.equal(s.scope(), "u1");
  s.set("fc-state", { a: 1 });
  assert.equal(env.storage.getItem("fc-state"), null, "nothing under the plain key");
  assert.equal(env.storage.getItem("u1:fc-state"), JSON.stringify({ a: 1 }), "physically scoped");
  assert.deepEqual(plain(s.get("fc-state")), { a: 1 });
  // keys() speaks logical names; the scoped dirty map shows up just like the
  // global one always did in the legacy view (progressKeys filters it out)
  assert.deepEqual(plain(s.keys().sort()), ["fc-state", "nb-dirty"]);
  assert.deepEqual(plain(s.keys("fc")), ["fc-state"]);
  s.remove("fc-state");
  assert.equal(env.storage.getItem("u1:fc-state"), null);
  assert.deepEqual(plain(s.keys()), ["nb-dirty"]);
});

test("scope: reserved keys stay global and are hidden from keys()", () => {
  const env = boot({ "nb-token": "tok", "nb-schema": "1" });
  const s = env.NB.store;
  s.setScope("u1");
  assert.equal(s.getRaw("nb-token"), "tok", "reserved reads are never scoped");
  s.setRaw("nb-api", "https://x");
  assert.equal(env.storage.getItem("nb-api"), "https://x", "reserved writes land globally");
  assert.ok(s.keys().indexOf("nb-token") < 0 && s.keys().indexOf("nb-api") < 0 && s.keys().indexOf("nb-schema") < 0);
  assert.deepEqual(plain(s.keys()), [], "and no user data exists yet");
});

test("scope: dirty markers live in the active user's nb-dirty", () => {
  const env = boot();
  const s = env.NB.store;
  s.setScope("u1");
  s.set("fc-state", { a: 1 }); // synced, non-silent → marked dirty
  assert.deepEqual(Object.keys(plain(s.dirty())), ["fc-state"]);
  assert.equal(env.storage.getItem("nb-dirty"), null, "nothing in a global dirty map");
  assert.deepEqual(Object.keys(JSON.parse(env.storage.getItem("u1:nb-dirty"))), ["fc-state"]);
  s.clearDirty(["fc-state"]);
  assert.equal(env.storage.getItem("u1:nb-dirty"), "{}");
});

test("scope: the snapshot ring is per user", () => {
  const env = boot({ "fc-state": "{\"a\":1}" });
  const s = env.NB.store;
  s.setScope("u1"); // adoption moves the legacy fc-state into u1 first (and snapshots it)
  const id = s.snapshot("scoped");
  assert.match(id, /^nb-backup:/, "callers keep seeing logical ids");
  assert.ok(env.storage.getItem("u1:" + id), "stored inside the user's scope");
  // newest first: the scoped copy, then the adoption's safety copy of the legacy data
  assert.deepEqual(plain(s.snapshots().map(x => x.reason)), ["scoped", "before per-user storage migration"]);
  assert.equal(env.storage.getItem(id), null, "no unscoped copy");
  assert.equal(s.getSnapshot(id).keys["fc-state"], "{\"a\":1}");
});

test("scope: nb-active-user persists; a fresh boot re-enters the same scope", () => {
  const env = boot();
  env.NB.store.setScope("u1");
  env.NB.store.set("fc-state", { a: 2 });
  assert.equal(env.storage.getItem("nb-active-user"), "u1");
  const env2 = makeEnv({ storage: env.storage }).load("store.js");
  assert.equal(env2.NB.store.scope(), "u1");
  assert.deepEqual(plain(env2.NB.store.get("fc-state")), { a: 2 });
  assert.deepEqual(plain(env2.NB.store.keys().filter(k => !env2.NB.store.isLocalOnly(k))), ["fc-state"]);
});

test("scope: one-time adoption moves legacy data into the account that owns it", () => {
  const env = boot({ "fc-state": "{\"legacy\":1}", "quizlog": "[]", "nb-sync": JSON.stringify({ user: "alice", rev: 3, legacy: false }) });
  const s = env.NB.store;
  s.setScope("bob"); // nb-sync says alice last synced here → the legacy data is alice's
  const st = env.storage.dump();
  assert.equal(st["fc-state"], undefined, "legacy keys moved away");
  assert.equal(st["alice:fc-state"], "{\"legacy\":1}", "byte-for-byte into the owner's scope");
  assert.equal(st["alice:quizlog"], "[]");
  assert.equal(st["nb-scoped-v2"], "1", "marker set — runs once");
  assert.equal(st["nb-active-user"], "bob");
  const snapId = Object.keys(st).find(k => /^alice:nb-backup:/.test(k));
  assert.ok(snapId, "safety snapshot in the owner's backup ring");
  const snap = JSON.parse(st[snapId]);
  assert.equal(snap.reason, "before per-user storage migration");
  assert.equal(snap.keys["fc-state"], "{\"legacy\":1}", "raw values kept");
  assert.equal(s.get("fc-state", null), null, "bob's scope stays empty — no union from alice");
  s.setScope("alice");
  assert.deepEqual(plain(s.get("fc-state")), { legacy: 1 }, "alice's scope shows the adopted data");
  assert.equal(Object.keys(st).filter(k => /^alice:nb-backup:/.test(k)).length, 1, "no second adoption snapshot");
});

test("scope: adoption postponed (banner) when the safety copy can't be saved", () => {
  const raw = "{\"big\":\"" + "x".repeat(200) + "\"}";
  const env = makeEnv({ storage: new FakeStorage({ "fc-state": raw }, raw.length + 50) }).load("store.js");
  const s = env.NB.store;
  assert.equal(s.setScope("u1"), true, "the scope still switches: an empty scope never uploads another user's data");
  assert.match(env.bannerText(), /safety copy/);
  assert.equal(env.storage.getItem("fc-state"), raw, "legacy key untouched");
  assert.equal(env.storage.getItem("nb-scoped-v2"), null, "marker unset → retried on the next setScope");
  assert.equal(s.get("fc-state", null), null, "the scoped view does not fall back to the legacy key");
});

test("scope: a per-key move failure is not marked complete; the retry finishes it", () => {
  class Flaky extends FakeStorage {
    constructor(init) { super(init); this.failsLeft = 1; } // transient quota pressure: one write, then room appears
    setItem(k, v) {
      if (k === "u1:quizlog" && this.failsLeft > 0) { this.failsLeft--; const e = new Error("quota"); e.name = "QuotaExceededError"; e.code = 22; throw e; }
      return super.setItem(k, v);
    }
  }
  const env = makeEnv({ storage: new Flaky({ "fc-state": "{\"legacy\":1}", "quizlog": "[]" }) }).load("store.js");
  const s = env.NB.store;
  assert.equal(s.setScope("u1"), true, "the scope still switches");
  let st = env.storage.dump();
  assert.equal(env.storage.getItem("nb-scoped-v2"), null, "not marked complete while a key is left behind");
  assert.equal(st["nb-scoped-pending"], "u1", "the rightful owner is pinned for the retry");
  assert.equal(st["fc-state"], undefined, "the key that moved is gone from the flat namespace");
  assert.equal(st["quizlog"], "[]", "the key that failed stays in the flat namespace (covered by the safety snapshot)");
  assert.equal(st["u1:quizlog"], undefined, "no half-written scoped copy");
  // the next setScope — even in a fresh session — finishes the pinned move
  const env2 = makeEnv({ storage: env.storage }).load("store.js");
  assert.equal(env2.NB.store.scope(), "u1", "fresh boot re-enters the scope via nb-active-user");
  env2.NB.store.setScope("u1");
  st = env2.storage.dump();
  assert.equal(st["nb-scoped-v2"], "1", "completes on retry");
  assert.equal(st["nb-scoped-pending"], undefined, "pin released");
  assert.equal(st["quizlog"], undefined, "flat namespace is clean");
  assert.equal(Object.keys(st).some(k => k.indexOf("u1:u1:") === 0), false, "no double-prefixed orphans — already-scoped keys were not re-moved");
  assert.deepEqual(plain(env2.NB.store.get("quizlog")), [], "the retried key is visible in scope");
  assert.deepEqual(plain(env2.NB.store.get("fc-state")), { legacy: 1 }, "the earlier moved key is untouched");
});

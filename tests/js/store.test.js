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
});

test("merge.RECORDS.quizlog: union, newest first, never truncates below input size", () => {
  const { RECORDS } = boot().NB.merge;
  const a = [{ date: "2026-11-18", label: "A", got: 1, max: 2, pct: 50 }];
  const b = [{ date: "2026-11-17", label: "B", got: 2, max: 2, pct: 100 }, a[0]];
  assert.deepEqual(plain(RECORDS.quizlog(a, b)).map(e => e.label), ["A", "B"]);
});

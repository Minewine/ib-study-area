// Per-record merge rules as used by sync (auth.js mergeValue → NB.merge.RECORDS).
// Run: node --test tests/js/*.test.js   (no dependencies)
const assert = require("assert");
const nodeTest = require("node:test");
const { makeEnv } = require("./harness");
const env = makeEnv({ fetch: () => Promise.reject(new Error("offline")) }).load("store.js").load("auth.js");
const ctx = env.ctx;
const M = ctx.window.Auth.mergeValue;
const t = (name, fn) => nodeTest(name, fn);

t("fc-state: union of cards from both devices", () => {
  const a = { c1: { box: 2, due: "2026-11-20", seen: 2, t: 100 } };
  const b = { c2: { box: 1, due: "2026-11-19", seen: 1, t: 50 } };
  assert.strictEqual(JSON.stringify(Object.keys(M("fc-state", a, b)).sort()), JSON.stringify(["c1", "c2"]));
});
t("fc-state: newest timestamp wins per card", () => {
  const local = { c1: { box: 3, due: "2026-11-25", seen: 3, t: 200 }, c2: { box: 1, due: "x", seen: 1, t: 10 } };
  const server = { c1: { box: 2, due: "2026-11-21", seen: 2, t: 100 }, c2: { box: 4, due: "y", seen: 4, t: 300 } };
  const m = M("fc-state", local, server);
  assert.strictEqual(m.c1.box, 3); assert.strictEqual(m.c2.box, 4);
});
t("fc-state: legacy entries (no t) ranked by seen, never dropped", () => {
  const local = { c1: { box: 1, due: "2026-11-19", seen: 5 } };
  const server = { c1: { box: 3, due: "2026-11-30", seen: 2 }, c9: { box: 1, due: "a", seen: 1 } };
  const m = M("fc-state", local, server);
  assert.strictEqual(m.c1.seen, 5); assert.ok(m.c9);
});
t("fc-state: timestamped review beats legacy entry", () => {
  const m = M("fc-state", { c1: { box: 1, due: "d", seen: 1, t: 5 } }, { c1: { box: 5, due: "e", seen: 9 } });
  assert.strictEqual(m.c1.t, 5);
});
t("fc-state: tie keeps server value (old behaviour)", () => {
  const m = M("fc-state", { c1: { box: 1, due: "d", seen: 1 } }, { c1: { box: 2, due: "d", seen: 1 } });
  assert.strictEqual(m.c1.box, 2);
});
t("q-errors: union by key, newest ts wins", () => {
  const local = [{ key: "bank-a#b01", attempts: 3, ts: 300, resolved: true }, { key: "bank-a#b02", attempts: 1, ts: 1 }];
  const server = [{ key: "bank-a#b01", attempts: 2, ts: 200, resolved: false }, { key: "bank-b#b01", attempts: 1, ts: 5 }];
  const m = M("q-errors", local, server);
  assert.strictEqual(m.length, 3);
  assert.strictEqual(m.find(e => e.key === "bank-a#b01").resolved, true);
});
t("q-errors: legacy records ranked by dates/attempts", () => {
  const m = M("q-errors", [{ key: "b01", lastMissed: "2026-11-10", attempts: 1 }], [{ key: "b01", lastMissed: "2026-11-15", attempts: 2 }]);
  assert.strictEqual(m[0].lastMissed, "2026-11-15");
});
t("q-errors: renamed record doesn't come back under its legacy key", () => {
  const local = [{ key: "bio-unity-diversity-cells#b01", legacyKey: "b01", ts: 9 }];
  const server = [{ key: "b01", attempts: 1 }];
  const m = M("q-errors", local, server);
  assert.strictEqual(JSON.stringify(m.map(e => e.key)), JSON.stringify(["bio-unity-diversity-cells#b01"]));
});
t("missing local/server values fall back safely", () => {
  assert.strictEqual(JSON.stringify(M("q-errors", null, [{ key: "x" }])), JSON.stringify([{ key: "x" }]));
  assert.strictEqual(JSON.stringify(M("q-errors", [{ key: "x" }], undefined)), JSON.stringify([{ key: "x" }]));
  assert.strictEqual(JSON.stringify(M("fc-state", { a: { seen: 1 } }, null)), JSON.stringify({ a: { seen: 1 } }));
});
t("non-merge keys keep server-wins behaviour", () => {
  assert.strictEqual(JSON.stringify(M("tok-objects", { items: [1] }, { items: [2] })), JSON.stringify({ items: [2] }));
  assert.strictEqual(JSON.stringify(M("quizlog", [{ date: "b" }], [{ date: "a" }])), JSON.stringify([{ date: "b" }, { date: "a" }]), "quizlog is now a union");
});


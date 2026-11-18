// node --test tests/js — loss-proof sync in assets/auth.js against an in-memory
// server: offline then online, write-then-navigate, two devices / stale tab,
// first login with local data, `me` failing, legacy server, storage full.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeEnv, FakeStorage, plain } = require("./harness");
const { FakeServer } = require("./fake-server");

const tick = (ms) => new Promise(r => setTimeout(r, ms || 15));

// a "device": its own localStorage, loading store.js + auth.js like a page does
async function device(server, data, opts) {
  opts = opts || {};
  const storage = opts.storage || new FakeStorage(data);
  const env = makeEnv({ storage, fetch: (...a) => server.fetchFor()(...a), setTimeout: opts.setTimeout });
  env.load("store.js").load("auth.js");
  await tick(30);
  return env;
}
const loggedIn = (rev, extra) => Object.assign({ "nb-token": "tok-1", "nb-sync": JSON.stringify({ user: "tester", rev: rev, legacy: false }) }, extra || {});
const J = JSON.stringify;
const get = (env, k) => plain(env.NB.store.get(k, null));

test("offline reviews survive: not overwritten by the older server copy on the next load", async () => {
  const server = new FakeServer({ rev: 3, state: { "fc-state": { c1: { box: 1, due: "2026-11-19", seen: 1, t: 100 } }, quizlog: [{ date: "2026-11-01", label: "old", got: 1, max: 2, pct: 50 }] } });
  server.online = false;
  const env = await device(server, loggedIn(3, { "fc-state": server.state["fc-state"] && J(server.state["fc-state"]), quizlog: J(server.state.quizlog) }));
  // studying offline: two reviews + a session log entry
  env.NB.store.set("fc-state", { c1: { box: 2, due: "2026-11-21", seen: 2, t: 200 }, c2: { box: 1, due: "2026-11-19", seen: 1, t: 210 } });
  env.NB.store.set("quizlog", [{ date: "2026-11-18", label: "offline", got: 2, max: 2, pct: 100 }].concat(server.state.quizlog));
  assert.deepEqual(Object.keys(plain(env.NB.store.dirty())).sort(), ["fc-state", "quizlog"]);
  // next page load, online again
  server.online = true;
  const env2 = await device(server, null, { storage: env.storage });
  assert.equal(server.state["fc-state"].c1.box, 2);
  assert.ok(server.state["fc-state"].c2);
  assert.equal(server.state.quizlog[0].label, "offline");
  assert.deepEqual(plain(env2.NB.store.dirty()), {}, "markers cleared after the push");
  assert.equal(get(env2, "fc-state").c1.box, 2);
});

test("write then navigate within the debounce: pagehide flush (keepalive) saves it", async () => {
  const server = new FakeServer({ rev: 1, state: { quizlog: [] } });
  const env = await device(server, loggedIn(1, { quizlog: "[]" }));
  env.NB.store.set("quizlog", [{ date: "2026-11-18", label: "just now", got: 1, max: 1, pct: 100 }]);
  env.fire("window", "pagehide");
  await tick();
  const last = server.saves[server.saves.length - 1];
  assert.ok(last && last.keepalive, "sent with keepalive");
  assert.deepEqual(Object.keys(last.body.state), ["quizlog"], "only the changed key");
  assert.equal(last.body.base_rev, 1);
  assert.equal(server.state.quizlog[0].label, "just now");
});

test("write then navigate while offline: markers persist and the next load pushes", async () => {
  const server = new FakeServer({ rev: 1, state: { "tok-objects": { items: [] } } });
  const env = await device(server, loggedIn(1, { "tok-objects": J({ items: [] }) }));
  server.online = false;
  env.NB.store.set("tok-objects", { items: [{ t: "a photo", done: false }] });
  env.fire("window", "pagehide");
  await tick();
  server.online = true;
  await device(server, null, { storage: env.storage });
  assert.deepEqual(server.state["tok-objects"], { items: [{ t: "a photo", done: false }] });
});

test("two devices: a stale device gets 409, merges, retries — both devices' work kept", async () => {
  const server = new FakeServer({ rev: 0, state: null });
  const a = await device(server, loggedIn(0));
  const b = await device(server, loggedIn(0));
  a.NB.store.set("fc-state", { c1: { box: 2, due: "d", seen: 1, t: 10 } });
  assert.equal(await a.ctx.window.Auth.pushNow(true), true);
  // B never saw A's save (stale tab): reviews another card and adds a missed question
  b.NB.store.set("fc-state", { c2: { box: 1, due: "d", seen: 1, t: 20 } });
  b.NB.store.set("q-errors", [{ key: "bank#q1", ts: 30 }]);
  assert.equal(await b.ctx.window.Auth.pushNow(true), true);
  assert.deepEqual(Object.keys(server.state["fc-state"]).sort(), ["c1", "c2"]);
  assert.deepEqual(server.state["q-errors"], [{ key: "bank#q1", ts: 30 }]);
  assert.deepEqual(Object.keys(get(b, "fc-state")).sort(), ["c1", "c2"], "B now holds A's review too");
  // same card on both: newest review wins
  a.NB.store.set("fc-state", Object.assign(get(a, "fc-state"), { c2: { box: 3, due: "e", seen: 2, t: 99 } }));
  await a.ctx.window.Auth.pushNow(true);
  assert.equal(server.state["fc-state"].c2.box, 3);
});

test("untouched keys take the server value (deletions elsewhere stick), with a local snapshot", async () => {
  const server = new FakeServer({ rev: 5, state: { "fc-user": [{ id: "u2" }] } });
  const env = await device(server, loggedIn(4, { "fc-user": J([{ id: "u1" }, { id: "u2" }]) }));
  assert.deepEqual(get(env, "fc-user"), [{ id: "u2" }]);
  const snaps = env.NB.store.snapshots();
  assert.equal(snaps.length, 1);
  assert.equal(env.NB.store.getSnapshot(snaps[0].id).keys["fc-user"], J([{ id: "u1" }, { id: "u2" }]));
  assert.equal(env.ctx.reloads, 0); // reload is scheduled via setTimeout 300 ms
  await tick(350);
  assert.equal(env.ctx.reloads, 1, "page reloads so engines re-read");
});

test("a key this device changed (dirty) keeps the local value and is pushed", async () => {
  const server = new FakeServer({ rev: 5, state: { "res-bookmarks": ["a", "b"] } });
  const env = await device(server, loggedIn(4, { "res-bookmarks": J(["a"]), "nb-dirty": J({ "res-bookmarks": 1 }) }));
  assert.deepEqual(get(env, "res-bookmarks"), ["a"]);
  assert.deepEqual(server.state["res-bookmarks"], ["a"]);
});

test("first login on a device with local progress: union, nothing lost", async () => {
  const server = new FakeServer({ rev: 2, state: {
    "fc-state": { c1: { box: 4, due: "x", seen: 5, t: 50 } },
    "fc-user": [{ id: "u-server" }],
    "site-state": { checklists: { "chk:bio::a": { c: true, r: "g" } }, week: {} }
  } });
  const env = await device(server, {
    "fc-state": J({ c2: { box: 2, due: "y", seen: 2 } }),
    "fc-user": J([{ id: "u-local" }]),
    "chk:bio::a": J({ c: false, r: "" }),        // default row
    "chk:bio::b": J({ c: true, r: "a" }),        // real local tick
    quizlog: J([{ date: "2026-11-10", label: "local", got: 1, max: 1, pct: 100 }])
  });
  await env.ctx.window.Auth.login("tester", "pw");
  await tick(30);
  assert.deepEqual(Object.keys(get(env, "fc-state")).sort(), ["c1", "c2"]);
  assert.deepEqual(get(env, "fc-user").map(c => c.id).sort(), ["u-local", "u-server"]);
  assert.deepEqual(get(env, "chk:bio::a"), { c: true, r: "g" }, "server tick beats the local default");
  assert.deepEqual(server.state["site-state"].checklists["chk:bio::b"], { c: true, r: "a" });
  assert.equal(server.state.quizlog[0].label, "local");
  assert.deepEqual(server.state["fc-user"].map(c => c.id).sort(), ["u-local", "u-server"]);
  assert.ok(env.NB.store.snapshots().length >= 1, "local copy snapshotted before merging");
});

test("first login on an empty account uploads this device's data", async () => {
  const server = new FakeServer({ rev: 0, state: null });
  const env = await device(server, { "q-errors": J([{ key: "b#1" }]), "chk:x::1": J({ c: false, r: "" }) });
  await env.ctx.window.Auth.login("tester", "pw");
  await tick(30);
  assert.deepEqual(server.state["q-errors"], [{ key: "b#1" }]);
  assert.equal(server.state["site-state"], undefined, "default-only rows are not pushed");
});

test("`me` failing (offline at load): writes are still marked and pushed once back", async () => {
  const server = new FakeServer({ rev: 1, state: { "fc-state": {} } });
  server.online = false;
  const env = await device(server, loggedIn(1, { "fc-state": "{}" }));
  assert.equal(env.ctx.window.Auth.user(), null);
  env.NB.store.set("fc-state", { c9: { box: 1, due: "z", seen: 1, t: 5 } });
  assert.ok(plain(env.NB.store.dirty())["fc-state"]);
  server.online = true;
  env.fire("window", "online");
  await tick(40);
  assert.ok(server.state["fc-state"].c9);
});

test("checklist default rows written on page load are never pushed over another device's ticks", async () => {
  const server = new FakeServer({ rev: 2, state: { "site-state": { checklists: { "chk:m::1": { c: true, r: "g" } }, week: {} } } });
  // app.js runs before auth.js boots and writes default rows silently (no dirty marker)
  const env = await device(server, loggedIn(1, { "chk:m::1": J({ c: false, r: "" }), "chk:m::2": J({ c: false, r: "" }) }));
  assert.deepEqual(get(env, "chk:m::1"), { c: true, r: "g" }, "the server tick replaces the local default");
  env.NB.store.set("week:0", "revise C1.1"); // a real change → full site-state push
  await env.ctx.window.Auth.pushNow(true);
  assert.deepEqual(server.state["site-state"].checklists["chk:m::1"], { c: true, r: "g" });
  assert.equal(server.state["site-state"].week["week:0"], "revise C1.1");
});

test("legacy server (no revisions): full payload with the server's other keys carried over", async () => {
  const server = new FakeServer({ legacy: true, state: { "fc-state": { c1: { box: 1, seen: 1 } }, "future-key": { keep: 1 } } });
  const env = await device(server, loggedIn(null, { "nb-sync": J({ user: "tester", rev: null, legacy: true }) }));
  env.NB.store.set("quizlog", [{ date: "2026-11-18", label: "x", got: 1, max: 1, pct: 100 }]);
  await env.ctx.window.Auth.pushNow(true);
  assert.deepEqual(server.state["future-key"], { keep: 1 });
  assert.deepEqual(server.state["fc-state"], { c1: { box: 1, seen: 1 } });
  assert.equal(server.state.quizlog[0].label, "x");
  assert.equal(server.saves[server.saves.length - 1].body.base_rev, undefined);
});

test("storage full: a key that can't be snapshotted is neither replaced nor pushed", async () => {
  const big = J([{ id: "u1", pad: "p".repeat(300) }]);
  const server = new FakeServer({ rev: 3, state: { "fc-user": [{ id: "u9" }], "q-errors": [{ key: "s#1", ts: 1 }] } });
  const init = loggedIn(2, { "fc-user": big, "q-errors": J([{ key: "l#1", ts: 2 }]) });
  const used = Object.entries(init).reduce((n, [k, v]) => n + k.length + v.length, 0);
  const storage = new FakeStorage(init, used + 150); // room for bookkeeping, not for a snapshot
  const env = await device(server, null, { storage });
  assert.equal(storage.getItem("fc-user"), big, "left untouched");
  assert.notDeepEqual(server.state["fc-user"], JSON.parse(big), "unmerged local copy not pushed");
  assert.match(env.bannerText(), /safety copy/);
});

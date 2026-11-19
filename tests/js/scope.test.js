// node --test tests/js — per-user data isolation through auth.js: one-time
// legacy adoption on login, a second account on a used browser starts empty,
// dirty markers never leak across accounts, account switching, logged-out
// writes land in the last active user's scope. Same device()/FakeServer
// harness as sync.test.js.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeEnv, FakeStorage, plain } = require("./harness");
const { FakeServer } = require("./fake-server");

const tick = (ms) => new Promise(r => setTimeout(r, ms || 15));
const J = JSON.stringify;
const get = (env, k) => plain(env.NB.store.get(k, null));

// a "device": its own localStorage, loading store.js + auth.js like a page does
async function device(server, data, opts) {
  opts = opts || {};
  const storage = opts.storage || new FakeStorage(data);
  const env = makeEnv({ storage, fetch: (...a) => server.fetchFor()(...a), setTimeout: opts.setTimeout });
  env.load("store.js").load("auth.js");
  await tick(30);
  return env;
}
const login = (env, u, pw) => env.ctx.window.Auth.login(u, pw || "pw");
const logout = (env) => env.ctx.window.Auth.logout();

test("login adopts the legacy flat data into the logging-in user's scope", async () => {
  const server = new FakeServer({ rev: 0, state: null });
  const fc = { c1: { box: 1, due: "d", seen: 1 } };
  const env = await device(server, { "fc-state": J(fc), quizlog: "[]" });
  await login(env, "tester");
  await tick(30);
  const st = env.storage.dump();
  assert.equal(st["fc-state"], undefined, "the legacy key is gone from the flat namespace");
  assert.equal(st["tester:fc-state"], J(fc), "moved byte-for-byte");
  assert.equal(st["nb-scoped-v2"], "1", "one-time marker set");
  assert.equal(st["nb-active-user"], "tester");
  assert.ok(Object.keys(st).some(k => /^tester:nb-backup:/.test(k)), "safety snapshot taken");
  assert.equal(get(env, "fc-state").c1.box, 1, "visible under the new scope");
  assert.deepEqual(server.state["fc-state"], fc, "seeded to the (empty) account from its own scope");
});

test("a second user on a used browser starts empty; the first user's data stays theirs", async () => {
  const server = new FakeServer({ users: { alice: "pw", bob: "pw" } });
  const fc = { c1: { box: 2, due: "d", seen: 2 } };
  const env = await device(server, { "fc-state": J(fc) });
  await login(env, "alice");
  await tick(30);
  assert.equal(env.storage.getItem("nb-active-user"), "alice");
  assert.ok(server.accts.alice.state && server.accts.alice.state["fc-state"], "alice's device seeded her account");
  const savesBefore = server.saves.length;
  await logout(env); await tick(30);
  await login(env, "bob");
  await tick(30);
  assert.equal(env.storage.getItem("nb-active-user"), "bob");
  assert.equal(get(env, "fc-state"), null, "bob's scope is empty — no union from alice");
  assert.equal(server.accts.bob.state, null, "bob's empty account did not receive alice's keys");
  assert.equal(server.saves.length, savesBefore, "nothing was pushed for bob");
  assert.equal(env.storage.getItem("alice:fc-state"), J(fc), "alice's data intact in her scope");
  await logout(env); await tick(30);
  await login(env, "alice");
  await tick(30);
  assert.equal(get(env, "fc-state").c1.box, 2, "alice re-login sees her data");
});

test("an abandoned session's dirty markers don't leak into the next account's sync", async () => {
  const server = new FakeServer({ users: { alice: "pw", bob: "pw" } });
  const env = await device(server, {
    "nb-token": "tok-alice", "nb-sync": J({ user: "alice", rev: 0, legacy: false }),
    "fc-state": J({ a1: { box: 3, due: "d", seen: 3, t: 50 } }),
    "nb-dirty": J({ "fc-state": 1 })
  });
  await tick(30); // boot → connect: alice's session restored, adoption + seeding push
  assert.ok(server.accts.alice.state["fc-state"], "alice's own data reached her account");
  env.NB.store.set("quizlog", [{ date: "2026-11-18", label: "unsynced", got: 1, max: 1, pct: 100 }]); // dirty, session ends uncleanly
  await login(env, "bob");
  await tick(30);
  assert.equal(server.accts.bob.state, null, "bob's account received nothing");
  assert.equal(server.accts.alice.state.quizlog, undefined, "alice's unsynced quizlog was not pushed to bob");
  assert.equal(env.storage.getItem("alice:quizlog"), J([{ date: "2026-11-18", label: "unsynced", got: 1, max: 1, pct: 100 }]),
    "her markers and data sit in her own scope, waiting for her next login");
  assert.equal(env.storage.getItem("nb-dirty"), null, "no global dirty map anymore");
});

test("account switching: each user's writes stay in their own scope and account", async () => {
  const server = new FakeServer({ users: { alice: "pw", bob: "pw" } });
  const env = await device(server, {});
  await login(env, "alice"); await tick(30);
  env.NB.store.set("fc-state", { a1: { box: 1, due: "d", seen: 1, t: 10 } });
  await env.ctx.window.Auth.pushNow(true);
  await logout(env); await tick(30);
  await login(env, "bob"); await tick(30);
  env.NB.store.set("q-errors", [{ key: "b#1", ts: 5 }]);
  await env.ctx.window.Auth.pushNow(true);
  await logout(env); await tick(30);
  await login(env, "alice"); await tick(30);
  assert.deepEqual(get(env, "fc-state"), { a1: { box: 1, due: "d", seen: 1, t: 10 } }, "alice sees her own review");
  assert.equal(get(env, "q-errors"), null, "bob's missed questions are not visible to alice");
  assert.deepEqual(plain(server.accts.alice.state["fc-state"]), { a1: { box: 1, due: "d", seen: 1, t: 10 } });
  assert.equal(server.accts.alice.state["q-errors"], undefined, "nothing of bob's reached alice's account");
  assert.deepEqual(server.accts.bob.state["q-errors"], [{ key: "b#1", ts: 5 }]);
  assert.equal(env.storage.getItem("bob:q-errors"), J([{ key: "b#1", ts: 5 }]), "bob's data untouched on the device");
});

test("writes while logged out land in the last active user's scope", async () => {
  const server = new FakeServer({});
  const env = await device(server, {});
  await login(env, "tester"); await tick(30);
  await logout(env); await tick(30);
  const entry = { date: "2026-11-18", label: "offline", got: 1, max: 1, pct: 100 };
  env.NB.store.set("quizlog", [entry]); // nb-token is gone, nb-active-user is not
  assert.equal(env.storage.getItem("quizlog"), null, "not in the flat namespace");
  assert.equal(env.storage.getItem("tester:quizlog"), J([entry]), "in the last active user's scope");
  // a fresh page (no token) boots straight back into the same scope
  const env2 = await device(server, null, { storage: env.storage });
  assert.equal(env2.NB.store.scope(), "tester");
  assert.deepEqual(get(env2, "quizlog"), [entry]);
});

test("a username the scope layer refuses pauses sync entirely (no pull, no push)", async () => {
  // "Neva" (uppercase) can't exist on the real server; a slip there must fail
  // closed: without a valid scope, pulling would merge into the previous user's
  // local scope and pushes would send it to the wrong account.
  const server = new FakeServer({ users: { "Neva": "pw" } });
  const env = await device(server, {});
  await login(env, "Neva");
  await tick(30);
  const st = env.storage.dump();
  assert.equal(st["nb-active-user"], undefined, "the scope was never switched");
  assert.equal(Object.keys(st).some(k => k.indexOf("Neva:") === 0), false, "no scope was created for the malformed name");
  assert.match(env.bannerText(), /not a valid username/, "the refusal is announced visibly");
  env.NB.store.set("fc-state", { a: 1 }); // a write while sync is paused
  await env.ctx.window.Auth.pushNow(true);
  await tick(30);
  assert.equal(server.saves.length, 0, "nothing was pushed — the pull/push paths are closed");
});

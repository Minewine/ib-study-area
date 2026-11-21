// node --test tests/js/feedback.test.js — the Feedback widget (assets/feedback.js):
// payload shape + context assembly + validation, page context collection (bare
// DOM + a quiz-shaped page), submit against a scripted fetch, no fetch at load,
// and the CSP endpoint-host guard.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeEnv, plain } = require("./harness");

function envWith(opts) {
  return makeEnv(opts || {}).load("feedback.js");
}

function envFetch(fetchFn) {
  const calls = [];
  const e = makeEnv({ fetch: (...a) => { calls.push(a); return fetchFn(...a); } }).load("feedback.js");
  return { e, calls };
}

const VALID = { type: "bug", area: "quiz", title: "T", body: "B" };

test("buildPayload: full valid payload shape (app/key/type/area/title/body + context with user)", () => {
  const e = envWith();
  const p = plain(e.NB.feedback.buildPayload({
    type: "bug", area: "quiz", title: "  Timer stops  ", body: "\nThe timer froze.\n",
    context: { page: "quiz", subject: "biology-hl", topic: "A1.1 Water" }, user: "neva"
  }));
  assert.deepEqual(p, {
    app: "ibsystem", key: e.NB.feedback.config.appKey, type: "bug", area: "quiz",
    title: "Timer stops", body: "The timer froze.",
    context: { page: "quiz", subject: "biology-hl", topic: "A1.1 Water", user: "neva" }
  });
});

test("buildPayload context rules: context-only, user-only, neither, falsy fields dropped", () => {
  const e = envWith();
  const b = e.NB.feedback.buildPayload;
  assert.deepEqual(plain(b(Object.assign({}, VALID, { context: { page: "index" } }))).context, { page: "index" }, "context without user");
  assert.deepEqual(plain(b(Object.assign({}, VALID, { user: "neva" }))).context, { user: "neva" }, "user without context");
  assert.ok(!("context" in b(VALID)), "neither → no context key at all");
  const partial = plain(b(Object.assign({}, VALID, { context: { page: "", subject: "chemistry-hl", topic: null }, user: "" })));
  assert.deepEqual(partial.context, { subject: "chemistry-hl" }, "falsy context fields and empty user are dropped");
});

test("buildPayload validation: blank fields and unknown enum values throw friendly errors", () => {
  const e = envWith();
  const b = e.NB.feedback.buildPayload;
  assert.throws(() => b(Object.assign({}, VALID, { title: "" })), /title/i);
  assert.throws(() => b(Object.assign({}, VALID, { title: "   " })), /title/i);
  assert.throws(() => b(Object.assign({}, VALID, { body: "  " })), /describe/i);
  assert.throws(() => b(Object.assign({}, VALID, { type: "idea" })), /type/i);
  assert.throws(() => b(Object.assign({}, VALID, { area: "blog" })), /area/i);
  assert.throws(() => b({}), /type/i, "nothing at all → type is the first complaint");
});

test("buildPayload validation matrix: every valid type × area is accepted; each bad value (incl. case/whitespace) throws", () => {
  const e = envWith();
  const b = e.NB.feedback.buildPayload;
  for (const type of ["bug", "improvement", "feature"]) {
    for (const area of ["quiz", "cards", "today", "notes", "upload", "other"]) {
      const p = plain(b(Object.assign({}, VALID, { type, area })));
      assert.equal(p.type, type);
      assert.equal(p.area, area);
    }
  }
  // the widget shows "Idea" but sends "feature" (Signalbox's vocabulary); "idea" itself is not a valid type
  for (const bad of ["", null, "Bug", "BUG", "idea", "feature ", "bug ", "  "]) { // enums are exact, case- and space-sensitive
    assert.throws(() => b(Object.assign({}, VALID, { type: bad })), /type/i, "bad type " + JSON.stringify(String(bad)));
  }
  for (const bad of ["", null, "Quiz", "homepage", "cards ", "other "]) {
    assert.throws(() => b(Object.assign({}, VALID, { area: bad })), /area/i, "bad area " + JSON.stringify(String(bad)));
  }
});

test("buildPayload validation matrix: title and body must survive trimming; missing fields fail one check at a time", () => {
  const e = envWith();
  const b = e.NB.feedback.buildPayload;
  for (const bad of [undefined, "", "   ", "\n\t"]) {
    assert.throws(() => b(Object.assign({}, VALID, { title: bad })), /title/i, "bad title " + JSON.stringify(bad));
  }
  for (const bad of [undefined, "", "   "]) {
    assert.throws(() => b(Object.assign({}, VALID, { body: bad })), /describe/i, "bad body " + JSON.stringify(bad));
  }
  assert.throws(() => b({ type: "bug" }), /area/i, "missing area is the complaint when type is valid");
  assert.throws(() => b({ type: "bug", area: "quiz" }), /title/i, "missing title");
  assert.throws(() => b({ type: "bug", area: "quiz", title: "T" }), /describe/i, "missing body");
});

test("buildPayload: an empty or non-object context contributes nothing; context key is omitted when empty", () => {
  const e = envWith();
  const b = e.NB.feedback.buildPayload;
  assert.ok(!("context" in plain(b(Object.assign({}, VALID, { context: {} })))), "empty context object → key omitted");
  assert.ok(!("context" in plain(b(Object.assign({}, VALID, { context: { page: "", subject: "", topic: "" } })))), "all-blank context → key omitted");
  assert.ok(!("context" in plain(b(Object.assign({}, VALID, { context: "quiz" })))), "a non-object context is ignored");
  assert.ok(!("context" in plain(b(Object.assign({}, VALID, { user: 0 })))), "a non-string user is dropped");
  const p = plain(b(Object.assign({}, VALID, { context: { page: "cards", topic: "Cell division" }, user: "neva" })));
  assert.deepEqual(p.context, { page: "cards", topic: "Cell division", user: "neva" });
});

test("collectContext in the bare env: page from the fake location, null subject/topic, no throw", () => {
  const e = envWith(); // no store.js, no profile.js, no Auth
  assert.deepEqual(plain(e.NB.feedback.collectContext()), { page: "index", subject: null, topic: null });
});

test("collectContext on a quiz-shaped page: subject canonicalized, topic label from the option, * = null", () => {
  const e = makeEnv({ location: { pathname: "/nevaib/quiz.html" } }).load("profile.js").load("feedback.js");
  const sel = (id, value, opts) => {
    const s = e.document.createElement("select");
    s.id = id; s.value = value;
    (opts || []).forEach(o => { const op = e.document.createElement("option"); op.value = o[0]; op.textContent = o[1]; s.appendChild(op); });
    e.document.body.appendChild(s);
    return s;
  };
  sel("q-subject", "maths-aa-sl"); // legacy id → canonicalSubject must map it
  const qt = sel("q-topic", "a1-1", [["*", "Mixed"], ["a1-1", "A1.1 Water"]]);
  assert.deepEqual(plain(e.NB.feedback.collectContext()), { page: "quiz", subject: "math-aa-sl", topic: "A1.1 Water" });
  qt.value = "*";
  assert.equal(plain(e.NB.feedback.collectContext()).topic, null, "mixed (*) is not a topic");
});

test("collectContext on a notes-shaped URL: subject + topic from the query string, canonicalized", () => {
  const e = makeEnv({ location: { pathname: "/nevaib/notes.html", search: "?subject=french&topic=a1-1" } })
    .load("profile.js").load("feedback.js");
  assert.deepEqual(plain(e.NB.feedback.collectContext()), { page: "notes", subject: "french-a-langlit", topic: "a1-1" });
});

test("collectContext on a cards-shaped page: fc-subject canonicalized, fc-topic label from the option, * = null", () => {
  const e = makeEnv({ location: { pathname: "/nevaib/cards.html" } }).load("profile.js").load("feedback.js");
  const subj = e.document.createElement("select");
  subj.id = "fc-subject"; subj.value = "history"; // legacy checklist id → canonicalSubject must map it
  e.document.body.appendChild(subj);
  const t = e.document.createElement("select");
  t.id = "fc-topic"; t.value = "a1-1";
  [["*", "Mixed"], ["a1-1", "A1.1 Water"]].forEach(o => {
    const op = e.document.createElement("option"); op.value = o[0]; op.textContent = o[1]; t.appendChild(op);
  });
  e.document.body.appendChild(t);
  assert.deepEqual(plain(e.NB.feedback.collectContext()), { page: "cards", subject: "history-sl", topic: "A1.1 Water" });
  t.value = "*";
  assert.equal(plain(e.NB.feedback.collectContext()).topic, null, "mixed (*) is not a topic");
});

test("collectContext: missing page state yields nulls without throwing (quiz page with no selects, notes without params)", () => {
  const q = makeEnv({ location: { pathname: "/nevaib/quiz.html" } }).load("profile.js").load("feedback.js");
  assert.deepEqual(plain(q.NB.feedback.collectContext()), { page: "quiz", subject: null, topic: null });
  const n = makeEnv({ location: { pathname: "/nevaib/notes.html", search: "" } }).load("profile.js").load("feedback.js");
  assert.deepEqual(plain(n.NB.feedback.collectContext()), { page: "notes", subject: null, topic: null });
});

test("collectContext topic label: uses the selected option when options/selectedIndex exist (the real-DOM path)", () => {
  const e = makeEnv({ location: { pathname: "/nevaib/quiz.html" } }).load("profile.js").load("feedback.js");
  const s = e.document.createElement("select");
  s.id = "q-topic"; s.value = "a1-1";
  [["*", "Mixed"], ["a1-1", "A1.1 Water"]].forEach(o => {
    const op = e.document.createElement("option"); op.value = o[0]; op.textContent = o[1]; s.appendChild(op);
  });
  s.options = s.children.slice(); s.selectedIndex = 1; // what a real <select> exposes; the bare fake DOM does not
  e.document.body.appendChild(s);
  assert.equal(plain(e.NB.feedback.collectContext()).topic, "A1.1 Water");
});

test("submit: POSTs the JSON payload to the configured endpoint and resolves on 2xx with an empty body", async () => {
  let url = null, init = null;
  const { e } = envFetch((u, i) => { url = u; init = i; return Promise.resolve({ ok: true, status: 200, json: async () => { throw new Error("no body"); } }); });
  const payload = plain(e.NB.feedback.buildPayload({
    type: "improvement", area: "cards", title: "T", body: "B", context: { page: "cards" }
  }));
  await assert.doesNotReject(e.NB.feedback.submit(payload));
  assert.equal(url, e.NB.feedback.config.endpoint, "exactly the configured endpoint URL");
  assert.equal(init.method, "POST");
  assert.equal(init.headers["Content-Type"], "application/json");
  assert.equal(init.headers["Accept"], "application/json");
  assert.deepEqual(JSON.parse(init.body), payload, "body round-trips as JSON");
});

test("submit: a non-OK response rejects with the server's error message", async () => {
  const { e } = envFetch(() => Promise.resolve({ ok: false, status: 500, json: async () => ({ error: "nope" }) }));
  await assert.rejects(e.NB.feedback.submit(VALID), (err) => err.message === "nope");
});

test("submit: a non-OK response with a non-JSON body rejects with HTTP <status>", async () => {
  const { e } = envFetch(() => Promise.resolve({ ok: false, status: 502, json: async () => { throw new Error("not json"); } }));
  await assert.rejects(e.NB.feedback.submit(VALID), (err) => err.message === "HTTP 502");
});

test("submit: network failures propagate untouched", async () => {
  const { e } = envFetch(() => Promise.reject(new Error("offline")));
  await assert.rejects(e.NB.feedback.submit(VALID), (err) => err.message === "offline");
});

test("submit: a non-OK JSON body without an error field (or null) rejects with HTTP <status>", async () => {
  const a = envFetch(() => Promise.resolve({ ok: false, status: 422, json: async () => ({ message: "nope" }) }));
  await assert.rejects(a.e.NB.feedback.submit(VALID), (err) => err.message === "HTTP 422", "JSON without an error field");
  const b = envFetch(() => Promise.resolve({ ok: false, status: 403, json: async () => null }));
  await assert.rejects(b.e.NB.feedback.submit(VALID), (err) => err.message === "HTTP 403", "json() resolving to null");
});

test("submit: the 10 s timeout aborts a hung request and surfaces as a rejection", async () => {
  let sawMs = null, fire = null;
  const e = makeEnv({
    setTimeout(fn, ms) { fire = fn; sawMs = ms; return 1; },
    fetch(u, i) { // a request that never completes unless its abort signal fires
      return new Promise((resolve, reject) => {
        i.signal.addEventListener("abort", () => reject(new Error("The operation was aborted")));
      });
    }
  }).load("feedback.js");
  const p = e.NB.feedback.submit(VALID);
  assert.equal(sawMs, 10000, "the abort timer is registered for 10 s");
  fire(); // the request is still pending → the abort must reject, not wedge the caller
  await assert.rejects(p, (err) => /abort/i.test(err.message));
});

test("no fetch happens at module load; boot injects the style block and the button once", () => {
  let called = false;
  const e = makeEnv({ fetch: () => { called = true; return Promise.reject(new Error("offline")); } }).load("feedback.js");
  e.load("feedback.js"); // deliberate double include
  assert.equal(called, false, "lazy boot only — no network until Send");
  assert.ok(e.document.getElementById("sbx-fab"), "the Feedback button exists after load");
  assert.ok(e.document.getElementById("sbx-styles"), "the style block is injected");
});

test("config: endpoint is the Signalbox install on rametric.com (the pages' CSP connect-src whitelist)", () => {
  const e = envWith();
  const c = plain(e.NB.feedback.config);
  assert.equal(c.app, "ibsystem");
  assert.equal(c.endpoint, "https://rametric.com/signalbox/api.php?action=submit");
  assert.ok(c.endpoint.startsWith("https://rametric.com/"), "endpoint host must stay CSP-whitelisted");
  assert.equal(typeof c.appKey, "string");
  assert.ok(c.appKey.length > 0, "an app key must be configured");
});

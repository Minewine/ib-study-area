// node --test tests/js — per-user subject profiles (assets/profile.js):
// default-all without a profile key, stored subjects honoured with legacy-id
// aliasing on both sides, applyTo() over fake elements, missing-store
// tolerance, and the engine seams (quiz banks, card decks, notes subjects,
// library dropdown, coursework tracks) booted in the harness with a fake fetch.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { makeEnv, FakeStorage, plain } = require("./harness");

const REPO = path.join(__dirname, "..", "..");
const tick = (ms) => new Promise(r => setTimeout(r, ms || 25));
const J = JSON.stringify;
const ALL = ["biology-hl", "chemistry-hl", "math-aa-sl", "history-sl", "french-a-langlit", "english-lit-hl"];

// an element with a data-subject attribute and a style object, like the real
// DOM gives profile.js's applyTo
const subjEl = (subject) => { const el = makeEnv().document.createElement("div"); if (subject !== undefined) el.dataset.subject = subject; return el; };

// fetch that serves real library files from the repo (query strings stripped)
const repoFetch = () => (url) => {
  const p = path.join(REPO, String(url).split("?")[0].replace(/^.*?(library\/)/, "$1"));
  return Promise.resolve({ ok: true, json: async () => JSON.parse(fs.readFileSync(p, "utf8")) });
};

// append a fake element with an id to the document body (getElementById walks it)
function addEl(env, id, parent) {
  const el = env.document.createElement("div");
  el.id = id;
  (parent || env.document.body).appendChild(el);
  return el;
}

// ── NB.profile itself ──────────────────────────────────────────────────────

test("profile: no profile key → all six subjects (default = current behaviour)", () => {
  const env = makeEnv({}).load("store.js").load("profile.js");
  const P = env.NB.profile;
  assert.deepEqual(plain(P.subjects()), ALL);
  assert.equal(P.allows("biology-hl"), true);
  assert.equal(P.allows("french-a-langlit"), true);
  // a non-registry subject is not "allowed" (it isn't one of the six), but the
  // engines gate with hides(), which leaves non-registry content alone
  assert.equal(P.allows("ia-skills"), false);
  assert.equal(P.hides("ia-skills"), false);
  assert.equal(P.hides("biology-hl"), false);
});

test("profile: stored subjects honoured — canonicalised, deduped", () => {
  const env = makeEnv({ data: { profile: J({ subjects: ["biology-hl", "maths-aa-sl", "math-aa-sl", "history"] }) } })
    .load("store.js").load("profile.js");
  const P = env.NB.profile;
  assert.deepEqual(plain(P.subjects()), ["biology-hl", "math-aa-sl", "history-sl"]);
  assert.equal(P.allows("math-aa-sl"), true);
  assert.equal(P.allows("maths-aa-sl"), true, "legacy manifest id matches a canonical profile entry");
  assert.equal(P.allows("history"), true, "legacy checklist id matches too");
  assert.equal(P.allows("chemistry-hl"), false);
  assert.equal(P.hides("chemistry-hl"), true);
  assert.equal(P.hides("french-a-langlit"), true);
});

test("profile: a profile storing legacy ids is canonicalised on the way in", () => {
  const env = makeEnv({ data: { profile: J({ subjects: ["maths-aa-sl", "english-lit"] }) } })
    .load("store.js").load("profile.js");
  assert.deepEqual(plain(env.NB.profile.subjects()), ["math-aa-sl", "english-lit-hl"]);
  assert.equal(env.NB.profile.allows("english-lit-hl"), true);
});

test("profile: an empty subjects list hides all subject-tagged content", () => {
  const env = makeEnv({ data: { profile: J({ subjects: [] }) } }).load("store.js").load("profile.js");
  const P = env.NB.profile;
  assert.deepEqual(plain(P.subjects()), []);
  assert.equal(P.allows("biology-hl"), false);
  const els = [subjEl("biology-hl"), subjEl("history")];
  assert.equal(P.applyTo(els), 2);
  assert.equal(els[0].style.display, "none");
  assert.equal(els[1].style.display, "none");
});

test("profile: applyTo shows allowed, hides disallowed, returns the hidden count", () => {
  const env = makeEnv({ data: { profile: J({ subjects: ["math-aa-sl"] }) } }).load("store.js").load("profile.js");
  const kept = subjEl("maths-aa-sl");   // legacy tag for an allowed subject
  const gone = subjEl("history-sl");
  const untagged = subjEl(undefined);   // no data-subject at all — left untouched
  const emptyTag = subjEl("");          // empty tag means untagged — left untouched
  assert.equal(env.NB.profile.applyTo([kept, gone, untagged, emptyTag]), 1);
  assert.equal(kept.style.display, "", "allowed element restored to the stylesheet value");
  assert.equal(gone.style.display, "none");
  assert.equal(untagged.style.display, undefined);
  assert.equal(emptyTag.style.display, undefined);
  // a plain array was used above; a fake NodeList (has no forEach) works the same
  const list = Object.create({ length: 1, 0: gone });
  assert.equal(env.NB.profile.applyTo(list), 1, "Array.forEach.call handles array-likes");
  assert.equal(gone.style.display, "none");
});

test("profile: missing store.js (stale cache) shows everything instead of hiding", () => {
  const env = makeEnv({}).load("profile.js"); // deliberately NOT store.js
  const P = env.NB.profile;
  assert.deepEqual(plain(P.subjects()), ALL);
  assert.equal(P.allows("chemistry-hl"), true);
  const gone = subjEl("history-sl");
  assert.equal(P.applyTo([gone]), 0);
  assert.equal(gone.style.display, "", "nothing hidden when the store is missing");
});

test("profile: a malformed profile value falls back to all subjects", () => {
  for (const bad of [J({ nope: 1 }), J({ subjects: "biology-hl" }), "not json even"]) {
    const env = makeEnv({ data: { profile: bad } }).load("store.js").load("profile.js");
    assert.deepEqual(plain(env.NB.profile.subjects()), ALL, "profile " + bad + " → all subjects");
  }
});

// ── engine seams ───────────────────────────────────────────────────────────

test("quiz-engine: banks for profile-disallowed subjects never reach the dropdown", async () => {
  const manifest = [
    { file: "library/questions/a.json", subject: "biology-hl", subjectLabel: "Biology HL", label: "A bank" },
    { file: "library/questions/b.json", subject: "chemistry-hl", subjectLabel: "Chemistry HL", label: "B bank" },
    { file: "library/questions/c.json", subject: "ia-skills", subjectLabel: "Coursework & practical skills", label: "IA skills" }
  ];
  const fetch = (url) => /manifest\.json/.test(String(url))
    ? Promise.resolve({ ok: true, json: async () => JSON.parse(J(manifest)) })
    : Promise.reject(new Error("unexpected fetch " + url));
  const boot = async (profile) => {
    const env = makeEnv({
      fetch, readyState: "loading",
      data: profile ? { profile: J({ subjects: profile }) } : {}
    });
    env.load("store.js").load("profile.js");
    const subj = addEl(env, "q-subject");
    addEl(env, "q-topic");
    addEl(env, "q-start");
    env.load("quiz-engine.js");
    env.fire("document", "DOMContentLoaded");
    await tick();
    return subj.children.filter(c => c.tagName === "OPTION").map(c => c.value);
  };
  assert.deepEqual(await boot(["biology-hl"]), ["biology-hl", "ia-skills"],
    "disallowed subject's bank gone; the non-registry ia-skills bank stays for everyone");
  assert.deepEqual(await boot(undefined), ["biology-hl", "chemistry-hl", "ia-skills"], "no profile → everything");
});

test("flashcards: decks for profile-disallowed subjects are dropped before fetch", async () => {
  const boot = async (profile) => {
    const env = makeEnv({
      fetch: repoFetch(), readyState: "loading",
      data: profile ? { profile: J({ subjects: profile }) } : {}
    });
    env.load("store.js").load("profile.js").load("flashcards.js");
    await env.NB.flashcards.loadDecks(); // manual: boot is parked on DOMContentLoaded
    return env.NB.flashcards.cards().map(c => c.subject);
  };
  const subjects = await boot(["biology-hl"]);
  assert.ok(subjects.length > 0, "allowed decks loaded");
  assert.ok(subjects.every(s => s === "biology-hl"), "only profile subjects: " + [...new Set(subjects)].join(","));
  const all = await boot(undefined);
  assert.ok(all.includes("chemistry-hl") && all.includes("math-aa-sl"), "no profile → every deck loads");
});

test("notes: subject buttons only for profile subjects (manifest filtered once)", async () => {
  const boot = async (profile) => {
    const env = makeEnv({
      fetch: repoFetch(), readyState: "complete",
      data: profile ? { profile: J({ subjects: profile }) } : {}
    });
    env.load("store.js").load("profile.js");
    const bar = addEl(env, "nt-subjects");
    addEl(env, "nt-index");
    addEl(env, "nt-note");
    env.load("notes.js");
    await tick();
    return bar.children.filter(c => c.tagName === "BUTTON").map(c => c.getAttribute("data-subject"));
  };
  assert.deepEqual(await boot(["chemistry-hl"]), ["chemistry-hl"],
    "one button — the maths manifest id canonicalises away and biology is filtered");
  assert.deepEqual(await boot(undefined), ["biology-hl", "chemistry-hl", "maths-aa-sl"], "no profile → all three subjects");
});

test("library: subject dropdown options filtered; persisted filter on a hidden subject resets", async () => {
  const boot = async (profile, filters) => {
    const env = makeEnv({
      fetch: repoFetch(), readyState: "complete",
      data: Object.assign({}, profile ? { profile: J({ subjects: profile }) } : {}, filters ? { "lib-filters": J(filters) } : {})
    });
    env.load("store.js").load("profile.js");
    const subj = addEl(env, "lib-subject");
    addEl(env, "lib-type");
    addEl(env, "lib-search");
    env.load("library.js");
    await tick();
    return { html: subj.innerHTML, value: subj.value, stored: plain(env.NB.store.get("lib-filters", null)) };
  };
  const r = await boot(["biology-hl"]);
  assert.match(r.html, /value='biology-hl'/, "allowed subject keeps its option");
  assert.doesNotMatch(r.html, /value='history-sl'/, "disallowed subject's option is gone");
  assert.doesNotMatch(r.html, /value='french-a-langlit'/, "disallowed subject's option is gone");
  assert.match(r.html, /value='school'/, "non-registry groups (school/tsm/core) stay for every account");
  assert.doesNotMatch(r.html, /value='math-aa-sl'/);
  const stale = await boot(["biology-hl"], { subject: "math-aa-sl", type: "all", q: "" });
  assert.equal(stale.value, "", "persisted filter naming a now-hidden subject is reset");
  assert.equal(stale.stored.subject, "", "and the reset is persisted, or results stay filtered invisibly");
  const none = await boot([], {});
  assert.equal(none.stored.subject === undefined || none.stored.subject === "", true);
  const noOptions = await boot([], { subject: "school", type: "all", q: "" });
  assert.ok(!/value='biology-hl'/.test(noOptions.html), "empty profile: no registry subject options at all");
});

test("coursework: tracks for profile-disallowed subjects are removed; empty profile gets a message", async () => {
  const boot = async (profile) => {
    const env = makeEnv({
      fetch: repoFetch(), readyState: "complete",
      data: profile ? { profile: J({ subjects: profile }) } : {}
    });
    env.load("store.js").load("profile.js");
    const tabs = addEl(env, "cw-tabs");
    const root = addEl(env, "cw-track");
    env.load("coursework.js");
    await tick(40);
    return { tabs: tabs.children.map(c => c.children[0].textContent), root: root.textContent };
  };
  const r = await boot(["chemistry-hl"]);
  assert.equal(r.tabs.length, 1, "one track left");
  assert.match(r.tabs[0], /Chemistry HL/);
  const all = await boot(undefined);
  assert.equal(all.tabs.length, 3, "no profile → all three tracks");
  const empty = await boot([]);
  assert.match(empty.root, /No coursework planner tracks/, "empty profile: no track can render — a message instead of a crash");
});

test("quiz-engine: the offline fallback banks get the same profile filter", async () => {
  const boot = async (profile) => {
    const env = makeEnv({
      fetch: () => Promise.reject(new Error("manifest fetch fails")), readyState: "loading",
      data: profile ? { profile: J({ subjects: profile }) } : {}
    });
    env.load("store.js").load("profile.js");
    const subj = addEl(env, "q-subject");
    addEl(env, "q-topic");
    addEl(env, "q-start");
    env.load("quiz-engine.js");
    env.fire("document", "DOMContentLoaded");
    await tick();
    return subj.children.filter(c => c.tagName === "OPTION").map(c => c.value);
  };
  assert.deepEqual(await boot(["biology-hl"]), ["biology-hl"],
    "fallback: a restricted profile never sees other subjects' built-in banks");
  assert.deepEqual(await boot(undefined), ["biology-hl", "chemistry-hl", "math-aa-sl"],
    "fallback: no profile → every built-in bank");
});

test("library: results rows for profile-disallowed subjects are hidden; hidden pins kept as data", async () => {
  const MATH_KEY = "math-aa-sl::library/notes/math-aa-sl/1-number-algebra/1-1-number-toolkit.pdf";
  const BIO_KEY = "biology-hl::library/notes/biology-hl/continuity-change/cell-nuclear-division.pdf";
  const boot = async (profile, pins) => {
    const env = makeEnv({
      fetch: repoFetch(), readyState: "complete",
      data: Object.assign({}, profile ? { profile: J({ subjects: profile }) } : {}, pins ? { "res-bookmarks": J(pins) } : {})
    });
    env.load("store.js").load("profile.js");
    addEl(env, "lib-subject");
    addEl(env, "lib-type");
    addEl(env, "lib-search");
    const results = addEl(env, "lib-results");
    const pinsBox = addEl(env, "res-pins");
    addEl(env, "papers-list");
    env.load("library.js");
    await tick();
    return { results: results.innerHTML, pins: pinsBox.innerHTML, storedPins: plain(env.NB.store.get("res-bookmarks", null)) };
  };
  const r = await boot(["biology-hl"], [MATH_KEY, BIO_KEY]);
  assert.match(r.results, /biology-hl/, "allowed subject's rows still render");
  assert.match(r.results, /tsm/, "non-registry groups (tsm/school/core-tok-ee) stay visible");
  assert.doesNotMatch(r.results, /math-aa-sl/, "disallowed subject's rows are not listed");
  assert.match(r.pins, /biology-hl/, "a pin on an allowed subject renders");
  assert.doesNotMatch(r.pins, /math-aa-sl/, "a pin on a disallowed subject is hidden from the render");
  assert.deepEqual(r.storedPins, [MATH_KEY, BIO_KEY], "the pin data itself is kept, not deleted");
  const all = await boot(undefined);
  assert.match(all.results, /math-aa-sl/, "no profile → every row renders");
});

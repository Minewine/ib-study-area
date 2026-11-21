// node --test tests/js — "retired": true items/cards (off-syllabus content kept in the
// bank so ids, q-errors and fc-state stay valid) are excluded from new sessions.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { makeEnv, plain } = require("./harness");

const LIB = path.join(__dirname, "..", "..", "library");
const json = (o) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(o) });

test("quiz engine: retired items never reach a session; others keep bank-scoped ids", async () => {
  const bank = { subject: "math-aa-sl", topic: "t", topicLabel: "T", items: [
    { id: "a1", format: "mcq", stem: "x", choices: ["1", "2"], answer: 0 },
    { id: "a2", format: "mcq", stem: "y", choices: ["1", "2"], answer: 1, retired: true },
  ] };
  const env = makeEnv({ readyState: "loading", fetch: () => json(bank) }).load("store.js").load("quiz-engine.js");
  const items = plain(await env.NB.quizEngine.bankItems({ file: "library/questions/m.json", label: "M" }));
  assert.deepEqual(items.map(i => i.id), ["a1"]);
  assert.equal(items[0].bankId, "m");
  const inline = plain(await env.NB.quizEngine.bankItems({ inline: true, label: "U", items: bank.items }));
  assert.deepEqual(inline.map(i => i.id), ["a1"]);
  assert.equal(env.NB.quizEngine.isActive({ retired: "yes" }), true, "only boolean true retires");
});

test("flashcards: retired cards are skipped but their fc-state is left untouched", async () => {
  const state = { "c-old": { box: 3, due: "2026-11-01", seen: 4, t: 1 } };
  const deck = { subject: "math-aa-sl", topic: "t", topicLabel: "T", cards: [
    { id: "c-live", type: "qa", front: "f", back: "b" },
    { id: "c-old", type: "qa", front: "f2", back: "b2", retired: true },
  ] };
  const fetch = (url) => json(String(url).includes("manifest") ? [{ file: "library/flashcards/d.json", subject: "math-aa-sl", subjectLabel: "Math" }] : deck);
  const env = makeEnv({ readyState: "loading", fetch, data: { "fc-state": JSON.stringify(state) } }).load("store.js").load("flashcards.js");
  await env.NB.flashcards.loadDecks();
  assert.deepEqual(plain(env.NB.flashcards.cards()).map(c => c.id), ["c-live"]);
  assert.deepEqual(JSON.parse(env.storage.getItem("fc-state")), state, "progress kept");
});

test("library: the flagged off-syllabus Maths items are retired (not deleted) with a reason", () => {
  const want = {
    "questions/math-aa-number-algebra.json": ["m03", "mnx6"],
    "questions/math-aa-topic4-statistics.json": ["s413"],
    "questions/math-functions-2-4-to-2-5.json": ["tf16"],
    "flashcards/math-number-algebra.json": ["fc-math-n-07"],
    "flashcards/math-topic4-statistics.json": ["fc-math-st-05"],
    "flashcards/math-functions-2-4-to-2-5.json": ["fc-math-tf-13"],
  };
  for (const [f, ids] of Object.entries(want)) {
    const d = JSON.parse(fs.readFileSync(path.join(LIB, f), "utf8"));
    const list = d.items || d.cards;
    for (const id of ids) {
      const it = list.find(x => x.id === id);
      assert.ok(it, `${f}: ${id} still present`);
      assert.equal(it.retired, true, `${f}: ${id} retired`);
      assert.ok(it.retiredReason, `${f}: ${id} has a reason`);
    }
  }
});

// Uploaded banks used to key mistakes as "user:<label>#id", so two same-labeled
// practice sets (which commonly reuse item ids p01–p08) wrote into ONE history.
// The stored bank name (unique per import) is the stable bank id now, and pre-name
// records rename onto it when the bank loads.
test("uploaded banks: error keys use the stored bank name; pre-name uploads keep the label fallback", async () => {
  const bank = { subject: "biology-hl", topic: "t", topicLabel: "T", items: [
    { id: "p01", format: "mcq", stem: "s", choices: ["1", "2"], answer: 0 },
  ] };
  const env = makeEnv({ readyState: "loading" }).load("store.js").load("quiz-engine.js");
  const named = plain(await env.NB.quizEngine.bankItems({ inline: true, name: "ai-photosynthesis.json", label: "Photosynthesis", items: bank.items }));
  assert.equal(named[0].bankId, "ai-photosynthesis", "stored name (unique per import) keys the errors");
  const legacy = plain(await env.NB.quizEngine.bankItems({ inline: true, label: "Photosynthesis", items: bank.items }));
  assert.equal(legacy[0].bankId, "user:photosynthesis", "uploads saved before banks carried a name keep their old id");
});

test("migrateUserBankKeys: pre-name records rename onto the stored bank name; non-matching stems stay put", () => {
  const env = makeEnv({ readyState: "loading", data: { "q-errors": JSON.stringify([
    { key: "user:photosynthesis#p01", id: "p01", bankId: "user:photosynthesis", stem: "Which bond?", attempts: 2, ts: 5, resolved: false },
    { key: "user:photosynthesis#p02", id: "p02", bankId: "user:photosynthesis", stem: "Different question", attempts: 1, ts: 5, resolved: false },
  ]) } }).load("store.js").load("quiz-engine.js");
  const bank = { name: "ai-photosynthesis.json", label: "Photosynthesis", items: [
    { id: "p01", stem: "Which bond?" },
    { id: "p03", stem: "Third question" },
  ] };
  env.NB.quizEngine.migrateUserBankKeys(bank);
  const errs = plain(env.NB.store.get("q-errors"));
  assert.deepEqual(errs.map(e => e.key).sort(), ["ai-photosynthesis#p01", "user:photosynthesis#p02"]);
  const moved = errs.find(e => e.key === "ai-photosynthesis#p01");
  assert.equal(moved.bankId, "ai-photosynthesis");
  assert.equal(moved.legacyKey, "user:photosynthesis#p01", "so the sync merge drops the old-key copy from other devices");
  env.NB.quizEngine.migrateUserBankKeys(bank); // idempotent
  assert.equal(plain(env.NB.store.get("q-errors")).length, 2, "nothing renamed twice");
});

test("migrateUserBankKeys: a legacy record meeting an existing new-key record merges instead of duplicating", () => {
  const env = makeEnv({ readyState: "loading", data: { "q-errors": JSON.stringify([
    { key: "user:photosynthesis#p01", id: "p01", stem: "Which bond?", attempts: 2, ts: 5, firstMissed: "2026-11-01", lastMissed: "2026-11-02", resolved: false },
    { key: "ai-photosynthesis#p01", id: "p01", stem: "Which bond?", attempts: 1, ts: 50, firstMissed: "2026-11-10", lastMissed: "2026-11-11", resolved: true },
  ]) } }).load("store.js").load("quiz-engine.js");
  env.NB.quizEngine.migrateUserBankKeys({ name: "ai-photosynthesis.json", label: "Photosynthesis", items: [{ id: "p01", stem: "Which bond?" }] });
  const errs = plain(env.NB.store.get("q-errors"));
  assert.equal(errs.length, 1);
  assert.equal(errs[0].attempts, 3, "attempts unioned");
  assert.equal(errs[0].firstMissed, "2026-11-01", "earliest miss kept");
  assert.equal(errs[0].resolved, false, "an unresolved history isn't resolved away by the merge");
});

// The merge-into-existing branch must not lose the legacy record's retirement: same
// missing-field rule as the sync merge (errMerge) — no retired field on the survivor
// means the legacy answer rides along; an explicit retired:false (restore) stays.
test("migrateUserBankKeys: the merge-into-existing branch inherits retirement the new-key record lacks; an explicit retired:false stays", () => {
  const bank = { name: "ai-photosynthesis.json", label: "Photosynthesis", items: [{ id: "p01", stem: "Which bond?" }] };
  const env = makeEnv({ readyState: "loading", data: { "q-errors": JSON.stringify([
    { key: "user:photosynthesis#p01", id: "p01", stem: "Which bond?", attempts: 2, ts: 5, resolved: false, retired: true, retiredReason: "off-syllabus", retiredAt: 9 },
    { key: "ai-photosynthesis#p01", id: "p01", stem: "Which bond?", attempts: 1, ts: 50, resolved: false },
  ]) } }).load("store.js").load("quiz-engine.js");
  env.NB.quizEngine.migrateUserBankKeys(bank);
  const errs = plain(env.NB.store.get("q-errors"));
  assert.equal(errs.length, 1);
  assert.equal(errs[0].retired, true, "the legacy record's \"not relevant\" rides the merge");
  assert.equal(errs[0].retiredReason, "off-syllabus");
  assert.equal(errs[0].retiredAt, 9);
  const restored = makeEnv({ readyState: "loading", data: { "q-errors": JSON.stringify([
    { key: "user:photosynthesis#p01", id: "p01", stem: "Which bond?", attempts: 2, ts: 5, resolved: false, retired: true, retiredReason: "off-syllabus", retiredAt: 9 },
    { key: "ai-photosynthesis#p01", id: "p01", stem: "Which bond?", attempts: 1, ts: 50, resolved: false, retired: false },
  ]) } }).load("store.js").load("quiz-engine.js");
  restored.NB.quizEngine.migrateUserBankKeys(bank);
  const errs2 = plain(restored.NB.store.get("q-errors"));
  assert.equal(errs2[0].retired, false, "an explicit restored record isn't re-retired by the merge");
  assert.equal(errs2[0].retiredReason, undefined);
});

// quiz.html?errkeys=… deep link: retired ("not relevant") records are never served,
// and the notices account for every key the session didn't pick up.
test("pickReviewErrors: the deep link skips retired records and says so; automatic paths stay retired-free", () => {
  const QE = makeEnv({ readyState: "loading" }).load("store.js").load("quiz-engine.js").NB.quizEngine;
  const errs = [
    { key: "a#1", stem: "s1", resolved: false },
    { key: "a#2", stem: "s2", resolved: false, retired: true },
    { key: "a#3", stem: "s3", resolved: true },
  ];
  const keys = QE.pickReviewErrors(errs, { keys: ["a#1", "a#2", "a#4"] });
  assert.deepEqual(plain(keys.errs).map(e => e.key), ["a#1"], "retired is not served by the deep link");
  assert.deepEqual(plain(keys.bits), ["1 linked item(s) not found.", "1 linked item(s) skipped — marked \u201cnot relevant\u201d."]);
  assert.equal(keys.retiredN, 1);
  assert.deepEqual(plain(QE.pickReviewErrors(errs, {}).errs).map(e => e.key), ["a#1"], "default path: unresolved, unretired only");
  const allRetired = QE.pickReviewErrors(errs, { keys: ["a#2"] });
  assert.equal(allRetired.errs.length, 0, "an all-retired deep link serves nothing");
  assert.deepEqual(plain(allRetired.bits), ["1 linked item(s) skipped — marked \u201cnot relevant\u201d."]);
});

// ── booting the quiz page itself (startReview is not exported — the real launch
// path is init() → startFromErrKeys via quiz.html?errkeys=…). Only the false paths
// are bootable here: a successful launch renders a question into innerHTML, which
// the string-based fake DOM cannot parse; the picker seams stay in the pure tests. ──
const tick = (ms) => new Promise(r => setTimeout(r, ms || 50));
const addEl = (env, id) => { const el = env.document.createElement("div"); el.id = id; env.document.body.appendChild(el); return el; };
const bootQuiz = async (opts) => {
  const env = makeEnv(Object.assign({ readyState: "loading" }, opts || {}));
  ["q-subject", "q-topic", "q-start", "q-error"].forEach(id => addEl(env, id));
  env.load("store.js").load("quiz-engine.js");
  env.fire("document", "DOMContentLoaded"); // init(): manifest → setup → deep links
  await tick();
  return env;
};

// An all-retired / unknown deep link starts nothing and reports why, instead of
// falling back to a generic session.
test("startReview: a deep link whose every key is retired (or unknown) starts nothing and says so", async () => {
  const data = { "q-errors": JSON.stringify([
    { key: "a#2", stem: "s2", resolved: false, retired: true, retiredReason: "off-syllabus", retiredAt: 9 },
    { key: "b#1", stem: "s1", resolved: false },
  ]) };
  const retired = await bootQuiz({ data, location: { search: "?errkeys=" + encodeURIComponent("a#2") } });
  assert.equal(retired.document.getElementById("q-error").textContent,
    "None of the questions picked from the mistake log could be found. (1 marked \u201cnot relevant\u201d.)",
    "a retired-only link starts no session and counts its skips");
  const unknown = await bootQuiz({ data, location: { search: "?errkeys=" + encodeURIComponent("absent#1") } });
  assert.equal(unknown.document.getElementById("q-error").textContent,
    "None of the questions picked from the mistake log could be found.",
    "an unknown-only link omits the retirement suffix");
});

// A link copied BEFORE the questions were retired must not resurrect them: the keys
// are retired afterwards through the real mistakes page mutator, then launched.
test("a copied deep link goes stale: retiring its keys afterwards makes the launch skip them", async () => {
  const env = makeEnv({ readyState: "loading", location: { search: "?errkeys=bio-y%231,bio-y%232" },
    data: { "q-errors": JSON.stringify([
      { key: "bio-y#1", stem: "s1", attempts: 1, resolved: false, ts: 1, firstMissed: "2026-11-01", lastMissed: "2026-11-01" },
      { key: "bio-y#2", stem: "s2", attempts: 1, resolved: false, ts: 2, firstMissed: "2026-11-02", lastMissed: "2026-11-02" },
    ]) } }).load("store.js").load("quiz-engine.js").load("mistakes.js");
  ["q-subject", "q-topic", "q-start", "q-error"].forEach(id => addEl(env, id));
  const keys = plain(env.NB.store.get("q-errors")).map(e => e.key); // the copied link
  assert.deepEqual(keys, ["bio-y#1", "bio-y#2"], "the link covers exactly the records the log shows");
  env.NB.mistakes.retire("bio-y#1", "off-syllabus");
  env.NB.mistakes.retire("bio-y#2", "off-syllabus");
  const errs = plain(env.NB.store.get("q-errors"));
  assert.equal(errs.length, 2, "records are never hard-deleted by retiring");
  assert.ok(errs.every(e => e.retired === true));
  env.fire("document", "DOMContentLoaded"); // quiz.html launch with the stale errkeys link
  await tick();
  assert.equal(env.document.getElementById("q-error").textContent,
    "None of the questions picked from the mistake log could be found. (2 marked \u201cnot relevant\u201d.)",
    "nothing left to serve the stale link");
});

// The Mistakes log itself (assets/mistakes.js renderList): a retired row offers
// Restore and never the quiz.html?errkeys= Retry deep link — the engine would
// skip it anyway, and the link must not suggest it works.
test("mistakes render: a retired row keeps Restore and drops the Retry deep link", () => {
  const env = makeEnv({ readyState: "loading", data: {
    "q-errors": JSON.stringify([
      { key: "bio-y#1", stem: "open stem", attempts: 1, ts: 1, firstMissed: "2026-11-19", lastMissed: "2026-11-19", resolved: false },
      { key: "bio-y#2", stem: "retired stem", attempts: 2, ts: 2, firstMissed: "2026-11-19", lastMissed: "2026-11-20", resolved: false, retired: true, retiredReason: "off-syllabus" },
    ]),
    "mistakes-filters": JSON.stringify({ status: "all", subject: "", q: "" }),
  } }).load("store.js").load("mistakes.js");
  // the harness fake DOM stores innerHTML as a string (no parsing), so the panel's
  // fixed controls are pre-created and handed to mount() through a stand-in element
  const controls = {};
  ["mk-status", "mk-subject", "mk-q", "mk-list"].forEach(id => {
    controls[id] = { id, innerHTML: "", value: "", listeners: {},
      addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
      querySelectorAll() { return []; } };
  });
  const panel = {
    innerHTML: "",
    querySelector(sel) { return controls[String(sel).slice(1)] || null; },
    querySelectorAll() { return []; },
  };
  env.NB.mistakes.mount(panel);
  const html = controls["mk-list"].innerHTML;
  const rowFor = (key) => {
    const at = html.indexOf('data-key="' + key + '"');
    assert.ok(at >= 0, "a row is rendered for " + key);
    return html.slice(at).split('<div class="mk-row"')[0];
  };
  const open = rowFor("bio-y#1");
  assert.match(open, /mk-retry/, "the open row keeps its Retry deep link");
  assert.match(open, /quiz\.html\?errkeys=bio-y%231/);
  const retired = rowFor("bio-y#2");
  assert.doesNotMatch(retired, /mk-retry|errkeys=/, "the retired row has NO Retry link");
  assert.match(retired, /mk-restore/, "…and offers Restore instead");
  assert.match(retired, /Not relevant: off-syllabus/);
});

// bankIdFor (assets/quiz-engine.js): the explicit stable "ub-…" id stamped at upload
// outranks the stored name and the legacy label fallback — two same-topic sets that
// share a label (and commonly item ids p01–p08) must never write into one history.
test("uploaded banks: an explicit ub- id beats the stored name and the label fallback; distinct ids keep mistake keys independent", async () => {
  const bank = { subject: "biology-hl", topic: "t", topicLabel: "T", items: [
    { id: "p01", format: "mcq", stem: "s", choices: ["1", "2"], answer: 0 },
  ] };
  const env = makeEnv({ readyState: "loading" }).load("store.js").load("quiz-engine.js");
  const QE = env.NB.quizEngine;
  const idOf = async (over) => plain(await QE.bankItems(Object.assign({ inline: true, label: "Photosynthesis", items: bank.items }, over)))[0].bankId;
  assert.equal(await idOf({ id: "ub-aa1", name: "ai-photosynthesis.json" }), "ub-aa1", "explicit id wins over the stored name");
  assert.equal(await idOf({ id: "ub-aa1" }), "ub-aa1", "explicit id wins even without a stored name");
  // two same-topic uploads on one device: distinct ids → "<bankId>#<itemId>" never pools
  const a = plain(await QE.bankItems({ inline: true, id: "ub-aa1", name: "ai-photosynthesis.json", label: "Photosynthesis", items: bank.items }));
  const b = plain(await QE.bankItems({ inline: true, id: "ub-bb2", name: "ai-photosynthesis-2.json", label: "Photosynthesis", items: bank.items }));
  assert.deepEqual(a.map(i => i.bankId), ["ub-aa1"]);
  assert.deepEqual(b.map(i => i.bankId), ["ub-bb2"]);
  assert.notEqual(a[0].bankId + "#" + a[0].id, b[0].bankId + "#" + b[0].id,
    "the same item id p01 in both sets still maps to different error keys");
});

// ── ?from= note links (startFromLink at page init): they resolve NON-inline banks
// only — an uploaded bank is inline, so its "ub-…" id never resolves, and the union
// never collapses two uploads. Resolved-or-not is observed through the bank-file
// fetch (a found bank's file is fetched; an unresolved id fetches nothing). ──

test("?from= deep links resolve non-inline banks only: an uploaded bank's ub- id starts nothing and fetches no bank file", async () => {
  const files = [];
  const fetch = (url) => {
    const u = String(url);
    if (u.includes("questions/manifest")) return json([{ file: "library/questions/lib-x.json", subject: "biology-hl", subjectLabel: "Biology HL", label: "Lib X" }]);
    if (u.includes("questions/")) { files.push(u); return json({ subject: "biology-hl", topic: "t", items: [] }); }
    return Promise.reject(new Error("unexpected fetch " + u)); // teaching meta — caught internally
  };
  const env = makeEnv({ readyState: "loading", fetch, location: { search: "?from=ub-aa1" },
    data: { "q-userbanks": JSON.stringify([{ id: "ub-aa1", name: "ai-x.json", subject: "biology-hl", label: "X",
      items: [{ id: "p01", format: "mcq", stem: "s", choices: ["1", "2"], answer: 0 }] }]) } })
    .load("store.js").load("quiz-engine.js");
  ["q-subject", "q-topic", "q-start", "q-error"].forEach(id => addEl(env, id));
  env.fire("document", "DOMContentLoaded");
  await tick();
  assert.equal(env.document.getElementById("q-error").textContent,
    "None of the questions linked from that note could be found.", "the inline upload does not resolve from a note link");
  assert.deepEqual(files, [], "no question file fetched — the upload was never even considered");
});

test("?from= to a library bank whose every item is retired resolves the bank (file fetched) but serves nothing", async () => {
  const files = [];
  const fetch = (url) => {
    const u = String(url);
    if (u.includes("questions/manifest")) return json([{ file: "library/questions/lib-x.json", subject: "biology-hl", subjectLabel: "Biology HL", label: "Lib X" }]);
    if (u.includes("questions/")) { files.push(u); return json({ subject: "biology-hl", topic: "t", topicLabel: "T", items: [
      { id: "p01", format: "mcq", stem: "s", choices: ["1", "2"], answer: 0, retired: true },
    ] }); }
    return Promise.reject(new Error("unexpected fetch " + u));
  };
  const env = makeEnv({ readyState: "loading", fetch, location: { search: "?from=lib-x" } }).load("store.js").load("quiz-engine.js");
  ["q-subject", "q-topic", "q-start", "q-error"].forEach(id => addEl(env, id));
  env.fire("document", "DOMContentLoaded");
  await tick();
  assert.equal(files.length, 1, "the bank WAS resolved through bankIdFor — its file was fetched");
  assert.equal(env.document.getElementById("q-error").textContent,
    "None of the questions linked from that note could be found.", "retired items never reach a from= session either");
});

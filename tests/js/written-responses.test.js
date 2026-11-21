// node --test tests/js — the written-answer history in "q-errors" (assets/
// quiz-engine.js): a wrong/partial written attempt stores a bounded copy of the
// typed response plus the self-awarded mark — on the record (both recordError
// branches, review-wrong via applyRetry) and on its retry entry; MCQ attempts and
// correct outcomes store neither. Also pins the errMerge (NB.merge.union
// "q-errors") semantics for the new fields. The engine is loaded WITHOUT firing
// DOMContentLoaded (readyState "loading"); session-shaped flows boot through
// quiz.html?from=… like retired.test.js does (recordError's new-record branch
// needs the live session only a booted page has).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeEnv, plain } = require("./harness");

const tick = (ms) => new Promise(r => setTimeout(r, ms || 50));

// one library bank (a written + an mcq item) served through the mocked fetches
const BANK = { subject: "biology-hl", topic: "c1-1", topicLabel: "Enzymes", items: [
  { id: "w1", format: "written", stem: "Explain induced fit.", marks: 3, markscheme: ["substrate binds", "active site moulds", "complex strains"] },
  { id: "m1", format: "mcq", stem: "Pick one.", choices: ["a", "b"], answer: 0, note: "why" },
] };
const writtenItem = (over) => Object.assign({
  id: "w1", bankId: "lib-x", format: "written", stem: "Explain induced fit.",
  marks: 3, markscheme: ["substrate binds", "active site moulds", "complex strains"], topic: "c1-1",
}, over);
const json = (o) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(o) });
const fetchLib = () => (url) => {
  const p = String(url).split("?")[0];
  if (p.endsWith("questions/manifest.json")) return json([{ file: "library/questions/lib-x.json", subject: "biology-hl", subjectLabel: "Biology HL" }]);
  if (p.endsWith("lib-x.json")) return json(BANK);
  return Promise.reject(new Error("offline " + url)); // teaching meta — caught internally
};

const addEl = (env, id) => { const el = env.document.createElement("div"); el.id = id; env.document.body.appendChild(el); return el; };
// the elements renderQuestion wires by id (the fake DOM never parses innerHTML —
// quiz-picker.test.js bootWith pattern, plus q-answer/q-fc/q-hide and the hidden panel)
const IDS = ["q-subject", "q-topic", "q-set", "q-format", "q-length", "q-diff-min", "q-diff-max",
  "q-taught-only", "q-taught-panel", "q-taught-list", "q-start", "q-error",
  "q-progress", "q-box", "setup", "runner", "summary", "q-log",
  "q-conf", "q-sure", "q-guess", "q-reveal", "q-reveal-guess", "q-ms",
  "q-answer", "q-selfscore", "q-next", "q-again", "q-fc", "q-hide",
  "q-hidden-panel", "q-hidden-list", "q-hidden-summary"];

const boot = async (opts) => {
  opts = opts || {};
  const env = makeEnv(Object.assign({ readyState: "loading", fetch: fetchLib() }, opts));
  IDS.forEach(id => addEl(env, id));
  env.load("store.js").load("qhidden.js").load("quiz-engine.js");
  env.fire("document", "DOMContentLoaded"); // init(): manifest → setup → ?from= deep link
  await tick();
  return env;
};
const last = (env, id) => {
  const el = env.document.getElementById(id);
  return el.listeners.click[el.listeners.click.length - 1];
};

// ── the real written flow (first miss) ─────────────────────────────────────
test("first written miss through the real flow: bounded response + awarded mark on the new record; no retry entry", async () => {
  const env = await boot({ location: { search: "?from=lib-x:w1" } });
  assert.match(env.document.getElementById("q-progress").textContent, /Question 1 \/ 1/, "the deep link started a session");
  last(env, "q-reveal")(); // "sure"
  env.document.getElementById("q-answer").value = "  " + "x".repeat(5000) + "  ";
  env.document.getElementById("q-selfscore").value = "1"; // 1 of 3 → wrong/partial
  last(env, "q-next")();
  const stored = plain(env.NB.store.get("q-errors"));
  assert.equal(stored.length, 1);
  const e = stored[0];
  assert.equal(e.key, "lib-x#w1");
  assert.equal(e.format, "written");
  assert.equal(e.response, "x".repeat(2000), "the typed answer is stored trimmed and bounded to 2000 chars");
  assert.equal(e.awarded, 1, "the self-awarded mark rides the record");
  assert.equal(e.marks, 3);
  assert.deepEqual(plain(e.markscheme), BANK.items[0].markscheme);
  assert.equal(e.retries, undefined, "the first miss has no retry entry (unchanged rule)");
  assert.equal(e.dueAt, e.ts + 1 * 86400000, "first miss → the 1-day rung (unchanged)");
});

test("MCQ miss stores neither response nor awarded (and no retry-entry fields on a first miss)", async () => {
  const env = await boot({ location: { search: "?from=lib-x:m1" } });
  // the choice buttons live in unparsed innerHTML, so the mcq call the check()
  // handler makes is exercised directly (same call shape)
  const it = plain(await env.NB.quizEngine.bankItems({ file: "library/questions/lib-x.json", label: "Lib X" })).find(x => x.id === "m1");
  env.NB.quizEngine.recordError(it, { userChoice: 1, conf: "sure" });
  const e = plain(env.NB.store.get("q-errors"))[0];
  assert.equal(e.format, "mcq");
  assert.equal(e.response, undefined, "MCQ attempts never store a response");
  assert.equal(e.awarded, undefined, "MCQ attempts never store an awarded mark");
  assert.equal(e.userAnswer, 1, "the wrong choice is stored as before");
  assert.equal(e.retries, undefined);
});

// ── recordError repeat miss (existing-record branch) ───────────────────────
test("repeat written miss: record-level response/awarded updated AND the retry entry carries them; the 20 cap holds", () => {
  const env = makeEnv({ readyState: "loading", data: { "q-errors": JSON.stringify([
    Object.assign(writtenItem({ bankId: "lib-x", subject: "biology-hl" }), {
      key: "lib-x#w1", attempts: 20, firstMissed: "2026-11-01", lastMissed: "2026-11-20",
      resolved: false, ts: 5, response: "first answer", awarded: 0,
      retries: Array.from({ length: 20 }, (_, i) => ({ ts: i + 1, correct: false })),
    }),
  ]) } }).load("store.js").load("quiz-engine.js");
  env.NB.quizEngine.recordError(writtenItem(), { response: "  second answer  ", awarded: 2, conf: "guess" });
  const e = plain(env.NB.store.get("q-errors"))[0];
  assert.equal(e.attempts, 21);
  assert.equal(e.retries.length, 20, "still capped at 20 — the oldest entry fell off");
  const lastRetry = e.retries[e.retries.length - 1];
  assert.equal(lastRetry.correct, false);
  assert.equal(lastRetry.response, "second answer", "the retry entry carries the bounded response");
  assert.equal(lastRetry.awarded, 2, "the retry entry carries the awarded mark");
  assert.equal(lastRetry.conf, undefined, "recordError retries never carried conf — unchanged");
  assert.equal(e.response, "second answer", "the record-level response is the latest miss's");
  assert.equal(e.awarded, 2);
});

// ── applyRetry / markReviewResult (review-wrong) ───────────────────────────
test("applyRetry wrong with extra: response/awarded ride the retry entry AND update the record level; correct stores nothing", () => {
  const QE = makeEnv({ readyState: "loading" }).load("store.js").load("quiz-engine.js").NB.quizEngine;
  const rec = Object.assign(writtenItem(), { key: "lib-x#w1", attempts: 1, resolved: false, ts: 1, response: "old answer", awarded: 0, retries: [] });
  QE.applyRetry(rec, false, "guess", 10 * 86400000, { response: "review answer", awarded: 1 });
  const r = rec.retries[rec.retries.length - 1];
  assert.equal(r.correct, false);
  assert.equal(r.conf, "guess", "conf rides the entry as before");
  assert.equal(r.response, "review answer");
  assert.equal(r.awarded, 1);
  assert.equal(rec.response, "review answer", "record-level mirrors recordError's repeat-miss branch");
  assert.equal(rec.awarded, 1);
  QE.applyRetry(rec, true, null, 11 * 86400000, { response: "should not be stored", awarded: 3 });
  const lastRetry = rec.retries[rec.retries.length - 1];
  assert.equal(lastRetry.correct, true);
  assert.equal(lastRetry.response, undefined, "a correct outcome stores no response anywhere");
  assert.equal(lastRetry.awarded, undefined);
  assert.equal(lastRetry.conf, undefined);
  assert.equal(rec.response, "review answer", "the record-level fields are untouched by a correct outcome");
  assert.equal(rec.awarded, 1);
});

test("markReviewResult passes extra through to applyRetry on a stored record", async () => {
  const env = await boot();
  env.NB.store.set("q-errors", [Object.assign(writtenItem(), {
    key: "lib-x#w1", attempts: 1, firstMissed: "2026-11-01", lastMissed: "2026-11-01",
    resolved: false, ts: 1, retries: [],
  })]);
  env.NB.quizEngine.markReviewResult({ errKey: "lib-x#w1", marks: 3, markscheme: BANK.items[0].markscheme }, false, "guess", { response: "still wrong", awarded: 2 });
  const e = plain(env.NB.store.get("q-errors"))[0];
  assert.equal(e.retries.length, 1);
  assert.equal(e.retries[0].response, "still wrong");
  assert.equal(e.retries[0].awarded, 2);
  assert.equal(e.response, "still wrong");
  assert.equal(e.awarded, 2);
  assert.equal(e.resolved, false);
});

// ── boundResponse + the empty case ─────────────────────────────────────────
test("boundResponse: 5000 chars → 2000; whitespace trimmed; null/undefined → empty string", () => {
  const QE = makeEnv({ readyState: "loading" }).load("store.js").load("quiz-engine.js").NB.quizEngine;
  assert.equal(QE.boundResponse("x".repeat(5000)).length, 2000);
  assert.equal(QE.boundResponse("x".repeat(2000)).length, 2000);
  assert.equal(QE.boundResponse("  hi there  "), "hi there");
  assert.equal(QE.boundResponse(null), "");
  assert.equal(QE.boundResponse(undefined), "");
  assert.equal(QE.boundResponse(""), "");
});

test("a whitespace-only typed response stores no response field (but the awarded mark is kept, 0 included)", async () => {
  const env = await boot({ location: { search: "?from=lib-x:w1" } });
  last(env, "q-reveal-guess")();
  env.document.getElementById("q-answer").value = "   ";
  env.document.getElementById("q-selfscore").value = "0"; // 0 of 3
  last(env, "q-next")();
  const e = plain(env.NB.store.get("q-errors"))[0];
  assert.equal(e.response, undefined, "empty after bounding → the field is absent, never \"\"");
  assert.equal(e.awarded, 0, "awarded 0 is a real value and is stored");
});

// ── errMerge / union pins (assets/store.js) ────────────────────────────────
test("merge.union q-errors: retry-entry response/awarded ride the retries union", () => {
  const { union } = makeEnv({ readyState: "loading" }).load("store.js").NB.merge;
  const merged = plain(union("q-errors",
    [{ key: "k", ts: 9, retries: [{ ts: 1, correct: false, response: "mine", awarded: 2 }] }],
    [{ key: "k", ts: 3, retries: [{ ts: 2, correct: false, response: "theirs" }] }]));
  assert.deepEqual(merged[0].retries, [
    { ts: 1, correct: false, response: "mine", awarded: 2 },
    { ts: 2, correct: false, response: "theirs" },
  ], "both devices' written attempts survive the merge");
});

test("merge.union q-errors: an identical (ts, correct) pair keeps the winner's WHOLE retry entry", () => {
  const { union } = makeEnv({ readyState: "loading" }).load("store.js").NB.merge;
  // Known limitation, pinned deliberately: retry dedupe is by [ts, correct] only,
  // so two devices answering at the exact same ms keep only the rank winner's
  // entry — its response/awarded (the whole entry) win; the loser's are dropped.
  const merged = plain(union("q-errors",
    [{ key: "k", ts: 9, retries: [{ ts: 100, correct: false, response: "winner-kept", awarded: 2 }] }],
    [{ key: "k", ts: 3, retries: [{ ts: 100, correct: false, response: "loser-dropped", awarded: 1 }] }]));
  assert.deepEqual(merged[0].retries, [{ ts: 100, correct: false, response: "winner-kept", awarded: 2 }]);
});

test("merge.union q-errors: record-level response/awarded ride the errRank winner and are NOT fill-from-loser", () => {
  const { union } = makeEnv({ readyState: "loading" }).load("store.js").NB.merge;
  assert.deepEqual(plain(union("q-errors",
    [{ key: "k", ts: 9, response: "A", awarded: 1 }],
    [{ key: "k", ts: 3, response: "B", awarded: 2 }])),
    [{ key: "k", ts: 9, response: "A", awarded: 1 }], "both sides have them → the winner's values win");
  assert.deepEqual(plain(union("q-errors",
    [{ key: "k", ts: 9 }],
    [{ key: "k", ts: 3, response: "B", awarded: 2 }])),
    [{ key: "k", ts: 9 }], "the winner lacks them → they are NOT filled from the loser (the fill list is reflection/errorType/dueAt only)");
});

// ── quota-full storage: the write fails, the flow survives ─────────────────
test("recordError with storage at quota: set returns false, recordError returns cleanly, nothing persisted", () => {
  const env = makeEnv({ readyState: "loading", quota: 60, data: { "q-errors": JSON.stringify([
    Object.assign(writtenItem({ bankId: "lib-x", subject: "biology-hl" }), {
      key: "lib-x#w1", attempts: 1, firstMissed: "2026-11-01", lastMissed: "2026-11-20",
      resolved: false, ts: 5, retries: [],
    }),
  ]) } }).load("store.js").load("quiz-engine.js");
  assert.equal(env.NB.quizEngine.recordError(writtenItem(), { response: "second answer", awarded: 2, conf: "guess" }), undefined,
    "a failed persistence is not a crash — the engine just carries on");
  assert.equal(plain(env.NB.store.get("q-errors"))[0].attempts, 1, "the stored record is unchanged (the miss is not half-written)");
});

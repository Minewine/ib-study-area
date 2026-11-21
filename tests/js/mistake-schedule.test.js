// node --test tests/js — the spaced-retest schedule over "q-errors"
// (assets/quiz-engine.js): the 7/30-day due ladder, the pure retry applier
// (applyRetry), the due gate in pickReviewErrors, and recordError's repeat-miss
// preservation. The engine is loaded WITHOUT firing DOMContentLoaded
// (readyState "loading"), like quiz-picker.test.js — only exported functions
// are exercised; the pure helpers take an explicit nowMs (no date faking).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeEnv, plain } = require("./harness");

const DAY = 86400000;
const engine = () => {
  const env = makeEnv({ readyState: "loading" }).load("store.js").load("quiz-engine.js");
  return { env, QE: env.NB.quizEngine };
};
const rec = (over) => Object.assign({
  key: "bio-y#1", id: "1", bankId: "bio-y", stem: "s", format: "mcq", attempts: 1,
  firstMissed: "2026-11-20", lastMissed: "2026-11-20", resolved: false, ts: 100,
}, over);

// ── due ladder ─────────────────────────────────────────────────────────────
test("dueDelayMs: first wrong outcome → 7 days, any later one → 30 days; nextDueAt adds it to now", () => {
  const { QE } = engine();
  assert.equal(QE.dueDelayMs(0), 7 * DAY, "a brand-new record reads as the first miss");
  assert.equal(QE.dueDelayMs(1), 7 * DAY);
  assert.equal(QE.dueDelayMs(2), 30 * DAY);
  assert.equal(QE.dueDelayMs(9), 30 * DAY);
  assert.equal(QE.dueDelayMs(undefined), 7 * DAY);
  assert.equal(QE.nextDueAt({ attempts: 1 }, 1000), 1000 + 7 * DAY);
  assert.equal(QE.nextDueAt({ attempts: 2 }, 1000), 1000 + 30 * DAY);
  assert.equal(QE.nextDueAt({}, 1000), 1000 + 7 * DAY, "no attempts yet = first miss");
});

test("isDue: open + due (or no dueAt) → true; resolved, retired and not-yet-due → false", () => {
  const { QE } = engine();
  const now = 5000;
  assert.equal(QE.isDue(rec({ dueAt: 5000 }), now), true, "dueAt == now is due");
  assert.equal(QE.isDue(rec({ dueAt: 4999 }), now), true);
  assert.equal(QE.isDue(rec({ dueAt: 5001 }), now), false, "not yet due");
  assert.equal(QE.isDue(rec({}), now), true, "legacy record without dueAt is due now");
  assert.equal(QE.isDue(rec({ dueAt: null }), now), true);
  assert.equal(QE.isDue(rec({ dueAt: 1, resolved: true }), now), false, "recovered records never come due");
  assert.equal(QE.isDue(rec({ dueAt: 1, retired: true }), now), false, "retired records never come due");
  assert.equal(QE.isDue(null, now), false);
});

// ── applyRetry ─────────────────────────────────────────────────────────────
test("applyRetry wrong: re-opens a resolved record, counts the wrong outcome, reschedules +30 days", () => {
  const { QE } = engine();
  const now = 10 * DAY;
  // missed once (attempts 1), recovered at the 7-day retest (resolved, schedule cleared),
  // then missed again in a LATER review — the old bug left it resolved forever
  const e = rec({ attempts: 1, resolved: true, ts: 8 * DAY, retries: [{ ts: 8 * DAY, correct: true }] });
  QE.applyRetry(e, false, "guess", now);
  assert.equal(e.resolved, false, "a wrong retry re-opens the record");
  assert.equal(e.attempts, 2, "attempts counts wrong outcomes");
  assert.equal(e.dueAt, now + 30 * DAY, "second wrong outcome → 30-day retest");
  assert.equal(e.ts, now);
  assert.ok(e.lastAttempt, "lastAttempt written (local date)");
  assert.equal(e.retries.length, 2);
  assert.equal(e.retries[1].correct, false);
  assert.equal(e.retries[1].conf, "guess", "the review rating rides the retry entry (as markReviewResult always recorded)");
  assert.equal(e.retries[1].ts > 0, true);
});

test("applyRetry correct BEFORE the scheduled retest: practice only — stays open, schedule kept", () => {
  const { QE } = engine();
  const now = 3 * DAY, due = 7 * DAY;
  const e = rec({ attempts: 1, resolved: false, dueAt: due });
  QE.applyRetry(e, true, null, now);
  assert.equal(e.resolved, false, "an early correct answer is practice, not recovery");
  assert.equal(e.dueAt, due, "the schedule is unchanged");
  assert.equal(e.attempts, 1, "attempts counts wrong outcomes only");
  assert.equal(e.ts, now);
  assert.equal(e.retries.length, 1);
  assert.equal(e.retries[0].correct, true);
});

test("applyRetry correct AT/AFTER the scheduled retest: recovered, schedule cleared", () => {
  const { QE } = engine();
  const e = rec({ attempts: 1, resolved: false, dueAt: 7 * DAY });
  QE.applyRetry(e, true, null, 7 * DAY);
  assert.equal(e.resolved, true, "dueAt == now recovers");
  assert.equal(e.dueAt, undefined, "the schedule is cleared on recovery");
  assert.equal(e.ts, 7 * DAY);
  const late = rec({ attempts: 2, resolved: false, dueAt: 37 * DAY });
  QE.applyRetry(late, true, null, 40 * DAY);
  assert.equal(late.resolved, true, "a late retest recovers too");
  assert.equal(late.dueAt, undefined);
});

test("applyRetry: legacy record without dueAt recovers on the first correct answer", () => {
  const { QE } = engine();
  const e = rec({ attempts: 1, resolved: false });
  QE.applyRetry(e, true, null, 5 * DAY);
  assert.equal(e.resolved, true, "backward compatible: no schedule → first correct recovers");
  assert.equal(e.dueAt, undefined);
});

// ── pickReviewErrors: the due gate ─────────────────────────────────────────
test("pickReviewErrors: only due records serve 'Review past errors'; ignoreDue bypasses the gate", () => {
  const { QE } = engine();
  const now = 10 * DAY;
  const all = [
    rec({ key: "bio-y#due", id: "due", dueAt: now - 1 }),
    rec({ key: "bio-y#future", id: "future", dueAt: now + DAY }),
    rec({ key: "bio-y#legacy", id: "legacy" }), // no dueAt — legacy record, always due
    rec({ key: "bio-y#resolved", id: "resolved", resolved: true, dueAt: now - 1 }),
    rec({ key: "bio-y#retired", id: "retired", retired: true, dueAt: now - 1 }),
  ];
  const picked = plain(QE.pickReviewErrors(all, { nowMs: now }).errs.map(e => e.key));
  assert.deepEqual(picked, ["bio-y#due", "bio-y#legacy"], "not-yet-due, resolved and retired are skipped");
  assert.deepEqual(plain(QE.pickReviewErrors(all, { nowMs: now, ignoreDue: true }).errs.map(e => e.key)),
    ["bio-y#due", "bio-y#future", "bio-y#legacy"], "ignoreDue serves every open, unretired record");
  // the Mistakes deep link never gates: picked keys are served even before their retest is due
  assert.deepEqual(plain(QE.pickReviewErrors(all, { keys: ["bio-y#future"] }).errs.map(e => e.key)),
    ["bio-y#future"]);
});

// ── recordError: repeat misses update one record, snapshots survive ────────
test("recordError repeat miss: same record updated (no duplicate), reflection/errorType/snapshot kept, dueAt rescheduled", () => {
  const { env, QE } = engine();
  const before = rec({
    key: "bio-y#1", stem: "Why do water molecules attract each other?",
    choices: ["a", "b", "c"], answer: 2, userAnswer: 0, note: "note text", marks: null,
    tactic: "draw it", attempts: 2, firstMissed: "2026-11-01", lastMissed: "2026-11-19",
    resolved: false, reflection: "watch the units", errorType: "misread",
    retries: [{ ts: 5, correct: false }],
  });
  env.storage.setItem("q-errors", JSON.stringify([before]));
  QE.recordError({ id: "1", bankId: "bio-y", format: "mcq", stem: "Why do water molecules attract each other?",
    choices: ["a", "b", "c"], answer: 2, note: "note text", tactic: "draw it" }, { userChoice: 1 });
  const stored = plain(env.NB.store.get("q-errors"));
  assert.equal(stored.length, 1, "no duplicate record for the same key");
  const e = stored[0];
  assert.equal(e.attempts, 3, "the miss is counted");
  assert.equal(e.resolved, false);
  assert.equal(e.userAnswer, 1, "the latest wrong choice overwrites the stored one");
  assert.equal(e.dueAt, e.ts + 30 * DAY, "a later wrong outcome → 30-day retest");
  // snapshot + tag fields the repeat miss must not touch
  assert.equal(e.stem, "Why do water molecules attract each other?");
  assert.deepEqual(plain(e.choices), ["a", "b", "c"]);
  assert.equal(e.answer, 2);
  assert.equal(e.note, "note text");
  assert.equal(e.tactic, "draw it");
  assert.equal(e.firstMissed, "2026-11-01", "firstMissed keeps the original miss date");
  assert.equal(e.reflection, "watch the units");
  assert.equal(e.errorType, "misread");
  assert.equal(e.retries.length, 2, "the wrong outcome is appended to the retry history");
  assert.equal(e.retries[1].correct, false);
});

// A wrong retry always lands on the 30-day rung: the record carries at least the
// first miss (attempts ≥ 1), so the increment takes it past the ladder's first step.
// The 7-day rung itself is set when the record is CREATED (recordError's new-record
// branch — it needs a live session, so it is pinned by e2e: miss today → dueAt ≈ +7d).
test("applyRetry wrong on a once-missed record: attempts 1 → 2, so the retest lands 30 days out", () => {
  const { QE } = engine();
  const e = rec({ attempts: 1, resolved: false });
  QE.applyRetry(e, false, null, 1000);
  assert.equal(e.attempts, 2);
  assert.equal(e.dueAt, 1000 + 30 * DAY);
});

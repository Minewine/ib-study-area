// node --test tests/js — calibration card (assets/calib.js): summarize() over the
// quizlog conf tallies, including old entries without conf and hidden subjects.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeEnv, FakeStorage, plain } = require("./harness");

const env = (data) => makeEnv({ storage: new FakeStorage(data) }).load("calib.js");

test("summarize: aggregates sure/guessing tallies across sessions, newest-first trend capped at 5", () => {
  const log = [
    { date: "2026-11-24", label: "Bio A1.1", pct: 80, subject: "biology-hl", conf: { sure: 4, sureRight: 4, guess: 1, guessRight: 0 } },
    { date: "2026-11-20", label: "Chem S1.1", pct: 50, subject: "chemistry-hl", conf: { sure: 2, sureRight: 1, guess: 2, guessRight: 1 } },
    { date: "2026-11-18", label: "old session, unrated" }, // predates ratings
    { date: "2026-11-10", label: "Maths", pct: 100, subject: "math-aa-sl", conf: { sure: 6, sureRight: 5, guess: 0, guessRight: 0 } }
  ];
  const s = plain(env().NB.calib.summarize(log, null));
  assert.equal(s.sessions, 4);
  assert.equal(s.rated, 3);
  assert.deepEqual(s.sure, { n: 12, right: 10, pct: 83 });
  assert.deepEqual(s.guess, { n: 3, right: 1, pct: 33 });
  assert.equal(s.trend.length, 3); // unrated entry excluded from trend
  assert.deepEqual(s.trend[0], { date: "2026-11-24", label: "Bio A1.1", pct: 80, surePct: 100, guessPct: 0 });
  assert.equal(s.bySubject["chemistry-hl"].sure.n, 2);
  assert.equal(s.bySubject["math-aa-sl"].guess.n, 0); // zero-guess sessions add nothing
});

test("summarize: trend is capped at the 5 most recent rated sessions", () => {
  const log = [];
  for (let i = 8; i >= 1; i--) log.push({ date: "2026-11-" + String(i).padStart(2, "0"), label: "s" + i, conf: { sure: 1, sureRight: 1 } }); // newest first, like the engine's unshift
  const s = env().NB.calib.summarize(log, null);
  assert.equal(s.trend.length, 5);
  assert.equal(s.trend[0].label, "s8"); // newest first
  assert.equal(s.trend[4].label, "s4"); // s1–s3 fall off the cap
  assert.equal(s.rated, 8);
});

test("summarize: entries of hidden subjects drop out of everything rated; malformed rows are skipped", () => {
  const log = [
    { date: "2026-11-24", label: "History", subject: "history-sl", conf: { sure: 5, sureRight: 5 } },
    null,
    "junk",
    { date: "2026-11-23", label: "Bio", subject: "biology-hl", conf: { sure: 2, sureRight: 1 } },
    { date: "2026-11-22", label: "no conf yet" }
  ];
  const s = plain(env().NB.calib.summarize(log, (id) => id === "history-sl"));
  assert.equal(s.sessions, 3); // null and "junk" rows are skipped entirely
  assert.equal(s.rated, 1);
  assert.deepEqual(s.sure, { n: 2, right: 1, pct: 50 });
  assert.deepEqual(Object.keys(s.bySubject), ["biology-hl"]);
  assert.equal(s.trend.length, 1);
});

test("summarize: empty / garbage log yields the empty shape (render shows the hint)", () => {
  const s = plain(env().NB.calib.summarize(null, null));
  assert.deepEqual(s, { sessions: 0, rated: 0, sure: { n: 0, right: 0, pct: null }, guess: { n: 0, right: 0, pct: null }, bySubject: {}, trend: [] });
  assert.equal(env().NB.calib.summarize([], null).rated, 0);
});

test("summarize: missing tally fields and partial tallies (guess-only session) are safe", () => {
  const log = [
    { date: "2026-11-24", label: "a", conf: { guess: 3, guessRight: 2 } },
    { date: "2026-11-23", label: "b", conf: {} },
    { date: "2026-11-22", label: "c", conf: { sure: 2, sureRight: 2 } }
  ];
  const s = plain(env().NB.calib.summarize(log, null));
  assert.equal(s.rated, 3);
  assert.deepEqual(s.sure, { n: 2, right: 2, pct: 100 });
  assert.deepEqual(s.guess, { n: 3, right: 2, pct: 67 });
  assert.equal(s.trend[0].surePct, null); // guess-only session has no sure pct
  assert.equal(s.trend[0].guessPct, 67);
});

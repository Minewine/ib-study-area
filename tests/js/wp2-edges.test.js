// node --test tests/js — WP2 edge/failure paths over the spaced-retest schedule
// ("q-errors" dueAt). Pins what the WP2 suite (mistake-schedule.test.js etc.)
// does not: applyRetry/isDue millisecond boundaries, a re-miss AFTER recovery,
// the retries cap, errMerge × dueAt (incl. a stale loser resurrecting a dueAt
// onto a recovered winner), the real per-record behavior of NB.merge.union for
// q-errors, openMistakes' due gate edges, the mistake-log due label (local date
// around midnight), hostile stored data (string/negative dueAt, null attempts —
// helpers must degrade, never throw) and pickReviewErrors' empty/order/nowMs
// surface. Loads exactly like mistake-schedule.test.js (readyState "loading" —
// no boot, no fetches; nowMs injected everywhere; the recordError tests use the
// existing-record branch, since the new-record branch needs a live session).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeEnv, plain } = require("./harness");

const J = JSON.stringify;
const DAY = 86400000;
// one env with all four assets: the merge rules (store.js), the schedule helpers
// (quiz-engine.js), the log page (mistakes.js) and the Today panel (today.js)
const engine = (data) => {
  const env = makeEnv({ readyState: "loading", data: data || {} });
  env.load("store.js").load("quiz-engine.js").load("mistakes.js").load("today.js");
  return { env, QE: env.NB.quizEngine, M: env.NB.mistakes, T: env.NB.today, merge: env.NB.merge };
};

const rec = (over) => Object.assign({
  key: "bio-y#1", id: "1", bankId: "bio-y", stem: "s", format: "mcq", attempts: 1,
  firstMissed: "2026-11-20", lastMissed: "2026-11-20", resolved: false, ts: 100,
}, over);

// ── 1. millisecond boundaries ──────────────────────────────────────────────
test("applyRetry boundary: correct at dueAt-1ms stays open with the schedule kept; correct AT dueAt is the first success (7-day follow-up); isDue at exactly dueAt", () => {
  const { QE } = engine();
  const due = 1 * DAY;
  const early = rec({ attempts: 1, resolved: false, dueAt: due });
  QE.applyRetry(early, true, null, due - 1);
  assert.equal(early.resolved, false, "1ms before the retest it is still practice, not recovery");
  assert.equal(early.dueAt, due, "the schedule is untouched by an early correct answer");
  assert.equal(early.attempts, 1, "an early correct answer does not count as an outcome");
  assert.equal(early.retries.length, 1, "the practice attempt is still recorded");
  const at = rec({ attempts: 1, resolved: false, dueAt: due });
  QE.applyRetry(at, true, null, due);
  assert.equal(at.resolved, false, "dueAt == nowMs is a successful retrieval — the first one, so not recovered yet");
  assert.equal(at.dueAt, due + 7 * DAY, "the first success lengthens the interval to the 7-day follow-up");
  QE.applyRetry(at, true, null, due + 7 * DAY);
  assert.equal(at.resolved, true, "the second consecutive success recovers");
  assert.equal(at.dueAt, undefined, "the schedule is cleared on recovery");
  assert.equal(QE.isDue(rec({ dueAt: due }), due), true, "isDue boundary: dueAt == nowMs is due (also pinned in mistake-schedule.test.js)");
  assert.equal(QE.isDue(rec({ dueAt: due }), due - 1), false);
});

// ── 2. the ladder AFTER recovery ───────────────────────────────────────────
test("re-miss after recovery: a wrong retry re-opens the record on the short miss ladder; reflection/errorType survive recovery and the re-miss", () => {
  const { QE } = engine();
  const now = 40 * DAY;
  const e = rec({
    attempts: 1, resolved: true, ts: 8 * DAY, // recovered: the schedule was cleared
    reflection: "watch the units", errorType: "misread",
    retries: [{ ts: 2, correct: false }, { ts: 8 * DAY, correct: true }],
  });
  QE.applyRetry(e, false, null, now);
  assert.equal(e.resolved, false, "the re-miss re-opens the record");
  assert.equal(e.attempts, 2, "attempts counts the new wrong outcome");
  assert.equal(e.dueAt, now + 2 * DAY, "attempts 2 → the 2-day rung of the short miss ladder");
  assert.equal(e.reflection, "watch the units", "applyRetry touches only outcome/schedule fields");
  assert.equal(e.errorType, "misread");
  assert.equal(e.retries.length, 3, "the wrong outcome is appended to the kept history");
  // same ladder from a deeper hole: two misses before the recovery
  const deep = rec({ attempts: 2, resolved: true, ts: 40 * DAY });
  QE.applyRetry(deep, false, null, 41 * DAY);
  assert.equal(deep.attempts, 3);
  assert.equal(deep.dueAt, 41 * DAY + 3 * DAY, "attempts ≥ 3 → the capped 3-day rung");
});

test("recordError on a recovered stored record: re-opens it, attempts 1→2, the schedule is re-written +2 days", () => {
  const { env, QE } = engine({ "q-errors": J([rec({ attempts: 1, resolved: true, ts: 8 * DAY, dueAt: undefined })]) });
  QE.recordError({ id: "1", bankId: "bio-y", format: "mcq", stem: "s" }, { userChoice: 1 });
  const e = plain(env.NB.store.get("q-errors"))[0];
  assert.equal(e.resolved, false, "the repeat miss re-opens the recovered record");
  assert.equal(e.attempts, 2);
  assert.equal(e.dueAt - e.ts, 2 * DAY, "the 2-day rung, measured from the write (Date.now() is the real clock here)");
  assert.match(e.lastMissed, /^\d{4}-\d{2}-\d{2}$/, "lastMissed re-stamped with the local date");
  assert.equal(e.firstMissed, "2026-11-20", "firstMissed keeps the original miss date");
});

// ── 3. the retries cap ─────────────────────────────────────────────────────
test("retries cap: applyRetry/recordError keep appending past 20 while the ladder works off attempts; the array stays capped", () => {
  const { env, QE } = engine();
  const history = Array.from({ length: 20 }, (_, i) => ({ ts: i + 1, correct: i % 2 === 0 }));
  const full = rec({ attempts: 3, resolved: false, dueAt: 5 * DAY, retries: history });
  QE.applyRetry(full, false, null, 10 * DAY);
  assert.equal(full.retries.length, 20, "capped at 20, not grown to 21");
  assert.equal(full.retries[19].correct, false, "the new outcome is the last entry");
  assert.ok(full.retries[19].ts > 20, "…stamped with the real clock, not a fixture ts");
  assert.equal(full.retries[0].ts, 2, "the OLDEST entry was dropped to make room");
  assert.equal(full.attempts, 4, "the ladder reads attempts, not the (capped) history");
  assert.equal(full.dueAt, 10 * DAY + 3 * DAY, "attempts ≥ 3 → the capped 3-day rung");
  // the same cap through the storage round-trip (recordError → pushRetry)
  env.storage.setItem("q-errors", J([rec({ key: "bio-y#2", id: "2", attempts: 3, retries: history })]));
  QE.recordError({ id: "2", bankId: "bio-y", format: "mcq", stem: "s2" }, { userChoice: 1 });
  const e = plain(env.NB.store.get("q-errors"))[0];
  assert.equal(e.retries.length, 20);
  assert.equal(e.attempts, 4);
  assert.equal(e.dueAt - e.ts, 3 * DAY);
});

// ── 4. errMerge × dueAt (the sync/restore merge) ───────────────────────────
test("errMerge via union: a winner without dueAt inherits the loser's schedule and unions the retries; a winner's own dueAt stands", () => {
  const { merge } = engine();
  // winner = higher ts, NO dueAt (recovered — schedule cleared — or a legacy writer);
  // the loser is older but carries a schedule AND the longer retry history
  const a = plain(merge.union("q-errors",
    [{ key: "k", ts: 300, attempts: 1, retries: [{ ts: 50, correct: false }] }],
    [{ key: "k", ts: 200, attempts: 2, dueAt: 123456, retries: [{ ts: 10, correct: false }, { ts: 20, correct: true }] }]));
  assert.equal(a.length, 1);
  assert.equal(a[0].ts, 300, "the errRank winner (ts) wins");
  assert.equal(a[0].dueAt, 123456, "the loser's schedule fills in — dueAt is on the fill-from-loser set");
  assert.deepEqual(plain(a[0].retries), [{ ts: 10, correct: false }, { ts: 20, correct: true }, { ts: 50, correct: false }],
    "the retry history is the union of both sides, ascending by ts");
  // reverse: the winner HAS a dueAt, the loser doesn't → the winner's value stands
  const b = plain(merge.union("q-errors",
    [{ key: "k", ts: 300, dueAt: 555 }],
    [{ key: "k", ts: 200 }]));
  assert.equal(b[0].dueAt, 555);
  assert.equal(b[0].retries, undefined, "no retries anywhere → none invented");
});

test("errMerge: a recovered winner stays resolved; a stale loser's resurrected dueAt is inert everywhere — until a new outcome overwrites it", () => {
  const { QE, M, T, merge } = engine();
  const merged = plain(merge.union("q-errors",
    // winner: recovered on this device (higher ts, resolved, schedule cleared)
    [{ key: "k", ts: 300 * DAY, attempts: 1, resolved: true, retries: [{ ts: 2, correct: false }, { ts: 300 * DAY, correct: true }] }],
    // stale open copy from before the recovery, still carrying a (past) schedule
    [{ key: "k", ts: 200 * DAY, attempts: 1, resolved: false, dueAt: 210 * DAY }]))[0];
  assert.equal(merged.resolved, true, "resolved stays resolved — the higher-ts recovery wins");
  assert.equal(merged.dueAt, 210 * DAY, "…but the missing dueAt is filled from the loser, so the schedule key DOES resurrect");
  // inert everywhere the schedule is consumed:
  assert.equal(QE.isDue(merged, 300 * DAY), false, "isDue: resolved beats any dueAt");
  assert.equal(M.statusOf(merged), "recovered", "the log lists it as recovered, not open");
  assert.deepEqual(plain(T.openMistakes([merged], null, 300 * DAY)), [], "the Today panel skips resolved records");
  // and the next wrong retry overwrites the resurrected value with a live schedule
  QE.applyRetry(merged, false, null, 400 * DAY);
  assert.equal(merged.resolved, false);
  assert.equal(merged.dueAt, 400 * DAY + 2 * DAY, "attempts 2 → the 2-day rung of the short miss ladder");
});

test("errMerge: an open winner keeps its state over a resolved loser — open does not inherit 'resolved' from a stale copy", () => {
  const { QE, merge } = engine();
  const m = plain(merge.union("q-errors",
    [{ key: "k", ts: 300 * DAY, attempts: 2, dueAt: 305 * DAY }], // open, with a live future retest — the newest fact
    [{ key: "k", ts: 200 * DAY, resolved: true }]))[0];           // an older "recovered" copy
  assert.equal(m.resolved, undefined, "resolved is NOT on the fill-from-loser set: the open winner must not be recovered by a stale copy");
  assert.equal(m.dueAt, 305 * DAY, "the winner's live schedule stands");
  assert.equal(QE.isDue(m, 304 * DAY), false);
  assert.equal(QE.isDue(m, 305 * DAY), true, "and it comes due exactly when scheduled");
});

// ── 5. the union() path for q-errors ───────────────────────────────────────
// union() checks RECORDS before UNIONS (assets/store.js), so the q-errors
// "union" (first login / backup restore) IS the field-aware errMerge — pinned
// here so reordering those checks cannot silently change restore behavior.
test("NB.merge.union('q-errors') routes through the field-aware record merge: a shared key collapses into ONE merged record", () => {
  const { merge } = engine();
  const out = plain(merge.union("q-errors",
    [{ key: "a", ts: 300, dueAt: 1000, retries: [{ ts: 1, correct: false }] }], // a wins conflicts
    [{ key: "a", ts: 200, dueAt: 500, retries: [{ ts: 2, correct: true }] }, { key: "b", ts: 9 }]));
  assert.deepEqual(plain(out.map(r => r.key).sort()), ["a", "b"], "distinct keys both survive");
  const a = out.find(r => r.key === "a");
  assert.equal(a.ts, 300, "newest ts wins per record");
  assert.equal(a.dueAt, 1000, "the winner's schedule stands when both sides carry one");
  assert.deepEqual(plain(a.retries), [{ ts: 1, correct: false }, { ts: 2, correct: true }], "and the retry history is unioned (errMerge ran)");
});

// ── 6. openMistakes edges ──────────────────────────────────────────────────
test("openMistakes edges: dueAt exactly now counts as due; hides still apply; legacy records (no/null dueAt) always show", () => {
  const { T } = engine();
  const now = 30 * DAY;
  const errs = [
    { key: "bio-y#now", bankId: "bio-y", topicLabel: "Enzymes", subject: "biology-hl", dueAt: now, lastMissed: "2026-11-20" },
    { key: "bio-y#null", bankId: "bio-y", topicLabel: "Enzymes", subject: "biology-hl", dueAt: null, lastMissed: "2026-11-19" },
    { key: "bio-y#legacy", bankId: "bio-y", topicLabel: "Enzymes", subject: "biology-hl", lastMissed: "2026-11-18" }, // no key at all
    { key: "bio-y#past", bankId: "bio-y", topicLabel: "Enzymes", subject: "biology-hl", dueAt: -1, lastMissed: "2026-11-17" },
    { key: "bio-y#future", bankId: "bio-y", topicLabel: "Enzymes", subject: "biology-hl", dueAt: now + 1, lastMissed: "2026-11-16" },
    { key: "chem-y#now", bankId: "chem-y", topicLabel: "Bonding", subject: "chemistry-hl", dueAt: now, lastMissed: "2026-11-15" },
  ];
  assert.deepEqual(plain(T.openMistakes(errs, null, now).map(g => g.keys)),
    [["bio-y#now", "bio-y#null", "bio-y#legacy", "bio-y#past"], ["chem-y#now"]],
    "dueAt == now is due, negative dueAt is long past due, both legacy shapes show; only the future one is held back");
  const hidden = T.openMistakes(errs, (id) => id === "biology-hl", now);
  assert.deepEqual(plain(hidden.map(g => g.label)), ["Bonding"], "the profile hide still applies to exactly-due records");
  assert.deepEqual(plain(hidden[0].keys), ["chem-y#now"]);
});

test("openMistakes with a hostile dueAt (string): degrades to SHOWN — the panel may over-include, but never throws or hides a real mistake", () => {
  const { T } = engine();
  const now = 30 * DAY;
  const errs = [{ key: "bio-y#str", bankId: "bio-y", topicLabel: "Enzymes", dueAt: "2026-11-28", lastMissed: "2026-11-20" }];
  // "2026-11-28" > now is a NaN comparison → false → the record is NOT skipped.
  // (quiz-engine's isDue reads the same record as NOT due — the conservative side —
  // while the panel errs visible. The errkeys deep link bypasses the gate anyway.)
  assert.deepEqual(plain(T.openMistakes(errs, null, now).map(g => g.keys)), [["bio-y#str"]]);
});

// ── 7. the mistake-log due label ───────────────────────────────────────────
// rowHtml is reached through mount(); the harness fake DOM has no querySelector,
// so the panel is a tiny stub (one element per selector, innerHTML strings,
// renderList's row-wiring loop skipped via querySelectorAll → []).
const panelStub = () => {
  const els = {};
  const el = () => ({ innerHTML: "", value: "", listeners: {}, querySelectorAll: () => [],
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); } });
  return {
    innerHTML: "",
    querySelector(sel) { return els[sel] || (els[sel] = el()); },
    querySelectorAll() { return []; },
    list: () => els["#mk-list"]
  };
};
const rowHtmlFor = (data, status) => {
  const { M } = engine(Object.assign({ "mistakes-filters": J({ status: status || "all", subject: "", q: "" }) }, data));
  const p = panelStub();
  M.mount(p);
  return p.list().innerHTML;
};

test("mistakes.js rows: the due label is the LOCAL calendar day of dueAt — the last ms before local midnight rolls back a day", () => {
  // local midnight of Jan 15 2026 (new Date(y,m,d) is defined as 00:00 LOCAL):
  // Jan 14/15 has no DST transition in any zone, so both boundaries are exact everywhere
  const mid = new Date(2026, 0, 15).getTime();
  assert.match(rowHtmlFor({ "q-errors": J([rec({ dueAt: mid - 1 })]) }), /due 2026-01-14/,
    "23:59:59.999 local is still the 14th (a UTC-based derivation would print the wrong day off-UTC)");
  assert.match(rowHtmlFor({ "q-errors": J([rec({ dueAt: mid })]) }), /due 2026-01-15/, "midnight itself is the 15th");
});

test("mistakes.js rows: retired and recovered records never show a due label — not even a stale-merge resurrected one", () => {
  const html = (over) => rowHtmlFor({ "q-errors": J([rec(Object.assign({ dueAt: 900 * DAY }, over))]) });
  assert.doesNotMatch(html({ retired: true, retiredReason: "off-syllabus" }), /due /, "retired: no due label");
  assert.doesNotMatch(html({ resolved: true }), /due /, "recovered: no due label (the inert resurrected dueAt never reaches the UI)");
  assert.match(html({ resolved: true }), /Recovered/, "the recovered badge is there instead");
});

test("mistakes.js rows: hostile dueAt values (string, negative) and missing attempts render without throwing", () => {
  assert.match(rowHtmlFor({ "q-errors": J([rec({ dueAt: "2026-11-28" })]) }), /due \d{4}-\d{2}-\d{2}/,
    "a string dueAt still renders A date (Date() parses it; the exact day can drift off-UTC — corrupt data is never fatal)");
  assert.match(rowHtmlFor({ "q-errors": J([rec({ dueAt: -5000 })]) }), /due \d{4}-\d{2}-\d{2}/, "negative dueAt → a pre-1970 date, no crash");
  assert.match(rowHtmlFor({ "q-errors": J([rec({ attempts: undefined })]) }), /1 attempt/, "undefined attempts render as 1, never 'NaN attempts'");
});

// ── 8. hostile data in the pure helpers ────────────────────────────────────
test("hostile stored data in the pure helpers: string/negative dueAt, attempts undefined/null — no throws, degradation documented", () => {
  const { QE } = engine();
  // dueAt as a string (a corrupted writer): the relational compare ToNumbers it → NaN
  const str = rec({ dueAt: "2026-11-28" });
  assert.equal(QE.isDue(str, 1000), false, "a string schedule reads as NOT due (NaN comparison) — never throws");
  QE.applyRetry(str, true, null, 1000);
  assert.equal(str.resolved, false, "…and it blocks recovery too: '2026-11-28' <= 1000 is false, so even a correct answer stays practice");
  assert.equal(str.dueAt, "2026-11-28", "the corrupt value is left as-is (a wrong retry rewrites it — see the recordError test)");
  assert.equal(QE.isDue(rec({ dueAt: -1 }), 1000), true, "a negative dueAt is long past due → due");
  // attempts undefined/null read as "first miss" → the 1-day rung
  const fresh = rec({ attempts: undefined, resolved: false });
  QE.applyRetry(fresh, false, null, 1000);
  assert.equal(fresh.attempts, 1);
  assert.equal(fresh.dueAt, 1000 + 1 * DAY, "attempts 1 after the increment → 1-day rung");
  assert.equal(QE.dueDelayMs(null), 1 * DAY);
  assert.equal(QE.dueDelayMs(undefined), 1 * DAY);
  assert.equal(QE.nextDueAt(null, 1000), 1000 + 1 * DAY, "nextDueAt tolerates a missing record");
  assert.equal(QE.nextDueAt({ attempts: null }, 1000), 1000 + 1 * DAY);
  // a non-array retries field is rebuilt, not concatenated onto or crashed on
  const junk = rec({ retries: "junk" });
  QE.applyRetry(junk, true, null, 1000);
  assert.equal(junk.retries.length, 1, "pushRetry starts a fresh history over a corrupt one");
});

test("recordError on hostile stored data: string dueAt + null attempts are rewritten as real numbers on the right rung", () => {
  const { env, QE } = engine({ "q-errors": J([rec({ attempts: null, dueAt: "2026-11-28" })]) });
  QE.recordError({ id: "1", bankId: "bio-y", format: "mcq", stem: "s" }, { userChoice: 1 });
  const e = plain(env.NB.store.get("q-errors"))[0];
  assert.equal(e.attempts, 1, "null attempts reads as the first miss (0 + 1)");
  assert.equal(typeof e.dueAt, "number", "the corrupt string schedule is replaced by a real epoch ms");
  assert.equal(e.dueAt - e.ts, 1 * DAY, "attempts 1 after the increment → the 1-day rung");
  assert.equal(e.resolved, false);
});

// ── 9. pickReviewErrors surface ────────────────────────────────────────────
test("pickReviewErrors: empty input, empty keys input; ordering keeps the input order (no due-soonest sort); opts.nowMs is respected", () => {
  const { QE } = engine();
  assert.deepEqual(plain(QE.pickReviewErrors([], {})), { errs: [], bits: [], retiredN: 0 });
  assert.deepEqual(plain(QE.pickReviewErrors([], { keys: ["k#1"] })),
    { errs: [], bits: ["1 linked item(s) not found."], retiredN: 0 });
  const now = 30 * DAY;
  const all = [
    rec({ key: "bio-y#late", id: "late", dueAt: now + 100 }),
    rec({ key: "bio-y#early", id: "early", dueAt: now + 1 }),
    rec({ key: "bio-y#past", id: "past", dueAt: now - 1 }),
  ];
  // no re-sort by due date: the input order is kept (startReview shuffles the
  // picked set downstream, so serving order is not user-visible)
  assert.deepEqual(plain(QE.pickReviewErrors(all, { nowMs: now + 1000 }).errs.map(e => e.key)),
    ["bio-y#late", "bio-y#early", "bio-y#past"], "all-due input → served in input order");
  assert.deepEqual(plain(QE.pickReviewErrors(all, { nowMs: now }).errs.map(e => e.key)),
    ["bio-y#past"], "one tick before the others come due → only the past-due record serves");
  // without nowMs the real clock decides (the fixture epochs near 1970 would all
  // be long past due, so the no-nowMs case is pinned against Date.now() itself)
  const tomorrow = rec({ key: "bio-y#tomorrow", id: "tomorrow", dueAt: Date.now() + DAY });
  const justNow = rec({ key: "bio-y#justnow", id: "justnow", dueAt: Date.now() - 1 });
  assert.deepEqual(plain(QE.pickReviewErrors([tomorrow, justNow], {}).errs.map(e => e.key)),
    ["bio-y#justnow"], "no nowMs → the real clock: a retest scheduled for tomorrow doesn't serve today");
});

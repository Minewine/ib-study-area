// node --test tests/js — mistake-log page logic (assets/mistakes.js over "q-errors"):
// status ranking, filters, tag/reflection edits, reversible retire. The store/sync
// side of q-errors is pinned in store.test.js + auth-merge.test.js; this file pins
// the page engine the mistake-log page mounts.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeEnv, FakeStorage, plain } = require("./harness");

const J = JSON.stringify;
const mk = (data) => makeEnv({ storage: new FakeStorage(data) }).load("store.js").load("profile.js").load("mistakes.js");
const M = (e) => e.NB.mistakes;

const err = (over) => Object.assign({
  key: "bio-molecules-water#wm01", bankId: "bio-molecules-water", id: "wm01",
  stem: "Why do water molecules attract each other?", attempts: 1, ts: 100,
  firstMissed: "2026-11-19", lastMissed: "2026-11-19", resolved: false,
}, over);

test("statusOf: retired beats recovered beats open", () => {
  const e = mk();
  assert.equal(M(e).statusOf(err()), "open");
  assert.equal(M(e).statusOf(err({ resolved: true })), "recovered");
  assert.equal(M(e).statusOf(err({ resolved: true, retired: true })), "retired");
  assert.equal(M(e).statusOf(err({ retired: true })), "retired");
});

test("filterRecords: status filter (retired hidden from open), subject + profile hiding, search", () => {
  const e = mk({
    "profile": J({ subjects: ["biology-hl"] }),
    "q-errors": J([
      err(), // open bio
      err({ key: "b#2", id: "2", resolved: true, stem: "Recovered stem" }), // recovered bio
      err({ key: "b#3", id: "3", retired: true, retiredReason: "not in our book", stem: "Retired stem" }), // retired bio
      err({ key: "c#4", id: "4", stem: "Chem misread", subject: "chemistry-hl" }), // out-of-profile
    ]),
  });
  const recs = plain(e.NB.store.get("q-errors"));
  const r = M(e);
  assert.deepEqual(plain(r.filterRecords(recs, { status: "open" }).map(x => x.key)), ["bio-molecules-water#wm01"],
    "open hides recovered AND retired");
  assert.deepEqual(plain(r.filterRecords(recs, { status: "recovered" }).map(x => x.key)), ["b#2"]);
  assert.deepEqual(plain(r.filterRecords(recs, { status: "retired" }).map(x => x.key)), ["b#3"]);
  const all = r.filterRecords(recs, { status: "all" });
  assert.equal(all.length, 3, "all shows every status but still respects the profile");
  assert.ok(all.every(x => x.subject !== "chemistry-hl"), "profile hides chemistry");
  assert.deepEqual(plain(r.filterRecords(recs, { status: "all", subject: "chemistry-hl" }).map(x => x.key)), [],
    "explicit subject filter still respects the profile");
  assert.deepEqual(plain(r.filterRecords(recs, { status: "all", q: "misread" }).map(x => x.key)), [],
    "search covers the stem — no chemistry hit outside the profile");
  assert.deepEqual(plain(r.filterRecords(recs, { status: "all", q: "attract" }).map(x => x.key)), ["bio-molecules-water#wm01"],
    "search narrows to the matching stem");
});

test("retire/restore: reversible soft-hide with a reason, never deleted, ts bumped", () => {
  const e = mk({ "q-errors": J([err()]) });
  const r = M(e);
  assert.equal(r.retire("bio-molecules-water#wm01", "  beyond the syllabus  "), true);
  let rec = plain(e.NB.store.get("q-errors"))[0];
  assert.equal(rec.retired, true);
  assert.equal(rec.retiredReason, "beyond the syllabus", "reason trimmed");
  assert.equal(rec.retiredAt > 0, true);
  assert.ok(rec.ts > 100, "ts bumped for the merge");
  assert.equal(rec.key, "bio-molecules-water#wm01", "record still present — never hard-deleted");
  assert.equal(r.restore("bio-molecules-water#wm01"), true);
  rec = plain(e.NB.store.get("q-errors"))[0];
  assert.equal(rec.retired, undefined);
  assert.equal(rec.retiredReason, undefined);
  assert.equal(rec.retiredAt, undefined);
  assert.equal(r.retire("nope#1", "x"), false, "unknown key refused");
  assert.equal(r.restore("nope#1"), false);
});

test("saveReflection/saveErrorType: caps and vocabulary; clear on empty", () => {
  const e = mk({ "q-errors": J([err()]) });
  const r = M(e);
  assert.equal(r.saveReflection("bio-molecules-water#wm01", "  read the units!  "), true);
  assert.equal(plain(e.NB.store.get("q-errors"))[0].reflection, "read the units!");
  r.saveReflection("bio-molecules-water#wm01", "x".repeat(600));
  assert.equal(plain(e.NB.store.get("q-errors"))[0].reflection.length, 500, "reflection capped at 500");
  r.saveReflection("bio-molecules-water#wm01", "");
  assert.equal(plain(e.NB.store.get("q-errors"))[0].reflection, undefined, "empty reflection clears");
  assert.equal(r.saveErrorType("bio-molecules-water#wm01", "misread"), true);
  assert.equal(plain(e.NB.store.get("q-errors"))[0].errorType, "misread");
  assert.equal(r.saveErrorType("bio-molecules-water#wm01", "invented"), true);
  assert.equal(plain(e.NB.store.get("q-errors"))[0].errorType, undefined, "unknown type clears the tag");
  assert.equal(r.saveReflection("nope#1", "x"), false);
});

test("sortRecords: open first, then recovered, then retired; most recent miss first within a status", () => {
  const e = mk();
  const r = M(e);
  const list = [
    err({ key: "b#r", id: "r", resolved: true, lastMissed: "2026-11-19" }),
    err({ key: "b#t", id: "t", retired: true, lastMissed: "2026-11-19" }),
    err({ key: "b#o2", id: "o2", lastMissed: "2026-11-18" }),
    err({ key: "b#o1", id: "o1", lastMissed: "2026-11-19" }),
  ];
  assert.deepEqual(plain(r.sortRecords(list).map(x => x.key)), ["b#o1", "b#o2", "b#r", "b#t"]);
});

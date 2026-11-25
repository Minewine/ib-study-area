// node --test tests/js — weekly retrieval sheet (assets/sheet.js): the pure item
// selectors over q-errors / fc-state / decks. Rendering needs a browser; these
// cover the selection rules the printed page depends on.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeEnv, FakeStorage, plain } = require("./harness");

const env = (data) => makeEnv({ storage: new FakeStorage(data) }).load("sheet.js");
const NOW = Date.parse("2026-11-25T12:00:00Z");
const TODAY = "2026-11-25";

test("dueErrorRecords: open + retest due (or legacy without dueAt), hidden subjects dropped, earliest due first", () => {
  const errors = [
    { key: "b#1", resolved: true, dueAt: 1 },                          // recovered — out
    { key: "b#2", retired: true, dueAt: 1 },                           // retired — out
    { key: "b#3", subject: "history-sl", dueAt: 1 },                   // hidden subject — out
    { key: "b#4", dueAt: NOW + 86400000, lastMissed: "2026-11-24" },   // retest not due yet — out
    { key: "b#5", dueAt: NOW - 1000, lastMissed: "2026-11-20", ts: 5 },// due
    { key: "b#6", lastMissed: "2026-11-22", ts: 9 },                    // legacy, no dueAt — due
    { key: "b#7", dueAt: NOW - 5000, lastMissed: "2026-11-21", ts: 7 } // due, earlier than b#5
  ];
  const out = plain(env().NB.sheet.dueErrorRecords(errors, NOW, (id) => id === "history-sl")).map(e => e.key);
  // by dueAt asc; a legacy record (no dueAt) counts as 0 = long overdue, so first
  assert.deepEqual(out, ["b#6", "b#7", "b#5"]);
});

test("dueErrorRecords: tie on dueAt falls back to most recent miss, then ts", () => {
  const errors = [
    { key: "old", dueAt: 100, lastMissed: "2026-11-01", ts: 1 },
    { key: "newer", dueAt: 100, lastMissed: "2026-11-24", ts: 2 }
  ];
  assert.deepEqual(plain(env().NB.sheet.dueErrorRecords(errors, NOW, null)).map(e => e.key), ["newer", "old"]);
  assert.deepEqual(plain(env().NB.sheet.dueErrorRecords(null, NOW, null)), []);
});

test("dueCardList: state due <= today, skipping deleted and retired cards; own cards have deck null", () => {
  const cards = [
    { id: "c1", front: "f1", back: "b1", deck: "d1" },
    { id: "c2", front: "f2", back: "b2", deck: "d1", retired: true },
    { id: "c3", front: "f3", back: "b3", deck: "d2" }
  ];
  const user = [{ id: "u1", front: "uf", back: "ub" }];
  const state = { c1: { due: "2026-11-25" }, c2: { due: "2026-11-01" }, c3: { due: "2026-11-26" }, u1: { due: "2026-11-20" } };
  const out = plain(env().NB.sheet.dueCardList(cards, user, state, TODAY, ["c1"]));
  assert.deepEqual(out, [{ id: "u1", front: "uf", back: "ub", deck: null }]); // c1 deleted, c2 retired, c3 not due
  assert.equal(env().NB.sheet.dueCardList(cards, user, state, TODAY, []).length, 2); // c1 + u1
});

test("selectSheet: mistakes first (capped), cards fill the rest; dueCardTotal reports the overflow", () => {
  const errors = [];
  for (let i = 1; i <= 8; i++) errors.push({ key: "b#" + i, dueAt: i, lastMissed: "2026-11-2" + (i % 10) });
  const cards = [];
  for (let i = 1; i <= 9; i++) cards.push({ id: "c" + i, front: "f" + i, back: "b" + i, deck: "d" });
  const state = {};
  cards.forEach(c => { state[c.id] = { due: "2026-11-25" }; });
  const sel = plain(env().NB.sheet.selectSheet(errors, cards, [], state, [], TODAY, NOW, null, 10));
  assert.equal(sel.mistakes.length, 6); // MAX_MISTAKES
  assert.equal(sel.cards.length, 4);    // fills to 10
  assert.equal(sel.dueCardTotal, 9);
  assert.deepEqual(sel.mistakes.map(m => m.key), ["b#1", "b#2", "b#3", "b#4", "b#5", "b#6"]);
  // with no mistakes, all 10 slots go to cards
  const sel2 = env().NB.sheet.selectSheet([], cards, [], state, [], TODAY, NOW, null, 10);
  assert.equal(sel2.mistakes.length, 0);
  assert.equal(sel2.cards.length, 9); // only 9 due cards exist
  // empty everything → empty sheet (the UI shows "nothing due")
  const sel3 = env().NB.sheet.selectSheet([], [], [], {}, [], TODAY, NOW, null, 10);
  assert.deepEqual(plain(sel3), { mistakes: [], cards: [], dueCardTotal: 0 });
});

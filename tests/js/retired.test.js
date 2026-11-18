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

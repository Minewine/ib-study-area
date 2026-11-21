// node --test tests/js — NB.bankSchema (assets/bank-schema.js): the shared bank/deck
// validators moved out of author.html, the optional practice-set metadata checks
// (set/setOrder/codes/difficulty) and the nextSetName suggestion helper.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeEnv, plain } = require("./harness");

const env = makeEnv({}).load("bank-schema.js");
const S = env.NB.bankSchema;

const mcq = (id, over) => Object.assign({ id, format: "mcq", stem: "Stem " + id, choices: ["a", "b", "c", "d"], answer: 0 }, over);
const written = (id, over) => Object.assign({ id, format: "written", stem: "Stem " + id, marks: 2, markscheme: ["point (1)", "point (1)"] }, over);
const bank = (items, over) => Object.assign({ subject: "chemistry-hl", items }, over);

test("bankSchema publishes the difficulty vocabulary", () => {
  assert.deepEqual(plain(S.DIFFICULTIES), ["easy", "standard", "hard"]);
  assert.deepEqual(plain(S.DIFFICULTY_ORDER), ["unrated", "easy", "standard", "hard"]);
});

test("validateQuizBank: valid banks pass, old messages unchanged", () => {
  assert.equal(S.validateQuizBank(bank([mcq("a1"), written("w1", { answer: undefined })])), null);
  assert.equal(S.validateQuizBank(bank([mcq("a1")], { topic: "chem-s1", topicLabel: "Structure 1" })), null, "legacy bank-level fields still fine");
  assert.match(S.validateQuizBank(bank([mcq("a1")], { subject: "  " })), /missing 'subject'/);
  assert.match(S.validateQuizBank(bank([])), /missing or empty 'items'/);
  assert.match(S.validateQuizBank(bank([{ id: "x", format: "mcq", stem: "s", choices: ["a"], answer: 0 }])), /at least 2 choices/);
  assert.match(S.validateQuizBank(bank([{ id: "x", format: "mcq", stem: "s", choices: ["a", "b"], answer: 5 }])), /0-based index/);
  assert.match(S.validateQuizBank(bank([{ id: "x", format: "written", stem: "s" }])), /written items need 'marks'/);
  assert.match(S.validateQuizBank(bank([mcq("a1"), mcq("a1")])), /duplicate id 'a1'/);
  assert.match(S.validateQuizBank(bank([{ format: "mcq", stem: "s", choices: ["a", "b"], answer: 0 }])), /missing 'id'/);
  assert.match(S.validateQuizBank(bank([mcq("a1", { stem: "" })])), /item 'a1': missing 'stem'/);
});

test("validateQuizBank: optional new fields are accepted when well-formed", () => {
  assert.equal(S.validateQuizBank(bank([mcq("a1", { difficulty: "hard" }), written("w1", { difficulty: "easy" })],
    { set: "Practice set 1", setOrder: 3, codes: ["S1.1", "2.1"] })), null);
});

test("validateQuizBank: bad item difficulty is rejected, message names the item and the allowed values", () => {
  for (const bad of ["bogus", "", "Easy", "unrated", 2, null]) {
    const err = S.validateQuizBank(bank([mcq("a1"), mcq("a2", { difficulty: bad })]));
    assert.match(err, /item 'a2': difficulty must be 'easy', 'standard' or 'hard'/, "difficulty " + JSON.stringify(bad));
  }
});

test("validateQuizBank: set/setOrder/codes shape checks (absent stays valid, present-but-empty is an error)", () => {
  assert.match(S.validateQuizBank(bank([mcq("a1")], { set: "" })), /'set' must be a non-empty string/);
  assert.match(S.validateQuizBank(bank([mcq("a1")], { set: "   " })), /'set' must be a non-empty string/);
  assert.match(S.validateQuizBank(bank([mcq("a1")], { set: 7 })), /'set' must be a non-empty string/);
  assert.match(S.validateQuizBank(bank([mcq("a1")], { set: null })), /'set' must be a non-empty string/, "explicit null counts as present (mirrors tools/validate_content.py)");
  assert.match(S.validateQuizBank(bank([mcq("a1")], { setOrder: "2" })), /'setOrder' must be an integer/);
  assert.match(S.validateQuizBank(bank([mcq("a1")], { setOrder: 1.5 })), /'setOrder' must be an integer/);
  assert.match(S.validateQuizBank(bank([mcq("a1")], { setOrder: true })), /'setOrder' must be an integer/);
  assert.match(S.validateQuizBank(bank([mcq("a1")], { codes: "S1.1" })), /'codes' must be an array of strings/);
  assert.match(S.validateQuizBank(bank([mcq("a1")], { codes: ["S1.1", 2] })), /'codes' must be an array of strings/);
  // zero-migration: a bank with none of the new fields (the keys simply absent) stays valid
  const legacy = { subject: "chemistry-hl", items: [mcq("a1")] };
  assert.equal("set" in legacy, false);
  assert.equal(S.validateQuizBank(legacy), null);
});

test("validateDeck: existing behaviour unchanged, new fields checked", () => {
  const ids = new Set();
  assert.equal(S.validateDeck({ subject: "biology-hl", topic: "enzymes", cards: [{ id: "c1", front: "F", back: "B" }, { id: "c2", type: "term", front: "F", back: "B" }] }, ids), null);
  assert.match(S.validateDeck({ subject: "biology-hl", topic: "enzymes", cards: [] }, new Set()), /missing or empty 'cards'/);
  assert.match(S.validateDeck({ subject: "biology-hl", cards: [{ id: "c1", front: "F", back: "B" }] }, new Set()), /missing 'topic'/);
  assert.match(S.validateDeck({ subject: "biology-hl", topic: "t", cards: [{ id: "c1", front: "F" }] }, new Set()), /'front' and 'back' are both required/);
  assert.match(S.validateDeck({ subject: "biology-hl", topic: "t", cards: [{ id: "c1", front: "F", back: "B", type: "nope" }] }, new Set()), /type must be 'qa' or 'term'/);
  const dup = new Set(["c1"]);
  assert.match(S.validateDeck({ subject: "biology-hl", topic: "t", cards: [{ id: "c1", front: "F", back: "B" }] }, dup), /already exists in another deck/);
  assert.equal(S.validateDeck({ subject: "biology-hl", topic: "t", set: "Practice set 2", setOrder: 2, codes: ["C1.1"], cards: [{ id: "c3", front: "F", back: "B" }] }, new Set()), null);
  assert.match(S.validateDeck({ subject: "biology-hl", topic: "t", set: 3, cards: [{ id: "c3", front: "F", back: "B" }] }, new Set()), /'set' must be a non-empty string/);
  assert.match(S.validateDeck({ subject: "biology-hl", topic: "t", setOrder: 1.5, cards: [{ id: "c3", front: "F", back: "B" }] }, new Set()), /'setOrder' must be an integer/);
  assert.match(S.validateDeck({ subject: "biology-hl", topic: "t", codes: {}, cards: [{ id: "c3", front: "F", back: "B" }] }, new Set()), /'codes' must be an array of strings/);
});

test("nextSetName: fills the first free number at or above the lowest used number", () => {
  const next = (names) => S.nextSetName(names, "chem-s1");
  assert.equal(next([]), "Practice set 1");
  assert.equal(next(["Practice set 1"]), "Practice set 2");
  assert.equal(next(["Practice set 1", "Practice set 3"]), "Practice set 2");
  assert.equal(next(["Practice set 2"]), "Practice set 3");
  assert.equal(next(["Practice set 3", "Practice set 1", "Practice set 2"]), "Practice set 4");
  assert.equal(next(["Quiz bank", "My practice set"]), "Practice set 1", "unrelated names never block the numbered sequence");
  assert.equal(next(["Practice set 1x"]), "Practice set 1", "only an exact name blocks its number");
  assert.equal(next(["Practice set 2", "My set 1"]), "Practice set 3");
  assert.equal(S.nextSetName("not-an-array"), "Practice set 1", "malformed input stays pure and safe");
});

test("nextSetOrder: one past the largest integer setOrder of the same subject + effective topic", () => {
  const order = (banks, topic) => S.nextSetOrder(banks, "chemistry-hl", topic);
  assert.equal(order([], "chem-s1"), 1, "empty list → 1");
  assert.equal(order([bank([mcq("a1")], { topic: "chem-s1", setOrder: 3 })], "chem-s1"), 4, "max + 1");
  assert.equal(order([
    bank([mcq("a1")], { topic: "chem-s1", setOrder: 2 }),
    bank([mcq("a2")], { topic: "chem-s1", setOrder: 7 })
  ], "chem-s1"), 8, "the largest wins — gaps in the numbering don't matter");
  assert.equal(order([bank([mcq("a1")], { topic: "chem-s1" })], "chem-s1"), 1, "absent setOrder is ignored");
  assert.equal(order([bank([mcq("a1")], { topic: "chem-s1", setOrder: 1.5 })], "chem-s1"), 1, "non-integer setOrder is ignored");
  assert.equal(order([bank([mcq("a1")], { topic: "chem-s2", setOrder: 5 })], "chem-s1"), 1, "other topics are ignored");
  assert.equal(order([bank([mcq("a1")], { subject: "biology-hl", topic: "chem-s1", setOrder: 5 })], "chem-s1"), 1, "other subjects are ignored");
  assert.equal(order([bank([mcq("a1")], { setOrder: 4 })]), 5, "a topic-less bank pools under (none) and matches a topic-less query");
  assert.equal(order([bank([mcq("a1")], { setOrder: 4 })], "chem-s1"), 1, "a bank without a topic never matches a real topic query");
  assert.equal(order([bank([mcq("a1")], { setOrder: 4 })], null), 5, "a missing topic query pools under (none)");
  assert.equal(S.nextSetOrder("junk", "chemistry-hl", "chem-s1"), 1, "malformed input stays pure and safe");
});

test("bankSchema publishes exactly the documented exports", () => {
  assert.deepEqual(Object.keys(env.NB.bankSchema).sort(), ["DIFFICULTIES", "DIFFICULTY_ORDER", "nextSetName", "nextSetOrder", "validateDeck", "validateQuizBank"]);
});

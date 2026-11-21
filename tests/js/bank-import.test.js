// node --test tests/js — the Upload page's staged import (assets/bank-import.js):
// stage → preview edits → finalize, with bank-schema validation re-run after
// every change. The entry produced by finalize() must be byte-shape-equal to
// what the file-upload path stores (author.html processContent).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeEnv, FakeStorage, plain } = require("./harness");

const mk = () => makeEnv({ storage: new FakeStorage({}) }).load("bank-schema.js").load("bank-import.js");
const BI = (e) => e.NB.bankImport;

const J = JSON.stringify;
const mkBank = () => ({
  subject: "biology-hl",
  topic: "a1-1",
  topicLabel: "A1.1 Water",
  items: [
    { id: "p01", format: "mcq", topic: "a1-1", stem: "Why is water polar?", choices: ["O is more electronegative", "H bonds to itself", "It is symmetric"], answer: 0, note: "electronegativity" },
    { id: "p02", format: "mcq", topic: "a1-1", stem: "A solvent dissolves…", choices: ["polar solutes", "lipids", "nothing"], answer: 0 },
    { id: "p03", format: "written", topic: "a1-1", marks: 2, stem: "Explain cohesion.", markscheme: ["hydrogen bonding (1)", "between water molecules (1)"], tactic: "name the bond" },
  ],
});

test("stage: a valid pasted bank stages with a suggested unique name; junk is refused", () => {
  const e = mk();
  const res = BI(e).stage(J(mkBank()), ["ai-a1-1.json"]);
  assert.ok(res.ok, res.error);
  assert.equal(res.staged.name, "ai-a1-1-2.json", "collision with the existing name gets -2");
  assert.equal(res.staged.data.items.length, 3);
  assert.ok(BI(e).stage("{oops", []).error, "malformed JSON refused");
  assert.ok(BI(e).stage(J({ cards: [] }), []).error, "a deck is not a quiz bank");
  assert.ok(BI(e).stage(J({ subject: "biology-hl", items: [{ id: "p01" }, { id: "p01" }] }), []).error, "schema violation (duplicate id) refused");
});

test("suggestName: slugs the topic, avoids collisions, survives a missing topic", () => {
  const e = mk();
  const s = BI(e).suggestName;
  assert.equal(s({ topic: "enzymes-metabolism" }, []), "ai-enzymes-metabolism.json");
  assert.equal(s({ topic: "C1.1 Enzymes & metabolism!" }, []), "ai-c1-1-enzymes-metabolism.json");
  assert.equal(s({ topic: "a1-1" }, ["ai-a1-1.json", "ai-a1-1-2.json"]), "ai-a1-1-3.json");
  assert.equal(s({}, []), "ai-practice-set.json");
});

test("editItem: mcq choices are trimmed/empties dropped, answer must land inside them", () => {
  const e = mk();
  const bi = BI(e);
  const staged = bi.stage(J(mkBank()), []).staged;
  // dropping a choice and leaving answer=2 must fail: two choices survive, index 2 is past the end
  let r = bi.editItem(staged, 0, { choices: ["", "H bonds to itself", "It is symmetric"], answer: 2 });
  assert.ok(r.error, "answer out of range after dropping a choice");
  // a valid re-answer fixes it
  r = bi.editItem(staged, 0, { choices: ["", "H bonds to itself", "It is symmetric"], answer: 1 });
  assert.ok(r.ok, r.error);
  // a committed edit REPLACES the item object (atomic validate-then-commit), so re-read
  let item = staged.data.items[0];
  assert.deepEqual(plain(item.choices), ["H bonds to itself", "It is symmetric"]);
  assert.equal(item.answer, 1);
  // stem/difficulty edits; an unknown difficulty value removes the field
  assert.ok(bi.editItem(staged, 0, { stem: "  Why is water polar?  ", difficulty: "hard" }).ok);
  item = staged.data.items[0];
  assert.equal(item.stem, "Why is water polar?");
  assert.equal(item.difficulty, "hard");
  assert.ok(bi.editItem(staged, 0, { difficulty: "impossible" }).ok);
  assert.equal(staged.data.items[0].difficulty, undefined);
  // a bad edit to item 1 surfaces as a bank-level error but staged.data keeps the edit attempt out
  const snapshot = J(staged.data);
  r = bi.editItem(staged, 1, { choices: [], answer: 0 });
  assert.ok(r.error, "removing every choice is a bank error");
  assert.equal(J(staged.data), snapshot, "the validator's rejection leaves the staged data unchanged in items[1]");
});

test("editItem: written items — marks must be ≥1, markscheme becomes one point per line", () => {
  const e = mk();
  const bi = BI(e);
  const staged = bi.stage(J(mkBank()), []).staged;
  const item = () => staged.data.items[2]; // committed edits replace the object — re-read
  assert.ok(bi.editItem(staged, 2, { marks: "0" }).error, "marks < 1 breaks the schema");
  assert.ok(bi.editItem(staged, 2, { marks: "3", markscheme: "  pt one (1) \n\npt two (1)\npt three (1)" }).ok);
  assert.equal(item().marks, 3);
  assert.deepEqual(plain(item().markscheme), ["pt one (1)", "pt two (1)", "pt three (1)"]);
  assert.ok(bi.editItem(staged, 2, { tactic: " " }).ok, "empty tactic is removed");
  assert.equal(item().tactic, undefined);
  const empty = bi.stage(J(mkBank()), []).staged;
  assert.ok(bi.editItem(empty, 2, { markscheme: "" }).error, "no markscheme at all breaks the schema");
});

test("removeItem: items can be trimmed; the last one cannot (a bank needs items)", () => {
  const e = mk();
  const bi = BI(e);
  const staged = bi.stage(J(mkBank()), []).staged;
  assert.ok(bi.removeItem(staged, 1).ok);
  assert.equal(staged.data.items.length, 2);
  assert.ok(bi.removeItem(staged, 0).ok);
  const r = bi.removeItem(staged, 0);
  assert.ok(r.error, "the last item cannot be removed");
  assert.equal(staged.data.items.length, 1, "the failed remove left the item in place");
  assert.ok(bi.removeItem(staged, 99).error, "out-of-range index refused");
});

test("finalize: entry matches the file-upload storage shape exactly (name/uploaded/label/subjectLabel)", () => {
  const e = mk();
  const bi = BI(e);
  const staged = bi.stage(J(mkBank()), []).staged;
  staged.name = "ai-a1-1.json";
  const res = bi.finalize(staged);
  assert.ok(res.ok, res.error);
  const today = new Date().toISOString().slice(0, 10);
  assert.deepEqual(plain(res.entry), {
    subject: "biology-hl", topic: "a1-1", topicLabel: "A1.1 Water", items: mkBank().items,
    name: "ai-a1-1.json", uploaded: today, label: "A1.1 Water", subjectLabel: "biology-hl",
  }, "label/subjectLabel defaults mirror processContent; original fields preserved");
  // a bank without topicLabel gets the file name as its label
  const noLabel = bi.stage(J({ subject: "chemistry-hl", topic: "s1-1", items: mkBank().items }), []).staged;
  const res2 = bi.finalize(noLabel);
  assert.equal(res2.entry.label, "ai-s1-1.json");
  assert.equal(res2.entry.subjectLabel, "chemistry-hl");
  // a staged bank broken after staging refuses to finalize
  const broken = bi.stage(J(mkBank()), []).staged;
  broken.data.items[0].answer = 99;
  assert.ok(bi.finalize(broken).error, "finalize re-validates");
});

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

// ── AI difficulty suggestions: unreviewed until applied in the preview ──────
test("suggestionFor: a valid suggestion passes through; invalid, absent or non-item returns null", () => {
  const sf = BI(mk()).suggestionFor;
  assert.equal(sf({ suggestedDifficulty: "easy" }), "easy");
  assert.equal(sf({ suggestedDifficulty: "standard" }), "standard");
  assert.equal(sf({ suggestedDifficulty: "hard" }), "hard");
  assert.equal(sf({ suggestedDifficulty: "impossible" }), null, "not a real difficulty value");
  assert.equal(sf({ suggestedDifficulty: "" }), null);
  assert.equal(sf({}), null, "no suggestion on the item");
  assert.equal(sf(null), null, "no item at all");
  assert.equal(sf(42), null, "a truthy non-object item carries no suggestion");
});

test("applySuggestion: the suggestion becomes the item's difficulty and the key is deleted; no suggestion → error, staged unchanged", () => {
  const e = mk();
  const bi = BI(e);
  const bank = mkBank();
  bank.items[0].suggestedDifficulty = "hard";
  const staged = bi.stage(J(bank), []).staged;
  const r = bi.applySuggestion(staged, 0);
  assert.ok(r.ok, r.error);
  const item = staged.data.items[0]; // committed applies replace the object — re-read
  assert.equal(item.difficulty, "hard", "the suggestion was applied as the real difficulty");
  assert.equal(item.suggestedDifficulty, undefined, "the unreviewed key is gone after applying");
  const snapshot = J(staged.data);
  const miss = bi.applySuggestion(staged, 1);
  assert.ok(miss.error, "item 2 carries no suggestion");
  assert.equal(miss.error, "no difficulty suggestion on this item");
  assert.equal(J(staged.data), snapshot, "a failed apply leaves staged unchanged");
  assert.ok(bi.applySuggestion(staged, 99).error, "out-of-range index refused");
});

test("applyAllSuggestions: applies every suggestion and reports the count; nothing suggested applies 0", () => {
  const e = mk();
  const bi = BI(e);
  const bank = mkBank();
  bank.items[0].suggestedDifficulty = "easy";
  bank.items[2].suggestedDifficulty = "standard";
  const staged = bi.stage(J(bank), []).staged;
  const r = bi.applyAllSuggestions(staged);
  assert.ok(r.ok, r.error);
  assert.equal(r.applied, 2, "two suggestions applied");
  assert.equal(staged.data.items[0].difficulty, "easy");
  assert.equal(staged.data.items[0].suggestedDifficulty, undefined);
  assert.equal(staged.data.items[2].difficulty, "standard");
  assert.equal(staged.data.items[2].suggestedDifficulty, undefined);
  assert.equal(staged.data.items[1].difficulty, undefined, "an item without a suggestion is untouched");
  const none = bi.stage(J(mkBank()), []).staged;
  assert.deepEqual(plain(bi.applyAllSuggestions(none)), { ok: true, applied: 0 }, "nothing suggested → nothing applied");
});

test("applyAllSuggestions: a validation failure rejects the whole batch and leaves staged unchanged", () => {
  const e = mk();
  const bi = BI(e);
  const bank = mkBank();
  bank.items[1].suggestedDifficulty = "easy";
  const staged = bi.stage(J(bank), []).staged;
  staged.data.items[0].answer = 99; // pre-break the bank: mcq answer out of range
  const snapshot = J(staged.data);
  const r = bi.applyAllSuggestions(staged);
  assert.ok(r.error, "the batch is rejected by the validator");
  assert.equal(J(staged.data), snapshot, "the failed batch left staged exactly as it was");
  assert.equal(staged.data.items[1].suggestedDifficulty, "easy", "the suggestion was not consumed");
  assert.equal(staged.data.items[1].difficulty, undefined, "the difficulty was not applied");
});

test("finalize: residual suggestedDifficulty is stripped from every item; a hand-authored difficulty survives", () => {
  const e = mk();
  const bi = BI(e);
  bi.newBankId = () => "ub-test";
  const bank = mkBank();
  bank.items[0].suggestedDifficulty = "standard"; // never applied
  bank.items[1].difficulty = "hard";              // rated by hand before staging
  const staged = bi.stage(J(bank), []).staged;
  const res = bi.finalize(staged);
  assert.ok(res.ok, res.error);
  res.entry.items.forEach(it => assert.equal(it.suggestedDifficulty, undefined, it.id + " must not carry an unreviewed suggestion into storage"));
  assert.equal(res.entry.items[0].difficulty, undefined, "an unapplied suggestion is dropped, not committed as difficulty");
  assert.equal(res.entry.items[1].difficulty, "hard", "the hand-authored difficulty survives the strip");
  assert.equal(staged.data.items[0].suggestedDifficulty, "standard", "finalize never mutates the staged data (the preview still shows the chip)");
});

test("finalize: a bank with no suggestions finalizes unchanged — the strip is a no-op pass-through", () => {
  const e = mk();
  const bi = BI(e);
  bi.newBankId = () => "ub-test";
  const staged = bi.stage(J(mkBank()), []).staged;
  const snapshot = J(staged.data.items);
  const res = bi.finalize(staged);
  assert.ok(res.ok, res.error);
  assert.equal(J(res.entry.items), snapshot, "zero suggestions → every item passes through byte-identical (no key added, none stripped)");
});

test("finalize: entry matches the file-upload storage shape exactly (id/name/uploaded/label/subjectLabel)", () => {
  const e = mk();
  const bi = BI(e);
  bi.newBankId = () => "ub-test"; // stub id generation so the full-shape compare stays deterministic
  const staged = bi.stage(J(mkBank()), []).staged;
  staged.name = "ai-a1-1.json";
  const res = bi.finalize(staged);
  assert.ok(res.ok, res.error);
  const today = new Date().toISOString().slice(0, 10);
  assert.deepEqual(plain(res.entry), {
    id: "ub-test",
    subject: "biology-hl", topic: "a1-1", topicLabel: "A1.1 Water", items: mkBank().items,
    name: "ai-a1-1.json", uploaded: today, label: "A1.1 Water", subjectLabel: "biology-hl",
  }, "id + label/subjectLabel defaults mirror processContent; original fields preserved");
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

// The authoring prompt asks for raw JSON, but chatbots still often wrap the answer
// in a markdown fence — one optional fence is stripped before JSON.parse.
test("stage: a markdown-fenced paste (typical chatbot output) parses; prose around the JSON still fails cleanly", () => {
  const e = mk();
  const res = BI(e).stage("```json\n" + J(mkBank()) + "\n```", []);
  assert.ok(res.ok, "fenced ```json block accepted");
  assert.equal(res.staged.name, "ai-a1-1.json");
  assert.ok(BI(e).stage("```\n" + J(mkBank()) + "\n```", []).ok, "untagged fence accepted too");
  assert.ok(BI(e).stage("```json\n" + J(mkBank()) + "\n```trailing prose", []).error, "an unclosed fence (prose after) is still refused");
  assert.ok(BI(e).stage("Here you go:\n" + J(mkBank()), []).error, "prose before the JSON is refused");
});

// The staged id (assets/bank-import.js newBankId) is the bank's stable identity across
// devices: "ub-" + base36 time + "-" + base36 random (the papers.js "pp-…" convention).
// finalize stamps it, so two same-topic imports on ONE device already get distinct
// names AND ids — the precondition for independent q-error histories everywhere.
test("newBankId: ub- prefixed and unique per call; two same-topic imports on one device get distinct names AND ids", () => {
  const bi = BI(mk());
  assert.match(bi.newBankId(), /^ub-[0-9a-z]+-[0-9a-z]+$/, "ub- + base36 time + '-' + base36 random");
  const ids = Array.from({ length: 25 }, () => bi.newBankId());
  assert.equal(new Set(ids).size, 25, "the random part keeps same-millisecond calls unique");
  const first = bi.stage(J(mkBank()), []).staged;
  const second = bi.stage(J(mkBank()), [first.name]).staged;
  assert.notEqual(second.name, first.name, "distinct stored names on one device");
  const f1 = bi.finalize(first), f2 = bi.finalize(second);
  assert.ok(f1.ok && f2.ok, f1.error || f2.error);
  assert.notEqual(f1.entry.id, f2.entry.id, "distinct ids — the identity that survives sync, name collisions aside");
});

test("stage: fence tolerance — any language tag parses, broken JSON inside a proper fence names the parse error, arrays are not banks", () => {
  const bi = BI(mk());
  assert.ok(bi.stage("```javascript\n" + J(mkBank()) + "\n```", []).ok, "any fence language tag is stripped, not just 'json'");
  const badInside = bi.stage("```json\n{oops\n```", []);
  assert.ok(badInside.error, "invalid JSON inside a proper fence is still refused");
  assert.match(badInside.error, /^invalid JSON — /, "the error text names the JSON problem");
  const arr = bi.stage("[1,2,3]", []);
  assert.ok(arr.error, "a JSON array is not a bank");
  assert.match(arr.error, /no 'items' array found/, "…refused with the missing-items error, not a parse error");
  assert.ok(bi.stage("Sure:\n```json\n" + J(mkBank()) + "\n```", []).error,
    "prose before a fenced block defeats the strip — exactly ONE optional fence, anchored at the start");
});

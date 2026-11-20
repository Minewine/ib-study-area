// node --test tests/js — Ask an AI prompts (library/ai-prompts.json + assets/ai-prompt.js):
// only documented placeholders, https assistant URLs, and every topic note fills cleanly.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { makeEnv, FakeStorage, plain } = require("./harness");

const ROOT = path.join(__dirname, "..", "..");
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, "library", "ai-prompts.json"), "utf8"));
const NOTES_DIR = path.join(ROOT, "library", "topic-notes");
const PLACEHOLDER = /\{([a-z_]+)\}/g;

function noteFiles() {
  const out = [];
  for (const sub of fs.readdirSync(NOTES_DIR)) {
    const dir = path.join(NOTES_DIR, sub);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith(".json")) out.push(path.join(dir, f));
    }
  }
  return out;
}

function envWith(data) {
  return makeEnv({ storage: new FakeStorage(data || {}) }).load("store.js").load("ai-prompt.js");
}

test("config: default_ai, https assistants, modes use only known placeholders", () => {
  assert.equal(typeof CFG._doc, "string");
  assert.ok(CFG._doc.includes("{subject}"));
  assert.ok(Array.isArray(CFG.assistants) && CFG.assistants.length >= 1);
  assert.ok(CFG.assistants.some(a => a.id === CFG.default_ai), "default_ai must be an assistant id");
  for (const a of CFG.assistants) {
    assert.ok(a.id && a.name, a.id);
    assert.match(String(a.url), /^https:\/\//, a.id + " url must be https");
  }
  assert.ok(Array.isArray(CFG.modes) && CFG.modes.length >= 3);
  const ids = new Set();
  const known = new Set(["subject", "level", "topic", "understandings", "keyterms", "wrong_questions", "subjectid", "topickey"]);
  for (const m of CFG.modes) {
    assert.ok(m.id && m.label && m.template, m.id);
    assert.ok(!ids.has(m.id), "duplicate mode " + m.id);
    ids.add(m.id);
    const used = [...(CFG.preamble + " " + m.template).matchAll(PLACEHOLDER)].map(x => x[1]);
    const unknown = used.filter(k => !known.has(k));
    assert.deepEqual(unknown, [], "unknown placeholders in mode " + m.id);
  }
  assert.ok(ids.has("explain") && ids.has("quiz") && ids.has("data"));
});

test("every topic note renders every mode with no leftover placeholders", () => {
  const e = envWith();
  const files = noteFiles();
  assert.ok(files.length >= 100, "expected the committed topic notes, got " + files.length);
  const leftover = [];
  for (const f of files) {
    const note = JSON.parse(fs.readFileSync(f, "utf8"));
    // notes.js sets note.topicKey = the URL topic (file basename) before rendering;
    // mirror that contract here so {topickey}-using modes are filled the same way.
    note.topicKey = path.basename(f, ".json");
    for (const m of CFG.modes) {
      const text = e.NB.aiPrompt.build(note, m.id, CFG);
      assert.ok(text.length > 40, f + " " + m.id + " too short");
      const left = [...text.matchAll(PLACEHOLDER)].map(x => x[0]);
      if (left.length) leftover.push(path.relative(ROOT, f) + " " + m.id + ": " + left.join(", "));
    }
  }
  assert.deepEqual(leftover, []);
});

test("bankgen mode: a manifest-entry-shaped note fills the raw subject id and topic key", () => {
  const e = envWith();
  // exactly what author.html's picker passes: a topic-notes manifest entry + topicKey
  const entry = { subject: "biology-hl", code: "A1.1", title: "Water", themeLabel: "Unity and diversity", hlOnly: false, topicKey: "a1-1" };
  const vals = plain(e.NB.aiPrompt.values(entry, CFG));
  assert.equal(vals.subjectid, "biology-hl");
  assert.equal(vals.topickey, "a1-1");
  assert.match(vals.topic, /A1\.1 Water/);
  const text = e.NB.aiPrompt.build(entry, "bankgen", CFG);
  assert.match(text, /experienced IB Biology HL teacher/);
  assert.match(text, /"subject": "biology-hl"/);
  assert.match(text, /"topic": "a1-1"/);
  assert.match(text, /0-based index/);
  assert.doesNotMatch(text, /\{[a-z_]+\}/);
  assert.doesNotMatch(text, /Neva|Lausanne|Rametric/i);
  // without a topicKey the placeholder empties (caller contract) rather than leaking braces
  const noKey = e.NB.aiPrompt.build({ subject: "chemistry-hl", code: "S1.1", title: "Particulate nature" }, "bankgen", CFG);
  assert.doesNotMatch(noKey, /\{[a-z_]+\}/);
  assert.match(noKey, /"subject": "chemistry-hl"/);
});

test("Biology A1.1 quiz mode names the subject, topic and understandings", () => {
  const e = envWith();
  const note = JSON.parse(fs.readFileSync(path.join(NOTES_DIR, "biology-hl", "a1-1.json"), "utf8"));
  const vals = plain(e.NB.aiPrompt.values(note));
  assert.equal(vals.subject, "Biology");
  assert.equal(vals.level, "HL");
  assert.match(vals.topic, /A1\.1/);
  assert.match(vals.topic, /Water/);
  assert.match(vals.understandings, /A1\.1\./);
  assert.match(vals.keyterms, /Hydrogen bond/i);
  const text = e.NB.aiPrompt.build(note, "quiz", CFG);
  assert.match(text, /experienced IB Biology HL teacher/);
  assert.match(text, /May 2028/);
  assert.match(text, /one question at a time/i);
  assert.match(text, /A1\.1 Water/);
  assert.doesNotMatch(text, /\{[a-z_]+\}/);
  assert.doesNotMatch(text, /Neva|Lausanne|Rametric/i);
});

test("review mode uses only our question stems for this topic; resolved and other banks are skipped", () => {
  const e = envWith({
    "q-errors": JSON.stringify([
      { key: "bio-molecules-water#wm01", id: "wm01", bankId: "bio-molecules-water", stem: "Why do water molecules attract each other?", markscheme: "SECRET_MS_TEXT_MUST_NOT_APPEAR", answer: 0, userAnswer: 2, resolved: false },
      { key: "bio-molecules-water#wm02", id: "wm02", bankId: "bio-molecules-water", stem: "Resolved stem should be absent", resolved: true },
      { key: "chem-other#c01", id: "c01", bankId: "chem-other", stem: "Unrelated chemistry miss", resolved: false },
      { key: "bio-molecules-water#wm99", id: "wm99", bankId: "bio-molecules-water", stem: "Not in this note's itemIds", resolved: false }
    ])
  });
  const note = JSON.parse(fs.readFileSync(path.join(NOTES_DIR, "biology-hl", "a1-1.json"), "utf8"));
  const text = e.NB.aiPrompt.build(note, "review", CFG);
  assert.match(text, /Why do water molecules attract each other\?/);
  assert.doesNotMatch(text, /Resolved stem should be absent/);
  assert.doesNotMatch(text, /Unrelated chemistry miss/);
  assert.doesNotMatch(text, /Not in this note's itemIds/);
  assert.doesNotMatch(text, /SECRET_MS_TEXT_MUST_NOT_APPEAR/);
  const empty = envWith().NB.aiPrompt.build(note, "review", CFG);
  assert.match(empty, /No missed questions are recorded for this topic yet/);
});

test("ai-pref is device-local: not synced, not in backups, and not quarantined as raw text", () => {
  const e = envWith();
  assert.ok(!e.NB.store.SYNCED_KEYS.includes("ai-pref"));
  assert.equal(e.NB.aiPrompt.PREF_KEY, "ai-pref");
  assert.ok(e.NB.store.isLocalOnly("ai-pref"));
  assert.ok(!e.NB.store.isSynced("ai-pref"));
  e.storage.setItem("ai-pref", "chatgpt");
  e.storage.setItem("q-errors", JSON.stringify([{ key: "bank#q1", stem: "S", attempts: 1, ts: 5 }]));
  e.load("backup.js");
  const file = plain(e.NB.backup.collect());
  assert.ok(!Object.prototype.hasOwnProperty.call(file.keys, "ai-pref"), "preference must not enter a backup");
  assert.equal(e.storage.getItem("ai-pref"), "chatgpt", "raw pref must not be quarantined");
});

test("subjectNames: proper course names for subjects without -hl/-sl suffix notes", () => {
  const e = envWith();
  const subjectOf = (subject) => plain(e.NB.aiPrompt.values({ subject }, CFG)).subject;
  assert.equal(subjectOf("biology-hl"), "Biology");
  assert.equal(subjectOf("maths-aa-sl"), "Maths AA");
  assert.equal(subjectOf("chemistry-hl"), "Chemistry");
  assert.equal(subjectOf("french-a-langlit"), "French A: Language and Literature");
  assert.equal(subjectOf("english-lit-hl"), "English A: Literature");
  assert.equal(subjectOf("history-sl"), "History");
});

function envForCopy(execOk) {
  const e = envWith();
  const ta = {
    value: "", style: {}, attrs: {}, selected: false, range: null,
    setAttribute(k, v) { this.attrs[k] = v; },
    select() { this.selected = true; },
    setSelectionRange(a, b) { this.range = [a, b]; },
    remove() {}
  };
  e.document.createElement = () => ta;
  e.document.execCommand = () => execOk;
  return { e, ta };
}

test("copyText: execCommand success is 'copied' and selects the whole text (incl. iOS setSelectionRange)", () => {
  const { e, ta } = envForCopy(true);
  assert.equal(e.NB.aiPrompt.copyText("hello"), "copied");
  assert.ok(ta.selected, "textarea selected");
  assert.deepEqual(ta.range, [0, 5], "full range selected for iOS Safari");
});

test("copyText: execCommand refusal falls back to the async Clipboard API and reports 'maybe'", () => {
  const { e } = envForCopy(false);
  let called = false;
  e.ctx.navigator = { clipboard: { writeText(text) { called = true; assert.equal(text, "hello"); return Promise.resolve(); } } };
  assert.equal(e.NB.aiPrompt.copyText("hello"), "maybe");
  assert.ok(called, "async write attempted");
});

test("copyText: no execCommand result and no Clipboard API is a failure", () => {
  const { e } = envForCopy(false);
  assert.equal(e.NB.aiPrompt.copyText("hello"), "failed");
});

test("clickMsg tells the truth for every outcome", () => {
  const e = envWith();
  const m = e.NB.aiPrompt.clickMsg;
  assert.match(m("copied", true, true), /Prompt copied/);
  assert.match(m("maybe", true, true), /Copy the prompt again/, "hedged when only the async write was fired");
  assert.match(m("maybe", false, true), /blocked the new tab/);
  assert.match(m("copied", false, true), /blocked the new tab/);
  assert.match(m("failed", false, true), /Could not copy/);
  assert.match(m("copied", false, false), /Prompt copied.*no assistant link/);
  assert.match(m("maybe", false, false), /Copy attempted.*no assistant link/, "must not claim a copy that may not have happened");
});

test("subjectNames lookup is prototype-safe", () => {
  const e = envWith();
  const subjectOf = (subject) => plain(e.NB.aiPrompt.values({ subject }, CFG)).subject;
  assert.equal(subjectOf("constructor"), "constructor", "not the Object constructor source");
  assert.equal(subjectOf("__proto__"), "__proto__", "not Object.prototype");
});

// node --test tests/js — quiz-engine's topic picker: the pure model
// (buildTopics), the teaching-status resolver (taughtState) and the
// difficulty-range filter (difficultyPass). The engine is loaded WITHOUT firing
// DOMContentLoaded (readyState "loading"), exactly like retired.test.js parks
// boot() — so no fetches run and only the exported pure functions are exercised.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeEnv, plain } = require("./harness");

function engine() {
  const env = makeEnv({ readyState: "loading" }).load("store.js").load("quiz-engine.js");
  return { env, QE: env.NB.quizEngine };
}

// ── fixtures ───────────────────────────────────────────────────────────────
const metaBank = (file, label, topics, over) => Object.assign(
  { file, label, meta: Object.assign({ file, subject: "chemistry-hl", subjectLabel: "Chemistry HL", label, topics }, over) },
  {}
);

const SCHED = { subjects: { "biology-hl": { units: [
  { from: "2026-08-26", to: "2026-09-25", codes: ["A1.1", "B1.1"] },
  { from: "2026-11-02", to: "2026-11-27", codes: ["C1.1"] }
] } } };

// ── buildTopics ────────────────────────────────────────────────────────────
test("buildTopics: manifest-meta banks share one topic; counts, histograms, codes and labels merge", () => {
  const { QE } = engine();
  const a = metaBank("library/questions/chem-p1a-x.json", "Paper 1A — Structure",
    [
      { topic: "chem-s1-1", topicLabel: "Structure 1.1 — Moles", count: 5, difficulty: { unrated: 2, easy: 1, standard: 2, hard: 0 } },
      { topic: "chem-s1-2", topicLabel: "Structure 1.2 — Formulas", count: 3, difficulty: { unrated: 3, easy: 0, standard: 0, hard: 0 } }
    ],
    { codes: ["S1.1", "S1.2"], paperStyle: "1A", calculatorFree: true });
  const b = metaBank("library/questions/chem-p1b-x.json", "Paper 1B — Data",
    [{ topic: "chem-s1-1", topicLabel: "Structure 1.1 — Moles", count: 2, difficulty: { unrated: 2, easy: 0, standard: 0, hard: 0 } }],
    { codes: ["S1.1"], paperStyle: "1B" });
  const nodes = QE.buildTopics([a, b]);
  assert.deepEqual(plain(nodes.map(n => n.topicKey)), ["chem-s1-1", "chem-s1-2"], "sorted by label (both 'Structure 1.x — …')");
  const n1 = nodes[0];
  assert.equal(n1.count, 7, "per-topic counts from both banks sum up");
  assert.deepEqual(plain(n1.difficulties), { unrated: 4, easy: 1, standard: 2, hard: 0 });
  assert.deepEqual(plain(n1.codes), ["S1.1"], "multi-topic bank a's codes attach to no node (no declared topic — no leak); single-topic bank b's codes do");
  assert.equal(n1.label, "Structure 1.1 — Moles");
  assert.equal(n1.sets.length, 2, "each bank is one set of the shared topic");
  assert.deepEqual(plain(n1.sets.map(s => [s.name, s.count])), [["Paper 1A — Structure", 5], ["Paper 1B — Data", 2]]);
  assert.equal(n1.sets[0].paperStyle, "1A");
  assert.equal(n1.sets[0].calculatorFree, true);
  assert.equal(n1.sets[1].paperStyle, "1B");
  assert.equal(n1.sets[1].calculatorFree, false);
  assert.equal(nodes[1].count, 3);
  assert.equal(nodes[1].sets.length, 1);
  assert.equal(QE.buildTopics([a])[0].sets[0].ref, a, "sets keep a reference to the underlying bank object");
});

test("buildTopics: inline uploaded banks aggregate items like bankItems maps them", () => {
  const { QE } = engine();
  const b = {
    inline: true, label: "My enzymes bank", topicLabel: "Enzymes", topic: "enzymes",
    items: [
      { id: "e1", format: "mcq", stem: "s1", choices: ["a", "b"], answer: 0 },
      { id: "e2", format: "written", stem: "s2", marks: 2, markscheme: ["p (1)"], topic: "kinetics", topicLabel: "Kinetics", difficulty: "hard" },
      { id: "e3", format: "mcq", stem: "s3", choices: ["a", "b"], answer: 1, retired: true },
      { id: "e4", format: "mcq", stem: "s4", choices: ["a", "b"], answer: 0, difficulty: "bogus" },
      { id: "e5", format: "mcq", stem: "s5", choices: ["a", "b"], answer: 0, difficulty: "standard" }
    ],
    codes: ["C1.1"]
  };
  const nodes = QE.buildTopics([b]);
  assert.deepEqual(plain(nodes.map(n => n.label)), ["Enzymes", "Kinetics"], "sorted by label: effective topicLabels ('Enzymes' < 'Kinetics')");
  assert.deepEqual(plain(nodes.map(n => n.topicKey)), ["enzymes", "kinetics"], "topicKeys are the effective topic keys");
  const enz = nodes[0];
  assert.equal(enz.count, 3, "retired item skipped, the rest counted (e1, e4, e5)");
  assert.deepEqual(plain(enz.difficulties), { unrated: 2, easy: 0, standard: 1, hard: 0 }, "invalid difficulty pools as unrated");
  assert.deepEqual(plain(enz.codes), ["C1.1"], "bank-level codes reach the node");
  assert.equal(enz.label, "Enzymes", "bank topicLabel is the effective item topicLabel");
  assert.deepEqual(plain(enz.sets), [{ ref: b, name: "My enzymes bank", order: null, count: 3, paperStyle: null, calculatorFree: false }]);
  const kin = nodes[1];
  assert.equal(kin.count, 1);
  assert.deepEqual(plain(kin.difficulties), { unrated: 0, easy: 0, standard: 0, hard: 1 });
  assert.equal(kin.label, "Kinetics", "item-level topicLabel wins over the bank's");
});

test("buildTopics: a bank without meta (offline fallback) is its own topic with unknown count", () => {
  const { QE } = engine();
  const fb = { file: "library/questions/bio-unity-diversity-cells.json", label: "Unity & diversity — Cells" };
  const nodes = QE.buildTopics([fb]);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].topicKey, "bio-unity-diversity-cells", "topicKey = bankIdFor(bank)");
  assert.equal(nodes[0].label, "Unity & diversity — Cells");
  assert.equal(nodes[0].count, null, "count unknown without fetching the file → '?' in the picker");
  assert.deepEqual(plain(nodes[0].difficulties), { unrated: 0, easy: 0, standard: 0, hard: 0 });
  assert.deepEqual(plain(nodes[0].sets), [{ ref: fb, name: "Unity & diversity — Cells", order: null, count: null, paperStyle: null, calculatorFree: false }]);
});

test("buildTopics: topics sort by label numerically; sets sort by order (nulls last) then name", () => {
  const { QE } = engine();
  const banks = [
    metaBank("library/questions/b.json", "B", [{ topic: "t-b", topicLabel: "B topic", count: 1 }]),
    metaBank("library/questions/a10.json", "A10", [{ topic: "t-a10", topicLabel: "A 10", count: 1 }]),
    metaBank("library/questions/a2.json", "A2", [{ topic: "t-a2", topicLabel: "A 2", count: 1 }])
  ];
  assert.deepEqual(plain(QE.buildTopics(banks).map(n => n.label)), ["A 2", "A 10", "B topic"], "numeric-aware label compare");

  const s2 = Object.assign(metaBank("library/questions/s2.json", "Set B", [{ topic: "t1", count: 1 }]), { set: "Practice set 2", setOrder: 2 });
  const s1 = Object.assign(metaBank("library/questions/s1.json", "Set A", [{ topic: "t1", count: 1 }]), { set: "Practice set 1", setOrder: 1 });
  const s3 = metaBank("library/questions/s3.json", "Set C", [{ topic: "t1", count: 1 }]);
  const sets = plain(QE.buildTopics([s2, s1, s3])[0].sets.map(s => s.name));
  assert.deepEqual(sets, ["Practice set 1", "Practice set 2", "Set C"], "order wins, missing order last");
});

test("buildTopics: empty/degenerate input never throws", () => {
  const { QE } = engine();
  assert.deepEqual(plain(QE.buildTopics([])), []);
  assert.deepEqual(plain(QE.buildTopics(null)), []);
  assert.deepEqual(plain(QE.buildTopics([null, {}])), []);
});

test("buildTopics: bank codes attach only to the declared topic node; meta.set names the set", () => {
  const { QE } = engine();
  const two = metaBank("library/questions/chem-two.json", "Two-topic",
    [
      { topic: "t-a", topicLabel: "A", count: 1 },
      { topic: "t-b", topicLabel: "B", count: 1 }
    ],
    { topic: "t-a", codes: ["A1"], set: "Practice set 3", setOrder: 3 });
  const nodes = QE.buildTopics([two]);
  assert.deepEqual(plain(nodes.map(n => [n.topicKey, n.codes])), [["t-a", ["A1"]], ["t-b", []]],
    "the declared-topic node carries the codes; the bank's other topic stays empty (no leak)");
  assert.equal(nodes[0].sets[0].name, "Practice set 3", "meta.set wins over the manifest label");
  assert.equal(nodes[0].sets[0].order, 3);
  const single = metaBank("library/questions/chem-one.json", "Single-topic",
    [{ topic: "t-c", topicLabel: "C", count: 1 }], { codes: ["C1", "C2"] });
  assert.deepEqual(plain(QE.buildTopics([single])[0].codes), ["C1", "C2"], "single-topic bank: the node has the codes");
  const inline = { inline: true, label: "Inline", topicLabel: "Inline", topic: "i-a", codes: ["B1"], items: [
    { id: "i1", format: "mcq", stem: "s", choices: ["a", "b"], answer: 0, topic: "i-a" },
    { id: "i2", format: "mcq", stem: "s", choices: ["a", "b"], answer: 0, topic: "i-b" } ] };
  assert.deepEqual(plain(QE.buildTopics([inline]).map(n => [n.topicKey, n.codes])), [["i-a", ["B1"]], ["i-b", []]],
    "the inline path follows the same declared-topic rule");
});

// ── taughtState ────────────────────────────────────────────────────────────
test("taughtState: a stored override always wins, in both directions", () => {
  const { QE } = engine();
  const today = "2026-10-01"; // C1.1's unit hasn't finished, A1.1's has
  assert.deepEqual(plain(QE.taughtState("x", ["C1.1"], SCHED, "biology-hl", today, { x: { taught: true, t: 1 } })),
    { state: "taught", source: "you" }, "override true beats the schedule's not-yet");
  assert.deepEqual(plain(QE.taughtState("x", ["A1.1"], SCHED, "biology-hl", today, { x: { taught: false, t: 1 } })),
    { state: "not-taught", source: "you" }, "override false beats the schedule's taught");
  assert.deepEqual(plain(QE.taughtState("x", ["A1.1"], SCHED, "biology-hl", today, { x: { taught: "yes", t: 1 } })),
    { state: "taught", source: "schedule" }, "a non-boolean override is ignored");
});

test("taughtState: schedule suggestion — every code covered by a finished unit", () => {
  const { QE } = engine();
  const today = "2026-10-01";
  assert.deepEqual(plain(QE.taughtState("bio-a1-1", ["A1.1"], SCHED, "biology-hl", today, {})), { state: "taught", source: "schedule" });
  assert.deepEqual(plain(QE.taughtState("bio-c1-1", ["C1.1"], SCHED, "biology-hl", today, {})), { state: "not-taught", source: "schedule" }, "unit ends after today");
  assert.deepEqual(plain(QE.taughtState("x", ["A1.1", "C1.1"], SCHED, "biology-hl", today, {})), { state: "not-taught", source: "schedule" }, "EVERY code must be covered");
  assert.deepEqual(plain(QE.taughtState("x", ["A1.1", "C1.1"], SCHED, "biology-hl", "2026-12-01", {})), { state: "taught", source: "schedule" });
  assert.deepEqual(plain(QE.taughtState("x", ["Z9.9"], SCHED, "biology-hl", today, {})), { state: "not-taught", source: "schedule" }, "code in no unit");
});

test("taughtState: unknown on any doubt (no codes, no schedule, wrong subject, malformed input)", () => {
  const { QE } = engine();
  const unknown = { state: "unknown", source: "none" };
  assert.deepEqual(plain(QE.taughtState("x", [], SCHED, "biology-hl", "2026-10-01", {})), unknown);
  assert.deepEqual(plain(QE.taughtState("x", ["A1.1"], null, "biology-hl", "2026-10-01", {})), unknown);
  assert.deepEqual(plain(QE.taughtState("x", ["A1.1"], SCHED, "math-aa-sl", "2026-10-01", {})), unknown, "subject not tracked by the schedule");
  assert.deepEqual(plain(QE.taughtState("x", "A1.1", SCHED, "biology-hl", "2026-10-01", {})), unknown, "codes must be an array");
  for (const bad of [undefined, "junk", 42, { subjects: "nope" }, { subjects: { "biology-hl": { units: "nope" } } }, { subjects: { "biology-hl": {} } }]) {
    assert.deepEqual(plain(QE.taughtState("x", ["A1.1"], bad, "biology-hl", "2026-10-01", {})), unknown, "schedule " + JSON.stringify(bad));
  }
  assert.deepEqual(plain(QE.taughtState("x", ["A1.1"], SCHED, "biology-hl", "2026-10-01", "junk")), { state: "taught", source: "schedule" }, "malformed overrides fall through to the schedule");
});

test("taughtState: accepts a single subject entry; subject ids compare canonically", () => {
  const { env, QE } = engine();
  const units = [{ from: "2026-01-01", to: "2026-02-01", codes: ["1.1"] }];
  assert.deepEqual(plain(QE.taughtState("m1", ["1.1"], { units }, "math-aa-sl", "2026-03-01", {})), { state: "taught", source: "schedule" });
  // class-schedule.json predates the id scheme ("maths-aa-sl") — canonical compare via profile.js
  env.load("profile.js");
  const sched = { subjects: { "maths-aa-sl": { units } } };
  assert.deepEqual(plain(QE.taughtState("m1", ["1.1"], sched, "math-aa-sl", "2026-01-15", {})), { state: "not-taught", source: "schedule" }, "unit still running");
  assert.deepEqual(plain(QE.taughtState("m1", ["1.1"], sched, "math-aa-sl", "2026-03-01", {})), { state: "taught", source: "schedule" }, "legacy id matched canonically");
});

// ── difficultyPass ─────────────────────────────────────────────────────────
test("difficultyPass: range boundaries, invalid difficulty ranks as unrated", () => {
  const { QE } = engine();
  const rank = (d, min, max) => QE.difficultyPass(d == null ? {} : { difficulty: d }, min, max);
  assert.equal(rank("unrated", "unrated", "hard"), true, "full range includes unrated");
  assert.equal(rank("easy", "easy", "standard"), true, "min boundary included");
  assert.equal(rank("standard", "easy", "standard"), true, "max boundary included");
  assert.equal(rank("hard", "easy", "standard"), false);
  assert.equal(rank("unrated", "easy", "standard"), false);
  assert.equal(rank("easy", "unrated", "unrated"), false, "unrated-only range excludes rated items");
  assert.equal(rank(null, "easy", "standard"), false, "missing difficulty → unrated");
  assert.equal(rank("bogus", "easy", "standard"), false, "invalid difficulty → unrated");
  assert.equal(rank("hard", "unrated", "hard"), true);
});

test("difficultyPass: crossed-over min/max are swapped, not silently empty", () => {
  const { QE } = engine();
  assert.equal(QE.difficultyPass({ difficulty: "easy" }, "standard", "easy"), true);
  assert.equal(QE.difficultyPass({ difficulty: "standard" }, "standard", "easy"), true);
  assert.equal(QE.difficultyPass({ difficulty: "hard" }, "standard", "easy"), false);
  assert.equal(QE.difficultyPass({ difficulty: "unrated" }, "standard", "easy"), false);
});

// ── picker wiring (boot with the app/quiz.html markup, fake fetches) ───────
const tick = (ms) => new Promise(r => setTimeout(r, ms || 25));

const QMANIFEST = [
  { file: "library/questions/chem-p1a-x.json", subject: "chemistry-hl", subjectLabel: "Chemistry HL", label: "Paper 1A — Structure",
    topic: "chem-s1", topicLabel: "Structure 1", codes: ["S1.1", "S1.2"], paperStyle: "1A", calculatorFree: true,
    counts: { mcq: 3, written: 0, total: 3 },
    topics: [{ topic: "chem-s1-1", topicLabel: "Structure 1.1 — Moles", count: 3, difficulty: { unrated: 2, easy: 1, standard: 0, hard: 0 } }] },
  { file: "library/questions/chem-p1b-x.json", subject: "chemistry-hl", subjectLabel: "Chemistry HL", label: "Paper 1B — Data",
    topic: "chem-s1", topicLabel: "Structure 1", codes: ["S1.1"], paperStyle: "1B",
    counts: { mcq: 1, written: 0, total: 1 },
    topics: [{ topic: "chem-s1-1", topicLabel: "Structure 1.1 — Moles", count: 1, difficulty: { unrated: 1, easy: 0, standard: 0, hard: 0 } }] },
  { file: "library/questions/chem-mixed-x.json", subject: "chemistry-hl", subjectLabel: "Chemistry HL", label: "Untaught bank",
    counts: { mcq: 1, written: 0, total: 1 },
    topics: [{ topic: "chem-s9-9", topicLabel: "Zzz untaught topic", count: 1, difficulty: { unrated: 1, easy: 0, standard: 0, hard: 0 } }] }
];
const BANK_FILES = {
  // items carry ITEM-level topics matching the manifest's topics[].topic, like the
  // real seeded banks do (bankItems maps effective topic = it.topic || data.topic
  // || bankId — the wiring tests assert item → topicKey mapping through this)
  "library/questions/chem-p1a-x.json": { subject: "chemistry-hl", topic: "chem-p1a-x", items: [
    { id: "a1", format: "mcq", stem: "s", choices: ["x", "y"], answer: 0, topic: "chem-s1-1" },
    { id: "a2", format: "mcq", stem: "s", choices: ["x", "y"], answer: 0, topic: "chem-s1-1" },
    { id: "a3", format: "mcq", stem: "s", choices: ["x", "y"], answer: 0, topic: "chem-s1-1", difficulty: "easy" }] },
  "library/questions/chem-p1b-x.json": { subject: "chemistry-hl", topic: "chem-p1b-x", items: [
    { id: "b1", format: "mcq", stem: "s", choices: ["x", "y"], answer: 1, topic: "chem-s1-1" },
    { id: "b2", format: "mcq", stem: "s", choices: ["x", "y"], answer: 0, topic: "chem-s1-1", retired: true }] },
  "library/questions/chem-mixed-x.json": { subject: "chemistry-hl", topic: "chem-s9-9", items: [
    { id: "m1", format: "mcq", stem: "s", choices: ["x", "y"], answer: 0, topic: "chem-s9-9" }] }
};
// schedule: S1.1/S1.2 finished long ago (taught regardless of the real date);
// S9.9's unit ends far in the future (not yet taught regardless of the real date)
const NOTES = { notes: [{ id: "chem-s1-1", subject: "chemistry-hl", code: "S1.1" }] };
const SCHEDULE = { subjects: { "chemistry-hl": { units: [
  { from: "2000-01-01", to: "2000-01-02", codes: ["S1.1", "S1.2"] },
  { from: "2099-01-01", to: "2099-12-31", codes: ["S9.9"] }
] } }, breaks: [] };

// A seeded bank whose items span TWO topics — the Paper 1A/1B shape. No bank-level
// topic in the manifest (like the real Paper 1A/1B entries), so the codes guard
// keeps both node codes empty and note-id matching supplies them.
const TWO_MANIFEST = [
  { file: "library/questions/chem-two-x.json", subject: "chemistry-hl", subjectLabel: "Chemistry HL", label: "Two-topic bank",
    codes: ["S1.1"], paperStyle: "1B",
    counts: { mcq: 3, written: 0, total: 3 },
    topics: [
      { topic: "chem-s1-1", topicLabel: "Structure 1.1 — Moles", count: 2, difficulty: { unrated: 1, easy: 1, standard: 0, hard: 0 } },
      { topic: "chem-s1-9", topicLabel: "Zzz untaught", count: 1, difficulty: { unrated: 1, easy: 0, standard: 0, hard: 0 } }
    ] }
];
const TWO_FILES = {
  "library/questions/chem-two-x.json": { subject: "chemistry-hl", topic: "chem-two-x", items: [
    { id: "t1", format: "mcq", stem: "s", choices: ["x", "y"], answer: 0, topic: "chem-s1-1" },
    { id: "t2", format: "mcq", stem: "s", choices: ["x", "y"], answer: 0, topic: "chem-s1-1", difficulty: "easy" },
    { id: "t3", format: "mcq", stem: "s", choices: ["x", "y"], answer: 0, topic: "chem-s1-9" } ] }
};
const TWO_NOTES = { notes: [
  { id: "chem-s1-1", subject: "chemistry-hl", code: "S1.1" },
  { id: "chem-s1-9", subject: "chemistry-hl", code: "S9.9" } ] };

// a Paper 1B bank that ALSO sets calculatorFree — the badge must stay Paper 1B
const BF_MANIFEST = [
  { file: "library/questions/chem-bf-x.json", subject: "chemistry-hl", subjectLabel: "Chemistry HL", label: "1B calc-free bank",
    paperStyle: "1B", calculatorFree: true, counts: { mcq: 1, written: 0, total: 1 },
    topics: [{ topic: "chem-bf-1", topicLabel: "Badge topic", count: 1, difficulty: { unrated: 1, easy: 0, standard: 0, hard: 0 } }] }
];
const BF_FILES = {
  "library/questions/chem-bf-x.json": { subject: "chemistry-hl", topic: "chem-bf-1", items: [
    { id: "bf1", format: "mcq", stem: "s", choices: ["x", "y"], answer: 0, topic: "chem-bf-1" } ] }
};

// the offline fallback: the engine's FALLBACK_BANKS math files, served by the mock
const FALLBACK_FILES = {
  "library/questions/math-aa-number-algebra.json": { subject: "math-aa-sl", topic: "math-na", items: [
    { id: "n1", format: "mcq", stem: "s", choices: ["x", "y"], answer: 0 },
    { id: "n2", format: "mcq", stem: "s", choices: ["x", "y"], answer: 0 }] },
  "library/questions/math-aa-functions-2-1-to-2-3.json": { subject: "math-aa-sl", topic: "math-fn", items: [
    { id: "f1", format: "mcq", stem: "s", choices: ["x", "y"], answer: 0 }] },
  "library/questions/math-functions-2-4-to-2-5.json": { subject: "math-aa-sl", topic: "math-tf", items: [
    { id: "g1", format: "mcq", stem: "s", choices: ["x", "y"], answer: 0 }] }
};

function addEl(env, id) {
  const el = env.document.createElement("div");
  el.id = id;
  env.document.body.appendChild(el);
  return el;
}

async function bootWith(opts) {
  opts = opts || {};
  const manifest = opts.manifest || QMANIFEST;
  const notes = opts.notes || NOTES;
  const schedule = opts.schedule === undefined ? SCHEDULE : opts.schedule;
  const manifestOk = opts.manifestOk !== false;
  const files = Object.assign({}, BANK_FILES, opts.files || {});
  const fetch = (url) => {
    const p = String(url).split("?")[0].replace(/^.*?(library\/)/, "$1");
    if (p === "library/questions/manifest.json") return manifestOk ? Promise.resolve({ ok: true, json: async () => manifest }) : Promise.reject(new Error("manifest offline"));
    if (p === "library/topic-notes/manifest.json") return Promise.resolve({ ok: true, json: async () => notes });
    if (p === "library/class-schedule.json") return Promise.resolve({ ok: !!schedule, json: async () => schedule || {} });
    if (files[p]) return Promise.resolve({ ok: true, json: async () => files[p] });
    return Promise.reject(new Error("unexpected fetch " + url));
  };
  const env = makeEnv({ fetch, readyState: "loading", data: opts.data });
  // q-sure/q-guess/q-conf: renderQuestion wires these by id after writing innerHTML
  // (the fake DOM doesn't parse markup, so they must exist as elements up front)
  ["q-subject", "q-topic", "q-set", "q-format", "q-length", "q-diff-min", "q-diff-max",
   "q-taught-only", "q-taught-panel", "q-taught-list", "q-start", "q-error",
   "q-progress", "q-box", "setup", "runner", "summary", "q-log",
   "q-conf", "q-sure", "q-guess"].forEach(id => addEl(env, id));
  env.load("store.js").load("quiz-engine.js");
  env.fire("document", "DOMContentLoaded");
  await tick(40); // manifest fetch + the background teaching-meta fetch + re-render
  return env;
}

const bootPicker = (data) => bootWith({ data });

const options = (el) => plain(el.children.filter(c => c.tagName === "OPTION").map(c => [c.value, c.textContent]));
const fireChange = (el) => (el.listeners.change || []).forEach(fn => fn());
const panelSelects = (env) => env.document.getElementById("q-taught-list").children
  .map(row => row.children.find(c => c.tagName === "SELECT"));

test("picker wiring: topic options carry topicKey values, counts and teaching suffixes", async () => {
  const env = await bootPicker();
  const subj = env.document.getElementById("q-subject");
  subj.value = "chemistry-hl";
  fireChange(subj);
  const opts = options(env.document.getElementById("q-topic"));
  assert.deepEqual(opts, [
    ["*", "Mixed — all topics (revision)"],
    ["chem-s1-1", "Structure 1.1 — Moles · 4 Qs · taught"],
    ["chem-s9-9", "Zzz untaught topic · 1 Qs"]
  ], "values are topicKeys (not bank indexes); 'taught' comes from the finished schedule unit; unknown shows no suffix");
  assert.equal(env.document.getElementById("q-set").style.display, "none", "set select hidden while Mixed is selected");
  assert.equal(env.document.getElementById("q-set").disabled, true);
});

test("picker wiring: choosing a topic fills #q-set with per-set counts and paper badges", async () => {
  const env = await bootPicker();
  const subj = env.document.getElementById("q-subject");
  subj.value = "chemistry-hl";
  fireChange(subj);
  const topic = env.document.getElementById("q-topic");
  topic.value = "chem-s1-1";
  fireChange(topic); // the topic change listener re-syncs the set select
  const set = env.document.getElementById("q-set");
  assert.equal(set.disabled, false);
  assert.equal(set.style.display, "");
  assert.deepEqual(options(set), [
    ["*", "All sets in this topic"],
    ["0", "Paper 1A — Structure · 3 Qs — Paper 1A · calculator-free"],
    ["1", "Paper 1B — Data · 1 Qs — Paper 1B · data practice (calculator allowed)"]
  ]);
  topic.value = "*";
  fireChange(topic);
  assert.equal(set.style.display, "none", "back to Mixed hides it again");
});

test("picker wiring: the taught panel lists topics with Auto/Taught/Not yet", async () => {
  const env = await bootPicker();
  const subj = env.document.getElementById("q-subject");
  subj.value = "chemistry-hl";
  fireChange(subj);
  const selects = panelSelects(env);
  assert.equal(selects.length, 2, "one row per topic");
  assert.deepEqual(plain(selects.map(s => s.value)), ["auto", "auto"], "no stored overrides → Auto");
  const hints = plain(env.document.getElementById("q-taught-list").children.map(r => r.children.find(c => c.className === "q-taught-hint").textContent));
  assert.deepEqual(hints, ["suggested from class schedule", ""], "schedule-sourced rows show the suggestion hint, the rest none");
});

test("picker wiring: setting an override stores {taught, t}; Auto deletes it", async () => {
  const env = await bootPicker();
  const subj = env.document.getElementById("q-subject");
  subj.value = "chemistry-hl";
  fireChange(subj);
  let selects = panelSelects(env);
  selects[0].value = "not-taught";
  fireChange(selects[0]);
  const stored = plain(env.NB.store.get("topic-taught", {}));
  assert.deepEqual(Object.keys(stored), ["chem-s1-1"]);
  assert.equal(stored["chem-s1-1"].taught, false);
  assert.ok(typeof stored["chem-s1-1"].t === "number");
  selects = panelSelects(env); // re-rendered
  assert.equal(selects[0].value, "not-taught", "the panel shows the stored override");
  selects[0].value = "auto";
  fireChange(selects[0]);
  assert.deepEqual(plain(env.NB.store.get("topic-taught", {})), {}, "Auto deletes the override");
});

test("picker wiring: startSession honours the set select", async () => {
  const env = await bootPicker();
  const subj = env.document.getElementById("q-subject");
  subj.value = "chemistry-hl";
  fireChange(subj);
  const topic = env.document.getElementById("q-topic");
  topic.value = "chem-s1-1";
  fireChange(topic);
  env.document.getElementById("q-set").value = "1"; // the Paper 1B set only
  env.document.getElementById("q-format").value = "mixed";
  env.document.getElementById("q-length").value = "20";
  await (env.document.getElementById("q-start").listeners.click[0])();
  await tick(10);
  assert.equal(env.document.getElementById("setup").style.display, "none", "runner opened");
  assert.match(env.document.getElementById("q-progress").textContent, /Question 1 \/ 1/, "only the 1B bank's active item (b2 is retired)");
});

test("picker wiring: taught-only keeps taught + unknown topics; overrides exclude", async () => {
  const env = await bootPicker();
  const subj = env.document.getElementById("q-subject");
  subj.value = "chemistry-hl";
  fireChange(subj);
  env.document.getElementById("q-taught-only").checked = true;
  env.document.getElementById("q-format").value = "mixed";
  env.document.getElementById("q-length").value = "20";
  const start = env.document.getElementById("q-start").listeners.click[0];
  await start();
  await tick(10);
  assert.match(env.document.getElementById("q-progress").textContent, /Question 1 \/ 5/,
    "chem-s1-1 (taught) + chem-s9-9 (unknown — always included): 3 + 1 active + 1 = 5 items");
  // override the taught topic to not-taught → only the unknown topic's bank remains
  let selects = panelSelects(env);
  selects[0].value = "not-taught";
  fireChange(selects[0]);
  await start();
  await tick(10);
  assert.match(env.document.getElementById("q-progress").textContent, /Question 1 \/ 1/, "only the untaught/unknown topic's item");
});

test("picker wiring: difficulty range filters items; an empty result shows the extended message", async () => {
  const env = await bootPicker();
  const subj = env.document.getElementById("q-subject");
  subj.value = "chemistry-hl";
  fireChange(subj);
  env.document.getElementById("q-format").value = "mixed";
  env.document.getElementById("q-length").value = "20";
  env.document.getElementById("q-diff-min").value = "easy";
  const start = env.document.getElementById("q-start").listeners.click[0];
  await start();
  await tick(10);
  assert.match(env.document.getElementById("q-progress").textContent, /Question 1 \/ 1/, "only a3 is easy; unrated items rank below easy");
  env.document.getElementById("q-diff-min").value = "hard";
  env.document.getElementById("q-diff-max").value = "hard";
  await start();
  await tick(10);
  // the previous start already hid setup; the signal here is the extended error message
  assert.match(env.document.getElementById("q-error").textContent, /No questions match those filters — try widening the difficulty range or including not-yet-taught topics\./);
});

// ── topic scoping of sessions (P1 regression: multi-topic banks must not leak) ──
test("picker wiring: a topic pick serves exactly that topic's items of a multi-topic bank", async () => {
  const env = await bootWith({ manifest: TWO_MANIFEST, notes: TWO_NOTES, files: TWO_FILES });
  const subj = env.document.getElementById("q-subject");
  subj.value = "chemistry-hl";
  fireChange(subj);
  const topic = env.document.getElementById("q-topic");
  env.document.getElementById("q-format").value = "mixed";
  env.document.getElementById("q-length").value = "20";
  const start = env.document.getElementById("q-start").listeners.click[0];
  topic.value = "chem-s1-9";
  fireChange(topic);
  await start();
  await tick(10);
  assert.match(env.document.getElementById("q-progress").textContent, /Question 1 \/ 1/,
    "only the chem-s1-9 item — the bank's chem-s1-1 items stay out despite sharing one bank");
  topic.value = "chem-s1-1";
  fireChange(topic);
  await start();
  await tick(10);
  assert.match(env.document.getElementById("q-progress").textContent, /Question 1 \/ 2/, "exactly the two chem-s1-1 items");
});

test("picker wiring: taught-only Mixed excludes a not-taught topic's items of a shared bank", async () => {
  const env = await bootWith({ manifest: TWO_MANIFEST, notes: TWO_NOTES, files: TWO_FILES });
  const subj = env.document.getElementById("q-subject");
  subj.value = "chemistry-hl";
  fireChange(subj);
  assert.deepEqual(options(env.document.getElementById("q-topic")), [
    ["*", "Mixed — all topics (revision)"],
    ["chem-s1-1", "Structure 1.1 — Moles · 2 Qs · taught"],
    ["chem-s1-9", "Zzz untaught · 1 Qs · not yet taught"]
  ], "chem-s1-1 taught via its note code + finished unit; chem-s1-9's unit ends in 2099");
  env.document.getElementById("q-taught-only").checked = true;
  env.document.getElementById("q-format").value = "mixed";
  env.document.getElementById("q-length").value = "20";
  await (env.document.getElementById("q-start").listeners.click[0])();
  await tick(10);
  assert.match(env.document.getElementById("q-progress").textContent, /Question 1 \/ 2/,
    "the not-taught topic's item of the shared bank is scoped out");
});

test("picker wiring: a fallback bank (offline, no meta) still serves whole under taught-only Mixed", async () => {
  const env = await bootWith({ manifestOk: false, files: FALLBACK_FILES });
  const subj = env.document.getElementById("q-subject");
  subj.value = "math-aa-sl";
  fireChange(subj);
  const opts = options(env.document.getElementById("q-topic"));
  assert.ok(opts.some(o => o[0] === "math-aa-number-algebra" && /· \? Qs$/.test(o[1])),
    "fallback topics show unknown counts: " + JSON.stringify(opts));
  env.document.getElementById("q-taught-only").checked = true;
  env.document.getElementById("q-format").value = "mixed";
  env.document.getElementById("q-length").value = "20";
  await (env.document.getElementById("q-start").listeners.click[0])();
  await tick(10);
  assert.match(env.document.getElementById("q-progress").textContent, /Question 1 \/ 4/,
    "fallback banks are taken whole — topic-key matching must not empty an offline session");
});

test("picker wiring: Paper 1B wins over calculatorFree in the set badge", async () => {
  const env = await bootWith({ manifest: BF_MANIFEST, notes: { notes: [] }, schedule: null, files: BF_FILES });
  const subj = env.document.getElementById("q-subject");
  subj.value = "chemistry-hl";
  fireChange(subj);
  const topic = env.document.getElementById("q-topic");
  topic.value = "chem-bf-1";
  fireChange(topic);
  assert.deepEqual(options(env.document.getElementById("q-set")), [
    ["*", "All sets in this topic"],
    ["0", "1B calc-free bank · 1 Qs — Paper 1B"]
  ], "1B + calculatorFree badges as Paper 1B, not Paper 1A");
});

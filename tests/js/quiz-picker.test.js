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
  assert.deepEqual(plain(enz.sets), [{ ref: b, name: "My enzymes bank", order: null, count: 3, paperStyle: null, calculatorFree: false, difficulties: { unrated: 2, easy: 0, standard: 1, hard: 0 } }], "inline sets carry a copy of the per-topic histogram");
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
  assert.deepEqual(plain(nodes[0].sets), [{ ref: fb, name: "Unity & diversity — Cells", order: null, count: null, paperStyle: null, calculatorFree: false, difficulties: null }], "offline fallback sets have no histogram");
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
    { state: "ready", source: "you" }, "legacy bool-only override true beats the schedule AND reads as ready (the old 'Taught' meaning)");
  assert.deepEqual(plain(QE.taughtState("x", ["A1.1"], SCHED, "biology-hl", today, { x: { taught: false, t: 1 } })),
    { state: "not-taught", source: "you" }, "override false beats the schedule's taught");
  assert.deepEqual(plain(QE.taughtState("x", ["A1.1"], SCHED, "biology-hl", today, { x: { taught: "yes", t: 1 } })),
    { state: "taught", source: "schedule" }, "a non-boolean override is ignored");
});

test("taughtState: a consistent status record IS the state; invalid/contradictory ones fall back to the bool", () => {
  const { QE } = engine();
  const today = "2026-10-01";
  assert.deepEqual(plain(QE.taughtState("x", ["C1.1"], SCHED, "biology-hl", today, { x: { taught: true, status: "learning", t: 2 } })),
    { state: "learning", source: "you" }, "learning beats the schedule's not-yet");
  assert.deepEqual(plain(QE.taughtState("x", ["C1.1"], SCHED, "biology-hl", today, { x: { taught: true, status: "ready", t: 2 } })),
    { state: "ready", source: "you" });
  assert.deepEqual(plain(QE.taughtState("x", ["C1.1"], SCHED, "biology-hl", today, { x: { taught: false, status: "not-taught", t: 2 } })),
    { state: "not-taught", source: "you" });
  for (const bad of ["bogus", "taught", "", null, undefined]) {
    assert.deepEqual(plain(QE.taughtState("x", ["C1.1"], SCHED, "biology-hl", today, { x: { taught: true, status: bad, t: 2 } })),
      { state: "ready", source: "you" }, "status " + JSON.stringify(bad) + " is not a real state — the bool decides");
  }
  assert.deepEqual(plain(QE.taughtState("x", ["C1.1"], SCHED, "biology-hl", today, { x: { taught: false, status: "learning", t: 2 } })),
    { state: "not-taught", source: "you" }, "a status contradicting the bool is ignored");
  assert.deepEqual(plain(QE.taughtState("x", ["C1.1"], SCHED, "biology-hl", today, { x: { taught: true, status: "not-taught", t: 2 } })),
    { state: "ready", source: "you" }, "so is not-taught on a taught:true record");
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

// ── per-set histograms, paperOnly, unratedSuffix, disambiguateSetNames ─────
test("buildTopics: per-set difficulties come from the manifest topic (meta) or the item aggregate (inline); absent → null", () => {
  const { QE } = engine();
  const a = metaBank("library/questions/p1a.json", "Paper 1A — Mixed",
    [
      { topic: "t1", topicLabel: "T one", count: 4, difficulty: { unrated: 2, easy: 1, standard: 1 } },
      { topic: "t2", topicLabel: "T two", count: 1 } // no difficulty histogram in the manifest
    ],
    { paperStyle: "1A" });
  const nodes = QE.buildTopics([a]);
  assert.deepEqual(plain(nodes[0].sets[0].difficulties), { unrated: 2, easy: 1, standard: 1, hard: 0 }, "missing histogram keys default to 0");
  assert.equal(nodes[1].sets[0].difficulties, null, "a manifest topic without difficulty → null");
  const inline = { inline: true, label: "Inline", topicLabel: "T three", topic: "t3", items: [
    { id: "i1", format: "mcq", stem: "s", choices: ["a", "b"], answer: 0, difficulty: "hard" },
    { id: "i2", format: "mcq", stem: "s", choices: ["a", "b"], answer: 0 } ] };
  const raw = QE.buildTopics([inline])[0];
  assert.deepEqual(plain(raw.sets[0].difficulties), { unrated: 1, easy: 0, standard: 0, hard: 1 }, "inline sets aggregate their items like the topic node does");
  assert.notEqual(raw.sets[0].difficulties, raw.difficulties, "the set histogram is a copy, never the node's own object");
});

test("buildTopics: paperOnly is the shared paperStyle of EVERY set; mixed or unstyled topics get null", () => {
  const { QE } = engine();
  const banks = [
    metaBank("library/questions/b1.json", "B one", [{ topic: "t-1b", topicLabel: "T one", count: 1 }], { paperStyle: "1B" }),
    metaBank("library/questions/b2.json", "B two", [{ topic: "t-1b", topicLabel: "T one", count: 1 }], { paperStyle: "1B" }),
    metaBank("library/questions/a1.json", "A one", [{ topic: "t-1a", topicLabel: "T two", count: 1 }], { paperStyle: "1A" }),
    metaBank("library/questions/p.json", "P plain", [{ topic: "t-none", topicLabel: "T three", count: 1 }]),
    metaBank("library/questions/m1.json", "M one", [{ topic: "t-mixed", topicLabel: "T four", count: 1 }], { paperStyle: "1A" }),
    metaBank("library/questions/m2.json", "M two", [{ topic: "t-mixed", topicLabel: "T four", count: 1 }], { paperStyle: "1B" })
  ];
  const byKey = {};
  QE.buildTopics(banks).forEach(n => { byKey[n.topicKey] = n; });
  assert.equal(byKey["t-1b"].paperOnly, "1B", "all sets 1B → 1B");
  assert.equal(byKey["t-1a"].paperOnly, "1A");
  assert.equal(byKey["t-none"].paperOnly, null, "no paperStyle anywhere → null");
  assert.equal(byKey["t-mixed"].paperOnly, null, "sets disagreeing on the style → null");
});

test("unratedSuffix: only a positive unrated count shows; null/undefined shows nothing", () => {
  const { QE } = engine();
  assert.equal(QE.unratedSuffix({ unrated: 3, easy: 0, standard: 0, hard: 0 }), " · 3 unrated");
  assert.equal(QE.unratedSuffix({ unrated: 0, easy: 2, standard: 0, hard: 1 }), "", "fully rated content shows nothing");
  assert.equal(QE.unratedSuffix(null), "", "offline fallback sets have no histogram");
  assert.equal(QE.unratedSuffix(undefined), "");
});

test("disambiguateSetNames: unique names pass through; tied sets get a stable source suffix, positional as the last resort", () => {
  const { QE } = engine();
  assert.deepEqual(plain(QE.disambiguateSetNames([])), []);
  assert.deepEqual(plain(QE.disambiguateSetNames(null)), [], "malformed input stays pure and safe");
  assert.deepEqual(plain(QE.disambiguateSetNames([
    { name: "Practice set 1", ref: { name: "ub-a.json" } },
    { name: "Photosynthesis", ref: { name: "ub-b.json" } }
  ])), ["Practice set 1", "Photosynthesis"], "names occurring once pass through untouched");
  assert.deepEqual(plain(QE.disambiguateSetNames([
    { name: "Enzymes", ref: { name: "ub-aaa.json" } },
    { name: "Enzymes", ref: { name: "ub-bbb.json" } }
  ])), ["Enzymes — ub-aaa.json", "Enzymes — ub-bbb.json"], "tied uploads show their stored bank names");
  assert.deepEqual(plain(QE.disambiguateSetNames([
    { name: "Structure 1", ref: { file: "library/questions/chem-s1-a.json" } },
    { name: "Structure 1", ref: { file: "library/questions/chem-s1-b.json" } }
  ])), ["Structure 1 — chem-s1-a", "Structure 1 — chem-s1-b"], "seeded banks fall to the file stem");
  assert.deepEqual(plain(QE.disambiguateSetNames([
    { name: "My bank", ref: { uploaded: "2026-11-20" } },
    { name: "My bank", ref: { uploaded: "2026-11-21" } }
  ])), ["My bank — 2026-11-20", "My bank — 2026-11-21"], "no name/file → the upload date");
  assert.deepEqual(plain(QE.disambiguateSetNames([
    { name: "Twin", ref: { name: "ub-a.json" } },
    { name: "Twin", ref: { name: "ub-a.json" } }
  ])), ["Twin — ub-a.json", "Twin (set 2)"], "an identical suffix cannot disambiguate — the 1-based position forces uniqueness");
  assert.deepEqual(plain(QE.disambiguateSetNames([
    { name: "A", ref: { file: "library/questions/x.json" } },
    { name: "A", ref: { file: "library/questions/y.json" } },
    { name: "A — x", ref: { name: "ub-z.json" } }
  ])), ["A (set 1)", "A — y", "A — x"], "a generated suffix never collides with another set's literal stored name");
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
  // (the fake DOM doesn't parse markup, so they must exist as elements up front);
  // q-reveal/q-selfscore/q-next/q-ms are the written-path counterparts, q-again the
  // summary's button (the last test to answer a whole session reaches summarize()).
  ["q-subject", "q-topic", "q-set", "q-format", "q-length", "q-diff-min", "q-diff-max",
   "q-taught-only", "q-taught-panel", "q-taught-list", "q-start", "q-error",
   "q-progress", "q-box", "setup", "runner", "summary", "q-log",
   "q-conf", "q-sure", "q-guess", "q-reveal", "q-reveal-guess", "q-ms",
   "q-selfscore", "q-next", "q-again"].forEach(id => addEl(env, id));
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
    ["chem-s1-1", "Structure 1.1 — Moles · 4 Qs · 3 unrated · taught"],
    ["chem-s9-9", "Zzz untaught topic · 1 Qs · 1 unrated"]
  ], "values are topicKeys (not bank indexes); 'taught' comes from the finished schedule unit; unrated counts sit right after the Qs count; unknown shows no status suffix");
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
    ["0", "Paper 1A — Structure · 3 Qs · 2 unrated — Paper 1A · calculator-free"],
    ["1", "Paper 1B — Data · 1 Qs · 1 unrated — Paper 1B · data practice (calculator allowed)"]
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
    ["chem-s1-1", "Structure 1.1 — Moles · 2 Qs · 1 unrated · Paper 1B practice · taught"],
    ["chem-s1-9", "Zzz untaught · 1 Qs · 1 unrated · Paper 1B practice · not yet taught"]
  ], "chem-s1-1 taught via its note code + finished unit; chem-s1-9's unit ends in 2099; the shared bank's 1B style reaches both topic rows");
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
    ["0", "1B calc-free bank · 1 Qs · 1 unrated — Paper 1B"]
  ], "1B + calculatorFree badges as Paper 1B, not Paper 1A");
});

// ── three-state teaching status (not-taught / learning / ready) ────────────
test("picker wiring: the three statuses store {taught, status, t}; Auto deletes", async () => {
  const env = await bootPicker();
  const subj = env.document.getElementById("q-subject");
  subj.value = "chemistry-hl";
  fireChange(subj);
  let selects = panelSelects(env);
  selects[0].value = "learning";
  fireChange(selects[0]);
  let stored = plain(env.NB.store.get("topic-taught", {}));
  assert.equal(stored["chem-s1-1"].taught, true, "learning implies taught:true");
  assert.equal(stored["chem-s1-1"].status, "learning");
  assert.ok(typeof stored["chem-s1-1"].t === "number");
  selects = panelSelects(env);
  assert.equal(selects[0].value, "learning", "the panel pre-selects the stored status");
  selects[0].value = "ready";
  fireChange(selects[0]);
  stored = plain(env.NB.store.get("topic-taught", {}));
  assert.deepEqual({ taught: stored["chem-s1-1"].taught, status: stored["chem-s1-1"].status }, { taught: true, status: "ready" });
  selects[0].value = "not-taught";
  fireChange(selects[0]);
  stored = plain(env.NB.store.get("topic-taught", {}));
  assert.deepEqual({ taught: stored["chem-s1-1"].taught, status: stored["chem-s1-1"].status }, { taught: false, status: "not-taught" }, "not-taught keeps taught consistent for older clients");
  selects = panelSelects(env);
  assert.equal(selects[0].value, "not-taught");
  selects[0].value = "auto";
  fireChange(selects[0]);
  assert.deepEqual(plain(env.NB.store.get("topic-taught", {})), {}, "Auto deletes the override");
});

test("picker wiring: topic options carry the status suffixes for learning/ready/not-taught", async () => {
  const env = await bootPicker();
  const subj = env.document.getElementById("q-subject");
  subj.value = "chemistry-hl";
  fireChange(subj);
  const topic = env.document.getElementById("q-topic");
  const selects = panelSelects(env);
  for (const [v, suffix] of [["learning", " · learning"], ["ready", " · ready to revise"], ["not-taught", " · not yet taught"]]) {
    selects[0].value = v;
    fireChange(selects[0]);
    assert.ok(options(topic).some(o => o[0] === "chem-s1-1" && o[1].endsWith(suffix)),
      v + " shows as" + suffix + ": " + JSON.stringify(options(topic)));
  }
});

test("picker wiring: taught-only still includes learning and ready topics, still excludes not-taught", async () => {
  const env = await bootPicker();
  const subj = env.document.getElementById("q-subject");
  subj.value = "chemistry-hl";
  fireChange(subj);
  env.document.getElementById("q-taught-only").checked = true;
  env.document.getElementById("q-format").value = "mixed";
  env.document.getElementById("q-length").value = "20";
  const start = env.document.getElementById("q-start").listeners.click[0];
  let selects = panelSelects(env);
  selects[0].value = "learning"; // chem-s1-1: schedule says taught, the user says learning
  fireChange(selects[0]);
  await start();
  await tick(10);
  assert.match(env.document.getElementById("q-progress").textContent, /Question 1 \/ 5/,
    "learning (3+1 items incl. the retired b2) + the unknown topic's item = 5");
  selects = panelSelects(env);
  selects[0].value = "ready";
  fireChange(selects[0]);
  await start();
  await tick(10);
  assert.match(env.document.getElementById("q-progress").textContent, /Question 1 \/ 5/, "ready is included too");
  selects[0].value = "not-taught";
  fireChange(selects[0]);
  await start();
  await tick(10);
  assert.match(env.document.getElementById("q-progress").textContent, /Question 1 \/ 1/, "only the unknown topic's item remains");
});

// ── progress keying regression: identical item ids across two uploads ──────
test("picker wiring: two uploads with the same topic and identical item ids keep separate q-errors records", async () => {
  const mk = (id, name) => ({ id, name, subject: "chemistry-hl", subjectLabel: "Chemistry HL",
    inline: true, label: name, topicLabel: "Enzymes", topic: "enzymes",
    items: ["p01", "p02", "p03"].map(x => ({ id: x, format: "written", stem: "Stem " + id + " " + x, marks: 2, markscheme: ["point (1)", "point (1)"] })) });
  const env = await bootWith({ data: { "q-userbanks": JSON.stringify([mk("ub-aaa-111", "Set one"), mk("ub-bbb-222", "Set two")]) } });
  const subj = env.document.getElementById("q-subject");
  subj.value = "chemistry-hl";
  fireChange(subj);
  const topic = env.document.getElementById("q-topic");
  topic.value = "enzymes";
  fireChange(topic);
  env.document.getElementById("q-format").value = "written";
  env.document.getElementById("q-length").value = "20";
  await (env.document.getElementById("q-start").listeners.click[0])();
  await tick(10);
  assert.match(env.document.getElementById("q-progress").textContent, /Question 1 \/ 6/,
    "both banks' items are in one session (same topic, identical ids, different banks)");
  // answer every question wrong through the real written flow — the latest
  // listener per element is the current render's (fake DOM never re-parses
  // innerHTML, so handlers stack on the same elements across renders)
  const last = (id) => { const el = env.document.getElementById(id); return el.listeners.click[el.listeners.click.length - 1]; };
  for (let i = 0; i < 6; i++) {
    last("q-reveal")();
    env.document.getElementById("q-selfscore").value = "0";
    last("q-next")();
  }
  const errs = plain(env.NB.store.get("q-errors", []));
  assert.deepEqual(errs.map(e => e.key).sort(), [
    "ub-aaa-111#p01", "ub-aaa-111#p02", "ub-aaa-111#p03",
    "ub-bbb-222#p01", "ub-bbb-222#p02", "ub-bbb-222#p03"
  ], "keys are bank-scoped: identical item ids never share a record across banks");
  assert.equal(errs.filter(e => e.id === "p01").length, 2, "both p01s exist as separate records");
  assert.equal(errs.filter(e => e.key === "ub-aaa-111#p01").length, 1);
  assert.equal(errs.filter(e => e.key === "ub-bbb-222#p01").length, 1);
  assert.ok(errs.every(e => e.attempts === 1), "each record counted its own miss only");
});

test("picker wiring: a legacy inline bank without an id still appears (fallback bank id untouched)", async () => {
  const env = await bootWith({ data: { "q-userbanks": JSON.stringify([{ subject: "chemistry-hl", subjectLabel: "Chemistry HL",
    label: "Legacy bank", topicLabel: "Legacy topic", topic: "legacy-topic",
    items: [{ id: "l1", format: "mcq", stem: "s", choices: ["a", "b"], answer: 0 }] }]) } });
  const subj = env.document.getElementById("q-subject");
  subj.value = "chemistry-hl";
  fireChange(subj);
  const opts = options(env.document.getElementById("q-topic"));
  assert.ok(opts.some(o => o[0] === "legacy-topic" && o[1].indexOf("Legacy topic · 1 Qs") === 0),
    "the no-id bank's topic is in the picker: " + JSON.stringify(opts));
});

// ── failure paths: corrupt topic-taught data through the real boot ──────────
test("picker wiring: a corrupt topic-taught whole value boots clean; an override choice rebuilds the map", async () => {
  // a legacy/corrupt write can leave any JSON shape in the key ("corrupted" is a
  // valid JSON string, so store.get hands it through verbatim): the boot must
  // not throw, the panel must still list every topic, and the first override
  // choice must replace the junk with a proper {taught, status, t} record
  const env = await bootPicker({ "topic-taught": JSON.stringify("corrupted") });
  const subj = env.document.getElementById("q-subject");
  subj.value = "chemistry-hl";
  fireChange(subj);
  assert.equal(options(env.document.getElementById("q-topic")).length, 3, "topics still render over a corrupt whole value");
  let selects = panelSelects(env);
  assert.equal(selects.length, 2, "the taught panel still lists every topic");
  assert.equal(selects[0].value, "auto", "a corrupt value is not mistaken for a stored override");
  selects[0].value = "learning";
  fireChange(selects[0]);
  const stored = plain(env.NB.store.get("topic-taught", {}));
  assert.deepEqual(Object.keys(stored), ["chem-s1-1"], "the corrupt whole value is replaced by a proper map");
  assert.equal(stored["chem-s1-1"].taught, true);
  assert.equal(stored["chem-s1-1"].status, "learning");
  assert.ok(typeof stored["chem-s1-1"].t === "number");
});

test("picker wiring: a legacy bool-only override pre-selects its mapped choice, not Auto", async () => {
  // records written by the pre-3-state client carry {taught, t} with no status;
  // the panel must pre-select the same choice its topic-dropdown suffix shows
  // ("ready to revise" for the old "Taught"), so switching subjects or
  // re-rendering never silently drops the override back to Auto
  const env = await bootPicker({ "topic-taught": JSON.stringify({ "chem-s1-1": { taught: true, t: 123 }, "chem-s9-9": { taught: false, t: 456 } }) });
  const subj = env.document.getElementById("q-subject");
  subj.value = "chemistry-hl";
  fireChange(subj);
  assert.deepEqual(options(env.document.getElementById("q-topic")), [
    ["*", "Mixed — all topics (revision)"],
    ["chem-s1-1", "Structure 1.1 — Moles · 4 Qs · 3 unrated · ready to revise"],
    ["chem-s9-9", "Zzz untaught topic · 1 Qs · 1 unrated · not yet taught"]
  ], "legacy bool-only records show the mapped three-state suffixes");
  const selects = panelSelects(env);
  assert.equal(selects[0].value, "ready", "legacy taught:true pre-selects Ready to revise");
  assert.equal(selects[1].value, "not-taught", "legacy taught:false pre-selects Not yet");
});

test("picker wiring: junk per-topic records degrade to schedule/unknown; taught-only sessions still start", async () => {
  const env = await bootPicker({ "topic-taught": JSON.stringify({ "chem-s1-1": "junk", "chem-s9-9": { taught: "yes", t: 1 } }) });
  const subj = env.document.getElementById("q-subject");
  subj.value = "chemistry-hl";
  fireChange(subj);
  assert.deepEqual(options(env.document.getElementById("q-topic")), [
    ["*", "Mixed — all topics (revision)"],
    ["chem-s1-1", "Structure 1.1 — Moles · 4 Qs · 3 unrated · taught"],
    ["chem-s9-9", "Zzz untaught topic · 1 Qs · 1 unrated"]
  ], "a string record and a non-boolean taught are ignored, not crashed on — the schedule decides for chem-s1-1, chem-s9-9 stays unknown");
  const selects = panelSelects(env);
  assert.equal(selects.length, 2, "both panel rows render over junk records");
  assert.ok(selects.every(s => s.value === "auto"), "junk records never pre-select an override");
  env.document.getElementById("q-taught-only").checked = true;
  env.document.getElementById("q-format").value = "mixed";
  env.document.getElementById("q-length").value = "20";
  await (env.document.getElementById("q-start").listeners.click[0])();
  await tick(10);
  assert.match(env.document.getElementById("q-progress").textContent, /Question 1 \/ 5/,
    "the taught-only session still serves schedule-taught (4) + unknown (1) items");
});

test("picker wiring: crossed difficulty bounds are swapped at start, not silently empty", async () => {
  const env = await bootPicker();
  const subj = env.document.getElementById("q-subject");
  subj.value = "chemistry-hl";
  fireChange(subj);
  env.document.getElementById("q-format").value = "mixed";
  env.document.getElementById("q-length").value = "20";
  env.document.getElementById("q-diff-min").value = "hard";
  env.document.getElementById("q-diff-max").value = "easy";
  await (env.document.getElementById("q-start").listeners.click[0])();
  await tick(10);
  assert.match(env.document.getElementById("q-progress").textContent, /Question 1 \/ 1/,
    "hard..easy is read as easy..hard → only a3 (easy) qualifies; unrated items rank below");
  assert.strictEqual(env.document.getElementById("q-error").textContent, "", "no empty-result error — the session started");
});

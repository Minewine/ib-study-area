// node --test tests/js — the per-question hide flag (assets/qhidden.js + the
// synced "q-hidden" key): the pure module helpers, sync registration + per-user
// scoping + dirty marking, the RECORDS merge (newest t per entry, restore
// sentinel), the backup.js shape validator, the serving gates (bankItems /
// startFromLink / today pickQuizIds / flashcards rebuild) and the quiz page's
// mutators + hide button + restore panel. Boots follow retired.test.js.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeEnv, plain } = require("./harness");

const J = JSON.stringify;
const tick = (ms) => new Promise(r => setTimeout(r, ms || 50));

const env = (data) => makeEnv({ readyState: "loading", data }).load("store.js").load("qhidden.js");
const engineEnv = (data, opts) => makeEnv(Object.assign({ readyState: "loading", data }, opts || {})).load("store.js").load("qhidden.js").load("quiz-engine.js");
const backupEnv = (data) => makeEnv({ data }).load("store.js").load("backup.js");
const QH = () => env({}).NB.qhidden;

const BANK = { subject: "biology-hl", topic: "c1-1", topicLabel: "Enzymes", items: [
  { id: "p01", format: "written", stem: "Stem one.", marks: 2, markscheme: ["m1"] },
  { id: "p02", format: "written", stem: "Stem two.", marks: 2, markscheme: ["m2"] },
] };
const json = (o) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(o) });
const fetchLib = () => (url) => {
  const p = String(url).split("?")[0];
  if (p.endsWith("questions/manifest.json")) return json([{ file: "library/questions/lib-x.json", subject: "biology-hl", subjectLabel: "Biology HL" }]);
  if (p.endsWith("lib-x.json")) return json(BANK);
  return Promise.reject(new Error("offline " + url)); // teaching meta — caught internally
};

const addEl = (env, id) => { const el = env.document.createElement("div"); el.id = id; env.document.body.appendChild(el); return el; };
const IDS = ["q-subject", "q-topic", "q-set", "q-format", "q-length", "q-diff-min", "q-diff-max",
  "q-taught-only", "q-taught-panel", "q-taught-list", "q-start", "q-error",
  "q-progress", "q-box", "setup", "runner", "summary", "q-log",
  "q-conf", "q-sure", "q-guess", "q-reveal", "q-reveal-guess", "q-ms",
  "q-answer", "q-selfscore", "q-next", "q-again", "q-fc", "q-hide",
  "q-hidden-panel", "q-hidden-list", "q-hidden-summary"];
const bootQuiz = async (opts) => {
  opts = opts || {};
  const e = makeEnv(Object.assign({ readyState: "loading", fetch: fetchLib() }, opts));
  IDS.forEach(id => addEl(e, id));
  e.load("store.js").load("qhidden.js").load("quiz-engine.js");
  e.fire("document", "DOMContentLoaded");
  await tick();
  return e;
};
const last = (e, id) => { const el = e.document.getElementById(id); return el.listeners.click[el.listeners.click.length - 1]; };

// ── pure module (assets/qhidden.js) ────────────────────────────────────────
test("qhidden module: keyFor joins bankId#id; hiddenIds guards garbage; filterItems never throws", () => {
  const qh = QH();
  assert.equal(qh.keyFor("bio-y", "1"), "bio-y#1");
  assert.equal(qh.keyFor(null, undefined), "#", "null/garbage ids still produce a stable key");
  assert.deepEqual(plain([...qh.hiddenIds({ "a#1": { hidden: true, t: 1 }, "a#2": { hidden: false, t: 2 }, "a#3": "junk", "a#4": { hidden: "yes" } })]), ["a#1"], "only boolean true hides; garbage entries never do");
  assert.deepEqual(plain([...qh.hiddenIds("junk")]), []);
  assert.deepEqual(plain([...qh.hiddenIds(null)]), []);
  const items = [{ bankId: "a", id: "1" }, { bankId: "a", id: "2" }, { bankId: null, id: "3" }, null];
  const map = { "a#1": { hidden: true, t: 1 } };
  assert.deepEqual(plain(qh.filterItems(items, map).filter(Boolean).map(i => i.id)), ["2", "3"]);
  assert.deepEqual(plain(qh.filterItems(null, map)), [], "non-array input → empty list");
  assert.deepEqual(plain(qh.filterItems(items, "junk")).length, 4, "garbage map → nothing hidden");
});

// ── sync registration + scope + dirty ──────────────────────────────────────
test("q-hidden is a synced key, round-trips through NB.store and marks itself dirty", () => {
  const e = env({});
  const s = e.NB.store;
  assert.ok(s.SYNCED_KEYS.indexOf("q-hidden") >= 0, "listed in SYNCED_KEYS");
  assert.ok(s.isSynced("q-hidden"), "isSynced");
  assert.equal(s.set("q-hidden", { "bio-y#1": { hidden: true, t: 5 } }), true);
  assert.deepEqual(plain(s.get("q-hidden", {})), { "bio-y#1": { hidden: true, t: 5 } });
  assert.ok(s.dirty()["q-hidden"] > 0, "a non-silent write marks the key for sync");
});

test("q-hidden stays per-user scoped", () => {
  const e = env({});
  const s = e.NB.store;
  assert.equal(s.setScope("u1"), true);
  assert.equal(s.set("q-hidden", { "k#1": { hidden: true, t: 1 } }), true);
  assert.equal(e.storage.getItem("u1:q-hidden"), J({ "k#1": { hidden: true, t: 1 } }), "physically scoped");
  assert.equal(e.storage.getItem("q-hidden"), null, "nothing under the plain key");
  assert.equal(s.setScope("u2"), true);
  assert.deepEqual(plain(s.get("q-hidden", {})), {}, "u2 does not see u1's hides");
  assert.equal(s.setScope("u1"), true);
  assert.deepEqual(plain(s.get("q-hidden", {})), { "k#1": { hidden: true, t: 1 } }, "switching back restores them");
});

// ── RECORDS merge ──────────────────────────────────────────────────────────
test("NB.merge RECORDS q-hidden: newest t wins per entry; union of keys; tie → b", () => {
  const merge = (a, b) => plain(env({}).NB.merge.RECORDS["q-hidden"](a, b));
  assert.deepEqual(merge({ "A#1": { hidden: true, t: 5 } }, { "A#1": { hidden: false, t: 9 }, "B#1": { hidden: true, t: 1 } }),
    { "A#1": { hidden: false, t: 9 }, "B#1": { hidden: true, t: 1 } }, "A from the server (newer t); B kept");
  assert.deepEqual(merge({ "A#1": { hidden: false, t: 9 } }, { "A#1": { hidden: true, t: 5 } }),
    { "A#1": { hidden: false, t: 9 } }, "local wins when its t is newer");
  assert.deepEqual(merge({ "A#1": { hidden: true, t: 5 } }, { "A#1": { hidden: false, t: 5 } }),
    { "A#1": { hidden: false, t: 5 } }, "tie → b wins (the RECORDS convention)");
});

test("NB.merge RECORDS q-hidden: missing t ranks as t=0; garbage entries dropped; non-object input never crashes", () => {
  const merge = (a, b) => plain(env({}).NB.merge.RECORDS["q-hidden"](a, b));
  assert.deepEqual(merge({ "A#1": { hidden: true } }, { "A#1": { hidden: false, t: 9 } }), { "A#1": { hidden: false, t: 9 } }, "untimed entry loses to a timed one");
  assert.deepEqual(merge({ "A#1": { hidden: true, t: 3 } }, { "A#1": { hidden: false } }), { "A#1": { hidden: true, t: 3 } }, "timed entry beats an untimed one");
  assert.deepEqual(merge({ "A#1": "junk", "B#1": { hidden: true, t: 1 } }, { "A#1": { hidden: false, t: 2 } }),
    { "A#1": { hidden: false, t: 2 }, "B#1": { hidden: true, t: 1 } }, "garbage loses to a proper record, not to nothing");
  assert.deepEqual(merge({ "A#1": "x" }, { "A#1": "y" }), {}, "garbage on both sides → dropped");
  assert.deepEqual(merge({ "A#1": { hidden: true, t: 1 } }, { "B#1": "junk" }), { "A#1": { hidden: true, t: 1 } }, "a lone garbage entry is dropped");
  assert.deepEqual(merge(5, { "A#1": { hidden: true, t: 1 } }), { "A#1": { hidden: true, t: 1 } }, "non-object whole value → other side");
  assert.deepEqual(merge({ "A#1": { hidden: true, t: 1 } }, "x"), { "A#1": { hidden: true, t: 1 } });
  assert.deepEqual(merge(undefined, { "A#1": { hidden: true, t: 1 } }), { "A#1": { hidden: true, t: 1 } });
});

test("NB.merge RECORDS q-hidden: an explicit {hidden:false, t} restore sentinel beats a stale hide", () => {
  const merge = (a, b) => plain(env({}).NB.merge.RECORDS["q-hidden"](a, b));
  // the restore sentinel is what makes cross-device convergence work: a delete
  // would let the other device's stale hide win the union
  assert.deepEqual(merge({ "A#1": { hidden: true, t: 1, reason: "old" } }, { "A#1": { hidden: false, t: 9 } }),
    { "A#1": { hidden: false, t: 9 } }, "a newer restore beats an older hide (and its reason)");
  assert.deepEqual(merge({ "A#1": { hidden: false, t: 1 } }, { "A#1": { hidden: true, t: 9 } }),
    { "A#1": { hidden: true, t: 9 } }, "…and a newer hide beats an older restore, symmetric");
});

// ── backup SPEC ────────────────────────────────────────────────────────────
test("backup: q-hidden is collected, validated and restored record-by-record; bogus entries are dropped as warnings", () => {
  const a = backupEnv({});
  a.NB.store.set("q-hidden", {
    "bio-y#1": { hidden: true, t: 5, reason: "off-syllabus", label: "Label" },
    "bio-y#2": { hidden: false, t: 6 }, // restore sentinel
    bad: "junk",
    bad2: { hidden: "yes", t: 7 },
  });
  const file = J(a.NB.backup.collect());
  assert.ok(Object.keys(JSON.parse(file).keys).indexOf("q-hidden") >= 0, "collect includes the key");

  const b = backupEnv({});
  const p = b.NB.backup.parse(file);
  assert.equal(p.ok, true, p.errors.join("; "));
  assert.ok(p.warnings.some(w => /q-hidden/.test(w)), "dropped records are counted as warnings");
  const r = b.NB.backup.restore(p, "merge");
  assert.equal(r.ok, true);
  assert.deepEqual(plain(b.NB.store.get("q-hidden", {})), {
    "bio-y#1": { hidden: true, t: 5, reason: "off-syllabus", label: "Label" },
    "bio-y#2": { hidden: false, t: 6 },
  }, "bad records dropped, good ones (incl. the sentinel) kept");

  const c = backupEnv({});
  const bad = c.NB.backup.parse(J({ format: "nevaib-backup", version: 3, keys: { "q-hidden": [1, 2] } }));
  assert.equal(bad.ok, false, "a non-object whole value is rejected as a damaged file");
  assert.match(bad.errors.join(" "), /wrong shape/);
});

// ── serving gates: bankItems (inline + file) ───────────────────────────────
test("bankItems: hidden items never serve — inline uploads and library banks alike; retired semantics untouched", async () => {
  const e = engineEnv({ "q-hidden": J({ "ub-x#p01": { hidden: true, t: 1 }, "lib-x#p01": { hidden: true, t: 2 } }) }, { fetch: fetchLib() });
  const QE = e.NB.quizEngine;
  const inline = plain(await QE.bankItems({ inline: true, id: "ub-x", label: "U", items: BANK.items }));
  assert.deepEqual(inline.map(i => i.id), ["p02"], "the hidden upload item is filtered");
  const file = plain(await QE.bankItems({ file: "library/questions/lib-x.json", label: "Lib X" }));
  assert.deepEqual(file.map(i => i.id), ["p02"], "the hidden library item is filtered (both branches gate)");
  assert.equal(file[0].bankId, "lib-x", "bankItems mapping unchanged");
});

// ── startFromLink: hidden-skip + notice bit ────────────────────────────────
test("startFromLink: hidden linked ids are skipped, counted separately from not-found, and reported", async () => {
  const e = await bootQuiz({ data: { "q-hidden": J({ "lib-x#p01": { hidden: true, t: 1, reason: "dupe" } }) },
    location: { search: "?from=lib-x:p01,p02,gone&label=Unit%201" } });
  assert.match(e.document.getElementById("q-progress").textContent, /Question 1 \/ 1/, "only p02 serves");
  assert.match(e.document.getElementById("q-box").innerHTML, /Stem two\./, "p02 is the session's first question");
  // answer it (full marks) to reach summarize(), where the notice renders
  last(e, "q-reveal")();
  e.document.getElementById("q-selfscore").value = "2";
  last(e, "q-next")();
  const notice = e.document.getElementById("summary").innerHTML;
  assert.match(notice, /1 hidden question\(s\) skipped\./, "the hidden skip gets its own notice bit");
  assert.match(notice, /1 linked item\(s\) not found\./, "the unknown id still counts as not found (not double-counted as hidden)");
});

test("startFromLink: a deep link whose every id is hidden starts nothing", async () => {
  const e = await bootQuiz({ data: { "q-hidden": J({ "lib-x#p01": { hidden: true, t: 1 } }) },
    location: { search: "?from=lib-x:p01" } });
  assert.equal(e.document.getElementById("q-error").textContent,
    "None of the questions linked from that note could be found. 1 hidden question(s) skipped.",
    "nothing left to serve the link — and the reason is stated, not 'not found'");
});

// ── mutators (hideQuestion / restoreQuestion) ──────────────────────────────
test("hideQuestion: read-modify-write map entry shape, bounds and empty-field drops", () => {
  const e = engineEnv({});
  const QE = e.NB.quizEngine;
  assert.equal(QE.hideQuestion("bio-y", "1", "  off-syllabus  ", 1000, "  " + "x".repeat(200) + "  "), true);
  let map = plain(e.NB.store.get("q-hidden"));
  assert.deepEqual(map["bio-y#1"], { hidden: true, t: 1000, reason: "off-syllabus", label: "x".repeat(120) },
    "reason ≤200, label ≤120, both trimmed");
  assert.equal(QE.hideQuestion("bio-y", "2", "   ", 2000, ""), true, "empty reason/label are dropped, not stored as \"\"");
  map = plain(e.NB.store.get("q-hidden"));
  assert.deepEqual(map["bio-y#2"], { hidden: true, t: 2000 });
  assert.equal(QE.hideQuestion("bio-y", "3", null, undefined), true, "null nowMs → Date.now(); no reason/label");
  map = plain(e.NB.store.get("q-hidden"));
  assert.equal(map["bio-y#3"].t > 0, true);
  assert.equal(map["bio-y#3"].reason, undefined);
  assert.equal(QE.hideQuestion("bio-y", "1", "second reason", 3000), true, "re-hiding overwrites the entry");
  map = plain(e.NB.store.get("q-hidden"));
  assert.deepEqual(map["bio-y#1"], { hidden: true, t: 3000, reason: "second reason" }, "the old label is gone too");
});

test("restoreQuestion: writes the explicit {hidden:false, t} sentinel (reason/label dropped); absent entry → false", () => {
  const e = engineEnv({ "q-hidden": J({ "bio-y#1": { hidden: true, t: 1, reason: "r", label: "L" } }) });
  const QE = e.NB.quizEngine;
  assert.equal(QE.restoreQuestion("bio-y", "1", 5000), true);
  assert.deepEqual(plain(e.NB.store.get("q-hidden"))["bio-y#1"], { hidden: false, t: 5000 },
    "the sentinel keeps only hidden+t — restore means gone");
  assert.equal(QE.restoreQuestion("bio-y", "absent", 5001), false, "nothing stored → nothing to restore");
});

test("hideQuestion returns false when the write fails (quota)", () => {
  const e = makeEnv({ quota: 40, readyState: "loading", data: { "q-hidden": J({ "seed#1": { hidden: true, t: 1 } }) } })
    .load("store.js").load("qhidden.js").load("quiz-engine.js");
  assert.equal(e.NB.quizEngine.hideQuestion("seed", "2", "r", 5), false, "quota → no write → false");
});

// ── runner UI: the hide button + the restore panel ─────────────────────────
test("hide button: stores the hide with the stem label, confirms on the button; the panel lists the row and Restore clears it", async () => {
  const e = await bootQuiz({ location: { search: "?from=lib-x:p01" } });
  // no `prompt` in the harness → the empty-reason path (same as cancelling-free)
  last(e, "q-hide")();
  const map = plain(e.NB.store.get("q-hidden"));
  assert.equal(map["lib-x#p01"].hidden, true);
  assert.equal(map["lib-x#p01"].label, "Stem one.", "the stem (≤120) is stored as the row label");
  const btn = e.document.getElementById("q-hide");
  assert.equal(btn.textContent, "\u2713 Hidden \u2014 restore via Quiz page");
  assert.equal(btn.disabled, true);
  // the debounced store-change re-render lands ~300ms later — ≥800ms so a slow
  // CI/event-loop stall under parallel node --test files can't outrun the wait
  await tick(800);
  assert.equal(e.document.getElementById("q-hidden-summary").textContent, "Hidden questions (1)", "the summary shows the count");
  const row = e.document.getElementById("q-hidden-list").children[0];
  assert.match(row.children[0].textContent, /Stem one\./, "the stored label names the row");
  const restoreBtn = row.children.find(c => c.tagName === "BUTTON");
  assert.ok(restoreBtn, "the row offers Restore");
  restoreBtn.listeners.click[0]();
  const after = plain(e.NB.store.get("q-hidden"));
  assert.deepEqual(after["lib-x#p01"], { hidden: false, t: after["lib-x#p01"].t }, "the sentinel replaces the hide");
  assert.equal(e.document.getElementById("q-hidden-summary").textContent, "Hidden questions", "the panel re-renders to the empty state");
  assert.match(e.document.getElementById("q-hidden-list").children[0].textContent, /Nothing hidden\./);
});

test("the hidden panel boots with the empty state and ignores a corrupt q-hidden value", async () => {
  const e = await bootQuiz({ data: { "q-hidden": J("corrupted") } });
  assert.equal(e.document.getElementById("q-hidden-summary").textContent, "Hidden questions");
  assert.match(e.document.getElementById("q-hidden-list").children[0].textContent, /Nothing hidden\./, "a corrupt value reads as nothing hidden");
  assert.equal(e.document.getElementById("q-error").textContent, "", "the boot is unaffected");
});

// ── fcSaveFromQuiz gating + qkey stamp ─────────────────────────────────────
test("fcSaveFromQuiz: refused while the question is hidden (no card written); allowed saves stamp qkey", async () => {
  const e = await bootQuiz({ location: { search: "?from=lib-x:p01" } }); // a live session (fcSaveFromQuiz needs it)
  const QE = e.NB.quizEngine;
  const it = { bankId: "lib-x", id: "p01", topic: "c1-1", topicLabel: "Enzymes", stem: "Stem one.", marks: 2, markscheme: ["m1"], note: "" };
  assert.equal(QE.fcSaveFromQuiz(it), true, "not hidden → allowed");
  let cards = plain(e.NB.store.get("fc-user"));
  assert.equal(cards.length, 1);
  assert.equal(cards[0].qkey, "lib-x#p01", "new from-quiz cards carry their question key");
  assert.equal(QE.hideQuestion("lib-x", "p01", "dupe", 20), true);
  assert.equal(QE.fcSaveFromQuiz(it), false, "hidden → refused");
  assert.deepEqual(plain(e.NB.store.get("fc-user")).length, 1, "no second card was written");
});

test("the Flashcard button shows the refusal when the question was hidden mid-session", async () => {
  // the real flow: answer → Hide question… → ＋ Flashcard (the session keeps the item)
  const e = await bootQuiz({ location: { search: "?from=lib-x:p01" } });
  last(e, "q-hide")(); // hides the current question (lib-x#p01)
  last(e, "q-fc")();
  assert.equal(e.document.getElementById("q-fc").textContent, "Hidden \u2014 not saved");
  assert.deepEqual(plain(e.NB.store.get("fc-user", [])), []);
});

// ── flashcards rebuild gating ──────────────────────────────────────────────
test("flashcards rebuild: fc-user cards with a hidden qkey are skipped; qkey-less cards always pass", async () => {
  const deck = { subject: "math-aa-sl", topic: "t", topicLabel: "T", cards: [{ id: "c-seed", type: "qa", front: "f", back: "b" }] };
  const fetch = (url) => json(String(url).includes("manifest") ? [{ file: "library/flashcards/d.json", subject: "math-aa-sl", subjectLabel: "Math" }] : deck);
  const data = {
    "fc-user": J([
      { id: "u1", type: "qa", front: "f1", back: "b1", qkey: "bio-y#1" },
      { id: "u2", type: "qa", front: "f2", back: "b2", qkey: "bio-y#2" },
      { id: "u3", type: "qa", front: "f3", back: "b3" }, // pre-qkey card
    ]),
    "q-hidden": J({ "bio-y#1": { hidden: true, t: 1 } }),
  };
  const e = makeEnv({ readyState: "loading", fetch, data }).load("store.js").load("qhidden.js").load("flashcards.js");
  await e.NB.flashcards.loadDecks();
  assert.deepEqual(plain(e.NB.flashcards.cards()).map(c => c.id), ["c-seed", "u2", "u3"],
    "the hidden question's card is out; the seed deck and qkey-less cards stay");
});

// ── today.js pickQuizIds gating ────────────────────────────────────────────
test("today pickQuizIds: hidden ids never serve the pick (gated through the weak spot's bank id)", () => {
  const e = makeEnv({ readyState: "loading", data: { "q-hidden": J({ "bio-y#q2": { hidden: true, t: 1 } }) } })
    .load("store.js").load("qhidden.js").load("today.js");
  const t = e.NB.today;
  const items = [{ id: "q1", topic: "a" }, { id: "q2", topic: "a" }, { id: "q3", topic: "b" }];
  const ids = plain(t.pickQuizIds(items, { ids: ["q2", "q1"], bankId: "bio-y", topic: "a" }, 3, () => 0.5));
  assert.equal(ids.includes("q2"), false, "the hidden question is dropped from the missed list and the pool");
  assert.deepEqual(ids.slice(0, 1), ["q1"], "the remaining missed id still leads");
  assert.equal(ids.length, 2);
  // the missing id case is unchanged: hidden ≠ missing for the picker, and callers
  // without a bankId (quizlog-source weak spots) are unaffected
  const noBank = plain(t.pickQuizIds(items, { ids: ["q2"], topic: "a" }, 3, () => 0.5));
  assert.equal(noBank.includes("q2"), true, "no bankId → nothing counts as hidden");
});

// ── pickQuizIds: a topic whose every question is hidden ────────────────────
test("today pickQuizIds: a topic whose every question is hidden picks nothing; the suggestion degrades to a whole-bank link", () => {
  const e = makeEnv({ readyState: "loading", data: { "q-hidden": J({ "bio-y#q1": { hidden: true, t: 1 }, "bio-y#q2": { hidden: true, t: 2 } }) } })
    .load("store.js").load("qhidden.js").load("today.js");
  const t = e.NB.today;
  const items = [{ id: "q1", topic: "a" }, { id: "q2", topic: "a" }];
  const ids = plain(t.pickQuizIds(items, { ids: ["q1", "q2"], bankId: "bio-y", topic: "a" }, 3, () => 0.5));
  assert.deepEqual(ids, [], "nothing hidden-safe → an empty pick (no crash, no fallback to hidden ids)");
  assert.match(t.quizHref("bio-y", ids, "Today", 5), /quiz\.html\?from=bio-y&n=5/,
    "an empty pick degrades to the whole-bank link — quiz.html then starts nothing and says so (the all-hidden deep link is pinned above)");
});

// ── hide → sync → a fresh environment (the stored shape is the read shape) ─
test("hideQuestion's written map survives to a fresh environment and gates there; restore finds it", async () => {
  const a = engineEnv({});
  assert.equal(a.NB.quizEngine.hideQuestion("lib-x", "p01", "dupe", 10, "Stem one."), true);
  // the storage dump is what sync/backup would carry to another device: a fresh
  // env boots on the raw written bytes — no re-shaping, no re-keying in between
  const b = engineEnv(a.storage.dump(), { fetch: fetchLib() });
  const items = plain(await b.NB.quizEngine.bankItems({ file: "library/questions/lib-x.json", label: "Lib X" }));
  assert.deepEqual(items.map(i => i.id), ["p02"], "the fresh env never serves the hidden question");
  assert.equal(b.NB.quizEngine.restoreQuestion("lib-x", "p01", 20), true, "the restore mutator finds the carried entry");
  assert.deepEqual(plain(b.NB.store.get("q-hidden"))["lib-x#p01"], { hidden: false, t: 20 }, "and restores it with the sentinel");
});

// ── review-item hide: the errKey path agrees with the record's key ─────────
test("hiding from the runner in a review session writes the record's own key (errKey path); fcSaveFromQuiz for that review item is then refused", async () => {
  const data = { "q-errors": J([
    { key: "lib-x#p01", id: "p01", bankId: "lib-x", format: "written", stem: "Stem one.", marks: 2,
      markscheme: ["m1"], topic: "c1-1", topicLabel: "Enzymes", attempts: 1, firstMissed: "2026-11-01",
      lastMissed: "2026-11-01", resolved: false, ts: 1 },
  ]) };
  const e = await bootQuiz({ data, location: { search: "?errkeys=" + encodeURIComponent("lib-x#p01") } });
  assert.match(e.document.getElementById("q-progress").textContent, /Question 1 \/ 1/, "the mistake-log deep link started a review session");
  last(e, "q-hide")(); // the review item carries no bankId — only the errKey ("<bankId>#<id>")
  const map = plain(e.NB.store.get("q-hidden"));
  assert.equal(map["lib-x#p01"] && map["lib-x#p01"].hidden, true, "the write landed on the record's key, not a split artifact");
  const it = { id: "p01", errKey: "lib-x#p01", format: "written", stem: "Stem one.", marks: 2, markscheme: ["m1"], isReview: true };
  assert.equal(e.NB.quizEngine.fcSaveFromQuiz(it), false, "the flashcard gate derives the same key → refused");
  assert.deepEqual(plain(e.NB.store.get("fc-user", [])), []);
});

test("hiding a review item from a legacy id-null record writes the record's own key, not '<bankId>#'", async () => {
  // legacy/stem-era record: the key holds the fallback id, but `id` itself is null
  // (recordError stores `id: it.id || null`, and migrateErrorKeys renames keys
  // without back-filling id) — keyFor(bankId, null) would gate nothing.
  const data = { "q-errors": J([
    { key: "lib-x#stem-" + "a".repeat(40), id: null, bankId: "lib-x", format: "written", stem: "Old stem-era question.", marks: 2,
      markscheme: ["m1"], topic: "c1-1", topicLabel: "Enzymes", attempts: 1, firstMissed: "2026-11-01",
      lastMissed: "2026-11-01", resolved: false, ts: 1 },
  ]) };
  const e = await bootQuiz({ data, location: { search: "?errkeys=" + encodeURIComponent("lib-x#stem-" + "a".repeat(40)) } });
  assert.match(e.document.getElementById("q-progress").textContent, /Question 1 \/ 1/, "the legacy record still reviews");
  last(e, "q-hide")();
  const map = plain(e.NB.store.get("q-hidden"));
  const k = "lib-x#stem-" + "a".repeat(40);
  assert.equal(map[k] && map[k].hidden, true, "the hide landed on the record's own key");
  assert.equal(map["lib-x#"], undefined, "no dead '<bankId>#' key was written");
  assert.equal(QH().keyFor("lib-x", null), "lib-x#", "documents the trap this test pins: keyFor(null id) cannot match");
});

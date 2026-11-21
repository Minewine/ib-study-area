// Per-record merge rules as used by sync (auth.js mergeValue → NB.merge.RECORDS).
// Run: node --test tests/js/*.test.js   (no dependencies)
const assert = require("assert");
const nodeTest = require("node:test");
const { makeEnv, plain } = require("./harness");
const env = makeEnv({ fetch: () => Promise.reject(new Error("offline")) }).load("store.js").load("auth.js");
const ctx = env.ctx;
const M = ctx.window.Auth.mergeValue;
const t = (name, fn) => nodeTest(name, fn);

t("fc-state: union of cards from both devices", () => {
  const a = { c1: { box: 2, due: "2026-11-20", seen: 2, t: 100 } };
  const b = { c2: { box: 1, due: "2026-11-19", seen: 1, t: 50 } };
  assert.strictEqual(JSON.stringify(Object.keys(M("fc-state", a, b)).sort()), JSON.stringify(["c1", "c2"]));
});
t("fc-state: newest timestamp wins per card", () => {
  const local = { c1: { box: 3, due: "2026-11-25", seen: 3, t: 200 }, c2: { box: 1, due: "x", seen: 1, t: 10 } };
  const server = { c1: { box: 2, due: "2026-11-21", seen: 2, t: 100 }, c2: { box: 4, due: "y", seen: 4, t: 300 } };
  const m = M("fc-state", local, server);
  assert.strictEqual(m.c1.box, 3); assert.strictEqual(m.c2.box, 4);
});
t("fc-state: legacy entries (no t) ranked by seen, never dropped", () => {
  const local = { c1: { box: 1, due: "2026-11-19", seen: 5 } };
  const server = { c1: { box: 3, due: "2026-11-30", seen: 2 }, c9: { box: 1, due: "a", seen: 1 } };
  const m = M("fc-state", local, server);
  assert.strictEqual(m.c1.seen, 5); assert.ok(m.c9);
});
t("fc-state: timestamped review beats legacy entry", () => {
  const m = M("fc-state", { c1: { box: 1, due: "d", seen: 1, t: 5 } }, { c1: { box: 5, due: "e", seen: 9 } });
  assert.strictEqual(m.c1.t, 5);
});
t("fc-state: tie keeps server value (old behaviour)", () => {
  const m = M("fc-state", { c1: { box: 1, due: "d", seen: 1 } }, { c1: { box: 2, due: "d", seen: 1 } });
  assert.strictEqual(m.c1.box, 2);
});
t("q-errors: union by key, newest ts wins", () => {
  const local = [{ key: "bank-a#b01", attempts: 3, ts: 300, resolved: true }, { key: "bank-a#b02", attempts: 1, ts: 1 }];
  const server = [{ key: "bank-a#b01", attempts: 2, ts: 200, resolved: false }, { key: "bank-b#b01", attempts: 1, ts: 5 }];
  const m = M("q-errors", local, server);
  assert.strictEqual(m.length, 3);
  assert.strictEqual(m.find(e => e.key === "bank-a#b01").resolved, true);
});
t("q-errors: same key merges field-aware — retries unioned, deduped by ts+correct, ascending", () => {
  const local = [{ key: "k1", ts: 300, retries: [{ ts: 1, correct: false }, { ts: 9, correct: false }] }];
  const server = [{ key: "k1", ts: 200, retries: [{ ts: 1, correct: false }, { ts: 2, correct: true }] }];
  const e = M("q-errors", local, server).find(x => x.key === "k1");
  assert.deepStrictEqual(plain(e.retries), [{ ts: 1, correct: false }, { ts: 2, correct: true }, { ts: 9, correct: false }]);
});
t("q-errors: winner's reflection/errorType win; missing ones fill from the loser", () => {
  const local = [{ key: "k1", ts: 300, errorType: "careless" }];
  const server = [{ key: "k1", ts: 200, errorType: "misread", reflection: "re-read the stem" }];
  const e = M("q-errors", local, server).find(x => x.key === "k1");
  assert.strictEqual(e.errorType, "careless", "winner's value wins");
  assert.strictEqual(e.reflection, "re-read the stem", "loser fills the winner's gap");
});
t("q-errors: retries only on the loser are kept; a retirement-unaware winner can't erase \"not relevant\"", () => {
  const local = [{ key: "k1", ts: 300 }]; // no retired field — e.g. a stale cached page predating the feature
  const server = [{ key: "k1", ts: 200, retries: [{ ts: 4, correct: true, conf: "sure" }], retired: true, retiredReason: "off-syllabus", retiredAt: 9 }];
  const e = M("q-errors", local, server).find(x => x.key === "k1");
  assert.deepStrictEqual(plain(e.retries), [{ ts: 4, correct: true, conf: "sure" }]);
  assert.strictEqual(e.retired, true, "retirement survives the older-but-newer-ts write");
  assert.strictEqual(e.retiredReason, "off-syllabus");
  assert.strictEqual(e.retiredAt, 9);
});
t("q-errors: an explicit retired:false (restore) beats a retired loser", () => {
  const local = [{ key: "k1", ts: 300, retired: false }];
  const server = [{ key: "k1", ts: 200, retired: true, retiredReason: "off-syllabus", retiredAt: 9 }];
  const e = M("q-errors", local, server).find(x => x.key === "k1");
  assert.strictEqual(e.retired, false, "restore is a real answer, not a missing field");
  assert.strictEqual(e.retiredReason, undefined);
});
t("q-errors: records without the new fields merge exactly as before", () => {
  const local = [{ key: "k1", attempts: 3, ts: 300, resolved: true }];
  const server = [{ key: "k1", attempts: 2, ts: 200, resolved: false }];
  const e = M("q-errors", local, server).find(x => x.key === "k1");
  assert.deepStrictEqual(Object.keys(e).sort(), ["attempts", "key", "resolved", "ts"], "no retries/reflection/errorType keys invented");
});
t("q-errors: legacy records ranked by dates/attempts", () => {
  const m = M("q-errors", [{ key: "b01", lastMissed: "2026-11-10", attempts: 1 }], [{ key: "b01", lastMissed: "2026-11-15", attempts: 2 }]);
  assert.strictEqual(m[0].lastMissed, "2026-11-15");
});
t("q-errors: renamed record doesn't come back under its legacy key", () => {
  const local = [{ key: "bio-unity-diversity-cells#b01", legacyKey: "b01", ts: 9 }];
  const server = [{ key: "b01", attempts: 1 }];
  const m = M("q-errors", local, server);
  assert.strictEqual(JSON.stringify(m.map(e => e.key)), JSON.stringify(["bio-unity-diversity-cells#b01"]));
});
t("missing local/server values fall back safely", () => {
  assert.strictEqual(JSON.stringify(M("q-errors", null, [{ key: "x" }])), JSON.stringify([{ key: "x" }]));
  assert.strictEqual(JSON.stringify(M("q-errors", [{ key: "x" }], undefined)), JSON.stringify([{ key: "x" }]));
  assert.strictEqual(JSON.stringify(M("fc-state", { a: { seen: 1 } }, null)), JSON.stringify({ a: { seen: 1 } }));
});
t("non-merge keys keep server-wins behaviour", () => {
  assert.strictEqual(JSON.stringify(M("tok-objects", { items: [1] }, { items: [2] })), JSON.stringify({ items: [2] }));
  assert.strictEqual(JSON.stringify(M("quizlog", [{ date: "b" }], [{ date: "a" }])), JSON.stringify([{ date: "b" }, { date: "a" }]), "quizlog is now a union");
});

t("q-errors: a legacy-key copy folds into the renamed record (attempts take the max) and is still dropped", () => {
  const local = [{ key: "ai-photosynthesis#p01", legacyKey: "user:photosynthesis#p01", attempts: 1, ts: 9 }];
  const server = [{ key: "user:photosynthesis#p01", attempts: 3, ts: 5, firstMissed: "2026-11-01", retries: [{ ts: 2, correct: false }] }];
  const m = M("q-errors", local, server);
  assert.strictEqual(JSON.stringify(m.map(e => e.key)), JSON.stringify(["ai-photosynthesis#p01"]),
    "the pre-migration copy must not survive the merge, or it resurrects every load");
  const folded = m[0];
  assert.strictEqual(folded.attempts, 3, "the stale copy's higher attempts are folded in, not lost by the drop");
  assert.deepStrictEqual(plain(folded.retries), [{ ts: 2, correct: false }], "errMerge semantics: the doomed copy's retries ride along");
});
t("q-errors: folding is idempotent — re-merging the same stale copy never re-inflates attempts", () => {
  const local = [{ key: "ai-photosynthesis#p01", legacyKey: "user:photosynthesis#p01", attempts: 1, ts: 9 }];
  const server = [{ key: "user:photosynthesis#p01", attempts: 3, ts: 5 }];
  const again = M("q-errors", plain(M("q-errors", local, server)), server);
  assert.strictEqual(again[0].attempts, 3, "max, not a sum — the ping-pong stays flat across repeated merges");
});
t("q-errors: a legacy-key copy's retirement folds into a new-key record missing the field; an explicit retired:false survivor keeps false", () => {
  const m = M("q-errors",
    [{ key: "ai-photosynthesis#p01", legacyKey: "user:photosynthesis#p01", attempts: 1, ts: 9 }],
    [{ key: "user:photosynthesis#p01", attempts: 1, retired: true, retiredReason: "off-syllabus", retiredAt: 9 }]);
  assert.strictEqual(m[0].retired, true, "the doomed copy's \"not relevant\" isn't lost by the fold");
  assert.strictEqual(m[0].retiredReason, "off-syllabus");
  assert.strictEqual(m[0].retiredAt, 9);
  const restored = M("q-errors",
    [{ key: "ai-photosynthesis#p01", legacyKey: "user:photosynthesis#p01", attempts: 1, ts: 9, retired: false }],
    [{ key: "user:photosynthesis#p01", attempts: 1, retired: true, retiredReason: "off-syllabus" }])[0];
  assert.strictEqual(restored.retired, false, "an explicit answer on the survivor outranks the inherited one");
  assert.strictEqual(restored.retiredReason, undefined);
});

// ── explicit-vs-explicit retirement: inheritance is only for records MISSING the field ──

t("q-errors: explicit retired:true beats an explicit retired:false loser — two explicit answers are ranked, not inherited", () => {
  const e = M("q-errors",
    [{ key: "k1", ts: 300, retired: true, retiredReason: "off-syllabus", retiredAt: 9 }],
    [{ key: "k1", ts: 200, retired: false }])[0];
  assert.strictEqual(e.retired, true, "the ranked winner's explicit answer stands");
  assert.strictEqual(e.retiredReason, "off-syllabus");
});
t("q-errors: explicit retired:false beats an explicit retired:true loser (the restore outranks by ts)", () => {
  const e = M("q-errors",
    [{ key: "k1", ts: 100, retired: true, retiredReason: "off-syllabus", retiredAt: 9 }],
    [{ key: "k1", ts: 300, retired: false }])[0];
  assert.strictEqual(e.retired, false, "the ranked winner's explicit answer stands");
  assert.strictEqual(e.retiredReason, undefined, "a restored record carries no reason again");
});
t("q-errors: a restore survives an old-tab write-back — a retirement-unaware winner inherits the loser's retired:false", () => {
  const e = M("q-errors",
    [{ key: "k1", ts: 300, attempts: 1 }], // stale cached page predating the feature — no retired field at all
    [{ key: "k1", ts: 200, retired: false }])[0];
  assert.strictEqual(e.retired, false, "inherited from the restored loser — a missing field is no opinion, but false IS one");
});

// ── bank identity in the q-userbanks union (store.js bankId): uploads carry a stable
// "ub-…" id so same-topic sets from two devices never collapse; pre-id copies keep
// converging on the subject::name composite as before. Used for q-userbanks AND
// fc-userdecks; the copy passed first (the dirty side, per auth.js union(k, l, r)) wins. ──
const U = (k, a, b) => env.NB.merge.union(k, a, b);

t("q-userbanks: two same-topic uploads with distinct ids both survive the union even with the same stored name", () => {
  const a = [{ id: "ub-aa1", name: "ai-photosynthesis.json", subject: "biology-hl", label: "Photosynthesis" }];
  const b = [{ id: "ub-bb2", name: "ai-photosynthesis.json", subject: "biology-hl", label: "Photosynthesis" }];
  const m = U("q-userbanks", a, b);
  assert.strictEqual(m.length, 2, "distinct ids → two banks; no attempt-history pooling between them");
  assert.strictEqual(JSON.stringify(m.map(x => x.id).sort()), JSON.stringify(["ub-aa1", "ub-bb2"]));
});
t("q-userbanks: the same id on both devices converges to one record — the copy passed first (the dirty side) wins", () => {
  const a = [{ id: "ub-aa1", name: "ai-photosynthesis.json", uploaded: "2026-11-20", label: "Dirty copy" }];
  const b = [{ id: "ub-aa1", name: "ai-photosynthesis.json", uploaded: "2026-11-19", label: "Server copy" }];
  const m = U("q-userbanks", a, b);
  assert.strictEqual(m.length, 1, "one id is one bank — the union converges");
  assert.strictEqual(m[0].label, "Dirty copy");
});
t("q-userbanks: pre-id banks keep the composite identity — same subject::name dedupes, a different name stays", () => {
  const a = [{ subject: "biology-hl", name: "ai-x.json", label: "X" }];
  const b = [{ subject: "biology-hl", name: "ai-x.json", label: "Older copy" }, { subject: "biology-hl", name: "ai-y.json" }];
  const m = U("q-userbanks", a, b);
  assert.strictEqual(m.length, 2, "the composite collision collapses to a's copy; the differently-named bank survives");
});
t("q-userbanks: an id-bearing upload and an id-less old copy of the same bank do not collapse (ids are never back-stamped)", () => {
  const a = [{ id: "ub-aa1", subject: "biology-hl", name: "ai-x.json" }];
  const b = [{ subject: "biology-hl", name: "ai-x.json" }];
  assert.strictEqual(U("q-userbanks", a, b).length, 2, "'i:ub-aa1' and 'biology-hl::ai-x.json' are different identities");
});

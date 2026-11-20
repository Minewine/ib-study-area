// node --test tests/js — "My resources" links on topic notes ("my-res"): sync registration,
// per-item merge with deletions (store.js) and backup export / restore validation (backup.js).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeEnv, FakeStorage, plain } = require("./harness");

const J = JSON.stringify;
const mk = (data) => makeEnv({ storage: new FakeStorage(data) }).load("store.js").load("backup.js");
const L = (note, label, url, t) => ({ note, label, url, t });

test("my-res is a synced key with a record merger", () => {
  const e = mk();
  assert.ok(e.NB.store.SYNCED_KEYS.includes("my-res"));
  assert.ok(e.NB.store.isSynced("my-res") && !e.NB.store.isLocalOnly("my-res"));
  e.NB.store.set("my-res", { r1: L("chem-s1-3", "Class notes", "https://example.org/a", 1) });
  assert.ok(plain(e.NB.store.dirty())["my-res"], "marked dirty for the next sync");
});

test("merge: newest edit per item wins, deletions survive an older copy, nothing dropped", () => {
  const M = mk().NB.merge;
  const local = { a: { note: "n1", deleted: true, t: 20 }, b: L("n1", "B new", "https://x/b2", 30), c: L("n2", "C", "file:///home/c.pdf", 5) };
  const server = { a: L("n1", "A", "https://x/a", 10), b: L("n1", "B old", "https://x/b", 25), d: L("n1", "D", "https://x/d", 7) };
  const m = plain(M.RECORDS["my-res"](local, server));
  assert.equal(m.a.deleted, true, "deletion not undone by the older server copy");
  assert.equal(m.b.label, "B new");
  assert.ok(m.c && m.d, "items from both sides kept");
  assert.deepEqual(plain(M.union("my-res", server, local)), m, "first-login union uses the same rules");
  assert.deepEqual(plain(M.RECORDS["my-res"](null, server)), server);
});

test("backup: my-res is exported, unsafe or malformed links are dropped on restore, local newer edits kept", () => {
  const a = mk({ "my-res": J({ r1: L("bio-a1-1", "Video", "https://example.org/v", 10), r2: L("bio-a1-1", "Old", "https://example.org/o", 10) }) });
  const file = plain(a.NB.backup.collect());
  assert.ok(file.keys["my-res"] && file.keys["my-res"].r1);
  file.keys["my-res"].bad1 = L("bio-a1-1", "XSS", "javascript:alert(1)", 11);
  file.keys["my-res"].bad2 = { note: "bio-a1-1", label: "", url: "https://x", t: 11 };
  file.keys["my-res"].bad3 = "nope";
  const b = mk({ "my-res": J({ r2: { note: "bio-a1-1", deleted: true, t: 50 } }) });
  const p = b.NB.backup.parse(J(file));
  assert.equal(p.ok, true, p.errors.join("; "));
  assert.ok(plain(p.warnings).some(w => /3 unreadable record.*my-res/.test(w)), "malformed records reported");
  assert.equal(b.NB.backup.restore(p, "merge").ok, true);
  const got = plain(b.NB.store.get("my-res"));
  assert.deepEqual(Object.keys(got).sort(), ["r1", "r2"]);
  assert.equal(got.r2.deleted, true, "newer local deletion kept");
  const bad = b.NB.backup.parse(J({ format: "nevaib-backup", version: 3, keys: { "my-res": [] } }));
  assert.ok(!bad.keys || !bad.keys["my-res"], "wrong shape rejected");
});

// Page-level resources (no note; subject/topic/type/comment tags) share the key:
// accepted on restore, tombstones need neither url nor label, junk still dropped.
test("backup: tagged page-level resources restore; tombstone without url survives; tagged junk dropped", () => {
  const mk2 = (data) => makeEnv({ storage: new FakeStorage(data) }).load("store.js").load("backup.js");
  const good = {
    subject: "biology-hl", topic: "a1-1", type: "video",
    label: "Khan academy water", url: "https://example.org/water", comment: "good osmosis bit", t: 10,
  };
  const a = mk2({ "my-res": J({ p1: good }) });
  const file = plain(a.NB.backup.collect());
  assert.ok(file.keys["my-res"].p1, "tagged record exported");
  file.keys["my-res"].badT1 = { subject: "chemistry-hl", label: "", url: "", deleted: true, t: 20 }; // tombstone: no url/label needed
  file.keys["my-res"].badJ1 = { subject: "chemistry-hl", label: "no url", t: 21 };
  file.keys["my-res"].badJ2 = { subject: "chemistry-hl", label: "js", url: "javascript:alert(1)", t: 22 };
  file.keys["my-res"].badJ3 = { subject: "", label: "empty subject", url: "https://x", t: 23 };
  file.keys["my-res"].badJ4 = { note: "bio-a1-1", comment: "x".repeat(501), label: "long comment", url: "https://x", t: 24 };
  const b = mk2({});
  const p = b.NB.backup.parse(J(file));
  assert.equal(p.ok, true, p.errors.join("; "));
  assert.ok(plain(p.warnings).some(w => /4 unreadable record.*my-res/.test(w)), "junk tagged records reported");
  assert.equal(b.NB.backup.restore(p, "merge").ok, true);
  const got = plain(b.NB.store.get("my-res"));
  assert.deepEqual(Object.keys(got).sort(), ["badT1", "p1"], "tagged record + bare tombstone kept, junk dropped");
  assert.equal(got.p1.comment, "good osmosis bit");
});

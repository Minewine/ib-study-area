// node --test tests/js — NB.backup (assets/backup.js): full backup, reading old and
// new export formats, validation of malformed input, merge-by-default restore,
// explicit replace, safety snapshot + undo.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { makeEnv, FakeStorage, plain } = require("./harness");

const fx = (f) => fs.readFileSync(path.join(__dirname, "fixtures", f), "utf8");
const J = JSON.stringify;
function env(data, quota) { return makeEnv({ storage: new FakeStorage(data, quota) }).load("store.js").load("backup.js"); }
const get = (e, k) => plain(e.NB.store.get(k, null));

const SAMPLE = {
  "fc-state": J({ "fc-bio-1": { box: 2, due: "2026-11-20", seen: 3, t: 1763400000000 } }),
  "q-errors": J([{ key: "bank#q1", stem: "S", attempts: 1, ts: 5 }]),
  "quizlog": J([{ date: "2026-11-17", label: "Chem", got: 5, max: 10, pct: 50, ts: 9 }]),
  "chk:biology-hl::library/notes/a.pdf": J({ c: true, r: "a" }),
  "week:1": J("Past paper"),
  "ia-debriefs": J({ nov: { rd: "notes" } }),
  "res-bookmarks": J(["biology-hl::x.pdf"]),
  "fc-theme": J("dark"),
  "nb-token": "secret-token",
  "nb-dirty": J({ "fc-state": 1 }),
  "nb-sync": J({ user: "tester", rev: 3 })
};

test("collect: every progress key, schema + timestamp; never the token or sync bookkeeping", () => {
  const e = env(SAMPLE);
  const b = plain(e.NB.backup.collect());
  assert.equal(b.format, "nevaib-backup");
  assert.equal(b.version, 3);
  assert.equal(b.schema, 1);
  assert.ok(Date.parse(b.created));
  assert.deepEqual(Object.keys(b.keys).sort(), ["chk:biology-hl::library/notes/a.pdf", "fc-state", "fc-theme", "ia-debriefs", "q-errors", "quizlog", "res-bookmarks", "week:1"]);
  assert.ok(!J(b).includes("secret-token"));
});

test("collect includes quarantined unreadable values", () => {
  const e = env({ "fc-user": "{oops" });
  e.NB.store.get("fc-user", []);
  const b = plain(e.NB.backup.collect());
  assert.equal(JSON.parse(b.quarantine["nb-corrupt:fc-user"])[0].raw, "{oops");
});

test("round trip: backup from one browser restores into an empty one exactly", () => {
  const a = env(SAMPLE);
  const file = J(a.NB.backup.collect());
  const b = env({});
  const p = b.NB.backup.parse(file);
  assert.equal(p.ok, true, p.errors.join("; "));
  const r = b.NB.backup.restore(p, "merge");
  assert.equal(r.ok, true);
  for (const k of Object.keys(plain(a.NB.backup.collect()).keys)) assert.deepEqual(get(b, k), get(a, k), k);
  assert.ok(plain(b.NB.store.dirty())["fc-state"], "restored keys are marked for sync");
});

test("old Cards export (v1) is read and merged; newer local progress kept", () => {
  const e = env({ "fc-state": J({ "fc-bio-1": { box: 5, due: "2026-12-01", seen: 9, t: 1763400000000 } }), "fc-user": J([{ id: "u-local", front: "f", back: "b" }]) });
  const p = e.NB.backup.parse(fx("export-v1-cards.json"));
  assert.equal(p.ok, true);
  assert.match(p.format, /v1/);
  e.NB.backup.restore(p, "merge");
  const st = get(e, "fc-state");
  assert.equal(st["fc-bio-1"].box, 5, "newer local review wins");
  assert.equal(st["fc-bio-2"].box, 1, "card only in the file is added");
  assert.deepEqual(get(e, "fc-user").map(c => c.id).sort(), ["u-1696000000000", "u-local"]);
  assert.deepEqual(get(e, "fc-deleted"), ["fc-chem-9"]);
  assert.equal(get(e, "fc-edits")["fc-bio-3"].front, "Edited front");
});

test("old author export (v2) is read: banks, progress and quiz log", () => {
  const e = env({ quizlog: J([{ date: "2026-11-01", label: "Mine", got: 1, max: 1, pct: 100 }]) });
  const p = e.NB.backup.parse(fx("export-v2-author.json"));
  assert.equal(p.ok, true);
  e.NB.backup.restore(p, "merge");
  assert.equal(get(e, "q-userbanks")[0].name, "my-bank.json");
  assert.deepEqual(get(e, "quizlog").map(x => x.label), ["Mine", "Biology HL"]);
});

test("server export (action=export) is read, site-state expanded into rows", () => {
  const e = env({});
  const p = e.NB.backup.parse(fx("server-export.json"));
  assert.equal(p.ok, true);
  e.NB.backup.restore(p, "merge");
  assert.deepEqual(get(e, "chk:biology-hl::library/notes/a.pdf"), { c: true, r: "g" });
  assert.equal(get(e, "week:0"), "Enzymes");
  assert.equal(get(e, "q-errors")[0].attempts, 2);
});

test("merge never loses local data; conflicts keep the current value", () => {
  const e = env(SAMPLE);
  const file = { format: "nevaib-backup", version: 3, schema: 1, keys: {
    "chk:biology-hl::library/notes/a.pdf": { c: false, r: "r" },
    "ia-debriefs": { nov: { rd: "other", da: "added" } },
    "res-bookmarks": ["other.pdf"],
    "q-errors": [{ key: "bank#q2", stem: "T", ts: 1 }]
  } };
  e.NB.backup.restore(e.NB.backup.parse(J(file)), "merge");
  assert.deepEqual(get(e, "chk:biology-hl::library/notes/a.pdf"), { c: true, r: "a" });
  assert.deepEqual(get(e, "ia-debriefs"), { nov: { rd: "notes", da: "added" } });
  assert.deepEqual(get(e, "res-bookmarks"), ["biology-hl::x.pdf", "other.pdf"]);
  assert.deepEqual(get(e, "q-errors").map(x => x.key).sort(), ["bank#q1", "bank#q2"]);
});

test("replace is explicit and only touches keys in the file; undo brings the old data back", () => {
  const e = env(SAMPLE);
  const p = e.NB.backup.parse(J({ format: "nevaib-backup", version: 3, schema: 1, keys: { "fc-state": { x: { box: 1, due: "d", seen: 1 } } } }));
  const r = e.NB.backup.restore(p, "replace");
  assert.equal(r.ok, true);
  assert.deepEqual(get(e, "fc-state"), { x: { box: 1, due: "d", seen: 1 } });
  assert.equal(get(e, "quizlog").length, 1, "keys not in the file untouched");
  assert.ok(r.snapshot, "safety snapshot taken first");
  const u = e.NB.backup.undoLast();
  assert.equal(u.ok, true);
  assert.deepEqual(get(e, "fc-state"), JSON.parse(SAMPLE["fc-state"]));
});

test("restore refuses to run without a safety copy when storage is full (unless told to)", () => {
  const used = Object.entries(SAMPLE).reduce((n, [k, v]) => n + k.length + v.length, 0);
  const e = env(SAMPLE, used + 400);
  const p = e.NB.backup.parse(J({ format: "nevaib-backup", version: 3, keys: { "fc-theme": "light" } }));
  const r = e.NB.backup.restore(p, "merge");
  assert.equal(r.ok, false);
  assert.equal(r.needBackup, true);
  assert.equal(get(e, "fc-theme"), "dark", "nothing changed");
});

test("summary counts what's in the file, in the browser, and what a merge changes", () => {
  const e = env(SAMPLE);
  const p = e.NB.backup.parse(fx("export-v1-cards.json"));
  const rows = plain(e.NB.backup.summarize(p));
  const fc = rows.find(r => r.key === "fc-state");
  assert.equal(fc.incoming, 2); assert.equal(fc.current, 1); assert.ok(fc.changes >= 1);
});

test("malformed input is rejected with clear errors and changes nothing", () => {
  const e = env(SAMPLE);
  const before = J(e.storage.dump());
  const cases = [
    ["{not json", /Not valid JSON/],
    ["[1,2]", /expected a JSON object/],
    [J({ hello: "world" }), /no recognised format/],
    [J({ format: "nevaib-backup", version: 3, keys: { "fc-state": [1, 2] } }), /wrong shape/],
    [J({ format: "nevaib-backup", version: 3, keys: { "q-errors": "nope" } }), /wrong shape/],
    [J({ format: "nevaib-backup", version: 3, keys: { "chk:x": { c: "yes" } } }), /wrong shape/],
    [J({ format: "nevaib-backup", version: 3, schema: 99, keys: { "fc-theme": "dark" } }), /newer app version/],
    [J({ format: "nevaib-backup", version: 3, keys: {} }), /no progress/]
  ];
  for (const [text, re] of cases) {
    const p = e.NB.backup.parse(text);
    assert.equal(p.ok, false, text);
    assert.match(p.errors.join(" "), re, text);
    assert.equal(e.NB.backup.restore(p, "merge").ok, false);
  }
  assert.equal(J(e.storage.dump()), before);
});

test("credentials and unknown keys in a file are ignored; bad records dropped with a warning", () => {
  const e = env({});
  const p = e.NB.backup.parse(J({ format: "nevaib-backup", version: 3, keys: {
    "nb-token": "evil", "nb-api": "https://evil.example/api", "nb-dirty": {}, "random-key": 1,
    "q-errors": [{ key: "ok#1" }, { nokey: true }, null]
  } }));
  assert.equal(p.ok, true);
  assert.equal(p.warnings.length, 5);
  e.NB.backup.restore(p, "merge");
  assert.equal(e.storage.getItem("nb-token"), null);
  assert.equal(e.storage.getItem("nb-api"), null);
  assert.deepEqual(get(e, "q-errors"), [{ key: "ok#1" }]);
});

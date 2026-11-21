// node --test tests/js — page-level "My resources" (assets/resources.js over the
// shared synced "my-res" key): validation, tombstone deletes, filters, deep links.
// The key's sync/merge/backup rules are covered in myres.test.js; this file pins
// the engine contract and that resources never touch quiz/card storage.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeEnv, FakeStorage, plain } = require("./harness");

const J = JSON.stringify;
const mk = (data) => makeEnv({ storage: new FakeStorage(data) }).load("store.js").load("profile.js").load("resources.js");
const R = (e) => e.NB.resources;

test("add: validates, tags and stores into my-res; quiz/card storage untouched", () => {
  const e = mk();
  const res = R(e).add({ label: "Khan academy water", url: "https://example.org/water", subject: "biology-hl", topic: "a1-1", type: "video", comment: "osmosis at 4:30" });
  assert.ok(res.ok, res.error);
  const map = plain(e.NB.store.get("my-res"));
  const rec = map[res.id];
  assert.equal(rec.label, "Khan academy water");
  assert.equal(rec.subject, "biology-hl");
  assert.equal(rec.topic, "a1-1");
  assert.equal(rec.type, "video");
  assert.equal(rec.comment, "osmosis at 4:30");
  assert.equal(typeof rec.t, "number");
  assert.equal(rec.note, undefined, "no note link unless asked for");
  assert.ok(e.NB.store.isSynced("my-res"));
  assert.equal(e.NB.store.get("q-userbanks", null), null, "resources never become quiz banks");
  assert.equal(e.NB.store.get("fc-userdecks", null), null, "resources never become card decks");
});

test("add/update validation: urls scheme-locked, subject required, legacy ids canonical, lengths capped", () => {
  const e = mk();
  const r = R(e);
  assert.ok(r.add({ label: "x", url: "javascript:alert(1)", subject: "biology-hl" }).error, "javascript: refused");
  assert.ok(r.add({ label: "x", url: "data:text/html;base64,AAAA", subject: "biology-hl" }).error, "data: refused");
  assert.ok(r.add({ label: "x", url: "library/notes/a.pdf", subject: "biology-hl" }).error, "relative paths refused");
  assert.ok(r.add({ label: "x", url: "https://a.b/c" }).error, "subject required");
  assert.ok(r.add({ label: "", url: "https://a.b/c", subject: "biology-hl" }).error, "title required");
  const long = "y".repeat(250);
  const ok = r.add({ label: long, url: "https://a.b/" + "z".repeat(1980), subject: "maths-aa-sl", comment: long, topic: "t".repeat(130) });
  assert.ok(ok.ok, ok.error);
  const rec = plain(e.NB.store.get("my-res"))[ok.id];
  assert.equal(rec.label.length, 200, "title capped");
  assert.equal(rec.subject, "math-aa-sl", "legacy subject id canonicalised");
  assert.equal(rec.comment.length, 250, "note kept (under the 500 cap)");
  assert.equal(rec.topic.length, 120, "topic capped");
  assert.equal(rec.url.length, "https://a.b/".length + 1980, "url kept verbatim when within limits");
  const tooLongUrl = r.add({ label: "too long", url: "https://a.b/" + "z".repeat(2100), subject: "math-aa-sl" });
  assert.ok(tooLongUrl.error, "url > 2000 refused");
});

test("update: bumps t past the old record, keeps the note link, refuses missing ids and bad input", () => {
  const e = mk();
  const r = R(e);
  const a = r.add({ label: "A", url: "https://x/a", subject: "biology-hl", topic: "a1-1", note: "bio-a1-1" });
  const before = plain(e.NB.store.get("my-res"))[a.id].t;
  const u1 = r.update(a.id, { label: "A2", url: "https://x/a2", subject: "biology-hl", topic: "a1-1" });
  assert.ok(u1.ok, u1.error);
  const rec = plain(e.NB.store.get("my-res"))[a.id];
  assert.equal(rec.label, "A2");
  assert.ok(rec.t > before, "edit must win the newest-t merge");
  assert.equal(rec.note, "bio-a1-1", "edits keep the note link");
  assert.ok(r.update("nope", { label: "B", url: "https://x/b", subject: "biology-hl" }).error, "unknown id refused");
  assert.ok(r.update(a.id, { label: "C", url: "ftp://x/c", subject: "biology-hl" }).error, "bad url refused");
});

test("update: the page's row editor sends no subject — it keeps the record's own; note-scoped records stay note-scoped", () => {
  const e = mk();
  const r = R(e);
  // exactly the payload resources.js wireRow sends (no subject field)
  const a = r.add({ label: "A", url: "https://x/a", subject: "chemistry-hl", topic: "s1-1" });
  const u = r.update(a.id, { label: "A2", url: "https://x/a2", type: "video", topic: "s1-2", comment: "", note: undefined });
  assert.ok(u.ok, "row-editor edit without a subject must succeed: " + u.error);
  const rec = plain(e.NB.store.get("my-res"))[a.id];
  assert.equal(rec.subject, "chemistry-hl", "subject preserved from the record");
  assert.equal(rec.type, "video");
  assert.equal(rec.note, undefined, "undefined note on a record without one stays absent");
  // a note-scoped record (no subject, as written by the notes page) must stay editable
  const e2 = mk({ "my-res": J({ n1: { note: "bio-a1-1", label: "Class notes", url: "https://x/n", t: 10 } }) });
  const u2 = R(e2).update("n1", { label: "Class notes 2", url: "https://x/n2", type: "doc", topic: "", comment: "", note: undefined });
  assert.ok(u2.ok, "note-scoped record edit must succeed: " + u2.error);
  const rec2 = plain(e2.NB.store.get("my-res")).n1;
  assert.equal(rec2.note, "bio-a1-1", "note link kept");
  assert.equal(rec2.subject, undefined, "no subject invented");
  // an explicit empty subject on a tagged record is still a user error
  const e3 = mk();
  const b = R(e3).add({ label: "B", url: "https://x/b", subject: "biology-hl" });
  assert.ok(R(e3).update(b.id, { label: "B2", url: "https://x/b2", subject: "" }).error, "explicit empty subject refused");
});

test("remove: tombstone wins the sync merge and keeps context; resource list excludes it", () => {
  const e = mk();
  const r = R(e);
  const a = r.add({ label: "A", url: "https://x/a", subject: "chemistry-hl", topic: "s1-1", note: "chem-s1-1" });
  const t0 = plain(e.NB.store.get("my-res"))[a.id].t;
  assert.equal(r.remove(a.id), true);
  const tomb = plain(e.NB.store.get("my-res"))[a.id];
  assert.equal(tomb.deleted, true);
  assert.ok(tomb.t > t0, "tombstone must be newer than the record it kills");
  assert.equal(tomb.subject, "chemistry-hl", "context kept for the tombstone");
  assert.equal(tomb.note, "chem-s1-1");
  assert.equal(tomb.label, undefined, "no payload left in a tombstone");
  // per-item merge (store.js): an older server copy without the delete must not resurrect it
  const server = { [a.id]: { label: "A", url: "https://x/a", subject: "chemistry-hl", topic: "s1-1", t: t0 } };
  const merged = plain(e.NB.merge.RECORDS["my-res"](plain(e.NB.store.get("my-res")), server));
  assert.equal(merged[a.id].deleted, true, "older server copy cannot resurrect a deleted resource");
  const f = r.filterRecords(merged, {});
  assert.equal(f.length, 0, "deleted records are not listed");
  assert.equal(r.remove("nope"), false);
});

test("filterRecords: subject/type/search filters, profile hiding, newest first", () => {
  const e = mk({
    "profile": J({ subjects: ["biology-hl"] }), // account profiled to Biology only
    "my-res": J({
      b2: { label: "Bio video", url: "https://x/b", subject: "biology-hl", type: "video", t: 10 },
      b1: { label: "Bio notes", url: "https://x/n", subject: "biology-hl", type: "doc", comment: "class scan", t: 20 },
      c1: { label: "Chem site", url: "https://x/c", subject: "chemistry-hl", t: 30 },
      gone: { deleted: true, subject: "biology-hl", t: 40 },
      broken: { label: "No url", url: "javascript:x", subject: "biology-hl", t: 50 },
    }),
  });
  const r = R(e);
  const map = plain(e.NB.store.get("my-res"));
  // the page renders sortRecords(filterRecords(...)) — unfiltered order is insertion order
  const all = r.sortRecords(r.filterRecords(map, {}));
  assert.deepEqual(plain(all.map(([id]) => id)), ["b1", "b2"], "profile hides chemistry; tombstones/invalid excluded; newest first");
  assert.deepEqual(plain(r.filterRecords(map, { subject: "chemistry-hl" }).map(([id]) => id)), [], "explicit subject filter still respects the profile");
  assert.deepEqual(plain(r.filterRecords(map, { type: "doc" }).map(([id]) => id)), ["b1"]);
  assert.deepEqual(plain(r.filterRecords(map, { q: "class scan" }).map(([id]) => id)), ["b1"], "search covers the note text");
});

test("topic index and deep links: manifest drives the datalist, note link and the AI picker", () => {
  const e = mk();
  const r = R(e);
  r.setTopicIndex({ notes: [
    { file: "library/topic-notes/biology-hl/a1-2.json", id: "bio-a1-2", subject: "biology-hl", code: "A1.2", title: "Nucleic acids" },
    { file: "library/topic-notes/biology-hl/a1-1.json", id: "bio-a1-1", subject: "biology-hl", code: "A1.1", title: "Water" },
  ] });
  assert.deepEqual(plain(r.topicsFor("biology-hl").map((t) => t.key)), ["a1-1", "a1-2"], "sorted by code");
  assert.equal(r.noteIdFor("biology-hl", "a1-1"), "bio-a1-1");
  assert.equal(r.noteIdFor("biology-hl", "zz"), "");
  const rec = { subject: "biology-hl", topic: "a1-1" };
  assert.equal(r.notesUrl(rec), "notes.html?subject=biology-hl&topic=a1-1");
  assert.equal(r.makeQuestionsUrl(rec), "author.html?ai-subject=biology-hl&ai-topic=a1-1");
  assert.equal(r.makeQuestionsUrl({ subject: "chemistry-hl" }), "author.html?ai-subject=chemistry-hl");
  assert.equal(r.notesUrl({ subject: "chemistry-hl" }), "", "no topic → no notes deep link");
  assert.equal(r.makeQuestionsUrl({ topic: "a1-1" }), "", "no subject → no AI link");
});

# Development Notes

_Last updated: 19 Nov 2026._

Architecture, data schemas, conventions and gotchas for anyone (including future-you)
touching this site.

## Architecture

- **Static site, no build step.** 19 study-site pages (incl. `admin.html`) + 7 practice-app pages (`app/`, LIVE on rametric.com/nevaib) + 17 asset files + JSON data in `library/` (32 quiz banks / 841 items, 28 flashcard decks / 594 cards, 113 topic notes, and the PDF manifest `library/library-manifest.json` / 127 items). The engines build their pickers from `library/questions/manifest.json` + `library/flashcards/manifest.json`; the Library browser reads `library/library-manifest.json`.
- **Practice app (`app/`)**: `index.html` (launcher), `quiz.html`, `cards.html`, `author.html` (upload/manage/export).
  Engines resolve content via `PATH_BASE` (`../` when served from `/app/`, empty at the root), so the same engine
  files serve both layers. Root `quiz.html`/`flashcards.html` are one-line redirect stubs to the app.
- **Hosted deployment**: `server/api.php` (auth + per-user state, PHP sessions, JSON files under the cPanel home)
  + `tools/build_deploy.py` (assembles `deploy/nevaib/` — original content only). See `server/deploy-notes.md`.
- **auth.js (`assets/`)**: login/logout widget, server pull on load, debounced push on every engine write
  (engines call `Auth.queueSync()` from their `store.set`; `app.js` and the author page do the same after their writes).
  Logged out = localStorage-only fallback (in the last active user's scope). Admins get a "Manage accounts" link
  (→ `admin.html`) from the account's `role`. The API base resolves per origin: pages on rametric.com use
  `/nevaib/api/api.php` (same-origin, session cookie), every other origin (localhost study site, LAN) uses the
  production URL **plus the login token** (`X-Nevaib-Token` header) — cookies can't cross origins, tokens can.
  A dev-only override exists for testing: `?nbapi=<url>` on a localhost page (sticky in localStorage `nb-api`,
  `?nbapi=` resets it).
- **Hosted backend (`server/api.php`)**: PHP, stdlib only — `login/logout/me/get-state/save-state` +
  admin-only `create-user/list-users/set-profile` (a user record is `{"h": <hash>, "role": "admin"|"student"}`;
  legacy plain-string hashes still log in and read as role `student` — migrate-on-read, never rewritten).
  **Must run on
  PHP 7.2+** (the host serves 7.2.34): no `never` return type, no arrow functions, positional
  `session_set_cookie_params`. Passwords: `password_hash`/`password_verify` against `~/nevaib-data/users.json`.
  Per-user state: JSON file per user under `~/nevaib-data/state/` (outside the web root). Sessions: PHP cookies
  (HttpOnly, Secure auto, 30 d) for same-origin callers; login also issues a bearer token (stored sha256-hashed
  in `~/nevaib-data/tokens.json`, 90-day expiry, max 8 per user) for cross-origin callers. Brute-force guard:
  5 fails → 5-min lockout (`login-fails.json`). Accounts: key-protected `action=setup` (optional `"role"`
  field — the one-time bootstrap of the `admin` account); `create-user` seeds the new student's state with
  their subject `profile`. CORS: whitelisted origins
  (rametric.com, localhost/127.0.0.1, LAN 192.168/10/172.16-31) get `Access-Control-Allow-Origin`; OPTIONS
  preflights answer 204 before auth.
- **Storage layer** (`assets/store.js`, loaded first on every page that stores anything): `window.NB.store`
  is the only get/set the engines use. Unreadable JSON is moved to `nb-corrupt:<key>` (raw text kept) with a
  banner; quota errors show a banner and `set()` returns false; `set()` of an unchanged value is a no-op.
  `nb-schema` holds the data-shape version (currently **1** = the shapes in the table below) and
  `MIGRATIONS` in store.js runs ordered, one-time steps (each snapshots the keys it touches; a failure stops the
  chain without bumping the version). **To change a stored shape:** add `{to: N+1, touches: [keys], run(store)}`,
  bump `SCHEMA_VERSION`, add a test in `tests/js/store.test.js` — note future migrations must be **scope-aware**
  (they run on whichever scope is active at load). Non-silent writes to synced keys are recorded in
  `nb-dirty` (`{key: ms}`), persisted, so "changed on this device since the last sync" survives reloads,
  offline use and closed tabs. `NB.store.snapshot(reason, keys)` keeps a ring of 3 local safety copies
  (`nb-backup:<ms>`). Each engine keeps its old 3-line helper only as a fallback for a stale cached page
  without store.js.
- **Per-user scope layer** (`assets/store.js`, added for multi-user): every non-reserved logical key is
  physically stored as `<username>:<key>` (e.g. `neva:fc-state`) for the active account, so two accounts on one
  browser never share data. Reserved/global keys: `nb-token`, `nb-api`, `nb-schema`, `nb-sync`,
  `nb-active-user`, `nb-scoped-v2`, `nb-scoped-pending`. `nb-dirty`, `nb-backup:*`, `nb-corrupt:*` are scoped
  with the data, so dirty markers and safety copies can never cross accounts. All public APIs keep speaking
  logical keys — translation happens only in the raw layer (`phys()`), so engines are unaware of scoping.
  `NB.store.setScope(user)` switches account (called by auth.js on login/session-restore, before any sync);
  the last active scope persists in `nb-active-user` across reloads and logout ("data stays on this device").
  The first `setScope` after this feature ships moves the pre-scope flat data into the owning account's scope
  (`nb-sync.user` if set, else the logging-in user) behind a safety snapshot; a quota failure postpones the
  move (marker `nb-scoped-v2` stays unset, target pinned in `nb-scoped-pending`, retried at the next login —
  already-scoped keys are never re-moved). If a refused username ever can't become a scope, auth.js pauses sync
  entirely rather than merge into the wrong scope.
- **Subject profiles** (`assets/profile.js`, loaded right after store.js): `NB.SUBJECTS` is the canonical
  subject registry (6 ids; `NB.subjectAlias` maps the legacy spellings — `maths-aa-sl`, `history`, `french`,
  `english-lit` — used by older manifests/checklist keys; compare canonical forms on BOTH sides). `NB.profile`
  reads the synced `profile` state key: `subjects()` = the stored array (canonicalized, deduped) or, when no
  profile exists, ALL six subjects (default = the historical single-student behaviour; an explicitly empty
  array hides everything subject-specific). `allows(subject)` / `hides(subject)` drive the engine filters;
  `hides()` is only true for the six registry subjects, so cross-curricular content (the `ia-skills` quiz bank,
  `core-tok-ee`/`school`/`tsm` library groups) stays visible to profiled accounts. `applyTo(elements)` hides
  `[data-subject]` elements outside the profile; it auto-applies on DOMContentLoaded. Engine seams: quiz-engine
  (manifest banks), flashcards (registry decks), notes (subjects + notes), library (dropdown options), coursework
  (tracks), today.js (subject list + schedule keys), deadlines.js (tagged entries). Admins manage accounts and
  subject lists on `admin.html` (server actions `create-user` / `list-users` / `set-profile`, admin-only).
- **Sync model** (`assets/auth.js`): synced keys = `NB.store.SYNCED_KEYS` (`q-userbanks, fc-userdecks, fc-state,
  fc-user, fc-deleted, fc-edits, quizlog, q-errors, tok-objects, ee-ideas, io-issues, ia-debriefs, res-bookmarks,
  res-notes, res-recent, pp-scores, cw-progress, my-res, profile`) **+ `site-state`** (`{checklists: {"chk:…": {c,r}}, week: {"week:0": "…"}}`, built from
  the per-row keys; rows are tracked individually). Rules, applied on page load, after login and on a 409:
  1. `fc-state`, `q-errors`, `quizlog` merge **per record** (`NB.merge.RECORDS`): `fc-state` per card (newest `t`,
     then `seen`, then `due`), `q-errors` union by `key` (newest `ts`, then last attempt/miss date, then attempts;
     a key renamed by the quiz migration — `legacyKey` — isn't resurrected), `quizlog` union, newest first.
  2. Any other key or checklist row **this device changed** since its last sync (`nb-dirty`) keeps the local value
     and is pushed.
  3. Untouched keys take the server value (so deletions made on another device stick).
  4. A device's **first** sync with the account (`nb-sync` missing or another user) unions both copies
     (`NB.merge.union`) instead — nothing on either side is dropped. This also happens once per device after
     upgrading from the pre-revision client. All of this runs inside the active user's scope, so a first sync
     for account B can never union account A's local data (B's scope starts empty and is filled from the server).
  Every local value about to be replaced is snapshotted first; if the snapshot can't be saved the key is left
  alone and not pushed. Pushes send only the changed keys plus `base_rev` (the server revision this device last
  saw, in `nb-sync`); a 409 returns the current server copy, which is merged (rules above) before retrying (max 4
  attempts). Pushes happen 2 s after a change, every 15 s while anything is dirty, on `online`, on "Sync now",
  before logout, and on `pagehide`/`visibilitychange→hidden` via `fetch(…, {keepalive: true})` (bodies ≤ 60 KB;
  if that doesn't get through, the markers make the next load push). Checklist default rows written on page
  load are written silently and never pushed over another device's ticks. Against an **old api.php** (no
  `rev`) the client falls back to fetch-merge-then-full-payload with the server's other keys carried over.
- **Server** (`server/api.php`): `state/<user>.json` = `{state, updated_at, rev}`; every save runs under a
  per-user `flock`, copies the previous file to `state/history/<user>/<UTC>-r<rev>.json` (newest 30 kept) and
  writes temp + `rename()`. `base_rev` mismatch → 409 + current state; no `base_rev` (older clients) → saved as
  before. Keys a save omits are kept. An unreadable stored file → 500, never overwritten. `action=export`
  downloads the user's full stored state; `action=history` lists previous versions, `&name=<file>` returns one.
- **Backup / restore** (`assets/backup.js`, Cards page + author page): one file
  (`{format: "nevaib-backup", version: 3, schema, created, keys}`) with every progress key incl. `q-errors`,
  `chk:*`, `week:*`, lists, `res-*`, settings and quarantined values (never `nb-token`, `nb-api`, `nb-dirty`,
  `nb-sync`, `nb-schema`, snapshots). Restore also reads the old Cards export (v1), the old author export (v2) and
  `action=export` files; validates each key (wrong shape → rejected, bad records dropped with a warning,
  credentials/unknown keys ignored, newer schema refused); shows a summary; snapshots first; **merges** by default
  (records newest-wins, otherwise the current value wins conflicts and gaps are filled); Replace is an explicit
  opt-in for the keys in the file; "Undo last restore" brings the snapshot back.
- **Cache-busting convention**: engine script tags carry `?v=N` — bump N in the referencing pages whenever an engine
  file changes. `store.js` `?v=7` (first script on every storing page), `profile.js` `?v=1` (right after store.js),
  `backup.js` `?v=4` (cards, author), `auth.js` `?v=10`, `quiz-engine.js` `?v=17`, `flashcards.js` `?v=13`,
  `notes.js` `?v=4` (app/notes.html), `app.js` `?v=5`, `lists.js` `?v=4`
  (core, ia, french hub, ee, library), `library.js` `?v=4` (library.html, index, practice), `deadlines.js` `?v=5`
  (index + deadlines), `today.js` `?v=2`, `coursework.js` `?v=2`, `ai-prompt.js` `?v=4`. Bank/deck/manifest fetches use `?cb=Date.now()` + `cache: no-store`.
- **Vanilla JS, one engine per concern**:
  | File | Owns | Page(s) |
  |---|---|---|
  | `assets/store.js` | `NB.store` (get/set, quarantine, quota banner, dirty markers, snapshots, schema + migrations, **per-user scope layer**, legacy adoption) and `NB.merge` rules | every page that stores data (first script) |
  | `assets/profile.js` | `NB.SUBJECTS` registry + legacy aliases, `NB.profile` (per-user subject list, `allows`/`hides`/`applyTo` engine + nav filtering) | every storing page (right after store.js), `admin.html`, `deadlines.html` |
  | `assets/backup.js` | `NB.backup`: full backup, validated restore (merge/replace), undo, restore dialog | `app/cards.html`, `app/author.html` |
  | `assets/auth.js` | Login widget, sync (reconcile, dirty-key pushes with `base_rev`, 409 retry, pagehide flush), role + admin link | auth pages + app pages |
  | `assets/app.js` | Checklist rows (RAG + ticks), progress bars, countdown, this-week inputs | all pages (safe no-op) |
  | `assets/quiz-engine.js` | Session builder, MCQ marking, written self-marking, summaries, `fcSaveFromQuiz()` hook, PATH_BASE content resolution, user-bank merge | `quiz.html` (root + `app/`) |
  | `assets/flashcards.js` | Deck loading, Leitner SRS, session runner, editor, backup/restore buttons (via backup.js), theme, PATH_BASE, user-deck merge | `flashcards.html` (root + `app/`) |
  | `assets/deadlines.js` | Deadline data + `#nextup` / `#timeline` renderers | `index.html`, `deadlines.html` |
  | `assets/lists.js` | Tracked lists (`data-list` containers) + debrief notes (`textarea[data-note]`), one synced blob each | `core.html`, `ia.html`, `french-a-langlit.html`, `ee.html` |
  | `assets/library.js` | Library browser over `library/library-manifest.json`: filter bar (subject/type/free-text), rows reusing the hub-row convention, ★ pins / notes / recent tracking, `#res-pins` + `#papers-list` renderers | `library.html`, `index.html`, `practice.html` |
- **State** lives in `localStorage` (per browser/device — see table below).
- **Python** is used only for one-off scripts, run with `python3 -I` (`tools/build_site.py`,
  past extraction scripts). Nothing at runtime needs Python except the file server.

## Running it

```bash
./dev.sh start        # site + API on http://127.0.0.1:8018 (php -S + tools/dev_server.php)
./dev.sh adduser mick # dev login in ~/.cache/nevaib-dev-data (NEVAIB_DATA_DIR overrides)
./dev.sh test         # pytest (incl. PHP API tests) + node --test tests/js + php -l + node --check
./dev.sh e2e          # headless Chrome end-to-end (tests/e2e; installs puppeteer-core there on first run)
./dev.sh validate     # content validator
./dev.sh build        # build_site.py (+ library manifest when the PDFs are present) + build_deploy.py
./dev.sh deploy       # push_deploy.py --rebuild --dry-run; a real upload needs --confirm
```

`start` binds **127.0.0.1** only. `./dev.sh start --lan` binds 0.0.0.0 (with a warning) and serves only the
built `deploy/nevaib` copy — never the working tree, which holds `.git` and `deploy/.ftp-credentials`.
Open a page once with `?nbapi=/api/api.php` to point it at the local API (localhost only; `?nbapi=` resets).

**Gotcha:** `quiz.html` and `flashcards.html` `fetch()` their JSON banks — `fetch()` on
`file://` is blocked by browsers. Always use the HTTP server for real use.

**Tests** (`./dev.sh test`, also the CI workflow in `tools/ci/github-actions-test.yml` — copy it to
`.github/workflows/test.yml` to enable it on GitHub):
- `tests/js/*.test.js` (node ≥ 18, no dependencies; `tests/js/harness.js` fakes localStorage/document/fetch):
  `store.test.js` (get/set, quarantine, quota, dirty markers, snapshots, migrations, merge rules),
  `sync.test.js` (offline then online, write-then-navigate, two devices / stale tab + 409, first login with
  local data, `me` failing, checklist defaults, legacy server, storage full — against `fake-server.js`),
  `backup.test.js` (v1/v2/server-export fixtures, round trip, merge vs replace, undo, malformed input),
  `auth-merge.test.js`.
- `tests/test_api.py`: `server/api.php` on `php -S` with a temp data dir (skipped without php): auth,
  revisions + 409, partial saves, legacy files and clients, history rotation, export, atomic writes,
  unreadable file, lockout, plus a PHP 7.2 syntax guard.
- `tests/test_validate_content.py`, `tests/test_build_deploy.py`, `tests/test_course_calendar.py` (regenerates
  the site and requires byte-identical output — works without the private PDFs via `library-manifest.json`).
- `tests/e2e/e2e.js` (needs Chrome + `npm install --prefix tests/e2e`): every page loads cleanly, quiz flows,
  migration, two-browser sync, leave-within-2 s, offline study, stale tab, restore through the Cards UI.

`build_site.py` writes into the repo it lives in (`NEVAIB_ROOT` overrides); without the git-ignored PDF
folders it reads the file list from `library/library-manifest.json`.

## localStorage keys

Every data key below is physically stored as `<username>:<key>` for the active account (per-user scope layer in
store.js); the table lists the **logical** names engines use. `nb-*` bookkeeping is global except where marked
"scoped". A one-time adoption moves pre-scope flat data into the owning account's scope (see Architecture).

| Key | Owner | Contents |
|---|---|---|
| `chk:<subject>::<path>` | `app.js` | syllabus checklist row: `{c: bool, r: "r/a/g"}` |
| `week:0` … `week:4` | `app.js` | dashboard this-week items |
| `quizlog` | `quiz-engine.js` | last 20 session summaries `{date, label, got, max, pct, ts}` (local date; `ts` on new entries) |
| `fc-state` | `flashcards.js` | per-card SRS state `{box: 1–5, due: "YYYY-MM-DD", seen, t}` — `t` = last-review ms timestamp (absent on older entries), used by the sync merge |
| `fc-user` | both | user-created cards (quiz hook + editor), full card objects |
| `fc-deleted` | `flashcards.js` | seeded card ids the user deleted (override) |
| `fc-edits` | `flashcards.js` | edits to seeded cards `{id: {front, back, tags}}` |
| `fc-theme` | `flashcards.js` | "light"/"dark" for the Cards page |
| `q-userbanks` | `app/author.html` + quiz-engine | uploaded quiz banks (per device) |
| `fc-userdecks` | `app/author.html` + flashcards | uploaded flashcard decks (per device) |
| `q-errors` | quiz-engine + `practice.html` | missed-question tracker: `{key, subject, topic, topicLabel, format, stem, choices, answer, userAnswer, note, marks, markscheme, tactic, attempts, firstMissed, lastMissed, resolved}` + `id, bankId, ts, lastAttempt, legacyKey` — key = `"<bankId>#<id>"` (bankId = bank file name without `.json`, `user:<slug>` for uploaded banks; ids are only unique per file). Older records keyed by bare id / stem hash are renamed when their bank loads in a session (same id AND same stem), keeping `legacyKey`; unmatched old records stay as they are and remain reviewable. `ts` = last-change ms timestamp for the sync merge. Synced cross-device when logged in |
| `profile` | `profile.js` / server | per-user subject list `{subjects: ["biology-hl", …]}` (canonical ids; absent = all six subjects; empty array = none). Set by an admin via `set-profile`/`create-user`, synced as a normal state key |
| `nb-token` | `auth.js` | login bearer token (sent as `X-Nevaib-Token`) — cross-origin sync — global |
| `nb-api` | `auth.js` | dev-only API override set via `?nbapi=` on localhost pages — global |
| `nb-schema` | `store.js` | data-shape version (int) — global |
| `nb-dirty` | `store.js` / `auth.js` | `{key: ms}` synced keys/rows changed on this device since the last successful sync — **scoped** per user |
| `nb-sync` | `auth.js` | `{user, rev, legacy, at}` — server revision this device last synced with — global |
| `nb-active-user` | `store.js` | last active storage scope (username); kept on logout — global |
| `nb-scoped-v2` | `store.js` | one-time marker: the legacy flat namespace has been adopted into per-user scopes — global |
| `nb-scoped-pending` | `store.js` | adoption postponed: pins the flat data's rightful owner across retries — global |
| `nb-backup:<ms>` | `store.js` | local safety snapshots `{reason, at, schema, keys: {key: rawJSON}}`, newest 3 — **scoped** per user |
| `nb-corrupt:<key>` | `store.js` | quarantined unreadable values `[{key, at, raw}]` — **scoped** per user, included in backups |
| `chk:*` / `week:*` | `app.js` | synced inside the `site-state` payload (not as their own keys) |
| `tok-objects` | `lists.js` (core.html) | TOK exhibition shortlist blob `{items:[{t, done, a: prompt, b: why}]}` |
| `ee-ideas` | `lists.js` (ee.html) | EE idea-log shortlist blob `{items:[{t, done, a: subject, b: why}]}` |
| `io-issues` | `lists.js` (french hub) | French IO global-issue bank blob `{items:[{t, done, a: text, b: work}]}` |
| `ia-debriefs` | `lists.js` (ia.html) | IA practice debrief notes `{nov:{rd,da,ce}, jan:{rd,ace}}` |
| `cw-progress` | `coursework.js` (app/coursework.html) | coursework planner `{checks: {"<track>.<stage>.<check>": {c, t}}, notes: {"<track>.<stage>": {s, t}}, dates: {"<track>.<stage>": {d, t}}}` — synced and merged **per record** (newest `t`; an untick is `c:false`, never deleted). Ids come from `library/coursework/coursework.json` and must never be renamed |
| `res-bookmarks` | `library.js` | pinned library resources: array of `subject::path` keys (★ on library rows), newest pin first |
| `res-notes` | `library.js` | per-resource free-text notes `{subject::path: text}` |
| `res-recent` | `library.js` | recently opened PDFs: array of `subject::path`, newest first, capped at 20 |
| `lib-filters` | `library.js` | library browser filter state `{subject, type, q}` — device-local, NOT synced (but scoped per user) |

`tok-objects`, `ee-ideas`, `io-issues`, `ia-debriefs` and the three `res-*` blobs are plain synced keys (in
`NB.store.SYNCED_KEYS`; per blob: the device that changed it wins, otherwise the server copy — see Sync model). `q-errors` is synced and merged per record (see Sync model);
practice.html's inline script (folded into the generator) renders it.

## Data schemas

### Quiz bank (`library/questions/*.json`)
```json
{
  "subject": "chemistry-hl",
  "topic": "structure-3-1-periodicity",
  "topicLabel": "human-readable",
  "items": [
    {"id": "p01", "format": "mcq", "stem": "…", "choices": ["…"], "answer": 1,
     "note": "why the answer is right + the trap"},
    {"id": "p21", "format": "written", "marks": 3, "stem": "…",
     "markscheme": ["point (1)", "point (1)"], "tactic": "how to attack this question type"}
  ]
}
```
Rules: ids unique across the file; `answer` is a 0-based choice index; every item carries
its unit `topic` code; notes state the fact and the trap — never hedge.

### Flashcard deck (`library/flashcards/*.json`)
```json
{
  "subject": "biology-hl",
  "topic": "c1-1-enzymes-metabolism",
  "topicLabel": "human-readable",
  "cards": [
    {"id": "fc-bio-e-01", "type": "term | qa", "tags": ["definition", "IA"],
     "front": "term or question", "back": "definition or answer"}
  ]
}
```
Ids unique **across all decks** (prefix per deck). Same `topic` keys as question banks.

### Content manifests (`library/questions/manifest.json`, `library/flashcards/manifest.json`)
```json
[
  {"file": "library/questions/bio-unity-diversity-cells.json", "subject": "biology-hl",
   "subjectLabel": "Biology HL", "label": "Unity & diversity — Cells & membranes"}
]
```
Array of entries; this is what `quiz-engine.js` / `flashcards.js` fetch to build their
pickers (`?cb=` + `cache: no-store`). The flashcards manifest omits `label`. The inline
`FALLBACK_BANKS` / `FALLBACK_REGISTRY` lists at the top of the engines are partial
fetch-failure snapshots, not the source of truth — the manifests are. `validate_content.py`
checks that every manifest entry points to an existing file.

### Library manifest (`library/library-manifest.json`)
```json
{
  "generated": "2026-11-15T20:01:52Z",
  "items": [
    {"file": "library/notes/biology-hl/continuity-change/cell-nuclear-division.pdf",
     "subject": "biology-hl", "subjectLabel": "Biology HL", "type": "notes",
     "section": "continuity-change", "label": "Cell nuclear division"}
  ]
}
```
`type` is one of `notes | official | school | papers` (`papers/` may be empty); items are sorted by
(type, subject, section, label) so re-runs diff cleanly; `label`/`subjectLabel` are pre-HTML-escaped by
the tool (its `pretty()` mirrors `build_site.py`). Rebuild after adding/removing PDFs with
`python3 -I tools/build_library_manifest.py` — it scans `library/{notes,official,school,papers}` only
(`questions/` and `flashcards/` keep their own manifests). `library.html`, the dashboard pins card and
the practice papers list all render from this one file.

### Deadlines (`assets/deadlines.js` → `DEADLINES` array)
`{ d: "YYYY-MM-DD", t: "label", tag: "sciences|ee|tok|core|exams|langlit|university|sixth" }`

### Topic notes (`library/topic-notes/<subject>/<code>.json`, schema v1)

One file per syllabus topic, original wording, organised by the official topic codes. Viewer: `app/notes.html` +
`assets/notes.js` (subject → theme → topic; `?subject=biology-hl&topic=c1-1` deep-links one note). Listed in
`library/topic-notes/manifest.json` (`{schemaVersion, subjects: {id: {label, syllabus, themes}}, notes: [{file, id,
subject, code, title, theme, themeLabel, hlOnly, status}]}`), generated — never hand-edit it. Syllabus maps
(codes, titles, statement numbers, teaching order; no guide text) live in `library/syllabus/<subject>.json`.

| field | purpose |
|---|---|
| `schemaVersion` (1), `id`, `subject`, `code`, `title`, `theme`, `themeLabel` | required identity + placement |
| `level`/`levelLabel` (Biology), `hlOnly`, `status`, `islOrder`/`islUnits`/`taughtStatus` | placement, school order |
| `statements.SL` / `statements.AHL` | statement numbers only |
| `bigPicture` | 1–2 sentence anchor |
| `keyIdeas[] {id, ahl, stmt, cue, answer}` | recall-first pairs: cue shown, answer revealed on demand |
| `keyTerms[] {term, def}` | "+ card" adds a personal flashcard to `fc-user` (synced) |
| `workedExamples[] {title, prompt, steps[], answer}` | steps revealed one at a time |
| `misconceptions[] {wrong, right}`, `errorHints[] {category, hint}` | common mistakes |
| `practice[] {commandTerm, marks, prompt, checkpoints[]}` | self-check points written by us — **not IB markschemes** (label kept on the page) |
| `paper1A[] {stem, choices, answer, why}`, `paper1B[] {data, prompt, answer}` | Chemistry calculator-free MCQ / data prompts |
| `dataBooklet` (strings or `{section, title, use}`), `formulaBooklet {given[], memorise[], note}` | booklet pointers |
| `linkingQuestions[] {to, prompt}` | cross-topic links (clickable when `to` has a note) |
| `links {checklistKey, quizBanks[{file, itemIds\|null}], decks[{file, cardIds\|null}], gap}` | `null` ids = whole bank/deck |

**Authoring flow:** drafts are written outside the repo (with the private guides alongside), then
`python3 -I tools/import_topic_notes.py <draft-dir>` copies the per-topic JSON (never `sources/` or `_build/`,
and it refuses any file mentioning a local path), copies `syllabus-*.json` to `library/syllabus/`, and rebuilds the
manifest. Then `./dev.sh validate` (checks required fields, list-item shapes, Paper 1A answer indices, that every
linked bank/deck file and every linked question/card id exists, manifest ↔ files, no local paths) and
`python3 -I tools/build_site.py` (adds "study notes" links to checklist rows whose key matches `links.checklistKey`).

**Deep links into practice:** `quiz.html?from=<bankId>[:id1,id2]&from=…&label=…&n=20` starts a session on exactly
those questions (bank id = file name without `.json`; unknown ids are skipped and reported in the notice).
`cards.html?from=<deckId>[:ids]&label=…&n=20` starts a card session on those cards: due first, then new, then the rest.
`notes-last` (`{subject, topic}`) remembers the last opened note — device-local, not synced.

**Ask an AI:** `assets/ai-prompt.js` draws the control on each note. All wording is in `library/ai-prompts.json` (`default_ai`, `assistants[]`, `preamble`, `modes[]`). Placeholders `{subject}` `{level}` `{topic}` `{understandings}` `{keyterms}` `{wrong_questions}` are documented in `_doc` and filled from the note (and, for `{wrong_questions}`, unresolved `q-errors` stems for that note's linked quiz items). A click copies the prompt and `window.open`s the assistant URL; she pastes with Ctrl+V. Preferred assistant: raw `localStorage` key `ai-pref`, in `LOCAL_ONLY`, not synced. To change text or add a mode, edit the JSON and run `./dev.sh test`.


## Generator

`tools/build_site.py` regenerates the 10 base pages (index, 5 hubs, core, practice, ia,
quick-reference) plus `assets/style.css` and `assets/app.js`. All post-generation patches
are folded into its `PATCHES` list (teaching-sequence panels, dashboard next-up strip,
English Lit card, quiz callout, ISL milestone dates, chip styles, canonical nav) — re-running
it reproduces every page. The practice-page "Missed questions" card + its inline script live in
the generator too (folded in 2026-11-15 — they used to be hand-added drift). The sciences-IA
paragraph on ia.html is single-source (the old IA_PARA prefix-patch that duplicated a fragment
is gone).

Rules:
- Any hand-edit to one of the 10 generated pages must ALSO be folded into the generator
  (template or PATCHES entry) — otherwise the next regeneration reverts it.
- Auth widget (auth-slot + `auth.js?v=6` tag) is injected by `page()` for the `AUTH_PAGES` set
  (index, 5 hubs, core, ia); `english-lit-hl.html` and `ee.html` carry the same markup
  hand-authored. Keep them in sync. Core/ia/ee load auth.js because their lists/notes sync.
- Per-page engine scripts go through `EXTRA_SCRIPTS` (lists.js on core/ia/french; library.js on index
  + practice — it drives the dashboard pins card and the practice papers list).
- The hand-maintained pages (`quiz.html`, `plan.html`, `deadlines.html`, `flashcards.html`,
  `english-lit-hl.html`, `ee.html`, `library.html`, `sixth-subject.html`) are never touched by the generator.

## Recipes (common changes)

- **Add school papers (manifest-driven intake)**: save the PDF into `library/papers/<subject>/`, run
  `python3 -I tools/build_library_manifest.py`, refresh — the papers list on `practice.html` and the
  Papers group on `library.html` pick it up from the manifest; no page edit needed. The drop-files hint
  shows on both only while the papers count is 0.
- **Add library resources (notes/official/school)**: file the PDF under its `library/<type>/<subject>/`
  folder, re-run the manifest tool, refresh `library.html` — filter by type/subject/section or search;
  ★ pins, per-resource notes and recently-opened tracking sync via the `res-*` blobs.
- **Add a quiz bank**: JSON into `library/questions/`, then add an entry to
  `library/questions/manifest.json` (`file`, `subject`, `subjectLabel`, `label`). The engines
  fetch the manifest — no engine edit needed. The inline `FALLBACK_BANKS` in `quiz-engine.js`
  is only a best-effort snapshot for a manifest-fetch failure (may lag the manifest; not
  authoritative) — update it only if the degraded picker should include the new bank too.
  Validate with `python3 -I tools/validate_content.py` (answer ranges, unique ids,
  manifest→file consistency).
- **Add a flashcard deck**: JSON into `library/flashcards/`, then add an entry to
  `library/flashcards/manifest.json` (`file`, `subject`, `subjectLabel`). Same fallback note
  (`FALLBACK_REGISTRY` in `flashcards.js`) and same validator.
- **Add deadlines**: edit the `DEADLINES` array in `assets/deadlines.js` (dashboard next-up
  and the timeline update automatically; the renderers sort by date, but keep the array ordered).
- **Add a tracked list or debrief notes**: drop a `<div data-list="<key>" data-list-fields='[{"k":"a","label":"…","ph":"…"}]'></div>`
  or `<textarea class="tnote" data-note="<key>:<dot.path>"></textarea>` into the page, register `<key>`
  in `NB.store.SYNCED_KEYS` (assets/store.js), and load `lists.js` on that page (add it to `EXTRA_SCRIPTS` for generated
  pages, or the script tag for hand-made ones). One blob key per list/notes group; blobs are
  last-write-wins on sync.
- **Add a subject hub**: copy a hub page, keep the checklist `data-key` convention
  (`<subject>::<path>`), add the nav link on **every** page (navs are hand-copied), add a
  dashboard card with `data-subject="<key>"`.

## Link check (run after edits)

```bash
python3 -I - <<'EOF'
import re
from pathlib import Path
ROOT = Path.home() / "Projects" / "ibsystem"
for f in ROOT.glob("*.html"):
    for href in re.findall(r'href="([^"#]+)"', f.read_text()):
        if not href.startswith(("http", "mailto")) and not (ROOT / href.split("?")[0]).exists():
            print("MISSING:", f.name, href)
EOF
```

## Known quirks

- Em-dashes/unicode subscripts inside JSON are fine (UTF-8 everywhere) — but always
  validate with `json.loads` after editing banks.
- Anchor-based patches must match exactly; the generated pages are single-line in places,
  so patch on short unique substrings and re-run the link check.
- `ibsystem/library/` is **canonical**. The ZCode workspace copy (`ib-library/`) was a
  staging area — do not update it further.
- `source-archives/` holds the original downloaded ZIPs (~434 MB) — provenance only,
  deletable once confident in `library/notes/`.
- The Cards page dark mode is scoped to that page (`data-fcTheme` attribute); the rest of
  the site is light-only by design (one thing to change at a time).
- **The host runs PHP 7.2.34**, not 8 (cPanel can switch it — worth asking for). `server/api.php`
  is written for 7.2+: no `never` return type, no arrow functions, positional
  `session_set_cookie_params`, no trailing commas in calls. Keep it that way even though local
  `php -l` (8.3) accepts newer syntax.

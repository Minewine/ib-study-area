# Changelog — 21 Nov 2026: Signalbox feedback widget on the practice pages

_On top of the uncommitted study-loop/difficulty tree. Adds a small, self-contained feedback channel: a
"Feedback" button on the eight practice pages opens a lightweight modal and POSTs JSON to the Signalbox
feedback endpoint. No stored-data changes — the widget creates no localStorage keys and never touches
store.js, SYNCED_KEYS or backups._

## What changed

### assets/feedback.js (new, `?v=1`)
- `window.NB.feedback` IIFE, no dependencies, loaded on the eight practice pages (index, quiz, cards,
  notes, mistakes, coursework, resources, author — **not** `summary.html`, which stays parent-facing and
  minimal) right after `profile.js`, before `auth.js`.
- Boot injects one `<style>` block (`sbx-*` prefixed classes, built on the page CSS variables
  `--ink/--muted/--bg/--card/--line/--accent` with literal fallbacks — there is no shared `.btn` and no
  page CSS to lean on) and a fixed bottom-right **Feedback** button. Double include is harmless
  (`NB.feedback` guard + an id check in `boot()`).
- The modal: type (Bug / Improvement / Idea), area (Quiz / Cards / Today / Notes / Upload / Other,
  preselected per page — index→today, author→upload, mistakes/coursework/resources→other), title,
  description, an **"Include current page and topic"** checkbox (default checked) and an inline status
  line (errors in a reddish tone). Send disables itself and shows "Sending…" while in flight; a success
  replaces the form with a greenish "Thanks — feedback sent." and auto-closes after ~2 s; a failure shows
  the reason in the status line and re-enables Send. Cancel, Escape and a backdrop click close it.
- Context: `collectContext()` reads each page's own state — Quiz `#q-subject`/`#q-topic` (the selected
  option's visible label; `*` mixed → null), Cards `#fc-subject`/`#fc-topic`, Notes `?subject=`/`?topic=`
  URL params — canonicalized through `NB.canonicalSubject` when loaded; page = the pathname basename.
  The username comes from `Auth.user()` at submit time (guarded, so logged-out sends simply omit it).
- Pure helpers exported for the node tests: `buildPayload` (friendly-error validation + `{app, key, type,
  area, title, body}` + an optional `context` included only when non-empty), `collectContext`, `submit`
  (fetch POST, JSON headers, 10 s AbortController timeout — the today.js convention; non-OK rejects with
  the server's `error` message or `"HTTP <status>"` — the auth.js convention), plus `config`.

### Config (the one place to edit — `FEEDBACK_CONFIG` at the top of the file)
The endpoint URL and the app key are the two `PLACEHOLDER` constants at the top of `assets/feedback.js` —
edit them there (config values stay out of docs). CSP constraint: every app page's meta CSP whitelists only `'self'` +
rametric.com/www.rametric.com + localhost in `connect-src` — the endpoint host must stay inside that
whitelist (or all nine pages' CSP need editing along with it). The POST always goes through `fetch()`;
a real `<form action>` would be blocked by `form-action 'self'`.

## Files touched

- **Added**: `assets/feedback.js`, `tests/js/feedback.test.js`, this changelog.
- **Modified (one-line script-tag insertions)**: `app/index.html`, `app/quiz.html`, `app/cards.html`,
  `app/notes.html`, `app/mistakes.html`, `app/coursework.html`, `app/resources.html`, `app/author.html`.
- **Modified (docs)**: `docs/HANDOFF.md` (dated blurb), `docs/DEVELOPMENT.md` (engine-table row +
  cache-busting entry).

## Verification

- `node --check assets/feedback.js` ok.
- `node --test tests/js/feedback.test.js` — 12/12 pass: payload shape, context assembly rules
  (context/user/neither/falsy-dropped), validation errors, bare-DOM + quiz-shaped + notes-URL context
  collection, the scripted-fetch submit matrix (URL/method/headers/body round-trip, 500 JSON error,
  500 non-JSON → `HTTP 502`, network reject propagates, 2xx empty body resolves), no fetch at load, and
  the CSP endpoint-host guard.
- Full JS suite: `node --test tests/js/*.test.js`.

# Deploying the practice app to rametric.com/nevaib

**STATUS 2026-11-15: DEPLOYED AND LIVE** — `deploy/nevaib/` uploaded via SFTP, verified
over HTTPS (pages 200, API live, TLS valid for rametric.com). Setup key blanked on the
host after account creation. The steps below remain the re-deployment procedure for
content updates. (Last updated: 19 Nov 2026 — multi-user release notes and the
"Creating accounts" section added; see DEPLOY.md for the release checklist.)

## Verified live 2026-11-15

`https://rametric.com/nevaib/` serves the app; api.php auth + cross-device
state sync verified end-to-end (login 200, wrong password 401, setup locked,
CORS preflights OK). First deployment was done as: zip → cPanel extract →
curl setup → blank key. Ongoing updates use the push script below.

**Host PHP is 7.2.34** (not 8 — check the cPanel MultiPHP Manager; 7.2 is EOL,
worth switching the account when convenient). `server/api.php` is therefore
written for 7.2+: no `never` return type (8.1+), no arrow functions (7.4+),
positional `session_set_cookie_params` (array form needs 7.3+). Local
`php -l` (8.3) won't catch violations — keep new syntax out by hand. The
token/auth flow was verified live after making the file 7.2-safe.

## One-time setup (already done for this site)

1. RE-DEPLOY (content updates): build the deployable folder:
   ```sh
   python3 -I tools/build_deploy.py
   ```
   → produces `deploy/nevaib/` + `deploy/nevaib.zip`. If `deploy/.setup-key`
   exists it is baked into the built api.php (one-time account creation).
2. Set a setup key: put a long random string into `deploy/.setup-key` and
   rebuild — or edit `deploy/nevaib/api/api.php` directly. Empty `$SETUP_KEY`
   = setup disabled.
3. Upload `nevaib/` into `public_html/` (`tools/push_deploy.py`, or the zip
   via cPanel File Manager → Extract).
4. Create the accounts (from any terminal, against the live host):
   ```sh
   curl -X POST "https://rametric.com/nevaib/api/api.php?action=setup" \
        -H "Content-Type: application/json" \
        -d '{"setup_key":"<the key>","username":"<her-username>","password":"<a-good-password>"}'
   ```
   Repeat per account. Then **blank `$SETUP_KEY` in the uploaded api.php**
   (cPanel editor) and confirm setup returns 403. Delete `deploy/.setup-key`
   too — rebuilds then ship the blank-key api.php, and `tools/push_deploy.py`
   refuses to push an armed api.php unless you pass `--allow-setup-key`.
5. Verify: open `https://rametric.com/nevaib/`, log in, run a session, confirm
   `~/nevaib-data/state/<user>.json` appears (cPanel file manager, outside public_html).

## Creating accounts (multi-user, 2026-11)

> **Done for this site (19 Nov):** the `admin` account exists, the setup key was used once and
> blanked again (`action=setup` verified locked). Add students via the admin on the study site's
> `admin.html`, or the `create-user` curl recipe below.

User records in `~/nevaib-data/users.json` are `{"h": <password-hash>, "role": "admin"|"student"}`.
Plain-string hash values from before this release keep working and read as role `student` — nothing to
migrate on the host. Every student account needs a profile (its subject list) or the site shows them
*all* subjects, so create students through the admin flow below rather than with the setup key.

**Bootstrap the admin account (once, same ritual as the one-time setup):**

1. Arm the key: put a long random string into `deploy/.setup-key`, rebuild
   (`python3 -I tools/build_deploy.py`), upload (or edit the uploaded `api/api.php` directly).
2. Create the admin account — note `"role":"admin"`:
   ```sh
   curl -X POST "https://rametric.com/nevaib/api/api.php?action=setup" \
        -H "Content-Type: application/json" \
        -d '{"setup_key":"<the key>","username":"<admin-username>","password":"<a-good-password>","role":"admin"}'
   ```
   Without the field the account is a plain student.
3. **Blank `$SETUP_KEY` in the uploaded api.php** and confirm setup returns 403. Delete
   `deploy/.setup-key` (the push script refuses to upload an armed api.php unless forced).
   The admin account is not a student: it sees no subject content, only `admin.html`.

**Create students (no key needed, from the admin login):** log in as the admin on
`https://rametric.com/nevaib/admin.html` — account list, "Add student" form (username, password,
subject checkboxes), and a per-student subject editor. Under the hood these call:

- `?action=create-user` (POST `{username, password, subjects: ["biology-hl", …]}`) — admin only;
  creates the record and seeds `state/<user>.json` with `profile.subjects`.
- `?action=list-users` (GET) — admin only; `[{user, role, subjects}]`, never any hash material.
- `?action=set-profile` (POST `{user, subjects}`) — admin only; updates the subject list (new revision,
  history snapshot like a normal save).

Canonical subject ids: `biology-hl`, `chemistry-hl`, `math-aa-sl`, `history-sl`, `french-a-langlit`,
`english-lit-hl` (`assets/profile.js` normalizes legacy spellings like `maths-aa-sl`). A student whose
subjects are not in that list simply starts with an empty personal space — they can upload their own
quiz banks and decks on the Upload page; those are per-account data.

**Existing account (neva):** nothing to do. No profile key means "all six subjects", and her browser
data is adopted into her per-user storage scope automatically (with a safety snapshot) on her first
login after the upgrade.

## Content updates

```sh
python3 -I tools/push_deploy.py --rebuild     # rebuild from repo + push over FTPS
python3 -I tools/push_deploy.py               # push only (rebuild separately if needed)
python3 -I tools/push_deploy.py --dry-run     # show what would change
python3 -I tools/push_deploy.py --prune       # also delete remote files removed from the build
```

Uploads go over FTPS with the `nevaib-deploy@rametric.com` FTP account
(created in cPanel, home directory scoped to `public_html/nevaib` only).
Credentials live in the gitignored `deploy/.ftp-credentials` (or
`NEVAIB_FTP_*` env vars). Unchanged files (same size + mtime) are skipped,
so a no-change push is cheap.

**Gotcha (cost us an hour):** when creating the FTP account programmatically
(UAPI `Ftp::add_ftp`), `homedir` must be **relative to the account root** —
`/public_html/nevaib`. An absolute path like `/home/<user>/public_html/nevaib`
gets *nested* (`/home/<user>/home/...`): FTP uploads then land in a folder the
web server never serves, and every push "succeeds" into thin air. The host
runs LiteSpeed, so freshly-uploaded PHP files can also lag a moment before
serving. Verify scoping with a canary: upload `zz-canary.txt` over FTPS, then
expect `https://rametric.com/nevaib/zz-canary.txt` to return it (200), and
delete it afterwards.

The engines carry a version query (`?v=N`) — bump it in the app pages when you change
an engine file, so phones pick up the new copy instead of a cached one.

## HTTPS

Live and serving 200 over https (verified 2026-11-15). The API sets the `Secure`
cookie flag automatically when served over HTTPS. Do not share password logins
over plain HTTP.

## What is intentionally NOT deployed

- `library/official/`, `library/school/`, `library/notes/`, `library/papers/` — IB/publisher
  copyrighted material stays local-only, forever.
- `source-archives/`, `tools/`, the study-site pages (hubs reference those PDFs and stay
  local by design).

## Per-user data on the host

- `~/nevaib-data/users.json` — password hashes (never plaintext).
- `~/nevaib-data/state/<user>.json` — each user's full app state (incl. `site-state`:
  checklist ticks + this-week items, synced from the study-site pages too).
- `~/nevaib-data/tokens.json` — sha256-hashed login tokens (90-day expiry, max 8/user)
  used by non-rametric.com origins (localhost study site, LAN) where cookies can't cross.
- `~/nevaib-data/login-fails.json` — brute-force guard: counters keyed by sha256 of username+IP and of IP
  (no raw usernames/IPs stored), 15-minute window, written atomically under `login-fails.json.lock`.

- `~/nevaib-data/state/history/<user>/<UTC>-r<rev>.json` — the previous 30 versions of each
  state file (written by every save; files are copies of the state file before the save).
- `~/nevaib-data/state/<user>.json.lock` — empty lock file used to serialise saves.

**Per-user export (no PHP upload needed):** logged in, open
`https://rametric.com/nevaib/api/api.php?action=export` — downloads `{state, rev, history list}` for
that account; `?action=history` lists previous versions and `?action=history&name=<file>` returns one.
The Cards page backup file can restore an export (it reads `nevaib-server-export`). This covers the
student's data; `users.json`/`tokens.json` still need the recipe below.

**Backup recipe (verified 2026-11-15):** the cPanel **File Manager UI is disabled** on this
account (and `FileMan` UAPI + most file APIs are stripped), so the documented
"cPanel → download the folder" route does not exist. Working path: upload a
temporary **key-gated PHP dumper** into `public_html/nevaib/` via the scoped FTP
account, curl it with the key (it base64-returns every `nevaib-data` file),
save + byte-verify against a `statfiles` listing, then **delete the dumper**
and confirm it 404s. First backup: `~/Backups/nevaib-data-2026-11-15/` (+ zip)
on the dev machine. Ask support for Web Disk or a restored File Manager if a
zero-PHP route is preferred.

**PHP on the host — findings (2026-11-15):** the account runs **PHP 7.2.34** and
has **no MultiPHP Manager and no CloudLinux PHP Selector** (both UIs + the
`multiphp` feature are absent). `.htaccess` handler tests from `/nevaib/`:
`application/x-httpd-ea-php81(-lsphp)` falls back to 7.2, while
`ea-php82/83/84` handlers are recognised by LiteSpeed but return **403 —
defined server-wide, not permitted for this account**. So PHP 8 needs a
**Namecheap support ticket** (ask them to enable PHP 8.x for the account).
`server/api.php` is written for 7.2 and runs fine; this is hygiene, not urgency.

Ready-to-send ticket text for that hygiene pass (fill in the cPanel username):

> Subject: Enable PHP 8.x for my account (cPanel: `<username>`, domain rametric.com)
>
> Hi — my account currently serves `public_html` with PHP 7.2.34. The MultiPHP
> Manager and CloudLinux PHP Selector icons are not present in my cPanel, and
> `.htaccess` handler overrides (`ea-php82/83/84`) return 403 from my sites, so I
> can't switch the version myself. Please enable PHP 8.x (8.2 or newer) for the
> account, or let me know the supported way to change it.
>
> One more ask while you're there: the cPanel File Manager is disabled on this
> account and the FileMan UAPI + most file APIs are stripped — please restore it
> or enable Web Disk, so I can back up my files without workarounds.
>
> The only PHP on the account is a small standard-library script; I'll re-test it
> after any switch. Thanks!

After the switch: re-verify `https://rametric.com/nevaib/` (login + a state save),
then the 7.2 syntax constraints in `server/api.php` can be relaxed if desired.

## Local test host (no shell on the real one)

```sh
NEVAIB_DATA_DIR=/tmp/nevaib-test-data php -S 127.0.0.1:8018 -t . tools/dev_server.php
```

`tools/dev_server.php` maps `/api/api.php` → `server/api.php`; the env var keeps
test data out of the real home dir. From a browser:
`http://localhost:8017/<page>?nbapi=http://127.0.0.1:8018/api/api.php` exercises
the full cross-origin token path (override is localhost-only; see DEVELOPMENT.md).

## Security hardening (2026-11)

What `server/api.php` enforces (tests: `tests/test_api.py`):

- **Login limits.** 5 failed logins per username + IP within 15 minutes, and 20 per IP across
  all usernames, then HTTP 429 with a generic message until the window passes (a correct
  password is refused too while locked). A success clears that username+IP counter. Unknown
  usernames get the same "wrong username or password" answer and the same bcrypt cost, so the
  API doesn't reveal which accounts exist. Only `REMOTE_ADDR` is used (never
  `X-Forwarded-For`, which a client can forge). If she is ever locked out, wait 15 minutes, or
  delete `~/nevaib-data/login-fails.json` (safe: it holds only counters).
- **Tokens.** 64-hex tokens from `random_bytes(32)`, stored only as sha256 hashes, compared with
  `hash_equals`, valid 90 days, max 8 per user, accepted only in the `X-Nevaib-Token` header
  (never a URL parameter). Logout retires the presented token.
- **Cookie sessions.** `HttpOnly`, `Secure` on HTTPS, browser-default `SameSite=Lax` (PHP 7.2 can't
  set the attribute), strict mode (no adopting client-chosen ids), cookies only (no ids in URLs),
  regenerated at login, absolute 30-day lifetime.
- **CSRF.** `setup`, `login`, `logout` and `save-state` must be POST/PUT with
  `Content-Type: application/json` (405 / 415 otherwise). An HTML form on another site can't send
  that content type, and a cross-origin `fetch` with it needs a CORS preflight that only the
  allow-listed origins (rametric.com, localhost, private LAN) pass. A browser `Origin` that is
  neither allow-listed nor this host gets 403. Form-encoded bodies are no longer accepted
  (the setup `curl` above already sends JSON). Reads stay GET, so the export link still works in a tab.
- **Response headers.** `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  `X-Frame-Options: DENY`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`,
  `Cache-Control: no-store` (state is private; no proxy or browser cache keeps it).

**Pages (`app/*.html`)** carry a `<meta>` CSP and referrer policy:
`default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;
connect-src 'self' https://rametric.com https://www.rametric.com http://localhost:* http://127.0.0.1:*;
object-src 'none'; base-uri 'self'; form-action 'self'`. `'unsafe-inline'` stays because
`author.html` and `cards.html` have inline `<script>` blocks and the pages use inline `<style>`
and `style=""`. Moving those scripts into `assets/*.js` would allow dropping it for scripts —
a later, separate change. A `<meta>` CSP can't set `frame-ancestors`; for that (and headers on
static files generally) an optional `public_html/nevaib/.htaccess` would work on LiteSpeed:

```apache
<IfModule mod_headers.c>
  Header always set X-Content-Type-Options "nosniff"
  Header always set Referrer-Policy "strict-origin-when-cross-origin"
  Header always set X-Frame-Options "DENY"
</IfModule>
```

It is **not** shipped by the build: test it on the host first (a bad `.htaccess` returns 500 for
the whole folder), then add it to `tools/build_deploy.py` if wanted.

**XSS.** Content (questions, cards, notes) is plain text by design. Every string built into
`innerHTML` from content, imported backups, synced state or the user goes through one escaper,
`NB.escapeHtml` (in `assets/store.js`; escapes `& < > " '`), with an identical local fallback in
modules that load without `store.js`. `assets/notes.js` builds DOM nodes and never uses `innerHTML`.

## Parent weekly summary (2026-11)

**Page:** `https://rametric.com/nevaib/summary.html` (linked in the home-page footer). Read-only.
It logs in **token-only** (`"no_session": true`) and keeps the token in `sessionStorage`; it
never loads `auth.js`/`store.js` and never writes `nb-token` or any synced key, so a parent's
browser can't merge its own local data into the student's account. Logging in with her
username/password works with no setup at all.

**API:** `GET api.php?action=summary&days=7[&user=<name>]` (authenticated, days 1–90). Computed
by `server/summary.php` from the stored state; nothing is written. Figures:
- active days (dates with a quiz session or a card review), quiz sessions and accuracy by
  session label, accuracy **by topic** (from quiz sessions saved by quiz-engine v13+, which adds a
  `topics` breakdown to each `quizlog` entry; older entries count only in the totals),
- flashcards: distinct cards whose latest review falls in the window (the app keeps only the
  last review time per card, so repeated reviews of one card count once), due now, mastered,
- missed questions (unresolved `q-errors` last missed in the window) and the 5 weakest topics,
- **minutes are an estimate** (≈20 s per card + 1 min per quiz mark): the app doesn't time sessions.

**Optional config** — `~/nevaib-data/config.json` (outside `public_html`, never committed; the
deploy never touches it). Upload it the same way as other `nevaib-data` files, or create it via a
temporary key-gated PHP helper as in the backup recipe. Example:

```json
{
  "timezone": "Europe/Zurich",
  "summary_viewers": { "<parent-username>": ["<student-username>"] },
  "summary_email": { "to": "<parent e-mail>", "from": "<sender on your domain>",
                     "users": ["<student-username>"], "days": 7 }
}
```

- `summary_viewers` lets a separate parent account read the student's summary (one-way,
  read-only). The parent account is created with the one-time setup-key procedure above.
  Without it, log in on the summary page with the student's own credentials.
- `summary_email` is used by the cron script below.

**Weekly e-mail (optional, no external service):** `api/weekly_email.php` runs only from the
command line (web requests get 404) and sends a plain-text summary with PHP `mail()`.
cPanel → Cron Jobs → e.g. Sundays 18:00:

```sh
php -q /home/<cpanel-user>/public_html/nevaib/api/weekly_email.php
```

Try it first with `--dry-run` (prints, sends nothing) if you have any CLI access, or schedule one
run a few minutes ahead and check the inbox (and spam folder). Use a `from` address on the
hosting domain (e.g. `nevaib@rametric.com`) so SPF passes. If the cron's `php` is a different
version than the web one, use the path cPanel shows (e.g. `/usr/local/bin/php`).

# Deploying the practice app to rametric.com/nevaib

**STATUS 2026-11-15: DEPLOYED AND LIVE** — `deploy/nevaib/` uploaded via SFTP, verified
over HTTPS (pages 200, API live, TLS valid for rametric.com). Setup key blanked on the
host after account creation. The steps below remain the re-deployment procedure for
content updates.

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
- `~/nevaib-data/login-fails.json` — brute-force guard (auto-clears on success).

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

# Deploying the practice app to rametric.com/nevaib

Target: Namecheap shared hosting (no shell). The deployable folder contains only
original content — the copyrighted PDF library is **not** part of it and must
never be uploaded.

## Verified live 2026-11-15

`https://rametric.com/nevaib/` serves the app; api.php auth + cross-device
state sync verified end-to-end (login 200, wrong password 401, setup locked).
First deployment was done as: zip → cPanel extract → curl setup → blank key.
Ongoing updates use the push script below.

## One-time setup (already done for this site)

1. Build the deployable folder:
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
- `~/nevaib-data/state/<user>.json` — each user's full app state.
- `~/nevaib-data/login-fails.json` — brute-force guard (auto-clears on success).
- Back these up occasionally (cPanel file manager → download the `nevaib-data`
  folder); the practice app has no other server-side state.

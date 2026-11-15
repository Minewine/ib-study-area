# Deploying the practice app to rametic.com/nevaib

Target: Namecheap shared hosting (no shell). The deployable folder contains only
original content — the copyrighted PDF library is **not** part of it and must
never be uploaded.

## One-time setup

1. Build the deployable folder:
   ```sh
   python3 -I tools/build_deploy.py
   ```
   → produces `deploy/nevaib/` (pages + engines + original banks/decks + api.php).
2. Set a setup key: edit `deploy/nevaib/api/api.php`, put a long random string in
   `$SETUP_KEY` (any password manager's generator). This enables one-time account creation.
3. Upload the whole `nevaib/` folder into `public_html/` via cPanel file manager or SFTP
   (the marketing site's `deploy.sh`/rsync flow also works for this folder).
4. Create the accounts (from any terminal, against the live host):
   ```sh
   curl -X POST "https://rametic.com/nevaib/api/api.php?action=setup" \
        -H "Content-Type: application/json" \
        -d '{"setup_key":"<the key>","username":"<her-username>","password":"<a-good-password>"}'
   ```
   Repeat per account. Then **blank `$SETUP_KEY` in the uploaded api.php** (cPanel editor)
   and confirm account creation now returns 403.
5. Verify: open `https://rametic.com/nevaib/`, log in, run a session, confirm
   `~/nevaib-data/state/<user>.json` appears (cPanel file manager, outside public_html).

## HTTPS

Verified live (the domain serves 200 on https). The API sets the `Secure` cookie flag
automatically when served over HTTPS. Do not share password logins over plain HTTP.

## Content updates

```sh
python3 -I tools/build_deploy.py     # rebuilds deploy/nevaib from the repo
# upload the changed files (or the whole nevaib/ folder) via cPanel/SFTP
```

The engines carry a version query (`?v=N`) — bump it in the app pages when you change
an engine file, so phones pick up the new copy instead of a cached one.

## What is intentionally NOT deployed

- `library/official/`, `library/school/`, `library/notes/`, `library/papers/` — IB/publisher
  copyrighted material stays local-only, forever.
- `source-archives/`, `tools/`, the study-site pages (hubs reference those PDFs and stay
  local by design).

## Per-user data on the host

- `~/nevaib-data/users.json` — password hashes (never plaintext).
- `~/nevaib-data/state/<user>.json` — each user's full app state.
- `~/nevaib-data/login-fails.json` — brute-force guard (auto-clears on success).
- Back these up occasionally (cPanel file manager → download the folder).

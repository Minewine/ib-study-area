# Getting the study area onto her devices

Everything in this folder except `docs/` (your ZIP archive storage) and `tools/`
(the site generator) **is** the deployable site — plain static files, no build step.

## Option A — use it at home (LAN)

```bash
./dev.sh start --lan
```

This binds 0.0.0.0 and serves only the freshly built `deploy/nevaib` copy (never the working tree, which
contains `.git` and `deploy/.ftp-credentials`). Find the machine's IP (`hostname -I`), then on any phone/laptop
on the same Wi-Fi: `http://<that-ip>:8018`. Home Wi-Fi only — plain HTTP, don't port-forward it.

## Option B — host it on the personal website (the durable way)

1. **Ship exactly the site files** (not `docs/`, not `tools/`):
   ```bash
   rsync -av --exclude docs --exclude tools \
     ~/Projects/ibsystem/ user@yourhost:/path/on/server/study/
   ```
   Or zip the same set and upload via your hosting panel.

2. **Keep it private — this matters here.** The `library/` folder contains IB-copyrighted
   material (specimens, briefs, booklets). Before going live, put basic auth in front of
   the whole `/study/` path (nginx example):
   ```nginx
   location /study/ {
       auth_basic "Family";
       auth_basic_user_file /etc/nginx/.htpasswd;   # htpasswd -c /etc/nginx/.htpasswd family
       # optional extra: make the URL path unguessable too
   }
   ```
   Never host the library unauthenticated and never list it publicly — that turns private
   family use into redistribution.

3. **Updates**: edit pages (or re-run `tools/build_site.py` for the ten generated hubs),
   then re-rsync. `quiz.html`, `plan.html`, `deadlines.html`, `sixth-subject.html` and
   anything in `library/questions/` are hand-maintained files — the generator won't overwrite them.

## Notes on behaviour

- **Progress (checklists, quiz log, missed questions, flashcard boxes, "this week") lives in the
  browser's localStorage** and syncs across devices through the login (`auth.js` → `api.php`);
  logged out it stays on that device and syncs at the next login. The server keeps the last 30
  versions per user (`state/history/`), and the Cards page has a full backup / restore.

## Deploying the data-integrity release (store.js, sync v2, api.php revisions)

1. `./dev.sh test` and `./dev.sh deploy` (dry run) — check the file list.
2. **Upload `api/api.php` first** (or in the same run — `push_deploy.py` uploads it with the rest). The
   new api.php accepts both old clients (no `base_rev`) and new ones, so it is safe on its own; new
   assets against the *old* api.php also work (legacy fallback: fetch-merge, full payload), but the old
   api.php replaces the whole file and keeps no history.
3. Then the assets and pages (`store.js`, `backup.js`, new `?v=` numbers): `./dev.sh deploy --confirm`.
4. Existing `~/nevaib-data/state/<user>.json` files need **no migration**: files without `rev` read as
   revision 0; the first save writes `rev: 1` and copies the old file to `state/history/<user>/`. The
   `history/` folder is created on demand (same permissions as `state/`).
5. Before deploying, take a host backup with the current recipe (server/deploy-notes.md); afterwards
   `https://rametric.com/nevaib/api/api.php?action=export` (logged in) downloads the stored state.
6. Each browser runs its first sync after the upgrade in "first sync" mode (union of local + server), so
   nothing is dropped; a card deleted on one device may reappear once on a device that still had it.
- PDFs open in new tabs from every page.
- The site works offline from disk too — `index.html` opens fine via `file://`.

## Adding content later

- **Papers/markschemes from school** → `library/papers/<subject>/`, then link them on
  `practice.html`.
- **Quiz banks** → JSON in `library/questions/`, register in `assets/quiz-engine.js`.
- **Deadlines** → edit the `DEADLINES` array in `assets/deadlines.js`.

# Getting the study area onto her devices

Everything in this folder except `docs/` (your ZIP archive storage) and `tools/`
(the site generator) **is** the deployable site — plain static files, no build step.

## Option A — use it at home tonight (LAN, 30 seconds)

```bash
python3 -m http.server 8017 --bind 0.0.0.0 --directory ~/Projects/ibsystem
```

Find the machine's IP (`hostname -I`), then on any phone/laptop on the same Wi-Fi:
`http://<that-ip>:8017`. Home Wi-Fi only — this serves plain HTTP, so don't port-forward it.

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
  logged out it stays on that device.
- PDFs open in new tabs from every page.
- The site works offline from disk too — `index.html` opens fine via `file://`.

## Adding content later

- **Papers/markschemes from school** → `library/papers/<subject>/`, then link them on
  `practice.html`.
- **Quiz banks** → JSON in `library/questions/`, register in `assets/quiz-engine.js`.
- **Deadlines** → edit the `DEADLINES` array in `assets/deadlines.js`.

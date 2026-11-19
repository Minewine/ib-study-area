/* NevaIB shared storage layer — window.NB.store (+ NB.merge).
   Load FIRST on every page (before app.js, auth.js and the engines).

   - get(k, d): JSON value or d. A value that fails to parse is moved to
     "nb-corrupt:<k>" (raw text kept, never discarded) and a banner is shown.
   - set(k, v, {silent}): writes JSON; a no-op when the value is unchanged.
     Quota errors are reported in a visible banner and set() returns false.
     Non-silent writes to synced keys are marked in "nb-dirty" ({key: ms}) so
     auth.js knows what this device changed since its last successful sync —
     the marker lives in localStorage, so it survives reloads, offline use and
     closing the tab.
   - Schema: "nb-schema" holds the data-shape version; MIGRATIONS run in order
     on load (each one snapshots the keys it touches first).
   - snapshot(reason, keys): ring of BACKUP_KEEP local safety copies
     ("nb-backup:<ms>") taken before anything replaces local data.
   - Per-user scope: every account on a device used to share one flat
     namespace, so a second login could seed an empty account with the first
     user's data. While a user is active, the raw layer stores every
     non-reserved key as "<user>:<k>" (see the scope section below); callers
     keep speaking logical keys. setScope(user)/scope() manage the switch.
   - NB.merge: the per-record merge rules shared by sync (auth.js) and
     backup restore (backup.js). */
(function () {
  "use strict";
  const NB = window.NB = window.NB || {};
  // NB.escapeHtml: the one escaper for any string built into innerHTML — text AND
  // attribute contexts (escapes & < > " '). Content (questions, cards, notes) is plain
  // text by design, so everything content- or user-derived goes through it.
  if (!NB.escapeHtml) {
    NB.escapeHtml = function (s) {
      return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    };
  }
  if (NB.store) return;

  const SCHEMA_KEY = "nb-schema";
  const SCHEMA_VERSION = 1;
  const DIRTY_KEY = "nb-dirty";
  const CORRUPT_PREFIX = "nb-corrupt:";
  const BACKUP_PREFIX = "nb-backup:";
  const BACKUP_KEEP = 3;

  // Keys mirrored to the server by auth.js ("site-state" is assembled from the
  // chk:* / week:* rows, which are tracked as rows — see isSiteRow).
  const SYNCED_KEYS = [
    "q-userbanks", "fc-userdecks", "fc-state", "fc-user",
    "fc-deleted", "fc-edits", "quizlog", "q-errors",
    "tok-objects", "ee-ideas", "io-issues", "ia-debriefs",
    "res-bookmarks", "res-notes", "res-recent", "pp-scores", "cw-progress", "my-res",
    "profile" // per-user profile (a later phase of the multi-user upgrade writes it)
  ];
  // never synced, never in backups: credentials, sync bookkeeping, caches, safety copies
  const LOCAL_ONLY = ["nb-token", "nb-api", DIRTY_KEY, "nb-sync", SCHEMA_KEY, "fc-seedids", "ai-pref",
    "nb-active-user", "nb-scoped-v2", "nb-scoped-pending"];
  const LOCAL_ONLY_PREFIXES = [CORRUPT_PREFIX, BACKUP_PREFIX];

  const isSiteRow = (k) => typeof k === "string" && (k.indexOf("chk:") === 0 || /^week:\d+$/.test(k));
  const isSynced = (k) => SYNCED_KEYS.indexOf(k) >= 0 || isSiteRow(k);
  const isLocalOnly = (k) => LOCAL_ONLY.indexOf(k) >= 0 || LOCAL_ONLY_PREFIXES.some(p => String(k).indexOf(p) === 0);

  let ls = null;
  try { ls = window.localStorage; } catch (e) { ls = null; }

  // ── visible messages ────────────────────────────────────────────────────
  const pending = [];
  function banner(msg, kind) {
    try { console.warn("[NB.store] " + msg); } catch (e) {}
    if (typeof document === "undefined" || !document.body) {
      pending.push([msg, kind]);
      if (pending.length === 1 && typeof document !== "undefined" && document.addEventListener) {
        document.addEventListener("DOMContentLoaded", () => { pending.splice(0).forEach(p => banner(p[0], p[1])); });
      }
      return;
    }
    let el = document.getElementById("nb-banner");
    if (!el) {
      el = document.createElement("div");
      el.id = "nb-banner";
      el.setAttribute("role", "alert");
      el.style.cssText = "position:sticky;top:0;z-index:9999;padding:.6rem .9rem;font:14px/1.4 system-ui,sans-serif;" +
        "background:#fdecea;color:#611a15;border-bottom:2px solid #f5c2c0";
      document.body.insertBefore(el, document.body.firstChild);
    }
    if (kind === "info") { el.style.background = "#e8f4fd"; el.style.color = "#0b3c5d"; el.style.borderBottomColor = "#b6dcf5"; }
    const line = document.createElement("div");
    line.textContent = msg;
    const x = document.createElement("button");
    x.type = "button"; x.textContent = "\u00d7"; x.setAttribute("aria-label", "dismiss");
    x.style.cssText = "margin-left:.6rem;border:0;background:none;font-size:1.1em;cursor:pointer;color:inherit";
    x.addEventListener("click", () => { line.remove(); if (!el.childElementCount) el.remove(); });
    line.appendChild(x);
    el.appendChild(line);
  }

  const isQuota = (e) => e && (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED" || e.code === 22 || e.code === 1014);

  // ── per-user scope layer ────────────────────────────────────────────────
  // One flat namespace shared by every account on a device meant a second
  // login could seed an empty account with the first user's data (auth.js
  // marks all local synced keys dirty on an empty account) and per-device
  // dirty markers pushed one user's unsynced work into another's account.
  // Fix, at the RAW layer: while a user is active, every non-reserved logical
  // key k is physically stored as "<user>:<k>". Bookkeeping travels through
  // the same translation, so nb-dirty, nb-backup:* and nb-corrupt:* become
  // per-user automatically and everything above (get/set, dirty, snapshots,
  // NB.merge, auth.js) keeps speaking logical keys unchanged. scopeUser ===
  // null is the "legacy view": plain physical keys, exactly the pre-scope
  // behaviour, so a device that has never logged in still sees its data.
  const ACTIVE_KEY = "nb-active-user"; // last active scope — kept on logout ("data stays on this device")
  const SCOPED_KEY = "nb-scoped-v2";   // one-time marker: the legacy flat namespace has been adopted
  const PENDING_KEY = "nb-scoped-pending"; // adoption postponed: pins the flat data's rightful owner across retries
  // never scoped, never moved by the adoption: credentials + global sync/schema bookkeeping
  const RESERVED_KEYS = ["nb-token", "nb-api", SCHEMA_KEY, "nb-sync", ACTIVE_KEY, SCOPED_KEY, PENDING_KEY];
  // lowercase only, like the server: two spellings of one account must never
  // become two scopes (the data would silently split)
  const USERNAME_RE = /^[a-z0-9._-]{1,30}$/; // server usernames are ^[a-z0-9._-]{2,30}$
  let scopeUser = null;
  function phys(k) { return scopeUser && RESERVED_KEYS.indexOf(k) < 0 ? scopeUser + ":" + k : k; }
  scopeUser = getRaw(ACTIVE_KEY) || null; // raw read: at load time the translation is still identity

  // ── raw access (logical key in, physical key out via phys) ─────────────
  function getRaw(k) { try { return ls ? ls.getItem(phys(k)) : null; } catch (e) { return null; } }
  function setRaw(k, s) {
    if (!ls) return false;
    try { ls.setItem(phys(k), s); return true; }
    catch (e) {
      if (isQuota(e)) banner("Storage is full \u2014 a change could not be saved (" + k + "). Download a backup on the Cards page, then remove old uploaded banks or decks.");
      else banner("Could not save " + k + ": " + (e && e.message));
      return false;
    }
  }
  function remove(k) { try { if (ls) ls.removeItem(phys(k)); } catch (e) {} }
  // Scoped: only this user's physical keys, stripped back to logical names so
  // progressKeys, the snapshot ring and auth.js rowKeys work unchanged. Legacy
  // view: unscoped keys, minus the reserved globals (bookkeeping, not data).
  function keys(prefix) {
    const out = [];
    if (!ls) return out;
    const pfx = scopeUser ? scopeUser + ":" : "";
    for (let i = 0; i < ls.length; i++) {
      let k = ls.key(i);
      if (k === null) continue;
      if (pfx) {
        if (k.indexOf(pfx) !== 0) continue;
        k = k.slice(pfx.length); // logical name again
        if (RESERVED_KEYS.indexOf(k) >= 0) continue; // impossible via phys; belt and braces
      } else if (RESERVED_KEYS.indexOf(k) >= 0) continue;
      if (!prefix || k.indexOf(prefix) === 0) out.push(k);
    }
    return out;
  }

  // ── switching accounts on this device ───────────────────────────────────
  /* setScope(user): make <user> the active scope. The first call after this
     feature ships (nb-scoped-v2 unset) MOVES the legacy flat data into the
     scope of the account it belongs to: the one this device last synced with
     (raw "nb-sync" — a reserved global), else the user logging in now. Order
     matters: a safety snapshot of every legacy raw value FIRST, byte-for-byte,
     into the target's backup ring; if that copy cannot be saved (quota) nothing
     is moved and the marker stays unset so the next setScope retries — the same
     "never touch data without a safety copy" rule as reconcile() and migrate().
     The move writes each scoped copy before dropping its legacy key, so even a
     mid-move quota error leaves both copies on disk; a key that still fails
     stays put, the marker remains unset, and the target is pinned (nb-scoped-
     pending) so a later setScope — even by another user — finishes the same
     move. The scope switch happens regardless: an empty scope can never upload
     another user's data. */
  function setScope(user) {
    if (typeof user !== "string" || !USERNAME_RE.test(user)) {
      banner("Could not switch storage to \"" + user + "\": not a valid username.");
      return false;
    }
    if (!getRaw(SCOPED_KEY)) adoptLegacy(user); // getRaw is fine here: the marker is a reserved global
    scopeUser = user;
    setRaw(ACTIVE_KEY, user); // raw, global — survives reloads, kept on logout
    return true;
  }
  function scope() { return scopeUser; }

  // One-time legacy adoption. Runs entirely on direct `ls` access, bypassing
  // phys, so it sees the pre-migration namespace no matter which scope is
  // active. The target is pinned in "nb-scoped-pending" on the first attempt,
  // so a postponed attempt retries into the SAME account even if a different
  // user logs in next. A partially completed attempt (quota mid-move) leaves
  // the marker unset and some keys flat; the enumeration below recognises keys
  // that already belong to a scope and leaves them alone, so the retry only
  // moves what is genuinely still legacy.
  function adoptLegacy(user) {
    if (!ls) { setRaw(SCOPED_KEY, "1"); return; }
    // target: pinned from the first attempt, else the account this device last
    // synced with (raw "nb-sync" — a reserved global), else the user logging in now
    let target = null;
    try { target = ls.getItem(PENDING_KEY); } catch (e) {}
    if (!target || !USERNAME_RE.test(target)) {
      target = user;
      try {
        const m = JSON.parse(ls.getItem("nb-sync"));
        if (m && typeof m.user === "string" && USERNAME_RE.test(m.user)) target = m.user;
      } catch (e) {}
      try { ls.setItem(PENDING_KEY, target); } catch (e) {} // pin BEFORE anything moves
    }
    // every scope this device may already hold keys under: the pinned target,
    // the last active user, the last synced account, and the user logging in.
    // A legacy flat key can never collide with these except if an account were
    // literally named "chk" (legacy checklist rows are the only flat keys that
    // contain a colon) — acceptable, and skipping beats double-prefixing.
    const scopes = {};
    [user, target].forEach(u => { if (u && USERNAME_RE.test(u)) scopes[u] = true; });
    try {
      const m = JSON.parse(ls.getItem("nb-sync"));
      if (m && typeof m.user === "string" && USERNAME_RE.test(m.user)) scopes[m.user] = true;
    } catch (e) {}
    try {
      const active = ls.getItem(ACTIVE_KEY);
      if (active && USERNAME_RE.test(active)) scopes[active] = true;
    } catch (e) {}
    const legacy = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (!k || RESERVED_KEYS.indexOf(k) >= 0) continue;
      const c = k.indexOf(":");
      if (c > 0 && scopes[k.slice(0, c)]) continue; // an existing scope's key, not legacy
      legacy.push(k);
    }
    if (!legacy.length) { setRaw(SCOPED_KEY, "1"); try { ls.removeItem(PENDING_KEY); } catch (e) {} return; }
    const data = {};
    legacy.forEach(k => { data[k] = ls.getItem(k); });
    let at = Date.now();
    while (ls.getItem(target + ":" + BACKUP_PREFIX + at) !== null) at++;
    let copied = false;
    try {
      ls.setItem(target + ":" + BACKUP_PREFIX + at,
        JSON.stringify({ reason: "before per-user storage migration", at: new Date(at).toISOString(), schema: SCHEMA_VERSION, keys: data }));
      copied = true;
    } catch (e) { copied = false; }
    if (!copied) {
      banner("Storage is full \u2014 a safety copy could not be saved, so the move to per-user storage was postponed and nothing was changed. Free up space (download a backup on the Cards page), then reload and log in again.");
      return; // marker unset → retried on the next setScope, same pinned target
    }
    // move: scoped copy written first, then the legacy key dropped. A key that
    // still cannot be copied (quota mid-move) stays in the flat namespace and
    // KEEPS the marker unset — marking completion here would orphan it: visible
    // in no scope, reachable by nothing. The next setScope re-enumerates the
    // leftovers and finishes the move into the pinned target.
    let failed = false;
    legacy.forEach(k => {
      try { ls.setItem(target + ":" + k, data[k]); ls.removeItem(k); }
      catch (e) { failed = true; }
    });
    if (failed) {
      banner("Storage is full \u2014 the move to per-user storage is incomplete. Nothing was lost: every remaining item is still in place and covered by the safety copy, and the next login finishes the move. Free up space (download a backup on the Cards page).");
      return;
    }
    try { ls.removeItem(PENDING_KEY); } catch (e) {}
    setRaw(SCOPED_KEY, "1");
  }


  // ── corrupt values are quarantined, not discarded ───────────────────────
  function quarantine(k, raw) {
    const qk = CORRUPT_PREFIX + k;
    let list = [];
    try { list = JSON.parse(getRaw(qk)) || []; } catch (e) { list = []; }
    if (!Array.isArray(list)) list = [];
    if (!list.some(x => x && x.raw === raw)) list.push({ key: k, at: new Date().toISOString(), raw: raw });
    if (setRaw(qk, JSON.stringify(list.slice(-5)))) {
      remove(k); // only once the raw text is safely parked
      banner("A saved value (" + k + ") was unreadable and has been set aside as \"" + qk + "\" \u2014 nothing was deleted. A backup download includes it.");
    } else {
      banner("A saved value (" + k + ") is unreadable and could not be set aside; it was left untouched.");
    }
  }

  // ── JSON get/set ────────────────────────────────────────────────────────
  const listeners = [];
  function get(k, d) {
    const raw = getRaw(k);
    if (raw === null || raw === undefined) return d;
    try { const v = JSON.parse(raw); return v === null ? d : v; }
    catch (e) { quarantine(k, raw); return d; }
  }
  function set(k, v, opts) {
    const s = JSON.stringify(v === undefined ? null : v);
    if (getRaw(k) === s) return true; // unchanged → no write, no dirty mark
    if (!setRaw(k, s)) return false;
    const silent = !!(opts && opts.silent);
    if (!silent && isSynced(k)) markDirty(k);
    listeners.slice().forEach(fn => { try { fn(k, v, { silent: silent }); } catch (e) {} });
    return true;
  }
  function onChange(fn) { listeners.push(fn); }

  // ── dirty markers (persisted) ───────────────────────────────────────────
  function dirty() {
    let d = null;
    try { d = JSON.parse(getRaw(DIRTY_KEY)); } catch (e) { d = null; }
    return d && typeof d === "object" && !Array.isArray(d) ? d : {};
  }
  function markDirty(k) { const d = dirty(); d[k] = Date.now(); setRaw(DIRTY_KEY, JSON.stringify(d)); }
  // clear markers set at or before `upTo` (writes made while a push was in flight stay dirty)
  function clearDirty(list, upTo) {
    const d = dirty();
    let changed = false;
    (list || Object.keys(d)).forEach(k => { if (d[k] !== undefined && (upTo === undefined || d[k] <= upTo)) { delete d[k]; changed = true; } });
    if (changed) setRaw(DIRTY_KEY, JSON.stringify(d));
  }

  // ── local safety snapshots (ring) ───────────────────────────────────────
  function progressKeys() { return keys().filter(k => !isLocalOnly(k)); }
  function snapshots() {
    return keys(BACKUP_PREFIX).sort().reverse().map(id => {
      let s = null; try { s = JSON.parse(getRaw(id)); } catch (e) { s = null; }
      return s ? { id: id, reason: s.reason, at: s.at, keys: Object.keys(s.keys || {}) } : null;
    }).filter(Boolean);
  }
  function getSnapshot(id) { try { return JSON.parse(getRaw(id)); } catch (e) { return null; } }
  function snapshot(reason, list) {
    const ks = (list || progressKeys()).filter(k => !isLocalOnly(k));
    const data = {};
    ks.forEach(k => { data[k] = getRaw(k); });
    let at = Date.now();
    while (getRaw(BACKUP_PREFIX + at) !== null) at++;
    const rec = JSON.stringify({ reason: reason, at: new Date(at).toISOString(), schema: SCHEMA_VERSION, keys: data });
    const all = keys(BACKUP_PREFIX).sort();
    // make room first: drop the oldest beyond KEEP-1, then retry once more on quota
    while (all.length > BACKUP_KEEP - 1) remove(all.shift());
    let okSave = false;
    const snapKey = phys(BACKUP_PREFIX + at); // direct ls write (quota retry below) must stay scoped
    try { if (ls) { ls.setItem(snapKey, rec); okSave = true; } } catch (e) {
      if (all.length) { remove(all.shift()); try { ls.setItem(snapKey, rec); okSave = true; } catch (e2) { okSave = false; } }
    }
    return okSave ? BACKUP_PREFIX + at : null; // logical id — getSnapshot translates it back
  }

  // ── schema version + ordered migrations ─────────────────────────────────
  // Each migration: { to: N, touches: [keys], run(store) }. Runs once, in order,
  // after a snapshot of the keys it touches; a failure stops the chain (data is
  // left as it was and the version is not bumped) and shows a banner.
  // NOTE: this runs on the ACTIVE scope only, and "nb-schema" is a reserved
  // global — one version number for the whole device. Any future migration that
  // transforms data must be scope-aware (it will only see the active user's
  // keys, and other scopes need the same change on their next load).
  const MIGRATIONS = [
    // v1 = the shapes documented in docs/DEVELOPMENT.md at the time versioning was
    // introduced (fc-state {box,due,seen,t?}, q-errors [{key,…,ts?}], …). Nothing to transform.
    { to: 1, touches: [], run: function () {} }
  ];
  function schemaVersion() { const v = parseInt(getRaw(SCHEMA_KEY) || "0", 10); return isNaN(v) ? 0 : v; }
  function migrate(list) {
    const steps = list || MIGRATIONS;
    let cur = schemaVersion();
    if (cur > SCHEMA_VERSION && !list) {
      banner("This browser holds data from a newer version of the app \u2014 reload to get the latest version before studying.");
      return cur;
    }
    for (const m of steps) {
      if (m.to <= cur) continue;
      if (m.touches && m.touches.length && !snapshot("before migration to v" + m.to, m.touches)) {
        banner("A data update was postponed because a safety copy could not be saved (storage full?).");
        return cur;
      }
      try { m.run(api); }
      catch (e) { banner("A data update (v" + m.to + ") failed and was skipped: " + (e && e.message)); return cur; }
      cur = m.to;
      setRaw(SCHEMA_KEY, String(cur));
    }
    return cur;
  }

  const api = {
    SCHEMA_VERSION, SYNCED_KEYS, BACKUP_PREFIX, CORRUPT_PREFIX,
    get, set, remove, keys, getRaw, setRaw, onChange,
    isSynced, isSiteRow, isLocalOnly, progressKeys,
    dirty, markDirty, clearDirty,
    snapshot, snapshots, getSnapshot,
    schemaVersion, migrate, banner,
    setScope, scope
  };
  NB.store = api;

  // ── merge rules (shared by auth.js sync and backup.js restore) ──────────
  const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function newer(a, b, rank) { // true if a should win over b; tie → b
    const ra = rank(a), rb = rank(b);
    for (let i = 0; i < ra.length; i++) { if (ra[i] > rb[i]) return true; if (ra[i] < rb[i]) return false; }
    return false;
  }
  const fcRank = (s) => [s && s.t || 0, s && s.seen || 0, String(s && s.due || "")];
  const errRank = (e) => [e && e.ts || 0, String(e && (e.lastAttempt > e.lastMissed ? e.lastAttempt : e.lastMissed) || ""), e && e.attempts || 0];

  // Record-level mergers: merge(a, b) — on a tie b wins. Used for sync (a = local,
  // b = server) and restore (a = backup, b = local). Records are never dropped.
  const RECORDS = {
    // { cardId: {box, due, seen, t?} } — newest review wins per card
    "fc-state": function (a, b) {
      if (!isObj(a)) return b; if (!isObj(b)) return a;
      const out = Object.assign({}, b);
      Object.keys(a).forEach(id => { if (!(id in out) || newer(a[id], out[id], fcRank)) out[id] = a[id]; });
      return out;
    },
    // [ {key, …, ts?} ] — union by key, newest wins; a record renamed by the quiz's
    // key migration doesn't come back under its legacy key from an older copy
    "q-errors": function (a, b) {
      if (!Array.isArray(a)) return b; if (!Array.isArray(b)) return a;
      const byKey = new Map();
      b.forEach(e => { if (e && e.key) byKey.set(e.key, e); });
      a.forEach(e => {
        if (!e || !e.key) return;
        const cur = byKey.get(e.key);
        if (!cur || newer(e, cur, errRank)) byKey.set(e.key, e);
      });
      const out = Array.from(byKey.values());
      const renamed = new Set(out.map(e => e.legacyKey).filter(Boolean));
      return out.filter(e => !(renamed.has(e.key) && String(e.key).indexOf("#") < 0));
    },
    // [ {date, label, got, max, pct, ts?} ] newest first, capped at 20 (as saveLog does)
    "quizlog": function (a, b) {
      if (!Array.isArray(a)) return b; if (!Array.isArray(b)) return a;
      const seen = new Set(), out = [];
      b.concat(a).forEach(e => { const id = JSON.stringify(e); if (!seen.has(id)) { seen.add(id); out.push(e); } });
      const at = (e) => [String(e && e.date || ""), e && e.ts || 0];
      out.sort((x, y) => { const p = at(x), q = at(y); return p[0] < q[0] ? 1 : p[0] > q[0] ? -1 : q[1] - p[1]; });
      return out.slice(0, Math.max(20, a.length, b.length));
    },
    // coursework planner {checks: {id: {c, t}}, notes: {id: {s, t}}, dates: {id: {d, t}}}
    // — per record, the newest edit wins (an untick is a record with c:false, so it
    // survives a merge); records and unknown sections are never dropped
    "cw-progress": function (a, b) {
      if (!isObj(a)) return b; if (!isObj(b)) return a;
      const out = Object.assign({}, b, a);
      const t = (r) => [r && r.t || 0];
      new Set(Object.keys(a).concat(Object.keys(b))).forEach(sec => {
        const x = a[sec], y = b[sec];
        if (!isObj(x) || !isObj(y)) { out[sec] = isObj(x) ? x : isObj(y) ? y : (x !== undefined ? x : y); return; }
        const m = Object.assign({}, y);
        Object.keys(x).forEach(id => { if (!(id in m) || newer(x[id], m[id], t)) m[id] = x[id]; });
        out[sec] = m;
      });
      return out;
    },
    // past-paper scores [ {id, date, subject, paper, score, max, notes, ts} | {id, deleted, ts} ]:
    // union by id, newest ts wins (a deletion is a newer tombstone, so it isn't undone by an older copy)
    "pp-scores": function (a, b) {
      if (!Array.isArray(a)) return b; if (!Array.isArray(b)) return a;
      const byId = new Map();
      b.forEach(r => { if (r && r.id) byId.set(r.id, r); });
      a.forEach(r => {
        if (!r || !r.id) return;
        const cur = byId.get(r.id);
        if (!cur || (r.ts || 0) > (cur.ts || 0)) byId.set(r.id, r);
      });
      return Array.from(byId.values());
    },
    // "My resources" on topic notes {itemId: {note, label, url, t} | {note, deleted: true, t}}:
    // per item the newest t wins; a deletion is a newer tombstone, so an older copy can't revive it
    "my-res": function (a, b) {
      if (!isObj(a)) return b; if (!isObj(b)) return a;
      const out = Object.assign({}, b);
      Object.keys(a).forEach(id => { if (!(id in out) || newer(a[id], out[id], (r) => [r && r.t || 0])) out[id] = a[id]; });
      return out;
    }
  };

  // Union merges for blobs, used on a device's FIRST login and for backup restore
  // (never for routine sync, where deletions must win). `a` wins conflicts.
  const byField = (field) => function (a, b) {
    if (!Array.isArray(a)) return Array.isArray(b) ? b : a;
    if (!Array.isArray(b)) return a;
    const id = (x) => (x && typeof x === "object" && x[field] !== undefined) ? "f:" + x[field] : "j:" + JSON.stringify(x);
    const have = new Set(a.map(id));
    return a.concat(b.filter(x => !have.has(id(x))));
  };
  const setUnion = (cap) => function (a, b) {
    if (!Array.isArray(a)) return Array.isArray(b) ? b : a;
    if (!Array.isArray(b)) return a;
    const out = a.slice();
    b.forEach(x => { if (out.indexOf(x) < 0) out.push(x); });
    return cap ? out.slice(0, Math.max(cap, a.length)) : out;
  };
  function deepFill(a, b) { // keys missing in a are filled from b (recursively)
    if (!isObj(a)) return a === undefined || a === null ? b : a;
    if (!isObj(b)) return a;
    const out = Object.assign({}, a);
    Object.keys(b).forEach(k => { out[k] = (k in out) ? deepFill(out[k], b[k]) : b[k]; });
    return out;
  }
  const listItems = (a, b) => { // lists.js blobs: {items: [{t, done, …}]}
    if (!isObj(a) || !Array.isArray(a.items)) return isObj(b) ? b : a;
    if (!isObj(b) || !Array.isArray(b.items)) return a;
    return Object.assign({}, b, a, { items: byField("t")(a.items, b.items) });
  };
  const bankId = (x) => x && typeof x === "object" ? (x.subject || "") + "::" + (x.name || x.label || x.topic || JSON.stringify(x)) : JSON.stringify(x);
  const UNIONS = {
    "fc-user": byField("id"),
    "fc-deleted": setUnion(0),
    "res-bookmarks": setUnion(0),
    "res-recent": setUnion(20),
    "q-userbanks": function (a, b) { if (!Array.isArray(a) || !Array.isArray(b)) return Array.isArray(a) ? a : b; const have = new Set(a.map(bankId)); return a.concat(b.filter(x => !have.has(bankId(x)))); },
    "fc-userdecks": function (a, b) { return UNIONS["q-userbanks"](a, b); },
    "tok-objects": listItems, "ee-ideas": listItems, "io-issues": listItems,
    "fc-edits": deepFill, "res-notes": deepFill, "ia-debriefs": deepFill
  };
  const isDefaultRow = (k, v) => v === null || v === undefined ||
    (k.indexOf("chk:") === 0 && isObj(v) && !v.c && !v.r) || (/^week:/.test(k) && v === "");

  // union(k, a, b): combine two copies keeping everything; a wins conflicts
  function union(k, a, b) {
    if (a === null || a === undefined) return b;
    if (b === null || b === undefined) return a;
    if (RECORDS[k]) return RECORDS[k](a, b);
    if (UNIONS[k]) return UNIONS[k](a, b);
    if (isSiteRow(k)) return isDefaultRow(k, a) && !isDefaultRow(k, b) ? b : a;
    if (Array.isArray(a) && Array.isArray(b)) return byField("id")(a, b);
    if (isObj(a) && isObj(b)) return deepFill(a, b);
    return a;
  }

  NB.merge = { RECORDS, UNIONS, union, newer, same, isObj, isDefaultRow };

  migrate();
})();

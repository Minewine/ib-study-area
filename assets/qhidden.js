/* NevaIB question-level hide flag — window.NB.qhidden.
   A per-question "never serve this again" flag, stored in the synced "q-hidden"
   key as { "<bankId>#<itemId>": {hidden: true|false, t, reason?, label?} } and
   merged newest-t per entry (assets/store.js RECORDS). Written by quiz-engine.js
   ("Hide question…" button + the Quiz page's hidden-questions restore panel);
   read back by the quiz engine's session builder (bankItems), today.js's quiz
   pick and flashcards.js's rebuild (cards stamped with a qkey).

   - keyFor(bankId, id): the stable per-question key ("<bankId>#<itemId>") — the
     same shape the q-errors keys use (quiz-engine errKeyFor).
   - hiddenIds(map): Set of keys whose entry says hidden === true. Garbage entries
     (non-objects, non-boolean hidden) never hide anything.
   - filterItems(items, map): the items whose key is not hidden (pure — takes the
     map, so the node tests need no store). Never throws on null/garbage input:
     a non-array items list yields [], entries that can't be read pass through.

   Needs window (for NB) and nothing else — no store, no DOM. */
(function () {
  "use strict";
  const NB = window.NB = window.NB || {};
  if (NB.qhidden) return;

  const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

  const keyFor = (bankId, id) => String(bankId == null ? "" : bankId) + "#" + String(id == null ? "" : id);

  const hiddenIds = (map) => {
    const out = new Set();
    if (!isObj(map)) return out;
    Object.keys(map).forEach(k => { if (isObj(map[k]) && map[k].hidden === true) out.add(k); });
    return out;
  };

  const filterItems = (items, map) => {
    if (!Array.isArray(items)) return [];
    const hidden = hiddenIds(map);
    return items.filter(it => !it || !hidden.has(keyFor(it.bankId, it.id)));
  };

  NB.qhidden = { keyFor, hiddenIds, filterItems };
})();

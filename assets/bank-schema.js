/* NevaIB content-bank schema — window.NB.bankSchema.
   Shared validators + vocabulary for practice-question banks and flashcard
   decks, used by the Upload page (author.html) on upload and on every item edit.
   The same rules run in tools/validate_content.py over library/ content, so a
   bank the Upload page accepts cannot drift from what a permanent library file
   must look like.

   - DIFFICULTIES: the selectable per-item difficulty values. Absent difficulty
     is "unrated" — every pre-feature item stays valid (zero migration).
   - DIFFICULTY_ORDER: the ordinal scale the quiz picker's difficulty filter
     uses; unrated sits below easy.
   - validateQuizBank(bank) / validateDeck(deck, existingIds): return null when
     valid, else a short human-readable error string (exact Upload-page wording).
   - nextSetName(existingNames, topicKey): the next free "Practice set N" for a
     topic (pure; see the comment on the function).
   - nextSetOrder(banks, subject, topic): the next free setOrder for a topic
     (pure; see the comment on the function).

   Needs window (for NB) and nothing else — no store, no DOM. */
(function () {
  "use strict";
  const NB = window.NB = window.NB || {};
  if (NB.bankSchema) return;

  const DIFFICULTIES = ["easy", "standard", "hard"];
  const DIFFICULTY_ORDER = ["unrated", "easy", "standard", "hard"];

  // Optional practice-set metadata: absent fields stay valid (old banks never
  // carried them), present fields must have the right shape. Mirrors
  // tools/validate_content.py, which enforces the same rules over library/.
  function validateSetMeta(d) {
    if (d.set !== undefined && (typeof d.set !== "string" || !d.set.trim())) return "'set' must be a non-empty string";
    if (d.setOrder !== undefined && !Number.isInteger(d.setOrder)) return "'setOrder' must be an integer";
    if (d.codes !== undefined && (!Array.isArray(d.codes) || !d.codes.every(c => typeof c === "string"))) return "'codes' must be an array of strings";
    return null;
  }

  function validateQuizBank(bank) {
    if (typeof bank.subject !== "string" || !bank.subject.trim()) return "missing 'subject' (e.g. chemistry-hl)";
    const metaErr = validateSetMeta(bank);
    if (metaErr) return metaErr;
    if (!Array.isArray(bank.items) || bank.items.length === 0) return "missing or empty 'items' array";
    const ids = new Set();
    for (const it of bank.items) {
      if (!it.id) return "an item is missing 'id'";
      if (ids.has(it.id)) return "duplicate id '" + it.id + "' (ids must be unique within the file)";
      ids.add(it.id);
      if (!it.stem) return "item '" + it.id + "': missing 'stem'";
      if (it.format === "mcq") {
        if (!Array.isArray(it.choices) || it.choices.length < 2) return "item '" + it.id + "': needs at least 2 choices";
        if (!Number.isInteger(it.answer) || it.answer < 0 || it.answer >= it.choices.length) return "item '" + it.id + "': 'answer' must be the 0-based index of the correct choice";
      } else if (it.format === "written") {
        if (!it.marks || !Array.isArray(it.markscheme) || !it.markscheme.length) return "item '" + it.id + "': written items need 'marks' and a markscheme array";
      } else return "item '" + it.id + "': format must be 'mcq' or 'written'";
      if (it.difficulty !== undefined && DIFFICULTIES.indexOf(it.difficulty) < 0) {
        return "item '" + it.id + "': difficulty must be 'easy', 'standard' or 'hard'";
      }
    }
    return null;
  }

  function validateDeck(deck, existingIds) {
    if (typeof deck.subject !== "string" || !deck.subject.trim()) return "missing 'subject' (e.g. biology-hl)";
    const metaErr = validateSetMeta(deck);
    if (metaErr) return metaErr;
    if (typeof deck.topic !== "string" || !deck.topic.trim()) return "missing 'topic' (must match the quiz bank's topic key)";
    if (!Array.isArray(deck.cards) || deck.cards.length === 0) return "missing or empty 'cards' array";
    for (const c of deck.cards) {
      if (!c.id) return "a card is missing 'id'";
      if (existingIds.has(c.id)) return "card id '" + c.id + "' already exists in another deck — make ids globally unique (e.g. prefix them)";
      if (!c.front || !c.back) return "card '" + c.id + "': 'front' and 'back' are both required";
      if (c.type && c.type !== "qa" && c.type !== "term") return "card '" + c.id + "': type must be 'qa' or 'term'";
      existingIds.add(c.id);
    }
    return null;
  }

  /* The next free "Practice set N" for a topic. Numbering never goes backwards:
     N is the smallest free number at or above the lowest "Practice set N" already
     in use — gaps in the numbering are filled before a new number is appended,
     and a number below an existing set is never suggested (a topic holding
     "Practice set 2" gets 3, not the technically-free 1). When no numbered name
     exists yet the count starts at 1; other names only block their exact match.
     `topicKey` is carried for callers' messages/suggestions and unused here. */
  function nextSetName(existingNames, topicKey) {
    const names = (Array.isArray(existingNames) ? existingNames : []).map(n => String(n));
    const used = new Set(names);
    const nums = names.map(n => /^Practice set (\d+)$/.exec(n)).filter(Boolean).map(m => parseInt(m[1], 10));
    let n = nums.length ? Math.min.apply(null, nums) : 1;
    while (used.has("Practice set " + n)) n++;
    return "Practice set " + n;
  }

  /* The next free setOrder for a topic: one past the largest integer setOrder
     already stamped on a bank of the same subject AND effective topic (a bank
     without `topic` pools under "(none)", matching the upload-side effective-
     topic rule that stampSetMeta and setSuggestion apply). Uploads default
     their label to the topic label, so repeated uploads into one topic collide
     on display names — a per-topic order number is what keeps them in authored
     sequence (sets without an order sort last in the picker). Banks of other
     subjects/topics and absent/non-integer setOrder values are ignored;
     nothing here mutates `banks`. `topic` may be null/absent → the "(none)"
     bucket. */
  function nextSetOrder(banks, subject, topic) {
    const eff = (t) => t || "(none)";
    const max = (Array.isArray(banks) ? banks : [])
      .filter(b => b && b.subject === subject && eff(b.topic) === eff(topic) && Number.isInteger(b.setOrder))
      .reduce((m, b) => Math.max(m, b.setOrder), 0);
    return max + 1;
  }

  NB.bankSchema = { DIFFICULTIES, DIFFICULTY_ORDER, validateQuizBank, validateDeck, nextSetName, nextSetOrder };
})();

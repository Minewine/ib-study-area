/* NevaIB bank import staging — window.NB.bankImport. Needs window.NB only
   (bankSchema when present); no store, no DOM — the Upload page (author.html)
   owns the preview UI and storage, this file owns the staging rules so they can
   be unit-tested (tests/js/bank-import.test.js).

   The paste path on the Upload page no longer saves straight away: pasted JSON
   is staged here first, shown as a preview the student can edit (stem, choices,
   answer, markscheme, difficulty) or trim (remove items), and only "Import"
   writes the bank. The staged bank is plain in-memory data — a reload drops it,
   which is fine: she re-pastes.

   finalize() produces EXACTLY the stored-bank shape the file-upload path builds
   in author.html processContent (Object.assign(data, {id, name, uploaded}) +
   label/subjectLabel defaults), so staged imports and file uploads are
   indistinguishable to the quiz engine. */
(function () {
  "use strict";
  const NB = window.NB = window.NB || {};
  if (NB.bankImport) return;

  // above this, the preview renders summary rows instead of per-item editors —
  // a 20k-item pasted bank must not build 20k textareas
  const MAX_EDIT_ITEMS = 200;

  const validator = () => (NB.bankSchema && NB.bankSchema.validateQuizBank) || null;

  const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

  // Stable unique id stamped onto every newly stored bank ("ub-" + base36 time + "-" +
  // base36 random — the papers.js "pp-…" convention): the stored name is unique only per
  // device at import time, so two devices uploading the same topic would collide in the
  // sync union merge and share q-errors keys. finalize looks this up through NB.bankImport
  // (not the closure) so tests can stub it and keep comparing full record shapes.
  const newBankId = () => "ub-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);

  // "ai-<topic>.json", "-2"/"-3"… on collision with the stored banks' names
  function suggestName(data, existingNames) {
    const names = new Set(existingNames || []);
    const base = "ai-" + (slug(data && data.topic) || "practice-set");
    let name = base + ".json", n = 2;
    while (names.has(name)) name = base + "-" + (n++) + ".json";
    return name;
  }

  // The authoring prompt asks for raw JSON, but chatbots still often wrap the answer
  // in a Markdown fence — strip one optional ``` fence (with optional language tag)
  // before parsing, so a fenced paste doesn't fail before preview.
  const FENCE = /^\s*```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n?\s*```\s*$/;
  function parse(text) {
    const m = String(text || "").match(FENCE);
    try { return { data: JSON.parse(m ? m[1] : text) }; }
    catch (e) { return { error: "invalid JSON — " + e.message }; }
  }

  // stage(text, existingNames) → {ok, staged:{data, name}} | {error}
  // The AI is told to output the exact bank shape; anything that fails
  // bankSchema.validateQuizBank never reaches the preview.
  function stage(text, existingNames) {
    const p = parse(text);
    if (p.error) return { error: p.error };
    const data = p.data;
    if (!data || typeof data !== "object" || Array.isArray(data) || !Array.isArray(data.items))
      return { error: "no 'items' array found — is this a quiz bank? (flashcard decks go through the file upload)" };
    const v = validator();
    if (!v) return { error: "the page is stale — reload it so the bank validator (assets/bank-schema.js) loads, then try again" };
    const err = v(data);
    if (err) return { error: err };
    return { ok: true, staged: { data: data, name: suggestName(data, existingNames) } };
  }

  // re-run the shared validator over the staged bank (after every edit/remove)
  function validate(staged) {
    const v = validator();
    if (!v || !staged || !staged.data) return "the page is stale — reload it so the bank validator (assets/bank-schema.js) loads, then try again";
    return v(staged.data); // null when valid
  }

  // validate a candidate bank (data with `items` swapped in) without touching staged
  function validateCandidate(staged, items) {
    const v = validator();
    if (!v) return "the page is stale — reload it so the bank validator (assets/bank-schema.js) loads, then try again";
    return v(Object.assign({}, staged.data, { items: items })); // null when valid
  }

  // patch = {stem?, choices?, answer?, note?, marks?, markscheme?, tactic?, difficulty?, topic?}
  // Applied to a COPY of items[index]; the whole bank is re-validated and only a
  // valid result is committed, so a rejected edit leaves staged data unchanged.
  // For mcq, empty strings in `choices` are dropped and `answer` must land inside
  // the surviving choices — the same rules the item editor applies on save.
  function editItem(staged, index, patch) {
    if (!staged || !staged.data || !Array.isArray(staged.data.items)) return { error: "nothing staged" };
    const item = staged.data.items[index];
    if (!item) return { error: "no such item" };
    const p = patch || {};
    const cand = JSON.parse(JSON.stringify(item));
    if (p.stem !== undefined) cand.stem = String(p.stem).trim();
    if (p.topic !== undefined) { const t = String(p.topic).trim(); if (t) cand.topic = t; else delete cand.topic; }
    if (p.difficulty !== undefined) {
      if (NB.bankSchema && NB.bankSchema.DIFFICULTIES.indexOf(p.difficulty) >= 0) cand.difficulty = p.difficulty;
      else delete cand.difficulty;
    }
    if (cand.format === "mcq") {
      if (p.choices !== undefined) {
        const kept = (Array.isArray(p.choices) ? p.choices : []).map(c => String(c == null ? "" : c).trim()).filter(c => c !== "");
        cand.choices = kept;
      }
      if (p.answer !== undefined) {
        const a = parseInt(p.answer, 10);
        if (!isNaN(a)) cand.answer = a;
        else if (p.answer === "" || p.answer === null) delete cand.answer;
      }
      if (p.note !== undefined) { const n = String(p.note).trim(); if (n) cand.note = n; else delete cand.note; }
    } else if (cand.format === "written") {
      if (p.marks !== undefined) {
        const m = parseInt(p.marks, 10);
        if (!isNaN(m) && m >= 1) cand.marks = m; else delete cand.marks;
      }
      if (p.markscheme !== undefined) {
        const lines = String(p.markscheme).split("\n").map(l => l.trim()).filter(l => l !== "");
        if (lines.length) cand.markscheme = lines; else delete cand.markscheme;
      }
      if (p.tactic !== undefined) { const t = String(p.tactic).trim(); if (t) cand.tactic = t; else delete cand.tactic; }
    }
    const items = staged.data.items.slice();
    items[index] = cand;
    const err = validateCandidate(staged, items);
    if (err) return { error: err };
    staged.data.items[index] = cand;
    return { ok: true };
  }

  function removeItem(staged, index) {
    if (!staged || !staged.data || !Array.isArray(staged.data.items)) return { error: "nothing staged" };
    if (!staged.data.items[index]) return { error: "no such item" };
    const items = staged.data.items.slice();
    items.splice(index, 1);
    const err = validateCandidate(staged, items);
    if (err) return { error: err };
    staged.data.items.splice(index, 1);
    return { ok: true };
  }

  // → {ok, entry} | {error}. The entry mirrors author.html's processContent
  // storage shape exactly (id/name/uploaded/label/subjectLabel defaults included).
  function finalize(staged) {
    if (!staged || !staged.data) return { error: "nothing staged" };
    const err = validate(staged);
    if (err) return { error: err };
    const data = staged.data;
    const entry = Object.assign({}, data, { id: NB.bankImport.newBankId(), name: String(staged.name || "").trim() || suggestName(data, []), uploaded: new Date().toISOString().slice(0, 10) });
    if (!entry.label) entry.label = data.topicLabel || entry.name;
    if (!entry.subjectLabel) entry.subjectLabel = data.subject;
    return { ok: true, entry: entry };
  }

  NB.bankImport = { MAX_EDIT_ITEMS, stage, validate, editItem, removeItem, finalize, suggestName, newBankId };
})();

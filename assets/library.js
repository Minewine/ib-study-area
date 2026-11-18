/* Library browser (v1) — manifest-driven listing of every PDF in library/
   (notes · official · school · papers), plus per-resource tracking synced via
   auth.js (res-bookmarks / res-notes / res-recent are registered in auth.js
   SYNCED_KEYS; logged out = local only):
   - rows reuse the hub-row convention (.row[data-key="subject::path"] +
     checkbox/RAG) with the same chk:<key> localStorage schema as app.js.
     app.js binds rows once at load, before the manifest fetch resolves, so
     rows rendered here get identical wiring below — keep the two in step.
   - ★ toggles res-bookmarks (array of subject::path); the note button
     expands a textarea saving to res-notes ({subject::path: text}, debounced
     like the lists.js ia-debrief textareas); opening a PDF logs res-recent
     (array of subject::path, newest first, capped at 20).
   - #res-pins (dashboard) renders the pinned rows; #papers-list (practice)
     renders type=papers entries with the intake hint when none exist.
   - Filter state persists locally (lib-filters — device-local, not synced).
   Manifest labels/subjectLabels are pre-HTML-escaped by
   tools/build_library_manifest.py (pretty() mirrors build_site.py). */
(function () {
  "use strict";

  const MANIFEST_URL = "library/library-manifest.json";
  const FILTER_KEY = "lib-filters";
  const TYPE_ORDER = ["notes", "official", "school", "papers"];
  const TYPE_LABELS = { notes: "Notes", official: "Official", school: "School", papers: "Papers" };
  const RECENT_CAP = 20;

  /* Section display names, mirroring the section dicts in build_site.py so
     headings match the hub pages; unknown slugs fall back to pretty(). */
  const SECTION_LABELS = {
    "math-aa-sl": {
      "1-number-algebra": "1. Number & algebra",
      "2-functions": "2. Functions",
      "3-geometry-trigonometry": "3. Geometry & trigonometry",
      "4-statistics-probability": "4. Statistics & probability",
      "5-calculus": "5. Calculus",
      "": "Topics"
    },
    "biology-hl": {
      "unity-diversity": "Unity & diversity",
      "form-function": "Form & function",
      "interaction-interdependence": "Interaction & interdependence",
      "continuity-change": "Continuity & change",
      "tools": "Tools (skills)",
      "": "Topics"
    },
    "chemistry-hl": {
      "models-of-the-particulate-nature-of-matter": "Structure 1 — Particulate nature of matter",
      "models-of-bonding-structure": "Structure 2 — Models of bonding & structure",
      "classification-of-matter": "Structure 3 — Classification of matter",
      "what-drives-chemical-reactions": "Reactivity 1 — What drives chemical reactions?",
      "how-much-how-fast-how-far": "Reactivity 2 — How much, how fast & how far?",
      "what-are-the-mechanisms-of-chemical-change": "Reactivity 3 — Mechanisms of chemical change",
      "tools": "Tools (skills)",
      "": "Topics"
    }
  };

  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  // NB.store (assets/store.js) is the storage layer; the literal below is only a
  // fallback for a stale cached page that didn't load store.js.
  const store = (window.NB && window.NB.store) || {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
      try { if (window.Auth && window.Auth.queueSync) window.Auth.queueSync(); } catch (e) {}
    }
  };

  const state = { items: [], byKey: {}, failed: false };

  /* ---------- resource blobs (same synced-blob pattern as lists.js) ---------- */
  const bookmarks = () => { const v = store.get("res-bookmarks", null); return Array.isArray(v) ? v : []; };
  const notes = () => {
    const v = store.get("res-notes", null);
    return (v && typeof v === "object" && !Array.isArray(v)) ? v : {};
  };

  const noteTimers = {};
  const noteSaves = []; // flushed on pagehide / re-render — the debounce may not get to fire

  /* ---------- filters (device-local, deliberately NOT synced) ---------- */
  function filters() {
    let f = null;
    try { f = JSON.parse(localStorage.getItem(FILTER_KEY)); } catch (e) {}
    f = (f && typeof f === "object") ? f : {};
    return {
      subject: typeof f.subject === "string" ? f.subject : "",
      type: TYPE_ORDER.includes(f.type) || f.type === "all" ? f.type : "all",
      q: typeof f.q === "string" ? f.q : ""
    };
  }

  function setFilters(patch) {
    try { localStorage.setItem(FILTER_KEY, JSON.stringify(Object.assign(filters(), patch))); } catch (e) {}
    renderResults();
  }

  function haystack(it) {
    return (it.label + " " + it.subject + " " + it.subjectLabel + " " + it.section)
      .replace(/&amp;/g, "&").toLowerCase();
  }

  function sectionLabel(subject, section, hasSections) {
    if (!hasSections) return ""; // flat subject — no section headers at all
    if (section === "") return "Topics";
    const map = SECTION_LABELS[subject];
    if (map && map[section]) return esc(map[section]);
    return esc(section.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()));
  }

  /* ---------- row markup + wiring ---------- */
  function rowHtml(it) {
    const key = it.subject + "::" + it.file;
    const pinned = bookmarks().indexOf(key) >= 0;
    const noted = !!notes()[key];
    return '<div class="row" data-key="' + esc(key) + '">' +
      '<input type="checkbox" aria-label="done">' +
      '<span class="name">' + it.label + '</span>' +
      '<select class="rag" aria-label="confidence">' +
      '<option value="">–</option><option value="r">red</option>' +
      '<option value="a">amber</option><option value="g">green</option></select>' +
      '<a href="' + esc(it.file) + '" target="_blank">PDF</a>' +
      '<button type="button" class="lib-pin' + (pinned ? " on" : "") + '" aria-label="bookmark" title="pin / unpin">★</button>' +
      '<button type="button" class="lib-note-btn' + (noted ? " has" : "") + '" aria-label="note" title="note">note</button>' +
      '</div>' +
      '<textarea class="tnote lib-note" data-lib-note="' + esc(key) + '" placeholder="Note on this resource…" aria-label="note"></textarea>';
  }

  /* Same row wiring as app.js (chk:<key> = {c, r} + Auth.queueSync) — app.js
     only binds rows present at load, so async-rendered rows wire here. */
  function wireRows(scope) {
    (scope || document).querySelectorAll(".row[data-key]").forEach((row) => {
      const key = row.dataset.key;
      const st = store.get("chk:" + key, { c: false, r: "" });
      if (localStorage.getItem("chk:" + key) === null) store.set("chk:" + key, st, { silent: true }); // default row, not a user change
      const cb = row.querySelector("input[type=checkbox]");
      const sel = row.querySelector("select.rag");
      if (cb) cb.checked = !!st.c;
      if (sel) sel.value = st.r || "";
      const save = () => store.set("chk:" + key, { c: !!(cb && cb.checked), r: sel ? sel.value : "" });
      const paint = () => { row.setAttribute("data-rag", sel ? sel.value : ""); };
      const synced = () => { try { if (window.Auth && window.Auth.queueSync) window.Auth.queueSync(); } catch (e) {} };
      if (cb) cb.addEventListener("change", () => { save(); paint(); synced(); });
      if (sel) sel.addEventListener("change", () => { save(); paint(); synced(); });
      const pin = row.querySelector(".lib-pin");
      if (pin) pin.addEventListener("click", () => {
        const b = bookmarks();
        const i = b.indexOf(key);
        if (i >= 0) b.splice(i, 1); else b.unshift(key);
        store.set("res-bookmarks", b);
        pin.classList.toggle("on", i < 0);
        renderPins();
      });
      const noteBtn = row.querySelector(".lib-note-btn");
      const ta = row.nextElementSibling;
      if (noteBtn && ta && ta.classList.contains("lib-note")) {
        noteBtn.addEventListener("click", () => {
          flushNotes();
          const open = !ta.classList.contains("open");
          ta.classList.toggle("open", open);
          if (open) ta.focus();
        });
        ta.value = notes()[key] || "";
        const saveNote = () => {
          const blob = notes();
          if (ta.value) blob[key] = ta.value; else delete blob[key];
          store.set("res-notes", blob);
          noteBtn.classList.toggle("has", !!ta.value);
        };
        ta.addEventListener("input", () => {
          clearTimeout(noteTimers[key]);
          noteTimers[key] = setTimeout(saveNote, 600);
          if (!noteSaves.includes(saveNote)) noteSaves.push(saveNote);
        });
        ta.addEventListener("blur", () => { clearTimeout(noteTimers[key]); saveNote(); });
      }
      row.querySelectorAll("a[target=_blank]").forEach((a) => a.addEventListener("click", () => {
        const r = store.get("res-recent", null);
        const list = Array.isArray(r) ? r : [];
        const i = list.indexOf(key);
        if (i >= 0) list.splice(i, 1);
        list.unshift(key);
        store.set("res-recent", list.slice(0, RECENT_CAP));
      }));
    });
  }

  function flushNotes() {
    for (const t in noteTimers) clearTimeout(noteTimers[t]);
    const saves = noteSaves.splice(0, noteSaves.length);
    saves.forEach((fn) => { try { fn(); } catch (e) {} });
  }

  /* ---------- renderers ---------- */
  function filtered() {
    const f = filters();
    const q = f.q.trim().toLowerCase();
    return state.items.filter((it) =>
      (f.type === "all" || it.type === f.type) &&
      (!f.subject || it.subject === f.subject) &&
      (!q || haystack(it).includes(q)));
  }

  function groupedBy(items, field) {
    const groups = [];
    const index = {};
    items.forEach((it) => {
      if (index[it[field]] === undefined) { index[it[field]] = groups.length; groups.push([]); }
      groups[index[it[field]]].push(it);
    });
    return groups; // manifest order (sorted by type, subject, section, label)
  }

  function renderResults() {
    flushNotes();
    const box = document.getElementById("lib-results");
    if (!box) return;
    if (state.failed) {
      box.innerHTML = "<p class='muted'>Library manifest failed to load — is the site served over HTTP? (<code>" +
        MANIFEST_URL + "</code>)</p>";
      return;
    }
    const f = filters();
    const items = filtered();
    const count = document.getElementById("lib-count");
    if (count) count.textContent = items.length + " of " + state.items.length + " files";
    if (!items.length) {
      box.innerHTML = "<p class='muted'>No files match the current filters.</p>";
      return;
    }
    let html = "";
    for (const type of TYPE_ORDER) {
      if (f.type !== "all" && f.type !== type) continue;
      const tItems = items.filter((it) => it.type === type);
      if (!tItems.length) {
        if (type === "papers") {
          html += "<section class='card'><h3>Papers</h3><p class='muted'>No papers in the manifest yet — drop files into " +
            "<code>library/papers/&lt;subject&gt;/</code> then run <code>tools/build_library_manifest.py</code> and refresh.</p></section>";
        }
        continue;
      }
      html += "<section class='card'><h3>" + TYPE_LABELS[type] + " <span class='count'>(" + tItems.length + ")</span></h3>";
      for (const sItems of groupedBy(tItems, "subject")) {
        const hasSections = sItems.some((it) => it.section !== "");
        html += "<h4 class='lib-subj'>" + sItems[0].subjectLabel + " <span class='count'>(" + sItems.length + ")</span></h4>";
        for (const secItems of groupedBy(sItems, "section")) {
          const secLabel = sectionLabel(sItems[0].subject, secItems[0].section, hasSections);
          if (secLabel) html += "<div class='lib-sec'>" + secLabel + "</div>";
          html += secItems.map(rowHtml).join("");
        }
      }
      html += "</section>";
    }
    box.innerHTML = html;
    wireRows(box);
  }

  /* Dashboard slot — pinned resources as full rows (same chk: keys as the
     hubs, so ticks/RAG stay in step). */
  function renderPins() {
    const box = document.getElementById("res-pins");
    if (!box) return;
    const pins = bookmarks().filter((k) => state.byKey[k]);
    if (!pins.length) {
      box.innerHTML = "<p class='muted'>Nothing pinned yet — ★ a row on the <a href='library.html'>Library</a> page and it shows up here. Ticks, RAG and pins sync when logged in.</p>";
      return;
    }
    box.innerHTML = pins.map((k) => rowHtml(state.byKey[k])).join("");
    wireRows(box);
  }

  /* Practice slot — papers intake surfacing. */
  function renderPapersList() {
    const box = document.getElementById("papers-list");
    if (!box) return;
    const items = state.items.filter((it) => it.type === "papers");
    if (!items.length) {
      box.innerHTML = "<p class='muted'>No papers in the manifest yet — drop files into <code>library/papers/&lt;subject&gt;/</code>, " +
        "run <code>tools/build_library_manifest.py</code>, refresh; they appear here and on the <a href='library.html'>Library</a> page.</p>";
      return;
    }
    let html = "";
    for (const sItems of groupedBy(items, "subject")) {
      html += "<h4 class='lib-subj'>" + sItems[0].subjectLabel + " <span class='count'>(" + sItems.length + ")</span></h4>" +
        "<ul class='links'>" +
        sItems.map((it) => "<li><a href='" + esc(it.file) + "' target='_blank'>" + it.label + "</a></li>").join("") +
        "</ul>";
    }
    box.innerHTML = html;
  }

  /* ---------- filter bar (library.html only) ---------- */
  function initFilterBar() {
    const subjSel = document.getElementById("lib-subject");
    const typeSel = document.getElementById("lib-type");
    const qInput = document.getElementById("lib-search");
    if (!subjSel || !typeSel || !qInput) return;
    const f = filters();
    const subjects = groupedBy(state.items, "subject").map((g) => g[0])
      .sort((a, b) => a.subjectLabel.localeCompare(b.subjectLabel));
    subjSel.innerHTML = "<option value=''>All subjects</option>" +
      subjects.map((it) => "<option value='" + esc(it.subject) + "'>" + it.subjectLabel + "</option>").join("");
    subjSel.value = f.subject;
    typeSel.value = f.type;
    qInput.value = f.q;
    subjSel.addEventListener("change", () => setFilters({ subject: subjSel.value }));
    typeSel.addEventListener("change", () => setFilters({ type: typeSel.value }));
    qInput.addEventListener("input", () => setFilters({ q: qInput.value }));
  }

  async function init() {
    try {
      const res = await fetch(MANIFEST_URL + "?cb=" + Date.now(), { cache: "no-store" });
      const manifest = await res.json();
      state.items = Array.isArray(manifest.items) ? manifest.items : [];
    } catch (e) {
      state.failed = true;
    }
    state.byKey = {};
    state.items.forEach((it) => { state.byKey[it.subject + "::" + it.file] = it; });
    initFilterBar();
    renderResults();
    renderPins();
    renderPapersList();
  }

  window.addEventListener("pagehide", flushNotes);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

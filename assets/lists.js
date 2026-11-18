/* Study-site tracked lists + debrief notes (v1).
   Two small tools, each backed by ONE localStorage blob that syncs via auth.js
   (the blob key is registered in auth.js SYNCED_KEYS; logged out = local only):
   - <div data-list="<blobKey>" data-list-fields='[{"k":"a","label":"…","ph":"…"}]'></div>
     Items are {t: main text, done: bool, a:…, b:…}. Tick = shortlisted.
   - <textarea class="tnote" data-note="<blobKey>:<dot.path>"></textarea>
     Saves (debounced) into the blob at that path, e.g. ia-debriefs:nov.rd.
   Last-write-wins per blob, like every other synced key. */
(function () {
  "use strict";

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

  /* ---------- debrief notes ---------- */
  const noteTimers = {};
  const noteSaves = []; // flushed on pagehide — the debounce may not get to fire

  function notePath(blob, path, val) {
    let node = blob;
    for (let i = 0; i < path.length - 1; i++) {
      if (!node[path[i]] || typeof node[path[i]] !== "object") node[path[i]] = {};
      node = node[path[i]];
    }
    node[path[path.length - 1]] = val;
    return blob;
  }

  function noteGet(blob, path) {
    let v = blob;
    for (const p of path) { v = (v && typeof v === "object") ? v[p] : undefined; }
    return typeof v === "string" ? v : "";
  }

  function initNotes() {
    document.querySelectorAll("textarea[data-note]").forEach((ta) => {
      const i = ta.dataset.note.indexOf(":");
      if (i < 1) return;
      const key = ta.dataset.note.slice(0, i);
      const path = ta.dataset.note.slice(i + 1).split(".").filter(Boolean);
      if (!path.length) return;
      ta.value = noteGet(store.get(key, {}), path);
      const save = () => {
        const blob = store.get(key, {});
        store.set(key, notePath(blob && typeof blob === "object" ? blob : {}, path, ta.value));
      };
      const tid = () => "nt:" + key + ":" + path.join(".");
      ta.addEventListener("input", () => { clearTimeout(noteTimers[tid()]); noteTimers[tid()] = setTimeout(save, 600); });
      ta.addEventListener("blur", () => { clearTimeout(noteTimers[tid()]); save(); });
      noteSaves.push(save);
    });
  }

  /* ---------- tracked lists ---------- */
  function initLists() {
    document.querySelectorAll("[data-list]").forEach((box) => {
      const key = box.dataset.list;
      let fields = [];
      try { fields = JSON.parse(box.dataset.listFields || "[]"); } catch (e) {}
      fields = fields.filter(f => f && /^[A-Za-z0-9_-]+$/.test(f.k) && f.k !== "t" && f.k !== "done");

      const list = () => { const v = store.get(key, null); return v && Array.isArray(v.items) ? v : { items: [] }; };

      function save(items) { store.set(key, { items }); }

      function render() {
        const { items } = list();
        const rows = items.map((it, i) => {
          const extra = fields.map(f =>
            `<input type="text" class="t-field" data-i="${i}" data-k="${esc(f.k)}" value="${esc(it[f.k] || "")}" placeholder="${esc(f.label)}" aria-label="${esc(f.label)}">`
          ).join("");
          return `<div class="titem${it.done ? " done" : ""}">
            <input type="checkbox" data-i="${i}" data-act="tick" title="shortlist" ${it.done ? "checked" : ""}>
            <input type="text" class="t-main" data-i="${i}" data-k="t" value="${esc(it.t || "")}" placeholder="entry" aria-label="entry">
            ${extra}<button type="button" class="t-del" data-i="${i}" data-act="del" title="remove" aria-label="remove">×</button>
          </div>`;
        }).join("");
        const n = items.filter(it => it.done).length;
        box.innerHTML =
          (items.length ? `<div class="tlist">${rows}</div>` : "<p class='muted'>Nothing yet — add the first entry below.</p>") +
          `<div class="tadd">
            <input type="text" class="t-main" data-add="t" placeholder="entry (main line)" aria-label="entry">
            ${fields.map(f => `<input type="text" class="t-field" data-add="${esc(f.k)}" placeholder="${esc(f.label)}" aria-label="${esc(f.label)}">`).join("")}
            <button type="button" data-act="add">Add</button>
          </div>` +
          (items.length ? `<p class="tcount">${items.length} entr${items.length === 1 ? "y" : "ies"} · ${n} shortlisted</p>` : "");

        box.querySelectorAll("[data-act='tick']").forEach(el => el.addEventListener("change", () => {
          const { items } = list(); const it = items[+el.dataset.i]; if (!it) return;
          it.done = el.checked; save(items); render();
        }));
        box.querySelectorAll("[data-act='del']").forEach(el => el.addEventListener("click", () => {
          const { items } = list(); if (items[+el.dataset.i] === undefined) return;
          items.splice(+el.dataset.i, 1); save(items); render();
        }));
        box.querySelectorAll(".titem input[type='text']").forEach(el => el.addEventListener("change", () => {
          const { items } = list(); const it = items[+el.dataset.i]; if (!it) return; it[el.dataset.k] = el.value; save(items);
        }));
        const addBtn = box.querySelector("[data-act='add']");
        if (addBtn) addBtn.addEventListener("click", () => {
          const item = { t: (box.querySelector("[data-add='t']").value || "").trim(), done: false };
          fields.forEach(f => { item[f.k] = (box.querySelector(`[data-add='${f.k}']`).value || "").trim(); });
          if (!item.t && !fields.some(f => item[f.k])) return;
          const { items } = list(); items.push(item); save(items); render();
          const main = box.querySelector("[data-add='t']"); if (main) main.focus();
        });
      }

      render();
    });
  }

  function init() { initNotes(); initLists(); }

  window.addEventListener("pagehide", () => {
    for (const t in noteTimers) clearTimeout(noteTimers[t]);
    noteSaves.forEach(fn => { try { fn(); } catch (e) {} });
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

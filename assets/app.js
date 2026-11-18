(function () {
  // NB.store (assets/store.js) is the storage layer; the literal below is only a
  // fallback for a stale cached page that didn't load store.js.
  const store = (window.NB && window.NB.store) || {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  document.querySelectorAll('.row[data-key]').forEach(row => {
    const key = row.dataset.key;
    const st = store.get('chk:' + key, { c: false, r: '' });
    if (localStorage.getItem('chk:' + key) === null) store.set('chk:' + key, st, { silent: true }); // default row, not a user change
    const cb = row.querySelector('input[type=checkbox]');
    const sel = row.querySelector('select.rag');
    if (cb) cb.checked = !!st.c;
    if (sel) sel.value = st.r || '';
    const save = () => store.set('chk:' + key, { c: !!(cb && cb.checked), r: sel ? sel.value : '' });
    const paint = () => { row.setAttribute('data-rag', sel ? sel.value : ''); };
    if (cb) cb.addEventListener('change', () => { save(); paint(); progressPage(); try { if (window.Auth && window.Auth.queueSync) window.Auth.queueSync(); } catch (e) {} });
    if (sel) sel.addEventListener('change', () => { save(); paint(); progressPage(); try { if (window.Auth && window.Auth.queueSync) window.Auth.queueSync(); } catch (e) {} });
    paint();
  });
  function progressPage() {
    document.querySelectorAll('.bar[data-subject]').forEach(bar => {
      const prefix = bar.dataset.subject + '::';
      const rows = [...document.querySelectorAll('.row[data-key^="' + prefix + '"]')];
      if (!rows.length) return;
      const done = rows.filter(r => {
        const cb = r.querySelector('input[type=checkbox]');
        const sel = r.querySelector('select.rag');
        return (cb && cb.checked) || (sel && sel.value === 'g');
      }).length;
      bar.style.setProperty('--pct', Math.round(100 * done / rows.length) + '%');
    });
  }
  progressPage();
  document.querySelectorAll('.subj-card').forEach(cardEl => {
    const subj = cardEl.dataset.subject;
    let total = 0, done = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('chk:' + subj + '::')) {
        total++;
        const st = store.get(k, { c: false, r: '' });
        if (st.c || st.r === 'g') done++;
      }
    }
    if (total) {
      const pct = Math.round(100 * done / total) + '%';
      const mini = cardEl.querySelector('.bar.mini');
      if (mini) mini.style.setProperty('--pct', pct);
      const lbl = cardEl.querySelector('.pct');
      if (lbl) lbl.textContent = pct;
    }
  });
  const statsBody = document.getElementById('stats-body');
  if (statsBody) {
    const esc = (window.NB && window.NB.escapeHtml) || ((s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"));
    const d = new Date();
    const today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    let html = '';
    const pcts = [];
    const log = store.get('quizlog', []).filter(e => e && typeof e.pct === 'number');
    if (log.length) {
      html += log.slice(0, 5).reverse().map(e => {
        const raw = String(e.label || '');
        const label = raw.length > 30 ? raw.slice(0, 29) + '…' : raw;
        pcts.push(e.pct);
        return '<div class="stat-row"><span class="stat-date">' + esc((e.date || '').slice(5)) + '</span><span class="stat-label">' + esc(label) + '</span><span class="bar mini"></span><span class="pct">' + esc(e.pct) + '%</span></div>';
      }).join('');
    } else {
      html += '<p class="muted">No quiz sessions yet — run one in the practice app.</p>';
    }
    const seen = Object.values(store.get('fc-state', {})).filter(c => c && typeof c.seen === 'number' && c.seen > 0);
    if (seen.length) {
      const due = seen.filter(c => c.due <= today).length;
      const mastered = seen.filter(c => c.box >= 4).length;
      html += '<p>Flashcards: ' + (due ? '<strong>' + due + '</strong>' : due) + ' due · ' + mastered + ' mastered of ' + seen.length + ' seen</p>';
    } else {
      html += '<p class="muted">Flashcards: nothing seen yet.</p>';
    }
    const bySubj = {};
    let total = 0, done = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('chk:')) continue;
      const sep = k.indexOf('::');
      if (sep < 0) continue;
      const st = store.get(k, { c: false, r: '' });
      const ok = st.c || st.r === 'g';
      total++;
      if (ok) done++;
      const subj = k.slice(4, sep);
      if (!bySubj[subj]) bySubj[subj] = { done: 0, total: 0 };
      bySubj[subj].total++;
      if (ok) bySubj[subj].done++;
    }
    if (total) {
      let worst = null;
      for (const subj in bySubj) {
        const s = bySubj[subj];
        const pct = Math.round(100 * s.done / s.total);
        if (!worst || pct < worst.pct) worst = { subj, pct };
      }
      html += '<p>Checklists: ' + Math.round(100 * done / total) + '% overall (' + done + ' of ' + total + ' rows) · weakest: ' + esc(worst.subj) + ' (' + worst.pct + '%)</p>';
    } else {
      html += '<p class="muted">Checklists: nothing ticked yet.</p>';
    }
    statsBody.innerHTML = html;
    statsBody.querySelectorAll('.bar').forEach((b, i) => b.style.setProperty('--pct', pcts[i] + '%'));
  }
  const cd = document.getElementById('countdown');
  if (cd) {
    const target = new Date('2028-04-28T00:00:00');
    const days = Math.max(0, Math.ceil((target - new Date()) / 86400000));
    cd.textContent = days.toLocaleString() + ' days';
  }
  document.querySelectorAll('input.week').forEach(inp => {
    inp.value = store.get('week:' + inp.dataset.i, '');
    inp.addEventListener('input', () => { store.set('week:' + inp.dataset.i, inp.value); try { if (window.Auth && window.Auth.queueSync) window.Auth.queueSync(); } catch (e) {} });
  });
})();

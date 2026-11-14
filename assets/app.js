(function () {
  const store = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  document.querySelectorAll('.row[data-key]').forEach(row => {
    const key = row.dataset.key;
    const st = store.get('chk:' + key, { c: false, r: '' });
    const cb = row.querySelector('input[type=checkbox]');
    const sel = row.querySelector('select.rag');
    if (cb) cb.checked = !!st.c;
    if (sel) sel.value = st.r || '';
    const save = () => store.set('chk:' + key, { c: !!(cb && cb.checked), r: sel ? sel.value : '' });
    const paint = () => { row.setAttribute('data-rag', sel ? sel.value : ''); };
    if (cb) cb.addEventListener('change', () => { save(); paint(); progressPage(); });
    if (sel) sel.addEventListener('change', () => { save(); paint(); progressPage(); });
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
  const cd = document.getElementById('countdown');
  if (cd) {
    const target = new Date('2028-04-28T00:00:00');
    const days = Math.max(0, Math.ceil((target - new Date()) / 86400000));
    cd.textContent = days.toLocaleString() + ' days';
  }
  document.querySelectorAll('input.week').forEach(inp => {
    inp.value = store.get('week:' + inp.dataset.i, '');
    inp.addEventListener('input', () => store.set('week:' + inp.dataset.i, inp.value));
  });
})();

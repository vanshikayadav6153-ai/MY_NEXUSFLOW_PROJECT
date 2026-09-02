(function () {
  const listEl = document.getElementById('macro-list');
  const editorEl = document.getElementById('macro-editor');
  const stepsEl = document.getElementById('macro-steps');
  const nameEl = document.getElementById('macro-name');
  const descEl = document.getElementById('macro-desc');
  const btnNew = document.getElementById('btn-new-macro');
  const btnAddStep = document.getElementById('btn-add-step');
  const btnSave = document.getElementById('btn-save-macro');
  const btnCancel = document.getElementById('btn-cancel-macro');
  if (!listEl || !editorEl) return;

  let macros = [];
  let editingId = null;
  let loaded = false;
  const running = {};

  function toast(t, m, type) { if (typeof showToast === 'function') showToast(t, m, type); }

  async function load() {
    try {
      const res = await fetch('/api/macros');
      const data = await res.json();
      macros = Array.isArray(data.macros) ? data.macros : [];
      render();
    } catch (e) {
      listEl.innerHTML = '<div class="fm-empty">Failed to load macros.</div>';
    }
  }

  function render() {
    listEl.innerHTML = '';
    if (!macros.length) {
      listEl.innerHTML = '<div class="fm-empty">No macros yet. Create one below.</div>';
      return;
    }
    for (const m of macros) {
      const card = document.createElement('div');
      card.className = 'macro-card';
      card.dataset.id = m.id;
      const stepList = (m.steps || []).map((s) => s.command).join(' → ');
      card.innerHTML = `
        <div class="macro-card-head">
          <span class="macro-card-name"></span>
          <div class="macro-card-actions">
            <button class="hud-btn btn-primary btn-xs" data-act="run">RUN</button>
            <button class="btn-icon" data-act="edit" title="Edit">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="btn-icon" data-act="del" title="Delete">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
            </button>
          </div>
        </div>
        <div class="macro-card-desc"></div>
        <div class="macro-card-steps"></div>
        <div class="macro-progress hidden"></div>`;
      card.querySelector('.macro-card-name').textContent = m.name;
      card.querySelector('.macro-card-desc').textContent = m.description || '';
      card.querySelector('.macro-card-steps').textContent = stepList;
      card.querySelector('[data-act="run"]').addEventListener('click', () => runMacro(m));
      card.querySelector('[data-act="edit"]').addEventListener('click', () => openEditor(m));
      card.querySelector('[data-act="del"]').addEventListener('click', () => delMacro(m));
      listEl.appendChild(card);
    }
  }

  function addStepRow(step = { command: '', delay: 1000 }) {
    const row = document.createElement('div');
    row.className = 'macro-step-row';
    row.innerHTML = `
      <input type="text" class="hud-input input-sm step-cmd" placeholder="Command (e.g. wifi on)">
      <input type="number" class="hud-input input-sm step-delay" min="0" max="30000" step="250" title="Delay after (ms)">
      <button class="btn-icon step-del" title="Remove">✕</button>`;
    row.querySelector('.step-cmd').value = step.command || '';
    row.querySelector('.step-delay').value = Number.isFinite(step.delay) ? step.delay : 1000;
    row.querySelector('.step-del').addEventListener('click', () => row.remove());
    stepsEl.appendChild(row);
  }

  function openEditor(macro) {
    editingId = macro ? macro.id : null;
    nameEl.value = macro ? macro.name : '';
    descEl.value = macro ? (macro.description || '') : '';
    stepsEl.innerHTML = '';
    (macro && macro.steps && macro.steps.length ? macro.steps : [{ command: '', delay: 1000 }]).forEach(addStepRow);
    btnSave.textContent = macro ? 'UPDATE MACRO' : 'SAVE MACRO';
    editorEl.classList.remove('hidden');
    nameEl.focus();
  }

  function closeEditor() {
    editorEl.classList.add('hidden');
    editingId = null;
  }

  async function saveMacro() {
    const name = nameEl.value.trim();
    const steps = [...stepsEl.querySelectorAll('.macro-step-row')].map((r) => ({
      command: r.querySelector('.step-cmd').value.trim(),
      delay: Math.max(0, Math.min(30000, parseInt(r.querySelector('.step-delay').value, 10) || 0))
    })).filter((s) => s.command);

    if (!name || !steps.length) {
      toast('INVALID MACRO', 'Need a name and at least one step.', 'warning');
      return;
    }
    const body = { name, description: descEl.value.trim(), steps };
    try {
      const res = editingId
        ? await fetch(`/api/macros/${encodeURIComponent(editingId)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch('/api/macros', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (res.ok && data.success !== false) {
        toast('MACRO SAVED', name, 'success');
        closeEditor();
        load();
      } else {
        toast('SAVE FAILED', data.error?.message || data.error || `HTTP ${res.status}`, 'error');
      }
    } catch (e) {
      toast('SAVE FAILED', e.message, 'error');
    }
  }

  async function delMacro(macro) {
    const ask = typeof confirmDialog === 'function'
      ? confirmDialog(`Delete macro "${macro.name}"?`, { okText: 'Delete', danger: true })
      : Promise.resolve(window.confirm(`Delete "${macro.name}"?`));
    if (!(await ask)) return;
    try {
      const res = await fetch(`/api/macros/${encodeURIComponent(macro.id)}`, { method: 'DELETE' });
      if (res.ok) { toast('MACRO DELETED', macro.name, 'success'); load(); }
    } catch (e) { toast('DELETE FAILED', e.message, 'error'); }
  }

  async function runMacro(macro) {
    const card = listEl.querySelector(`.macro-card[data-id="${CSS.escape(macro.id)}"]`);
    const prog = card && card.querySelector('.macro-progress');
    if (prog) {
      prog.classList.remove('hidden');
      prog.innerHTML = (macro.steps || []).map((s, i) => `<span class="mp-step" data-i="${i}">${s.command}</span>`).join('');
    }
    running[macro.id] = { card };
    try {
      const res = await fetch(`/api/macros/${encodeURIComponent(macro.id)}/run`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || data.success === false) {
        toast('MACRO FAILED', data.error || `HTTP ${res.status}`, 'error');
      } else if (typeof appendTerminalLine === 'function') {
        appendTerminalLine(`[MACRO] Queued "${data.macro}"`, 'system');
      }
    } catch (e) {
      toast('MACRO FAILED', e.message, 'error');
    }
  }

  socket.addEventListener('message', (event) => {
    let data;
    try { data = JSON.parse(event.data); } catch { return; }
    if (data.type !== 'macro_step') return;
    const step = data.step || {};
    const ctx = running[step.macroId];
    if (!ctx || !ctx.card) return;
    const el = ctx.card.querySelector(`.mp-step[data-i="${step.stepIndex}"]`);
    if (el) {
      el.classList.remove('mp-executing', 'mp-success', 'mp-failed');
      el.classList.add('mp-' + (step.status === 'executing' ? 'executing' : step.status === 'success' ? 'success' : 'failed'));
    }
    if (typeof step.stepIndex === 'number' && step.stepIndex === (step.totalSteps - 1) && step.status !== 'executing') {
      setTimeout(() => { const p = ctx.card.querySelector('.macro-progress'); if (p) p.classList.add('hidden'); delete running[step.macroId]; }, 2500);
    }
  });

  btnNew.addEventListener('click', () => openEditor(null));
  btnAddStep.addEventListener('click', () => addStepRow());
  btnSave.addEventListener('click', saveMacro);
  btnCancel.addEventListener('click', closeEditor);

  const tabBtn = document.getElementById('tab-btn-macros');
  if (tabBtn) tabBtn.addEventListener('click', () => { if (!loaded) { loaded = true; load(); } });
})();

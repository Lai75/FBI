(function () {
  'use strict';

  // ---------- 工具 ----------
  async function api(path, opts) {
    const res = await fetch(path, opts);
    let body = null;
    try { body = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      const msg = (body && body.error) || `请求失败（${res.status}）`;
      throw new Error(msg);
    }
    return body;
  }

  function fmtDate(iso) {
    if (!iso) return '时间待确认';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '时间待确认';
    return d.toLocaleString('zh-CN', { hour12: false });
  }

  function toDatetimeLocalValue(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function fromDatetimeLocalValue(str) {
    if (!str) return null;
    const d = new Date(str);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ---------- 首次使用提示 ----------
  const NOTICE_KEY = 'liaohuiyi_notice_seen';
  const noticeEl = document.getElementById('notice');
  if (!localStorage.getItem(NOTICE_KEY)) {
    noticeEl.classList.remove('hidden');
  }
  document.getElementById('notice-ok').addEventListener('click', () => {
    localStorage.setItem(NOTICE_KEY, '1');
    noticeEl.classList.add('hidden');
  });

  // ---------- 视图切换 ----------
  const views = {
    home: document.getElementById('view-home'),
    import: document.getElementById('view-import'),
    search: document.getElementById('view-search'),
    detail: document.getElementById('view-detail'),
    trash: document.getElementById('view-trash'),
  };

  function showView(name) {
    Object.entries(views).forEach(([k, el]) => el.classList.toggle('hidden', k !== name));
    if (name === 'home') loadHome();
    if (name === 'trash') loadTrash();
    if (name === 'import') resetImportWizard();
  }

  document.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => showView(btn.dataset.nav));
  });

  // ---------- 首页 ----------
  async function loadHome() {
    const listEl = document.getElementById('home-list');
    listEl.innerHTML = '<p class="muted">加载中…</p>';
    try {
      const imports = await api('/api/imports');
      if (imports.length === 0) {
        listEl.innerHTML = '<p class="muted">还没有任何导入，点击上方"新建导入"开始。</p>';
        return;
      }
      listEl.innerHTML = '';
      imports.forEach((imp) => {
        const card = document.createElement('div');
        card.className = 'card';
        const range = imp.earliest || imp.latest
          ? `${fmtDate(imp.earliest)} ~ ${fmtDate(imp.latest)}`
          : '时间待确认';
        card.innerHTML = `
          <h3>${escapeHtml(imp.title)}</h3>
          <div class="muted">${escapeHtml(imp.source || '未填写来源')} · ${imp.message_count} 条消息 · ${range}</div>
          <div class="card-actions">
            <button class="btn btn-danger" data-action="delete" data-id="${imp.id}">删除</button>
          </div>
        `;
        card.addEventListener('click', (e) => {
          if (e.target.closest('[data-action]')) return;
          openDetail(imp.id);
        });
        card.querySelector('[data-action="delete"]').addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm(`确定删除「${imp.title}」吗？删除后会进入回收站，可在回收站恢复。`)) return;
          await api(`/api/imports/${imp.id}`, { method: 'DELETE' });
          loadHome();
        });
        listEl.appendChild(card);
      });
    } catch (err) {
      listEl.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
    }
  }

  // ---------- 导入向导 ----------
  const step1 = document.getElementById('import-step1');
  const step2 = document.getElementById('import-step2');
  const importError = document.getElementById('import-error');
  const previewBody = document.getElementById('preview-body');
  const previewWarnings = document.getElementById('preview-warnings');

  let previewState = [];

  function resetImportWizard() {
    step1.classList.remove('hidden');
    step2.classList.add('hidden');
    importError.classList.add('hidden');
    document.getElementById('import-text').value = '';
    document.getElementById('import-file').value = '';
    document.getElementById('meta-title').value = '';
    document.getElementById('meta-source').value = '';
    document.getElementById('meta-timezone').value = 'local';
    previewState = [];
  }

  document.getElementById('btn-preview').addEventListener('click', async () => {
    importError.classList.add('hidden');
    const text = document.getElementById('import-text').value;
    const fileInput = document.getElementById('import-file');
    const file = fileInput.files && fileInput.files[0];

    const fd = new FormData();
    if (file) {
      fd.append('file', file);
    } else {
      fd.append('text', text);
    }

    try {
      const result = await api('/api/imports/preview', { method: 'POST', body: fd });
      previewState = result.messages.map((m) => ({ ...m }));
      renderPreviewWarnings(result.warnings || []);
      renderPreviewTable();
      step1.classList.add('hidden');
      step2.classList.remove('hidden');
      if (!document.getElementById('meta-source').value && file) {
        document.getElementById('meta-source').value = file.name;
      }
    } catch (err) {
      importError.textContent = err.message;
      importError.classList.remove('hidden');
    }
  });

  function renderPreviewWarnings(warnings) {
    if (!warnings.length) {
      previewWarnings.classList.add('hidden');
      previewWarnings.innerHTML = '';
      return;
    }
    previewWarnings.classList.remove('hidden');
    const shown = warnings.slice(0, 20);
    previewWarnings.innerHTML = `<strong>解析提示（${warnings.length} 条）：</strong><ul>${shown.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>`;
  }

  function renderPreviewTable() {
    previewBody.innerHTML = previewState.map((m, idx) => `
      <tr class="${m.needs_review ? 'needs-review' : ''}" data-idx="${idx}">
        <td><input type="datetime-local" data-field="sent_at" value="${toDatetimeLocalValue(m.sent_at)}" /></td>
        <td><input type="text" data-field="sender" value="${escapeHtml(m.sender || '')}" /></td>
        <td><textarea data-field="content" rows="2">${escapeHtml(m.content || '')}</textarea></td>
        <td>${m.needs_review ? '<span class="badge badge-review">待确认</span>' : '<span class="badge badge-ok">已识别</span>'}</td>
      </tr>
    `).join('');
  }

  previewBody.addEventListener('input', (e) => {
    const field = e.target.dataset.field;
    if (!field) return;
    const tr = e.target.closest('tr');
    const idx = parseInt(tr.dataset.idx, 10);
    if (field === 'sent_at') {
      previewState[idx].sent_at = fromDatetimeLocalValue(e.target.value);
    } else {
      previewState[idx][field] = e.target.value;
    }
  });

  document.getElementById('btn-cancel-import').addEventListener('click', () => {
    resetImportWizard();
    showView('home');
  });

  document.getElementById('btn-confirm-import').addEventListener('click', async () => {
    const title = document.getElementById('meta-title').value.trim();
    if (!title) {
      alert('请先填写导入标题。');
      return;
    }
    const payload = {
      title,
      source: document.getElementById('meta-source').value.trim(),
      timezone: document.getElementById('meta-timezone').value.trim() || 'local',
      messages: previewState.map((m) => ({
        sent_at: m.sent_at || null,
        sender: m.sender ? String(m.sender).trim() : null,
        content: String(m.content || '').trim(),
        needs_review: !m.sent_at ? 1 : 0,
      })).filter((m) => m.content),
    };
    try {
      const result = await api('/api/imports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      resetImportWizard();
      openDetail(result.id);
    } catch (err) {
      alert('保存失败：' + err.message);
    }
  });

  // ---------- 搜索 ----------
  document.getElementById('btn-search').addEventListener('click', runSearch);
  async function runSearch() {
    const params = new URLSearchParams();
    const q = document.getElementById('search-q').value.trim();
    const sender = document.getElementById('search-sender').value.trim();
    const from = document.getElementById('search-from').value;
    const to = document.getElementById('search-to').value;
    if (q) params.set('q', q);
    if (sender) params.set('sender', sender);
    if (from) params.set('dateFrom', from);
    if (to) params.set('dateTo', to);

    const resultsEl = document.getElementById('search-results');
    if ([...params.keys()].length === 0) {
      resultsEl.innerHTML = '<p class="muted">请输入至少一个搜索条件。</p>';
      return;
    }
    resultsEl.innerHTML = '<p class="muted">搜索中…</p>';
    try {
      const result = await api('/api/search?' + params.toString());
      renderSearchResults(result);
    } catch (err) {
      resultsEl.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
    }
  }

  function renderSearchResults(result) {
    const resultsEl = document.getElementById('search-results');
    const { batches = [], messages = [] } = result;
    if (batches.length === 0 && messages.length === 0) {
      resultsEl.innerHTML = '<p class="muted">没有找到匹配内容。</p>';
      return;
    }
    let html = '';
    if (batches.length) {
      html += `<div class="result-group"><h2>匹配的导入批次</h2>` + batches.map((b) => `
        <div class="result-item" data-goto-import="${b.id}">
          <div class="meta">${escapeHtml(b.source || '')}</div>
          <strong>${escapeHtml(b.title)}</strong>
        </div>
      `).join('') + `</div>`;
    }
    if (messages.length) {
      html += `<div class="result-group"><h2>匹配的原始消息（${messages.length}）</h2>` + messages.map((m) => `
        <div class="result-item" data-goto-import="${m.import_id}" data-goto-message="${m.id}">
          <div class="meta">${escapeHtml(m.import_title)} · ${escapeHtml(m.sender || '未知发送人')} · ${fmtDate(m.sent_at)}</div>
          <div>${escapeHtml(m.content).slice(0, 200)}</div>
        </div>
      `).join('') + `</div>`;
    }
    resultsEl.innerHTML = html;
    resultsEl.querySelectorAll('[data-goto-import]').forEach((el) => {
      el.addEventListener('click', () => {
        const importId = el.dataset.gotoImport;
        const messageId = el.dataset.gotoMessage || null;
        openDetail(importId, messageId);
      });
    });
  }

  // ---------- 详情/时间线 ----------
  let currentDetailImportId = null;

  async function openDetail(importId, highlightMessageId) {
    currentDetailImportId = importId;
    showViewOnly('detail');
    const titleEl = document.getElementById('detail-title');
    const metaEl = document.getElementById('detail-meta');
    const timelineEl = document.getElementById('detail-timeline');
    titleEl.textContent = '加载中…';
    metaEl.textContent = '';
    timelineEl.innerHTML = '';
    try {
      const { import: imp, messages } = await api(`/api/imports/${importId}`);
      titleEl.textContent = imp.title;
      metaEl.textContent = `${imp.source || '未填写来源'} · 时区 ${imp.timezone || 'local'} · 共 ${messages.length} 条消息${imp.deleted_at ? '（已删除，位于回收站）' : ''}`;
      timelineEl.innerHTML = messages.map((m) => `
        <div class="msg-row ${String(m.id) === String(highlightMessageId) ? 'target' : ''}" id="msg-${m.id}">
          <div class="msg-time">${fmtDate(m.sent_at)}</div>
          <div class="msg-sender">${escapeHtml(m.sender || '未知')}</div>
          <div class="msg-content">${escapeHtml(m.content)}${m.needs_review ? ' <span class="badge badge-review">待确认</span>' : ''}</div>
        </div>
      `).join('');
      if (highlightMessageId) {
        const target = document.getElementById(`msg-${highlightMessageId}`);
        if (target) target.scrollIntoView({ block: 'center' });
      }
    } catch (err) {
      titleEl.textContent = '加载失败';
      metaEl.textContent = err.message;
    }
  }

  function showViewOnly(name) {
    Object.entries(views).forEach(([k, el]) => el.classList.toggle('hidden', k !== name));
  }

  document.getElementById('btn-delete-import').addEventListener('click', async () => {
    if (!currentDetailImportId) return;
    if (!confirm('确定删除本次导入吗？删除后会进入回收站。')) return;
    await api(`/api/imports/${currentDetailImportId}`, { method: 'DELETE' });
    showView('home');
  });

  // ---------- 回收站 ----------
  async function loadTrash() {
    const listEl = document.getElementById('trash-list');
    listEl.innerHTML = '<p class="muted">加载中…</p>';
    try {
      const items = await api('/api/trash');
      if (items.length === 0) {
        listEl.innerHTML = '<p class="muted">回收站是空的。</p>';
        return;
      }
      listEl.innerHTML = '';
      items.forEach((imp) => {
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
          <h3>${escapeHtml(imp.title)}</h3>
          <div class="muted">${escapeHtml(imp.source || '')} · ${imp.message_count} 条消息 · 删除于 ${fmtDate(imp.deleted_at)}</div>
          <div class="card-actions">
            <button class="btn btn-primary" data-action="restore">恢复</button>
            <button class="btn btn-danger" data-action="purge">彻底删除</button>
          </div>
        `;
        card.querySelector('[data-action="restore"]').addEventListener('click', async () => {
          await api(`/api/imports/${imp.id}/restore`, { method: 'POST' });
          loadTrash();
        });
        card.querySelector('[data-action="purge"]').addEventListener('click', async () => {
          if (!confirm(`彻底删除「${imp.title}」？此操作无法恢复。`)) return;
          await api(`/api/imports/${imp.id}/purge`, { method: 'DELETE' });
          loadTrash();
        });
        listEl.appendChild(card);
      });
    } catch (err) {
      listEl.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
    }
  }

  // ---------- 启动 ----------
  showView('home');
})();

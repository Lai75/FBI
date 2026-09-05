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
    document.querySelectorAll('.navbtn[data-nav]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.nav === name);
    });
    if (name === 'home') { loadContacts(); loadHome(); }
    if (name === 'trash') loadTrash();
    if (name === 'import') { loadContacts(); resetImportWizard(); }
  }

  // ---------- 人物 ----------
  async function loadContacts() {
    let contacts = [];
    try {
      contacts = await api('/api/contacts');
    } catch (e) { /* 静默失败，不影响其他功能 */ }

    const datalist = document.getElementById('contact-options');
    datalist.innerHTML = contacts.map((c) => `<option value="${escapeHtml(c.name)}"></option>`).join('');

    const filter = document.getElementById('home-contact-filter');
    const prevValue = filter.value;
    filter.innerHTML = '<option value="">全部人物</option>'
      + contacts.map((c) => `<option value="${c.id}">${escapeHtml(c.name)} (${c.import_count})</option>`).join('');
    filter.value = prevValue;

    renderContactManageList(contacts);
  }

  function renderContactManageList(contacts) {
    const listEl = document.getElementById('contact-manage-list');
    if (contacts.length === 0) {
      listEl.innerHTML = '<div class="empty-state">还没有任何人物。</div>';
      return;
    }
    listEl.innerHTML = '';
    contacts.forEach((c) => {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <span>${escapeHtml(c.name)} <span class="muted">(${c.import_count} 条导入)</span></span>
        <button class="btn btn-danger" data-action="delete">删除</button>
      `;
      card.querySelector('[data-action="delete"]').addEventListener('click', async () => {
        if (!confirm(`确定删除人物「${c.name}」吗？删除后会进入回收站，可在回收站恢复。`)) return;
        await api(`/api/contacts/${c.id}`, { method: 'DELETE' });
        loadContacts();
      });
      listEl.appendChild(card);
    });
  }

  document.getElementById('btn-manage-contacts').addEventListener('click', () => {
    document.getElementById('contact-manage-list').classList.toggle('hidden');
  });

  document.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => showView(btn.dataset.nav));
  });

  // ---------- 首页 ----------
  document.getElementById('home-contact-filter').addEventListener('change', (e) => loadHome(e.target.value));

  async function loadHome(contactId) {
    const listEl = document.getElementById('home-list');
    listEl.innerHTML = '<p class="muted">加载中…</p>';
    try {
      const imports = await api('/api/imports' + (contactId ? '?contactId=' + encodeURIComponent(contactId) : ''));
      if (imports.length === 0) {
        listEl.innerHTML = '<div class="empty-state">还没有任何导入，点击上方"新建导入"开始留住第一段回忆。</div>';
        return;
      }
      listEl.innerHTML = '';
      imports.forEach((imp) => {
        const card = document.createElement('div');
        card.className = 'card';
        const range = imp.earliest || imp.latest
          ? `${fmtDate(imp.earliest)} ~ ${fmtDate(imp.latest)}`
          : '时间待确认';
        const countText = imp.type === 'photo' ? `${imp.photo_count} 张照片` : `${imp.message_count} 条消息`;
        card.innerHTML = `
          <h3>${escapeHtml(imp.title)}</h3>
          <div class="muted">${escapeHtml(imp.contact_name || '未分类')} · ${escapeHtml(imp.source || '未填写来源')} · ${countText} · ${range}</div>
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
          loadHome(document.getElementById('home-contact-filter').value);
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
  let importMode = 'text'; // 'text' | 'photo'
  let selectedPhotoFiles = [];

  function resetImportWizard() {
    step1.classList.remove('hidden');
    step2.classList.add('hidden');
    importError.classList.add('hidden');
    document.getElementById('import-text').value = '';
    document.getElementById('import-file').value = '';
    document.getElementById('import-photos').value = '';
    document.getElementById('meta-title').value = '';
    document.getElementById('meta-source').value = '';
    document.getElementById('meta-contact').value = '';
    document.getElementById('meta-timezone').value = 'local';
    previewState = [];
    importMode = 'text';
    selectedPhotoFiles = [];
    previewWarnings.classList.add('hidden');
    document.querySelector('.table-scroll').classList.remove('hidden');
  }

  document.getElementById('btn-preview').addEventListener('click', async () => {
    importError.classList.add('hidden');
    const text = document.getElementById('import-text').value;
    const fileInput = document.getElementById('import-file');
    const file = fileInput.files && fileInput.files[0];
    const photosInput = document.getElementById('import-photos');
    const photoFiles = photosInput.files && photosInput.files.length ? Array.from(photosInput.files) : [];

    if (photoFiles.length && !text.trim() && !file) {
      importMode = 'photo';
      selectedPhotoFiles = photoFiles;
      previewWarnings.classList.add('hidden');
      document.querySelector('.table-scroll').classList.add('hidden');
      previewBody.innerHTML = '';
      step1.classList.add('hidden');
      step2.classList.remove('hidden');
      if (!document.getElementById('meta-source').value) {
        document.getElementById('meta-source').value = `${photoFiles.length} 张聊天截图`;
      }
      return;
    }

    importMode = 'text';
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
      document.querySelector('.table-scroll').classList.remove('hidden');
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
    const source = document.getElementById('meta-source').value.trim();
    const contactName = document.getElementById('meta-contact').value.trim();

    try {
      let result;
      if (importMode === 'photo') {
        const fd = new FormData();
        fd.append('title', title);
        fd.append('source', source);
        fd.append('contact_name', contactName);
        selectedPhotoFiles.forEach((f) => fd.append('photos', f));
        result = await api('/api/imports/photos', { method: 'POST', body: fd });
      } else {
        const payload = {
          title,
          source,
          contact_name: contactName,
          timezone: document.getElementById('meta-timezone').value.trim() || 'local',
          messages: previewState.map((m) => ({
            sent_at: m.sent_at || null,
            sender: m.sender ? String(m.sender).trim() : null,
            content: String(m.content || '').trim(),
            needs_review: !m.sent_at ? 1 : 0,
          })).filter((m) => m.content),
        };
        result = await api('/api/imports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
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
    const addTextBox = document.getElementById('detail-add-text');
    const addPhotosBox = document.getElementById('detail-add-photos');
    titleEl.textContent = '加载中…';
    metaEl.textContent = '';
    timelineEl.innerHTML = '';
    addTextBox.classList.add('hidden');
    addPhotosBox.classList.add('hidden');
    try {
      const { import: imp, messages, photos } = await api(`/api/imports/${importId}`);
      titleEl.textContent = imp.title;

      if (imp.type === 'photo') {
        metaEl.textContent = `${imp.contact_name || '未分类'} · ${imp.source || '未填写来源'} · 共 ${photos.length} 张照片${imp.deleted_at ? '（已删除，位于回收站）' : ''}`;
        renderPhotoGrid(photos);
        if (!imp.deleted_at) addPhotosBox.classList.remove('hidden');
        return;
      }

      if (!imp.deleted_at) addTextBox.classList.remove('hidden');

      metaEl.textContent = `${imp.contact_name || '未分类'} · ${imp.source || '未填写来源'} · 时区 ${imp.timezone || 'local'} · 共 ${messages.length} 条消息${imp.deleted_at ? '（已删除，位于回收站）' : ''}`;

      // 发送人字面为"我"的当作本人，靠右显示；否则退化为出现次数最多的发送人；其余靠左，模拟聊天气泡
      const counts = {};
      messages.forEach((m) => {
        const s = m.sender || '未知';
        counts[s] = (counts[s] || 0) + 1;
      });
      let primarySender = Object.keys(counts).find((s) => s === '我') || null;
      if (!primarySender) {
        let max = 0;
        Object.entries(counts).forEach(([s, c]) => { if (c > max) { max = c; primarySender = s; } });
      }

      timelineEl.innerHTML = messages.map((m) => {
        const sender = m.sender || '未知';
        const isMe = sender === primarySender;
        const initial = sender.trim().charAt(0) || '?';
        return `
        <div class="msg-row ${isMe ? 'me' : 'other'} ${String(m.id) === String(highlightMessageId) ? 'target' : ''}" id="msg-${m.id}">
          ${!isMe ? `<div class="msg-avatar" aria-hidden="true">${escapeHtml(initial)}</div>` : ''}
          <div class="msg-bubble-wrap">
            <div class="msg-meta">${!isMe ? `<span>${escapeHtml(sender)}</span>` : ''}<span>${fmtDate(m.sent_at)}</span></div>
            <div class="msg-bubble">${escapeHtml(m.content)}${m.needs_review ? ' <span class="badge badge-review">待确认</span>' : ''}</div>
          </div>
        </div>
      `;
      }).join('');
      if (highlightMessageId) {
        const target = document.getElementById(`msg-${highlightMessageId}`);
        if (target) target.scrollIntoView({ block: 'center' });
      }
    } catch (err) {
      titleEl.textContent = '加载失败';
      metaEl.textContent = err.message;
    }
  }

  function renderPhotoGrid(photos) {
    const timelineEl = document.getElementById('detail-timeline');
    if (photos.length === 0) {
      timelineEl.innerHTML = '<div class="empty-state">这批导入里没有照片了。</div>';
      return;
    }
    timelineEl.innerHTML = `<div class="photo-grid">${photos.map((p) => `
      <div class="photo-item" data-photo-id="${p.id}">
        <img src="/api/photos/file/${encodeURIComponent(p.stored_name)}" alt="${escapeHtml(p.filename)}" loading="lazy" />
        <button class="photo-delete" data-action="delete-photo" title="删除这张照片" aria-label="删除这张照片">×</button>
      </div>
    `).join('')}</div>`;
    timelineEl.querySelectorAll('.photo-item img').forEach((img) => {
      img.addEventListener('click', () => openLightbox(img.src, img.alt));
    });
    timelineEl.querySelectorAll('[data-action="delete-photo"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('确定删除这张照片吗？删除后会进入回收站，可在回收站恢复。')) return;
        const item = btn.closest('.photo-item');
        await api(`/api/photos/${item.dataset.photoId}`, { method: 'DELETE' });
        item.remove();
      });
    });
  }

  // ---------- 照片大图查看 ----------
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightbox-img');
  function openLightbox(src, alt) {
    lightboxImg.src = src;
    lightboxImg.alt = alt || '';
    lightbox.classList.remove('hidden');
  }
  function closeLightbox() {
    lightbox.classList.add('hidden');
    lightboxImg.src = '';
  }
  lightbox.addEventListener('click', closeLightbox);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !lightbox.classList.contains('hidden')) closeLightbox();
  });

  function showViewOnly(name) {
    Object.entries(views).forEach(([k, el]) => el.classList.toggle('hidden', k !== name));
  }

  document.getElementById('btn-delete-import').addEventListener('click', async () => {
    if (!currentDetailImportId) return;
    if (!confirm('确定删除本次导入吗？删除后会进入回收站。')) return;
    await api(`/api/imports/${currentDetailImportId}`, { method: 'DELETE' });
    showView('home');
  });

  document.getElementById('btn-add-text').addEventListener('click', async () => {
    if (!currentDetailImportId) return;
    const input = document.getElementById('add-text-input');
    const text = input.value;
    if (!text.trim()) { alert('请先粘贴要追加的内容。'); return; }
    try {
      const result = await api(`/api/imports/${currentDetailImportId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      input.value = '';
      openDetail(currentDetailImportId);
      if (result.warnings && result.warnings.length) {
        alert(`已追加 ${result.added} 条消息，但有 ${result.warnings.length} 条提示：\n` + result.warnings.slice(0, 5).join('\n'));
      }
    } catch (err) {
      alert('追加失败：' + err.message);
    }
  });

  document.getElementById('btn-add-photos').addEventListener('click', async () => {
    if (!currentDetailImportId) return;
    const input = document.getElementById('add-photos-input');
    const files = input.files && input.files.length ? Array.from(input.files) : [];
    if (!files.length) { alert('请先选择要添加的照片。'); return; }
    const fd = new FormData();
    files.forEach((f) => fd.append('photos', f));
    try {
      await api(`/api/imports/${currentDetailImportId}/photos`, { method: 'POST', body: fd });
      input.value = '';
      openDetail(currentDetailImportId);
    } catch (err) {
      alert('添加失败：' + err.message);
    }
  });

  // ---------- 回收站 ----------
  function renderTrashSection(listEl, items, emptyText, { label, restoreUrl, purgeUrl, confirmLabel }) {
    if (items.length === 0) {
      listEl.innerHTML = `<div class="empty-state">${emptyText}</div>`;
      return;
    }
    listEl.innerHTML = '';
    items.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <h3>${escapeHtml(label(item))}</h3>
        <div class="muted">删除于 ${fmtDate(item.deleted_at)}</div>
        <div class="card-actions">
          <button class="btn btn-primary" data-action="restore">恢复</button>
          <button class="btn btn-danger" data-action="purge">彻底删除</button>
        </div>
      `;
      card.querySelector('[data-action="restore"]').addEventListener('click', async () => {
        await api(restoreUrl(item), { method: 'POST' });
        loadTrash();
      });
      card.querySelector('[data-action="purge"]').addEventListener('click', async () => {
        if (!confirm(`彻底删除${confirmLabel(item)}？此操作无法恢复。`)) return;
        await api(purgeUrl(item), { method: 'DELETE' });
        loadTrash();
      });
      listEl.appendChild(card);
    });
  }

  async function loadTrash() {
    const importsEl = document.getElementById('trash-list');
    const contactsEl = document.getElementById('trash-contacts-list');
    const photosEl = document.getElementById('trash-photos-list');
    importsEl.innerHTML = contactsEl.innerHTML = photosEl.innerHTML = '<p class="muted">加载中…</p>';
    try {
      const [imports, contacts, photos] = await Promise.all([
        api('/api/trash'),
        api('/api/contacts/trash'),
        api('/api/photos/trash'),
      ]);
      renderTrashSection(importsEl, imports, '导入回收站是空的。', {
        label: (imp) => `${imp.title}（${imp.type === 'photo' ? imp.photo_count + ' 张照片' : imp.message_count + ' 条消息'}）`,
        restoreUrl: (imp) => `/api/imports/${imp.id}/restore`,
        purgeUrl: (imp) => `/api/imports/${imp.id}/purge`,
        confirmLabel: (imp) => `「${imp.title}」`,
      });
      renderTrashSection(contactsEl, contacts, '人物回收站是空的。', {
        label: (c) => c.name,
        restoreUrl: (c) => `/api/contacts/${c.id}/restore`,
        purgeUrl: (c) => `/api/contacts/${c.id}/purge`,
        confirmLabel: (c) => `人物「${c.name}」`,
      });
      renderTrashSection(photosEl, photos, '照片回收站是空的。', {
        label: (p) => `${p.filename}（来自「${p.import_title}」）`,
        restoreUrl: (p) => `/api/photos/${p.id}/restore`,
        purgeUrl: (p) => `/api/photos/${p.id}/purge`,
        confirmLabel: (p) => `照片「${p.filename}」`,
      });
    } catch (err) {
      importsEl.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
    }
  }

  // ---------- 启动 ----------
  showView('home');
})();

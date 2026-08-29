const express = require('express');
const multer = require('multer');
const { db, findOrCreateContact } = require('../lib/db');
const { parseChatText } = require('../lib/parser');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB，与需求文档一致
});

function nowISO() {
  return new Date().toISOString();
}

// ---- 预览（不落库）----
router.post('/imports/preview', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: '文件超过 10MB 上限，请拆分后重试或改用粘贴文本。' });
      }
      return res.status(400).json({ error: '文件上传失败：' + err.message });
    }
    next();
  });
}, (req, res) => {
  let text = '';
  let filename = '';

  if (req.file) {
    filename = req.file.originalname || '';
    const lower = filename.toLowerCase();
    if (!lower.endsWith('.txt') && !lower.endsWith('.csv')) {
      return res.status(400).json({ error: '仅支持 .txt 或 .csv 文件。' });
    }
    try {
      text = req.file.buffer.toString('utf-8');
    } catch (e) {
      return res.status(400).json({ error: '文件编码无法识别，请确认文件为 UTF-8 编码。' });
    }
  } else {
    text = (req.body && req.body.text) || '';
    filename = (req.body && req.body.filename) || '';
  }

  if (!text || !text.trim()) {
    return res.status(400).json({ error: '内容为空，请粘贴聊天文本或选择文件。' });
  }

  const result = parseChatText({ text, filename });
  if (result.messages.length === 0) {
    return res.status(400).json({ error: '未能从内容中解析出任何消息。', warnings: result.warnings });
  }
  res.json(result);
});

// ---- 保存（用户确认预览后）----
router.post('/imports', express.json({ limit: '15mb' }), (req, res) => {
  const { title, source, timezone, contact_name, messages } = req.body || {};
  if (!title || !title.trim()) {
    return res.status(400).json({ error: '请为本次导入命名。' });
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: '没有可保存的消息。' });
  }

  const contact = findOrCreateContact(contact_name);

  const insertImport = db.prepare(
    `INSERT INTO imports (title, source, timezone, status, created_at, contact_id) VALUES (?, ?, ?, 'confirmed', ?, ?)`
  );
  const insertMessage = db.prepare(
    `INSERT INTO messages (import_id, seq, sent_at, sender, content, confirmed, needs_review)
     VALUES (?, ?, ?, ?, ?, 1, ?)`
  );

  const tx = db.transaction((msgs) => {
    const info = insertImport.run(title.trim(), source || null, timezone || 'local', nowISO(), contact ? contact.id : null);
    const importId = info.lastInsertRowid;
    msgs.forEach((m, idx) => {
      if (!m || !String(m.content || '').trim()) return;
      insertMessage.run(
        importId,
        idx,
        m.sent_at || null,
        m.sender ? String(m.sender).trim() : null,
        String(m.content).trim(),
        m.needs_review ? 1 : 0
      );
    });
    return importId;
  });

  const importId = tx(messages);
  res.status(201).json({ id: importId });
});

// ---- 列表（未删除）----
router.get('/imports', (req, res) => {
  const contactId = (req.query.contactId || '').trim();
  const clauses = ['i.deleted_at IS NULL'];
  const params = [];
  if (contactId === 'none') {
    clauses.push('i.contact_id IS NULL');
  } else if (contactId) {
    clauses.push('i.contact_id = ?');
    params.push(contactId);
  }
  const rows = db.prepare(`
    SELECT i.id, i.title, i.source, i.timezone, i.created_at, i.contact_id, c.name AS contact_name,
           COUNT(m.id) AS message_count,
           MIN(m.sent_at) AS earliest,
           MAX(m.sent_at) AS latest
    FROM imports i
    LEFT JOIN messages m ON m.import_id = i.id
    LEFT JOIN contacts c ON c.id = i.contact_id
    WHERE ${clauses.join(' AND ')}
    GROUP BY i.id
    ORDER BY i.created_at DESC
  `).all(...params);
  res.json(rows);
});

// ---- 回收站 ----
router.get('/trash', (req, res) => {
  const rows = db.prepare(`
    SELECT i.id, i.title, i.source, i.deleted_at, COUNT(m.id) AS message_count
    FROM imports i
    LEFT JOIN messages m ON m.import_id = i.id
    WHERE i.deleted_at IS NOT NULL
    GROUP BY i.id
    ORDER BY i.deleted_at DESC
  `).all();
  res.json(rows);
});

// ---- 导出全部数据 ----
router.get('/export', (req, res) => {
  const imports = db.prepare(`SELECT * FROM imports WHERE deleted_at IS NULL ORDER BY created_at ASC`).all();
  const importIds = imports.map((i) => i.id);
  let messages = [];
  if (importIds.length) {
    const placeholders = importIds.map(() => '?').join(',');
    messages = db.prepare(`SELECT * FROM messages WHERE import_id IN (${placeholders}) ORDER BY import_id, seq`).all(...importIds);
  }
  const payload = {
    exported_at: nowISO(),
    imports: imports.map((imp) => ({
      ...imp,
      messages: messages.filter((m) => m.import_id === imp.id),
    })),
  };
  res.setHeader('Content-Disposition', `attachment; filename="liaohuiyi-export-${Date.now()}.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(payload, null, 2));
});

// ---- 详情 ----
router.get('/imports/:id', (req, res) => {
  const imp = db.prepare(`
    SELECT i.*, c.name AS contact_name
    FROM imports i
    LEFT JOIN contacts c ON c.id = i.contact_id
    WHERE i.id = ?
  `).get(req.params.id);
  if (!imp) return res.status(404).json({ error: '未找到该导入记录。' });
  const messages = db.prepare(`SELECT * FROM messages WHERE import_id = ? ORDER BY seq ASC`).all(req.params.id);
  res.json({ import: imp, messages });
});

// ---- 消息上下文（前后若干条）----
router.get('/messages/:id/context', (req, res) => {
  const target = db.prepare(`SELECT * FROM messages WHERE id = ?`).get(req.params.id);
  if (!target) return res.status(404).json({ error: '未找到该消息。' });
  const span = Math.min(parseInt(req.query.span, 10) || 5, 50);
  const context = db.prepare(`
    SELECT * FROM messages
    WHERE import_id = ? AND seq BETWEEN ? AND ?
    ORDER BY seq ASC
  `).all(target.import_id, target.seq - span, target.seq + span);
  res.json({ target, context });
});

// ---- 软删除 ----
router.delete('/imports/:id', (req, res) => {
  const info = db.prepare(`UPDATE imports SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`).run(nowISO(), req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: '未找到可删除的记录（可能已被删除）。' });
  res.json({ ok: true });
});

// ---- 恢复 ----
router.post('/imports/:id/restore', (req, res) => {
  const info = db.prepare(`UPDATE imports SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL`).run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: '未在回收站中找到该记录。' });
  res.json({ ok: true });
});

// ---- 彻底删除（须先在回收站中）----
router.delete('/imports/:id/purge', (req, res) => {
  const imp = db.prepare(`SELECT * FROM imports WHERE id = ? AND deleted_at IS NOT NULL`).get(req.params.id);
  if (!imp) return res.status(404).json({ error: '只能彻底删除回收站中的记录，请先删除该导入。' });
  db.prepare(`DELETE FROM imports WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;

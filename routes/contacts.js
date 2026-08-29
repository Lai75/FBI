const express = require('express');
const { db, findOrCreateContact } = require('../lib/db');

const router = express.Router();

router.get('/contacts', (req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.name, COUNT(i.id) AS import_count
    FROM contacts c
    LEFT JOIN imports i ON i.contact_id = c.id AND i.deleted_at IS NULL
    WHERE c.deleted_at IS NULL
    GROUP BY c.id
    ORDER BY c.name COLLATE NOCASE
  `).all();
  res.json(rows);
});

router.post('/contacts', express.json(), (req, res) => {
  const contact = findOrCreateContact(req.body && req.body.name);
  if (!contact) return res.status(400).json({ error: '请填写人物名字。' });
  res.status(201).json(contact);
});

// ---- 回收站 ----
router.get('/contacts/trash', (req, res) => {
  const rows = db.prepare(`SELECT id, name, deleted_at FROM contacts WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`).all();
  res.json(rows);
});

// ---- 软删除 ----
router.delete('/contacts/:id', (req, res) => {
  const info = db.prepare(`UPDATE contacts SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`).run(new Date().toISOString(), req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: '未找到可删除的人物（可能已被删除）。' });
  res.json({ ok: true });
});

// ---- 恢复 ----
router.post('/contacts/:id/restore', (req, res) => {
  const info = db.prepare(`UPDATE contacts SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL`).run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: '未在回收站中找到该人物。' });
  res.json({ ok: true });
});

// ---- 彻底删除（须先在回收站中）----
router.delete('/contacts/:id/purge', (req, res) => {
  const contact = db.prepare(`SELECT * FROM contacts WHERE id = ? AND deleted_at IS NOT NULL`).get(req.params.id);
  if (!contact) return res.status(404).json({ error: '只能彻底删除回收站中的人物，请先删除该人物。' });
  const tx = db.transaction(() => {
    db.prepare(`UPDATE imports SET contact_id = NULL WHERE contact_id = ?`).run(contact.id);
    db.prepare(`DELETE FROM contacts WHERE id = ?`).run(contact.id);
  });
  tx();
  res.json({ ok: true });
});

module.exports = router;

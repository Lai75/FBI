const express = require('express');
const { db, ftsAvailable } = require('../lib/db');

const router = express.Router();

router.get('/search', (req, res) => {
  const q = (req.query.q || '').trim();
  const sender = (req.query.sender || '').trim();
  const dateFrom = (req.query.dateFrom || '').trim();
  const dateTo = (req.query.dateTo || '').trim();
  const importId = (req.query.importId || '').trim();

  if (!q && !sender && !dateFrom && !dateTo && !importId) {
    return res.json({ messages: [], batches: [] });
  }

  const clauses = ['i.deleted_at IS NULL'];
  const params = {};

  if (sender) {
    clauses.push(`m.sender LIKE @sender COLLATE NOCASE`);
    params.sender = `%${sender}%`;
  }
  if (dateFrom) {
    clauses.push(`m.sent_at >= @dateFrom`);
    params.dateFrom = dateFrom;
  }
  if (dateTo) {
    clauses.push(`m.sent_at <= @dateTo`);
    params.dateTo = dateTo + (dateTo.length === 10 ? 'T23:59:59.999Z' : '');
  }
  if (importId) {
    clauses.push(`m.import_id = @importId`);
    params.importId = importId;
  }

  let rows;
  if (q && ftsAvailable) {
    const ftsQuery = q.split(/\s+/).filter(Boolean).map((t) => `"${t.replace(/"/g, '""')}"*`).join(' ');
    const sql = `
      SELECT m.*, i.title AS import_title
      FROM messages_fts f
      JOIN messages m ON m.id = f.rowid
      JOIN imports i ON i.id = m.import_id
      WHERE f MATCH @ftsQuery AND ${clauses.join(' AND ')}
      ORDER BY m.sent_at IS NULL, m.sent_at DESC
      LIMIT 200
    `;
    try {
      rows = db.prepare(sql).all({ ...params, ftsQuery });
    } catch (e) {
      rows = null; // FTS 查询语法失败（例如特殊字符），回退到 LIKE
    }
  }

  if (!rows) {
    if (q) {
      clauses.push(`m.content LIKE @q COLLATE NOCASE`);
      params.q = `%${q}%`;
    }
    const sql = `
      SELECT m.*, i.title AS import_title
      FROM messages m
      JOIN imports i ON i.id = m.import_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY m.sent_at IS NULL, m.sent_at DESC
      LIMIT 200
    `;
    rows = db.prepare(sql).all(params);
  }

  let batches = [];
  if (q) {
    batches = db.prepare(`
      SELECT * FROM imports
      WHERE deleted_at IS NULL AND (title LIKE @q COLLATE NOCASE OR source LIKE @q COLLATE NOCASE)
      ORDER BY created_at DESC LIMIT 50
    `).all({ q: `%${q}%` });
  }

  res.json({ messages: rows, batches });
});

module.exports = router;

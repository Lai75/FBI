const express = require('express');
const { db, findOrCreateContact } = require('../lib/db');

const router = express.Router();

router.get('/contacts', (req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.name, COUNT(i.id) AS import_count
    FROM contacts c
    LEFT JOIN imports i ON i.contact_id = c.id AND i.deleted_at IS NULL
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

module.exports = router;

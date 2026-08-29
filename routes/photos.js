const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, findOrCreateContact, DATA_DIR } = require('../lib/db');

const router = express.Router();

const PHOTOS_DIR = path.join(DATA_DIR, 'photos');
if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true });

const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic']);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, PHOTOS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      cb(null, crypto.randomUUID() + (ALLOWED_EXT.has(ext) ? ext : ''));
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 50 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!file.mimetype.startsWith('image/') || !ALLOWED_EXT.has(ext)) {
      return cb(new Error('只支持图片文件（jpg/png/gif/webp/heic）。'));
    }
    cb(null, true);
  },
});

function nowISO() {
  return new Date().toISOString();
}

function cleanupFiles(files) {
  (files || []).forEach((f) => {
    fs.unlink(f.path, () => {});
  });
}

// ---- 上传照片（新建一个"照片"类型的导入）----
router.post('/imports/photos', (req, res, next) => {
  upload.array('photos', 50)(req, res, (err) => {
    if (err) {
      cleanupFiles(req.files);
      const msg = err.code === 'LIMIT_FILE_SIZE' ? '单张照片超过 10MB 上限。' : err.message;
      return res.status(400).json({ error: msg });
    }
    next();
  });
}, (req, res) => {
  const { title, source, contact_name } = req.body || {};
  if (!title || !title.trim()) {
    cleanupFiles(req.files);
    return res.status(400).json({ error: '请为本次导入命名。' });
  }
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: '请至少选择一张照片。' });
  }

  const contact = findOrCreateContact(contact_name);

  const insertImport = db.prepare(
    `INSERT INTO imports (title, source, timezone, status, created_at, contact_id, type) VALUES (?, ?, 'local', 'confirmed', ?, ?, 'photo')`
  );
  const insertPhoto = db.prepare(
    `INSERT INTO photos (import_id, seq, filename, stored_name, mime_type, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  const tx = db.transaction((files) => {
    const info = insertImport.run(title.trim(), source || null, nowISO(), contact ? contact.id : null);
    const importId = info.lastInsertRowid;
    files.forEach((f, idx) => {
      insertPhoto.run(importId, idx, f.originalname, f.filename, f.mimetype, f.size, nowISO());
    });
    return importId;
  });

  const importId = tx(req.files);
  res.status(201).json({ id: importId });
});

// ---- 单张照片文件 ----
router.get('/photos/:id/file', (req, res) => {
  const photo = db.prepare(`SELECT * FROM photos WHERE id = ?`).get(req.params.id);
  if (!photo) return res.status(404).end();
  res.sendFile(path.join(PHOTOS_DIR, photo.stored_name));
});

// ---- 软删除单张照片 ----
router.delete('/photos/:id', (req, res) => {
  const info = db.prepare(`UPDATE photos SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`).run(nowISO(), req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: '未找到可删除的照片（可能已被删除）。' });
  res.json({ ok: true });
});

// ---- 恢复单张照片 ----
router.post('/photos/:id/restore', (req, res) => {
  const info = db.prepare(`UPDATE photos SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL`).run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: '未在回收站中找到该照片。' });
  res.json({ ok: true });
});

// ---- 彻底删除单张照片（须先在回收站中）----
router.delete('/photos/:id/purge', (req, res) => {
  const photo = db.prepare(`SELECT * FROM photos WHERE id = ? AND deleted_at IS NOT NULL`).get(req.params.id);
  if (!photo) return res.status(404).json({ error: '只能彻底删除回收站中的照片，请先删除该照片。' });
  db.prepare(`DELETE FROM photos WHERE id = ?`).run(photo.id);
  fs.unlink(path.join(PHOTOS_DIR, photo.stored_name), () => {});
  res.json({ ok: true });
});

// ---- 照片回收站列表 ----
router.get('/photos/trash', (req, res) => {
  const rows = db.prepare(`
    SELECT p.id, p.filename, p.deleted_at, p.import_id, i.title AS import_title
    FROM photos p
    JOIN imports i ON i.id = p.import_id
    WHERE p.deleted_at IS NOT NULL
    ORDER BY p.deleted_at DESC
  `).all();
  res.json(rows);
});

module.exports = router;

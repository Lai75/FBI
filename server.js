const express = require('express');
const path = require('path');
const crypto = require('crypto');

const importsRouter = require('./routes/imports');
const searchRouter = require('./routes/search');
const contactsRouter = require('./routes/contacts');

const app = express();
const PORT = process.env.PORT || 3000;
// 本机运行时只监听 127.0.0.1；部署到云端需设置 HOST=0.0.0.0
const HOST = process.env.HOST || '127.0.0.1';
const SITE_PASSWORD = process.env.SITE_PASSWORD;

if (SITE_PASSWORD) {
  app.use((req, res, next) => {
    const header = req.headers.authorization || '';
    const [scheme, encoded] = header.split(' ');
    const provided = scheme === 'Basic' && encoded
      ? Buffer.from(encoded, 'base64').toString().split(':')[1] || ''
      : '';
    const expected = Buffer.from(SITE_PASSWORD);
    const given = Buffer.from(provided);
    const ok = given.length === expected.length && crypto.timingSafeEqual(given, expected);
    if (!ok) {
      res.set('WWW-Authenticate', 'Basic realm="liaohuiyi"');
      return res.status(401).send('需要密码');
    }
    next();
  });
}

app.use('/api', importsRouter);
app.use('/api', searchRouter);
app.use('/api', contactsRouter);

app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: '服务器内部错误：' + err.message });
});

app.listen(PORT, HOST, () => {
  console.log(`聊回忆已启动：http://${HOST}:${PORT}`);
  console.log(SITE_PASSWORD ? '已启用密码保护。' : '未设置 SITE_PASSWORD，无密码保护。');
});

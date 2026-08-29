const express = require('express');
const path = require('path');

const importsRouter = require('./routes/imports');
const searchRouter = require('./routes/search');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '127.0.0.1'; // 仅本机可访问，不对外暴露

app.use('/api', importsRouter);
app.use('/api', searchRouter);

app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: '服务器内部错误：' + err.message });
});

app.listen(PORT, HOST, () => {
  console.log(`聊回忆已启动：http://${HOST}:${PORT}`);
  console.log('数据保存在本地 data/liaohuiyi.db，仅本机可访问。');
});

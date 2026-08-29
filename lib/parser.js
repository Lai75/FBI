// 统一聊天记录解析器
// 输出: { messages: [{sent_at, sender, content, needs_review}], warnings: string[], formatDetected: string }

const TIME_ALIASES = ['time', 'datetime', 'date', '时间', '日期', '发送时间'];
const SENDER_ALIASES = ['sender', 'from', 'name', 'user', '人物', '发送人', '发送者', '昵称', '用户'];
const CONTENT_ALIASES = ['content', 'message', 'text', 'msg', '内容', '消息', '正文'];

const WECHAT_HEADER_RE = /^(.{1,50}?)\s+(\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)\s*$/;
const INLINE_RE = /^\[?(\d{4}[-/]\d{1,2}[-/]\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2})?)\]?\s*[-–—]?\s*(.+?)\s*[:：]\s*(.*)$/;

function toISO(rawDate) {
  if (!rawDate) return null;
  const normalized = rawDate.replace(/\//g, '-').trim();
  const d = new Date(normalized.replace(' ', 'T'));
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function parseCSVLine(line) {
  const fields = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { fields.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  fields.push(cur);
  return fields.map((f) => f.trim());
}

function looksLikeCSVHeader(line) {
  if (!line.includes(',')) return false;
  const cols = parseCSVLine(line).map((c) => c.toLowerCase());
  return cols.some((c) => TIME_ALIASES.includes(c) || SENDER_ALIASES.includes(c) || CONTENT_ALIASES.includes(c));
}

function parseCSV(text) {
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.length > 0);
  const warnings = [];
  const messages = [];
  if (lines.length === 0) return { messages, warnings, formatDetected: 'csv' };

  let startIdx = 0;
  let timeIdx = 0, senderIdx = 1, contentIdx = 2;
  const headerCols = parseCSVLine(lines[0]).map((c) => c.toLowerCase());
  const hasHeader = headerCols.some((c) => TIME_ALIASES.includes(c) || SENDER_ALIASES.includes(c) || CONTENT_ALIASES.includes(c));
  if (hasHeader) {
    startIdx = 1;
    const ti = headerCols.findIndex((c) => TIME_ALIASES.includes(c));
    const si = headerCols.findIndex((c) => SENDER_ALIASES.includes(c));
    const ci = headerCols.findIndex((c) => CONTENT_ALIASES.includes(c));
    if (ti >= 0) timeIdx = ti;
    if (si >= 0) senderIdx = si;
    if (ci >= 0) contentIdx = ci;
    else warnings.push('CSV 表头未找到"内容"列，已按第三列作为正文处理');
  } else {
    warnings.push('CSV 未检测到表头，默认按 时间,发送人,内容 三列顺序解析');
  }

  for (let i = startIdx; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const rawTime = cols[timeIdx] || '';
    const sender = (cols[senderIdx] || '').trim() || null;
    const content = (cols[contentIdx] !== undefined ? cols[contentIdx] : cols.join(',')).trim();
    if (!content) continue;
    const iso = toISO(rawTime);
    const needsReview = !iso || !sender;
    if (needsReview) warnings.push(`第 ${i + 1} 行：时间或发送人未能识别，已标记为待确认`);
    messages.push({ sent_at: iso, sender, content, needs_review: needsReview ? 1 : 0 });
  }
  return { messages, warnings, formatDetected: 'csv' };
}

function parseWeChatBlocks(lines) {
  const messages = [];
  const warnings = [];
  let headerCount = 0;
  let i = 0;

  while (i < lines.length) {
    if (lines[i].trim() === '') { i++; continue; }

    const headerMatch = lines[i].trim().match(WECHAT_HEADER_RE);
    if (!headerMatch) {
      // 不属于任何消息块的孤立内容（文件开头、结尾，或格式不规范处），整段标记为待确认
      const strayLines = [];
      while (i < lines.length && lines[i].trim() !== '' && !WECHAT_HEADER_RE.test(lines[i].trim())) {
        strayLines.push(lines[i]);
        i++;
      }
      const content = strayLines.join('\n').trim();
      if (content) {
        messages.push({ sent_at: null, sender: null, content, needs_review: 1 });
        warnings.push('存在无法识别归属的内容，已标记为待确认');
      }
      continue;
    }

    headerCount++;
    const sender = headerMatch[1].trim();
    const iso = toISO(headerMatch[2]);
    i++;
    const contentLines = [];
    while (i < lines.length && lines[i].trim() !== '' && !WECHAT_HEADER_RE.test(lines[i].trim())) {
      contentLines.push(lines[i]);
      i++;
    }
    const content = contentLines.join('\n').trim();
    if (!content) continue;
    const needsReview = !iso;
    if (needsReview) warnings.push(`"${sender}" 的一条消息时间格式无法识别，已标记为待确认`);
    messages.push({ sent_at: iso, sender, content, needs_review: needsReview ? 1 : 0 });
  }

  return { messages, warnings, headerCount };
}

function parseGenericLines(lines) {
  const messages = [];
  const warnings = [];
  let matchCount = 0;

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (!line.trim()) continue;
    const m = line.trim().match(INLINE_RE);
    if (m) {
      matchCount++;
      const iso = toISO(m[1]);
      const sender = m[2].trim();
      const content = m[3].trim();
      if (!content) continue;
      const needsReview = !iso;
      messages.push({ sent_at: iso, sender, content, needs_review: needsReview ? 1 : 0 });
      if (needsReview) warnings.push(`第 ${idx + 1} 行：时间格式无法识别，已标记为待确认`);
    } else {
      messages.push({ sent_at: null, sender: null, content: line.trim(), needs_review: 1 });
      warnings.push(`第 ${idx + 1} 行：无法识别时间/发送人，已原样保留为待确认`);
    }
  }
  return { messages, warnings, matchCount };
}

function parseChatText({ text, filename = '' }) {
  if (!text || !text.trim()) {
    return { messages: [], warnings: ['输入内容为空'], formatDetected: 'empty' };
  }

  const firstLine = text.split(/\r\n|\r|\n/).find((l) => l.trim().length > 0) || '';
  const isCSV = filename.toLowerCase().endsWith('.csv') || looksLikeCSVHeader(firstLine);
  if (isCSV) {
    return parseCSV(text);
  }

  const lines = text.split(/\r\n|\r|\n/);
  const blockResult = parseWeChatBlocks(lines);
  if (blockResult.headerCount >= 1) {
    return { messages: blockResult.messages, warnings: blockResult.warnings, formatDetected: 'wechat-block' };
  }

  const genericResult = parseGenericLines(lines);
  return {
    messages: genericResult.messages,
    warnings: genericResult.warnings,
    formatDetected: genericResult.matchCount > 0 ? 'inline' : 'fallback-raw',
  };
}

module.exports = { parseChatText, toISO };

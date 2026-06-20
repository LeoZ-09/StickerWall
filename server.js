/**
 * 便签墙 (StickerWall) - Node.js + Express + SQLite 后端
 * 摄影社团课堂 Ideas 记录工具
 */
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');
const https = require('https');
const { WebSocketServer } = require('ws');
const initSqlJs = require('sql.js');

const app = express();
const PORT = 5050;

// ==================== Configuration ====================
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'stickers.db');
const UPLOAD_DIR = path.join(__dirname, 'static', 'uploads');
const JSON_STICKERS_PATH = path.join(DATA_DIR, 'stickers.json');
const JSON_CONNS_PATH = path.join(DATA_DIR, 'connections.json');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use('/static', express.static(path.join(__dirname, 'static')));

// ==================== SQLite Database (sql.js) ====================
let db;

async function initDB() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS stickers (
      id TEXT PRIMARY KEY,
      author TEXT NOT NULL DEFAULT '匿名',
      content_type TEXT NOT NULL DEFAULT 'text',
      text_content TEXT DEFAULT '',
      image_path TEXT DEFAULT '',
      drawing_data TEXT DEFAULT '',
      handwriting_data TEXT DEFAULT '',
      bg_color TEXT DEFAULT '#FFF9E6',
      pos_x REAL DEFAULT 0,
      pos_y REAL DEFAULT 0,
      rotation REAL DEFAULT 0,
      width INTEGER DEFAULT 280,
      height INTEGER DEFAULT 280,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      id_a TEXT NOT NULL,
      id_b TEXT NOT NULL,
      label TEXT DEFAULT '',
      created_at TEXT NOT NULL
    )
  `);

  // Indexes for performance
  db.run('CREATE INDEX IF NOT EXISTS idx_conn_id_a ON connections(id_a)');
  db.run('CREATE INDEX IF NOT EXISTS idx_conn_id_b ON connections(id_b)');
  db.run('CREATE INDEX IF NOT EXISTS idx_stickers_created ON stickers(created_at)');

  saveDB();
  console.log('  🗄️  SQLite database ready');
}

function saveDB() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// ==================== Helpers ====================

function nowISO() {
  return new Date().toISOString();
}

function dbQuery(sql, params) {
  const stmt = db.prepare(sql);
  if (params) stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function dbRun(sql, params) {
  db.run(sql, params);
  saveDB();
}

function formatSticker(row) {
  const result = { ...row };
  for (const key of ['drawing_data', 'handwriting_data']) {
    if (result[key] && typeof result[key] === 'string') {
      try {
        result[key] = JSON.parse(result[key]);
      } catch {
        result[key] = null;
      }
    }
  }
  return result;
}

function allStickers() {
  return dbQuery('SELECT * FROM stickers ORDER BY created_at DESC').map(formatSticker);
}

function getSticker(id) {
  const rows = dbQuery('SELECT * FROM stickers WHERE id = ?', [id]);
  return rows.length > 0 ? formatSticker(rows[0]) : null;
}

// ==================== JSON Migration ====================
async function migrateFromJson() {
  const existingCount = dbQuery('SELECT COUNT(*) AS c FROM stickers')[0].c;
  if (existingCount > 0) {
    console.log('  📦 Database already has data, skipping JSON migration');
    return;
  }

  // Migrate stickers
  if (fs.existsSync(JSON_STICKERS_PATH)) {
    try {
      const raw = fs.readFileSync(JSON_STICKERS_PATH, 'utf-8');
      const stickers = JSON.parse(raw);
      const insert = db.prepare(`
        INSERT INTO stickers (id, author, content_type, text_content, image_path,
          drawing_data, handwriting_data, bg_color, pos_x, pos_y, rotation,
          width, height, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const s of stickers) {
        insert.run([
          s.id, s.author, s.content_type, s.text_content, s.image_path,
          s.drawing_data ? JSON.stringify(s.drawing_data) : null,
          s.handwriting_data ? JSON.stringify(s.handwriting_data) : null,
          s.bg_color, s.pos_x, s.pos_y, s.rotation,
          s.width, s.height, s.created_at, s.updated_at
        ]);
      }
      insert.free();
      saveDB();
      console.log(`  📦 Migrated ${stickers.length} stickers from stickers.json`);
    } catch (e) {
      console.error('  ⚠️  Sticker migration error:', e.message);
    }
  }

  // Migrate connections
  if (fs.existsSync(JSON_CONNS_PATH)) {
    try {
      const raw = fs.readFileSync(JSON_CONNS_PATH, 'utf-8');
      const conns = JSON.parse(raw);
      const insert = db.prepare('INSERT INTO connections (id, id_a, id_b, label, created_at) VALUES (?, ?, ?, ?, ?)');
      for (const c of conns) {
        insert.run([c.id, c.id_a, c.id_b, c.label || '', c.created_at]);
      }
      insert.free();
      saveDB();
      console.log(`  📦 Migrated ${conns.length} connections from connections.json`);
    } catch (e) {
      console.error('  ⚠️  Connections migration error:', e.message);
    }
  }
}

// ==================== SSL / TLS ====================
const CERT_DIR = path.join(__dirname, 'cert');
const sslOptions = {
  key: fs.readFileSync(path.join(CERT_DIR, 'server.key')),
  cert: fs.readFileSync(path.join(CERT_DIR, 'server.crt'))
};

// ==================== WebSocket (Real-time sync) ====================
const server = https.createServer(sslOptions, app);
const wss = new WebSocketServer({ server });
const wsClients = new Set();

wss.on('connection', (ws) => {
  wsClients.add(ws);
  ws.on('close', () => wsClients.delete(ws));
  ws.on('error', () => wsClients.delete(ws));
});

function wsBroadcast(type, payload) {
  const msg = JSON.stringify({ type, ...payload });
  for (const client of wsClients) {
    if (client.readyState === 1) {
      try { client.send(msg); } catch { wsClients.delete(client); }
    }
  }
}

function wsStickerCreated(sticker)   { wsBroadcast('sticker:created',   { sticker }); }
function wsStickerUpdated(sticker)   { wsBroadcast('sticker:updated',   { sticker }); }
function wsStickerDeleted(id)        { wsBroadcast('sticker:deleted',   { id }); }
function wsConnectionCreated(conn)   { wsBroadcast('connection:created', { connection: conn }); }
function wsConnectionDeleted(id)     { wsBroadcast('connection:deleted', { id }); }

// ==================== Upload ====================
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('不支持的图片格式'));
    }
  }
});

// ==================== Routes: Stickers ====================

// GET /api/stickers — List all
app.get('/api/stickers', (req, res) => {
  res.json(allStickers());
});

// POST /api/stickers — Create
app.post('/api/stickers', (req, res) => {
  const data = req.body;
  const id = data.id || uuidv4().slice(0, 8);
  const author = (data.author || '匿名').trim() || '匿名';
  const ts = nowISO();

  const drawingData = serializeJsonField(data.drawing_data);
  const handwritingData = serializeJsonField(data.handwriting_data);

  dbRun(`
    INSERT INTO stickers (id, author, content_type, text_content, image_path,
      drawing_data, handwriting_data, bg_color, pos_x, pos_y, rotation,
      width, height, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id, author, data.content_type || 'text', data.text_content || '', data.image_path || '',
    drawingData, handwritingData,
    data.bg_color || '#FFF9E6', data.pos_x || 0, data.pos_y || 0, data.rotation || 0,
    data.width || 280, data.height || 280, ts, ts
  ]);

  const sticker = getSticker(id);
  res.status(201).json(sticker);
  wsStickerCreated(sticker);
});

// PUT /api/stickers/:id — Update
app.put('/api/stickers/:id', (req, res) => {
  const { id } = req.params;
  const data = req.body;

  const existing = getSticker(id);
  if (!existing) return res.status(404).json({ error: '未找到便签' });

  const updates = [];
  const values = [];

  for (const key of ['author', 'text_content', 'bg_color', 'pos_x', 'pos_y',
                     'rotation', 'width', 'height', 'image_path', 'content_type']) {
    if (data[key] !== undefined) {
      updates.push(`${key} = ?`);
      values.push(data[key]);
    }
  }
  for (const key of ['drawing_data', 'handwriting_data']) {
    if (data[key] !== undefined) {
      updates.push(`${key} = ?`);
      values.push(serializeJsonField(data[key]));
    }
  }

  if (updates.length === 0) {
    return res.json(existing);
  }

  updates.push('updated_at = ?');
  values.push(nowISO());
  values.push(id);

  dbRun(`UPDATE stickers SET ${updates.join(', ')} WHERE id = ?`, values);

  const sticker = getSticker(id);
  res.json(sticker);
  wsStickerUpdated(sticker);
});

// DELETE /api/stickers/:id — Delete with cascade
app.delete('/api/stickers/:id', (req, res) => {
  const { id } = req.params;
  const target = getSticker(id);

  if (target && target.image_path) {
    const fp = path.join(__dirname, target.image_path.replace(/^\//, ''));
    if (fs.existsSync(fp)) {
      try { fs.unlinkSync(fp); } catch { /* ignore */ }
    }
  }

  // Cascade: remove connections involving this sticker
  const conns = dbQuery('SELECT id FROM connections WHERE id_a = ? OR id_b = ?', [id, id]);
  for (const c of conns) {
    wsConnectionDeleted(c.id);
  }
  dbRun('DELETE FROM connections WHERE id_a = ? OR id_b = ?', [id, id]);
  dbRun('DELETE FROM stickers WHERE id = ?', [id]);

  wsStickerDeleted(id);
  res.json({ ok: true });
});

// ==================== Routes: Connections ====================

// GET /api/connections — List all
app.get('/api/connections', (req, res) => {
  res.json(dbQuery('SELECT * FROM connections ORDER BY created_at DESC'));
});

// GET /api/stickers/:id/connections — For a specific sticker
app.get('/api/stickers/:id/connections', (req, res) => {
  const { id } = req.params;
  res.json(dbQuery('SELECT * FROM connections WHERE id_a = ? OR id_b = ?', [id, id]));
});

// POST /api/connections — Create (undirected edge, sorted pair)
app.post('/api/connections', (req, res) => {
  const { id_a, id_b, label } = req.body;
  if (!id_a || !id_b) return res.status(400).json({ error: '缺少 id_a 或 id_b' });
  if (id_a === id_b) return res.status(400).json({ error: '不能与自身建立联系' });

  let [a, b] = [id_a, id_b];
  if (a > b) [a, b] = [b, a];

  // Check duplicate
  const dup = dbQuery('SELECT id FROM connections WHERE id_a = ? AND id_b = ?', [a, b]);
  if (dup.length > 0) {
    return res.status(409).json({ error: '已存在相同联系' });
  }

  const conn = {
    id: uuidv4().slice(0, 8),
    id_a: a,
    id_b: b,
    label: label || '',
    created_at: nowISO()
  };

  dbRun('INSERT INTO connections (id, id_a, id_b, label, created_at) VALUES (?, ?, ?, ?, ?)',
    [conn.id, conn.id_a, conn.id_b, conn.label, conn.created_at]);

  res.status(201).json(conn);
  wsConnectionCreated(conn);
});

// DELETE /api/connections/:id — Delete
app.delete('/api/connections/:id', (req, res) => {
  const { id } = req.params;
  dbRun('DELETE FROM connections WHERE id = ?', [id]);
  wsConnectionDeleted(id);
  res.json({ ok: true });
});

// ==================== Routes: Upload ====================

app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '无文件' });

  try {
    const ext = path.extname(req.file.originalname).toLowerCase();
    const filename = uuidv4() + ext;
    const savePath = path.join(UPLOAD_DIR, filename);

    let pipeline = sharp(req.file.buffer)
      .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true });

    if (ext === '.png') {
      await pipeline.png({ quality: 85 }).toFile(savePath);
    } else if (ext === '.webp') {
      await pipeline.webp({ quality: 85 }).toFile(savePath);
    } else {
      await pipeline.jpeg({ quality: 85, mozjpeg: true }).toFile(savePath);
    }

    res.json({ url: `/static/uploads/${filename}`, filename });
  } catch (err) {
    console.error('图片处理错误:', err);
    res.status(500).json({ error: '图片处理失败' });
  }
});

// ==================== Agent Module ====================
const { runAgent } = require('./agent');

// ==================== Routes: AI Chat Proxy ====================
// 纯透传代理：API Key 由前端提供，服务端不存储任何 AI 配置

app.post('/api/ai/chat', express.json(), async (req, res) => {
  const { message, systemPrompt, model, baseUrl, apiKey } = req.body;

  if (!apiKey) {
    return res.status(400).json({ error: '缺少 apiKey 参数，请在设置中配置 API Key' });
  }
  if (!message) {
    return res.status(400).json({ error: '缺少 message 参数' });
  }

  const targetUrl = (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '') + '/chat/completions';

  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model || 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: systemPrompt || '你是一个友好的便签墙助手。' },
          { role: 'user', content: message }
        ],
        temperature: 0.7,
        max_tokens: 2000
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      return res.status(response.status).json({ error: `AI 服务响应错误: ${response.status}`, detail: errBody });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (content) {
      res.json({ content });
    } else {
      res.status(502).json({ error: 'AI 返回了空响应' });
    }
  } catch (err) {
    console.error('AI proxy error:', err.message);
    res.status(502).json({ error: `AI 请求失败: ${err.message}` });
  }
});

// ==================== Routes: Agent Chat (SSE) ====================
// Agent 模式：LLM + tool calling 编排，SSE 流式推送每一步

app.post('/api/agent/chat', express.json(), async (req, res) => {
  const { message, systemPrompt, model, baseUrl, apiKey } = req.body;

  if (!apiKey) {
    return res.status(400).json({ error: '缺少 apiKey 参数，请在设置中配置 API Key' });
  }
  if (!message) {
    return res.status(400).json({ error: '缺少 message 参数' });
  }

  // SSE 头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sse = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const db = {
    dbQuery: (sql, params) => {
      // 引用 server.js 中的顶层 dbQuery
      return dbQuery(sql, params);
    },
    formatSticker: (row) => {
      return formatSticker(row);
    }
  };

  try {
    await runAgent({
      userMessage: message,
      systemPrompt: systemPrompt || '你是一个友好的便签墙助手。',
      apiKey,
      baseUrl,
      model,
      db,
      onEvent: (eventType, data) => {
        if (eventType === 'thinking') {
          sse('thinking', { tool: data.tool, args: data.args });
        } else if (eventType === 'tool_result') {
          sse('tool_result', { tool: data.tool, result: data.result });
        } else if (eventType === 'done') {
          sse('done', { content: data.content });
        } else if (eventType === 'error') {
          sse('error', { message: data.message });
        }
      }
    });
  } catch (err) {
    // runAgent 内部已通过 onEvent 发送 error，这里仅确保连接关闭
    sse('error', { message: err.message || 'Agent 执行失败' });
  } finally {
    res.end();
  }
});

// ==================== Serve Frontend ====================

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'static', 'index.html'));
});

// ==================== Startup ====================

async function start() {
  await initDB();
  await migrateFromJson();

  server.listen(PORT, () => {
    console.log('');
    console.log('  📌 便签墙 (StickerWall)');
    console.log(`  🚀 服务已启动: https://localhost:${PORT} (WebSocket 实时同步已开启)`);
    console.log(`  🗄️  数据库: SQLite (sql.js)`);
    console.log('  🤖 AI 代理: 就绪 (API Key 由前端配置，服务端纯透传)');
    console.log('');
  });
}

function serializeJsonField(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string') return val;
  return JSON.stringify(val);
}

start().catch(err => {
  console.error('启动失败:', err);
  process.exit(1);
});

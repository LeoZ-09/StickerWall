/**
 * 便签墙 (StickerWall) - Node.js + Express 后端
 * SQLite 存储 + WebSocket 实时同步
 */
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');
const Database = require('better-sqlite3');
const http = require('http');
const { WebSocketServer } = require('ws');

const app = express();
const PORT = 5050;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use('/static', express.static(path.join(__dirname, 'static')));

// ==================== SQLite Database ====================
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'static', 'uploads');
const DB_PATH = path.join(DATA_DIR, 'stickers.db');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS stickers (
    id            TEXT PRIMARY KEY,
    author        TEXT NOT NULL DEFAULT '匿名',
    content_type  TEXT NOT NULL DEFAULT 'text',
    text_content  TEXT DEFAULT '',
    image_path    TEXT DEFAULT '',
    drawing_data  TEXT DEFAULT '',
    handwriting_data TEXT DEFAULT '',
    bg_color      TEXT DEFAULT '#FFF9E6',
    pos_x         REAL DEFAULT 0,
    pos_y         REAL DEFAULT 0,
    rotation      REAL DEFAULT 0,
    width         INTEGER DEFAULT 280,
    height        INTEGER DEFAULT 280,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  )
`);

// ==================== Migration from JSON ====================
const JSON_DB = path.join(DATA_DIR, 'stickers.json');
if (fs.existsSync(JSON_DB)) {
  const count = db.prepare('SELECT COUNT(*) AS c FROM stickers').get().c;
  if (count === 0) {
    try {
      const raw = fs.readFileSync(JSON_DB, 'utf-8');
      const items = JSON.parse(raw);
      if (Array.isArray(items) && items.length > 0) {
        const stmt = db.prepare(`
          INSERT OR IGNORE INTO stickers
            (id, author, content_type, text_content, image_path,
             drawing_data, handwriting_data, bg_color,
             pos_x, pos_y, rotation, width, height, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const tx = db.transaction((list) => {
          for (const item of list) {
            stmt.run(
              item.id, item.author, item.content_type, item.text_content || '',
              item.image_path || '',
              item.drawing_data ? JSON.stringify(item.drawing_data) : '',
              item.handwriting_data ? JSON.stringify(item.handwriting_data) : '',
              item.bg_color || '#FFF9E6',
              item.pos_x || 0, item.pos_y || 0, item.rotation || 0,
              item.width || 280, item.height || 280,
              item.created_at || nowCST(), item.updated_at || nowCST()
            );
          }
        });
        tx(items);
        console.log(`  📦 从 stickers.json 迁移了 ${items.length} 条数据`);
      }
    } catch (e) {
      console.error('  ⚠️  JSON 迁移失败:', e.message);
    }
  }
}

// ==================== Helpers ====================
function nowCST() {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

function rowToSticker(row) {
  const s = { ...row };
  s.drawing_data = parseJSONField(s.drawing_data);
  s.handwriting_data = parseJSONField(s.handwriting_data);
  return s;
}

function parseJSONField(val) {
  if (!val || val === 'null' || val === '') return null;
  try { return JSON.parse(val); } catch { return null; }
}

// ==================== WebSocket ====================
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(msg);
  });
}

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

// ==================== Routes ====================

// Get all stickers
app.get('/api/stickers', (req, res) => {
  const rows = db.prepare('SELECT * FROM stickers ORDER BY created_at DESC').all();
  res.json(rows.map(rowToSticker));
});

// Create sticker
app.post('/api/stickers', (req, res) => {
  const data = req.body;
  const ts = nowCST();
  const sticker = {
    id: data.id || uuidv4().slice(0, 8),
    author: (data.author || '匿名').trim() || '匿名',
    content_type: data.content_type || 'text',
    text_content: data.text_content || '',
    image_path: data.image_path || '',
    drawing_data: data.drawing_data || null,
    handwriting_data: data.handwriting_data || null,
    bg_color: data.bg_color || '#FFF9E6',
    pos_x: data.pos_x || 0,
    pos_y: data.pos_y || 0,
    rotation: data.rotation || 0,
    width: data.width || 280,
    height: data.height || 280,
    created_at: ts,
    updated_at: ts
  };

  const dd = sticker.drawing_data
    ? (typeof sticker.drawing_data === 'string' ? sticker.drawing_data : JSON.stringify(sticker.drawing_data))
    : '';
  const hd = sticker.handwriting_data
    ? (typeof sticker.handwriting_data === 'string' ? sticker.handwriting_data : JSON.stringify(sticker.handwriting_data))
    : '';

  db.prepare(`
    INSERT INTO stickers
      (id, author, content_type, text_content, image_path,
       drawing_data, handwriting_data, bg_color,
       pos_x, pos_y, rotation, width, height, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sticker.id, sticker.author, sticker.content_type, sticker.text_content,
    sticker.image_path, dd, hd, sticker.bg_color,
    sticker.pos_x, sticker.pos_y, sticker.rotation,
    sticker.width, sticker.height, sticker.created_at, sticker.updated_at
  );

  const saved = rowToSticker(db.prepare('SELECT * FROM stickers WHERE id = ?').get(sticker.id));
  broadcast({ type: 'sticker:created', sticker: saved });
  res.status(201).json(saved);
});

// Update sticker
app.put('/api/stickers/:id', (req, res) => {
  const { id } = req.params;
  const data = req.body;
  const row = db.prepare('SELECT * FROM stickers WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: '未找到便签' });

  const fields = [];
  const values = [];

  const allowed = ['author', 'text_content', 'bg_color', 'pos_x', 'pos_y',
    'rotation', 'width', 'height', 'image_path', 'content_type'];

  allowed.forEach((k) => {
    if (data[k] !== undefined) {
      fields.push(`${k} = ?`);
      values.push(data[k]);
    }
  });

  ['drawing_data', 'handwriting_data'].forEach((k) => {
    if (data[k] !== undefined) {
      const v = typeof data[k] === 'object' ? JSON.stringify(data[k]) : data[k];
      fields.push(`${k} = ?`);
      values.push(v);
    }
  });

  if (fields.length > 0) {
    const ts = nowCST();
    fields.push('updated_at = ?');
    values.push(ts);
    values.push(id);
    db.prepare(`UPDATE stickers SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  const updated = rowToSticker(db.prepare('SELECT * FROM stickers WHERE id = ?').get(id));
  broadcast({ type: 'sticker:updated', sticker: updated });
  res.json(updated);
});

// Delete sticker
app.delete('/api/stickers/:id', (req, res) => {
  const { id } = req.params;
  const row = db.prepare('SELECT * FROM stickers WHERE id = ?').get(id);
  if (row && row.image_path) {
    const fp = path.join(__dirname, row.image_path.replace(/^\//, ''));
    if (fs.existsSync(fp)) try { fs.unlinkSync(fp); } catch {}
  }
  db.prepare('DELETE FROM stickers WHERE id = ?').run(id);
  broadcast({ type: 'sticker:deleted', id });
  res.json({ ok: true });
});

// Upload image
app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '无文件' });
  try {
    const filename = uuidv4() + path.extname(req.file.originalname).toLowerCase();
    const savePath = path.join(UPLOAD_DIR, filename);

    let pipeline = sharp(req.file.buffer)
      .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true });

    const ext = path.extname(filename).toLowerCase();
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

// AI Chat proxy
app.post('/api/ai/chat', async (req, res) => {
  const { messages, apiKey, baseUrl, model } = req.body;
  if (!apiKey) return res.status(400).json({ error: '缺少 API Key' });
  if (!baseUrl) return res.status(400).json({ error: '缺少接口地址' });
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: '缺少消息' });

  const url = baseUrl.replace(/\/+$/, '') + '/chat/completions';
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model || 'gpt-3.5-turbo',
        messages,
        stream: false
      })
    });
    if (!resp.ok) {
      const text = await resp.text();
      return res.status(resp.status).json({ error: `API 错误 (${resp.status}): ${text}` });
    }
    const data = await resp.json();
    res.json(data);
  } catch (e) {
    console.error('AI proxy error:', e.message);
    res.status(500).json({ error: '请求 AI 服务失败: ' + e.message });
  }
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'static', 'index.html'));
});

server.listen(PORT, () => {
  console.log('');
  console.log('  📌 便签墙 (StickerWall)');
  console.log(`  🚀 服务已启动: http://localhost:${PORT}`);
  console.log('  🔌 WebSocket 实时同步已启用');
  console.log('');
});

/**
 * 便签墙 (StickerWall) - Node.js + Express 后端
 * 使用 JSON 文件存储数据
 */
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');
const http = require('http');
const { WebSocketServer } = require('ws');

const app = express();
const PORT = 5050;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use('/static', express.static(path.join(__dirname, 'static')));

// ==================== JSON File Database ====================
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'stickers.json');
const CONN_DB_FILE = path.join(DATA_DIR, 'connections.json');
const UPLOAD_DIR = path.join(__dirname, 'static', 'uploads');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, '[]', 'utf-8');
}
if (!fs.existsSync(CONN_DB_FILE)) {
  fs.writeFileSync(CONN_DB_FILE, '[]', 'utf-8');
}

function readDB() {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function readConns() {
  try {
    const raw = fs.readFileSync(CONN_DB_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeConns(data) {
  fs.writeFileSync(CONN_DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function nowCST() {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

// ==================== WebSocket (实时同步) ====================
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const wsClients = new Set();

wss.on('connection', function connection(ws) {
  wsClients.add(ws);
  ws.on('close', function() { wsClients.delete(ws); });
  ws.on('error', function() { wsClients.delete(ws); });
});

function wsBroadcast(type, payload) {
  const msg = JSON.stringify(Object.assign({ type: type }, payload));
  wsClients.forEach(function(client) {
    if (client.readyState === 1) {
      try { client.send(msg); } catch(e) { wsClients.delete(client); }
    }
  });
}

function wsStickerCreated(sticker)   { wsBroadcast('sticker:created',   { sticker: sticker }); }
function wsStickerUpdated(sticker)   { wsBroadcast('sticker:updated',   { sticker: sticker }); }
function wsStickerDeleted(id)        { wsBroadcast('sticker:deleted',   { id: id }); }
function wsConnectionCreated(conn)   { wsBroadcast('connection:created', { connection: conn }); }
function wsConnectionDeleted(id)     { wsBroadcast('connection:deleted', { id: id }); }

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
  const stickers = readDB();
  stickers.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(stickers);
});

// Create sticker
app.post('/api/stickers', (req, res) => {
  const data = req.body;
  const stickers = readDB();
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
    created_at: nowCST(),
    updated_at: nowCST()
  };
  stickers.push(sticker);
  writeDB(stickers);
  res.status(201).json(sticker);
  wsStickerCreated(sticker);
});

// Update sticker
app.put('/api/stickers/:id', (req, res) => {
  const { id } = req.params;
  const data = req.body;
  const stickers = readDB();
  const index = stickers.findIndex(s => s.id === id);
  if (index === -1) return res.status(404).json({ error: '未找到便签' });

  const allowed = ['author', 'text_content', 'bg_color', 'pos_x', 'pos_y', 'rotation', 'width', 'height', 'image_path', 'content_type', 'drawing_data', 'handwriting_data'];
  allowed.forEach(k => {
    if (data[k] !== undefined) stickers[index][k] = data[k];
  });
  stickers[index].updated_at = nowCST();
  writeDB(stickers);
  res.json(stickers[index]);
  wsStickerUpdated(stickers[index]);
});

// Helper: cascade delete connections involving a sticker
function cascadeDeleteConnections(stickerId) {
  let conns = readConns();
  const affected = conns.filter(c => c.id_a === stickerId || c.id_b === stickerId);
  affected.forEach(c => wsConnectionDeleted(c.id));
  conns = conns.filter(c => c.id_a !== stickerId && c.id_b !== stickerId);
  writeConns(conns);
}

// Delete sticker (with cascade)
app.delete('/api/stickers/:id', (req, res) => {
  const { id } = req.params;
  let stickers = readDB();
  const target = stickers.find(s => s.id === id);
  if (target && target.image_path) {
    const fp = path.join(__dirname, target.image_path.replace(/^\//, ''));
    if (fs.existsSync(fp)) try { fs.unlinkSync(fp); } catch {}
  }
  cascadeDeleteConnections(id);
  stickers = stickers.filter(s => s.id !== id);
  writeDB(stickers);
  wsStickerDeleted(id);
  res.json({ ok: true });
});

// ==================== Connections Routes ====================

// Get all connections
app.get('/api/connections', (req, res) => {
  res.json(readConns());
});

// Get connections for a specific sticker
app.get('/api/stickers/:id/connections', (req, res) => {
  const { id } = req.params;
  const conns = readConns().filter(c => c.id_a === id || c.id_b === id);
  res.json(conns);
});

// Create connection (undirected edge, sorted pair)
app.post('/api/connections', (req, res) => {
  const { id_a, id_b, label } = req.body;
  if (!id_a || !id_b) return res.status(400).json({ error: '缺少 id_a 或 id_b' });
  if (id_a === id_b) return res.status(400).json({ error: '不能与自身建立联系' });

  // Sort to canonical order
  let [a, b] = [id_a, id_b];
  if (a > b) [a, b] = [b, a];

  const conns = readConns();
  // Check duplicate
  if (conns.some(c => c.id_a === a && c.id_b === b)) {
    return res.status(409).json({ error: '已存在相同联系' });
  }
  const conn = {
    id: uuidv4().slice(0, 8),
    id_a: a,
    id_b: b,
    label: label || '',
    created_at: nowCST()
  };
  conns.push(conn);
  writeConns(conns);
  res.status(201).json(conn);
  wsConnectionCreated(conn);
});

// Delete connection
app.delete('/api/connections/:id', (req, res) => {
  const { id } = req.params;
  let conns = readConns();
  conns = conns.filter(c => c.id !== id);
  writeConns(conns);
  wsConnectionDeleted(id);
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

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'static', 'index.html'));
});

server.listen(PORT, () => {
  console.log('');
  console.log('  📌 便签墙 (StickerWall)');
  console.log(`  🚀 服务已启动: http://localhost:${PORT} (WebSocket 实时同步已开启)`);
  console.log('');
});
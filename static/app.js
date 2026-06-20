// ========== Globals ==========
let stickers = [];
let currentDetailId = null;
let pendingPosX = null, pendingPosY = null;
let ws = null;
let wsReconnectTimer = null;
let createMode = 'text';
let createImageFile = null;
let cvDrawing = false, cvTool = 'pen';
let cvCtx, cvCanvas;
let cvStartX, cvStartY, cvSnapshot;
let dragTarget = null, dragOffsetX = 0, dragOffsetY = 0;
let dragStartX_wall = 0, dragStartY_wall = 0, dragZIndex = 1;
let hasMoved = false;
const DRAG_THRESHOLD = 5;
const REF_WIDTH = 1600;

function getScale() {
  const wall = document.getElementById('wall');
  return wall ? wall.clientWidth / REF_WIDTH : 1;
}
function updateContainerScale() {
  const container = document.getElementById('stickers-container');
  const wall = document.getElementById('wall');
  if (!container || !wall) return;
  const s = getScale();
  container.style.transform = `scale(${s})`;
  container.style.width = REF_WIDTH + 'px';
  let maxBottom = 800;
  if (stickers.length > 0) { maxBottom = Math.max(...stickers.map(s => (s.pos_y || 0) + (s.height || 200))); }
  container.style.height = Math.max(window.innerHeight / s + 400, maxBottom + 200) + 'px';
}

// ========== Init ==========
document.addEventListener('DOMContentLoaded', () => {
  refreshWall();
  initCreateCanvas();
  setupDragAndDrop();
  setupWallClick();
  initSettingsUI();
  setupImageZone();
  window.addEventListener('resize', updateContainerScale);
  fetchConnections();
  connectWS();
  setupConnectionUI();
});

async function refreshWallSilent() {
  try { const res = await fetch('/api/stickers'); stickers = await res.json(); renderStickers(); } catch {}
}

// ========== WebSocket 实时同步 ==========
function connectWS() {
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
  var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(protocol + '//' + location.host);

  ws.onopen = function() {
    if (wsReconnectTimer) { clearInterval(wsReconnectTimer); wsReconnectTimer = null; }
  };

  ws.onmessage = function(evt) {
    try {
      var msg = JSON.parse(evt.data);
      if (msg.type === 'sticker:created') {
        if (!stickers.some(function(s) { return s.id === msg.sticker.id; })) {
          stickers.unshift(msg.sticker);
          renderStickers();
        }
      } else if (msg.type === 'sticker:updated') {
        var idx = stickers.findIndex(function(s) { return s.id === msg.sticker.id; });
        if (idx !== -1) { stickers[idx] = msg.sticker; renderStickers(); }
      } else if (msg.type === 'sticker:deleted') {
        if (stickers.some(function(s) { return s.id === msg.id; })) {
          stickers = stickers.filter(function(s) { return s.id !== msg.id; });
          renderStickers();
        }
      } else if (msg.type === 'connection:created') {
        if (msg.connection && !connections.some(function(c) { return c.id === msg.connection.id; })) {
          connections.push(msg.connection);
          renderConnections();
        }
      } else if (msg.type === 'connection:deleted') {
        if (connections.some(function(c) { return c.id === msg.id; })) {
          connections = connections.filter(function(c) { return c.id !== msg.id; });
          renderConnections();
        }
      }
    } catch(e) {}
  };

  ws.onclose = function() {
    if (!wsReconnectTimer) {
      wsReconnectTimer = setInterval(function() {
        refreshWallSilent();
        connectWS();
      }, 8000);
    }
  };

  ws.onerror = function() { ws.close(); };
}

// ========== Wall Click ==========
function setupWallClick() {
  const wall = document.getElementById('wall');
  wall.addEventListener('click', (e) => {
    if (dragTarget) return;
    if (e.target.closest('.sticker')) return;
    if (e.target.closest('.bottom-bar')) return;
    if (e.target.closest('.ai-reply-bubble')) return;
    if (document.getElementById('createOverlay').style.display === 'flex') return;
    var bub = document.getElementById('aiReplyBubble');
    if (bub.style.display === 'block') { hideBubble(); return; }
    const rect = wall.getBoundingClientRect();
    const s = getScale();
    pendingPosX = (e.clientX - rect.left) / s;
    pendingPosY = (e.clientY - rect.top + wall.scrollTop) / s;
    showWallHint(e.clientX, e.clientY);
    openCreateModal();
  });
}
function showWallHint(cx, cy) {
  const hint = document.createElement('div'); hint.className = 'wall-hint';
  hint.style.left = cx + 'px'; hint.style.top = cy + 'px';
  document.body.appendChild(hint);
  hint.addEventListener('animationend', () => hint.remove());
}

// ========== Wall Render ==========
async function refreshWall() {
  try { const res = await fetch('/api/stickers'); stickers = await res.json(); renderStickers(); } catch {}
}
function renderStickers() {
  const container = document.getElementById('stickers-container');
  const existing = new Map();
  container.querySelectorAll('.sticker').forEach(el => existing.set(el.dataset.id, el));
  stickers.forEach((s, idx) => {
    let el = existing.get(s.id);
    if (!el) {
      el = createStickerElement(s); el.classList.add('sticker-entering');
      el.style.setProperty('--rot', s.rotation + 'deg'); container.appendChild(el);
    }
    updateStickerContent(el, s);
    el.style.left = s.pos_x + 'px'; el.style.top = s.pos_y + 'px';
    el.style.width = s.width + 'px'; el.style.height = s.height + 'px';
    el.style.transform = `rotate(${s.rotation}deg)`; el.style.zIndex = idx + 1; el.dataset.id = s.id;
  });
  existing.forEach((el, id) => {
    if (!stickers.find(s => s.id === id)) {
      el.style.animation = 'stickerFadeOut 0.32s var(--ease-standard) forwards';
      setTimeout(() => el.remove(), 300);
    }
  });
  updateContainerScale(); renderConnections();
}
function createStickerElement(s) {
  const el = document.createElement('div'); el.className = 'sticker'; el.dataset.id = s.id;
  el.innerHTML = `<div class="sticker-tape"></div><div class="sticker-inner"><div class="sticker-author"></div><div class="sticker-date"></div><div class="sticker-content"></div></div>`;
  el.addEventListener('mousedown', onStickerMouseDown);
  el.addEventListener('touchstart', onStickerTouchStart, { passive: false });
  el.addEventListener('contextmenu', onStickerContextMenu);
  el.addEventListener('mousedown', onStickerRightMouseDown);
  el.addEventListener('mouseup', onConnGlobalUp);
  return el;
}
function updateStickerContent(el, s) {
  const bgClass = (s.bg_color || '#FFF9E6').toUpperCase();
  const colorMap = { '#FFF9E6': 'bg-1', '#F0F7FF': 'bg-2', '#FFF0F5': 'bg-3', '#F5FFF5': 'bg-4', '#FFF5F0': 'bg-5', '#F8F0FF': 'bg-6', '#FFFFFF': 'bg-7' };
  el.classList.remove('bg-1','bg-2','bg-3','bg-4','bg-5','bg-6','bg-7');
  if (colorMap[bgClass]) el.classList.add(colorMap[bgClass]);
  else el.style.background = s.bg_color || '#FFF9E6';
  el.querySelector('.sticker-author').textContent = (s.author || '匿名').toUpperCase();
  el.querySelector('.sticker-date').textContent = s.created_at || '';
  const contentDiv = el.querySelector('.sticker-content'); contentDiv.innerHTML = '';
  const PAD_H = 36, PAD_V = 90, MIN_W = 180, MAX_W = 270, MIN_H = 140, MAX_H = 220;
  const LINE_H = 21.7, AVG_CHAR_W = 14;
  if (s.content_type === 'text') {
    const text = s.text_content || '';
    var mdDiv = document.createElement('div'); mdDiv.className = 'text-body'; mdDiv.innerHTML = typeof marked !== 'undefined' ? marked.parse(text) : text; contentDiv.appendChild(mdDiv);
    const lines = text.split('\n'); let maxL = 0; lines.forEach(l => { if (l.length > maxL) maxL = l.length; });
    const cw = Math.min(MAX_W, Math.max(MIN_W, maxL * AVG_CHAR_W + 20));
    const tl = lines.reduce((c, l) => c + Math.max(1, Math.ceil(l.length * AVG_CHAR_W / cw)), 0);
    const ch = Math.min(MAX_H, Math.max(MIN_H, tl * LINE_H + 20));
    el.style.width = cw + 'px'; el.style.height = ch + 'px'; s.width = cw; s.height = ch;
  } else if (s.content_type === 'drawing' || s.content_type === 'handwriting') {
    const strokes = s.content_type === 'handwriting' ? s.handwriting_data : s.drawing_data;
    const MX = s.content_type === 'handwriting' ? 300 : 320, MH = s.content_type === 'handwriting' ? 280 : 300;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    if (strokes && Array.isArray(strokes)) {
      strokes.forEach(st => { if (st.points) st.points.forEach(([px, py]) => { if (px < minX) minX = px; if (py < minY) minY = py; if (px > maxX) maxX = px; if (py > maxY) maxY = py; }); });
    }
    const has = isFinite(minX);
    const bbW = has ? maxX - minX + 24 : 140, bbH = has ? maxY - minY + 24 : 120;
    const cvsW = Math.min(MX - PAD_H, Math.max(MIN_W - PAD_H, Math.round(bbW)));
    const cvsH = Math.min(MH - PAD_V, Math.max(MIN_H - PAD_V, Math.round(bbH)));
    if (has) {
      const cvs = document.createElement('canvas'); cvs.width = cvsW; cvs.height = cvsH; cvs.style.width = '100%'; cvs.style.height = 'auto';
      const ctx = cvs.getContext('2d');
      const sc = Math.min(cvsW / bbW, cvsH / bbH) * 0.9;
      ctx.setTransform(sc, 0, 0, sc, (cvsW - bbW * sc) / 2 - minX * sc, (cvsH - bbH * sc) / 2 - minY * sc);
      renderStrokes(ctx, strokes);
      ctx.setTransform(1, 0, 0, 1, 0, 0); contentDiv.appendChild(cvs);
    }
    el.style.width = (cvsW + PAD_H) + 'px'; el.style.height = (cvsH + PAD_V) + 'px';
    s.width = cvsW + PAD_H; s.height = cvsH + PAD_V;
  } else if (s.content_type === 'image') {
    const MX = 290, MH = 300;
    if (s.image_path) {
      const img = document.createElement('img'); img.src = s.image_path; img.alt = '图片'; img.loading = 'lazy';
      img.style.maxWidth = (MX - PAD_H) + 'px'; img.style.maxHeight = (s.text_content ? (MH - PAD_V) * 0.7 : MH - PAD_V) + 'px';
      img.style.objectFit = 'contain'; img.style.borderRadius = '12px'; contentDiv.appendChild(img);
    }
    if (s.text_content) {
      const p = document.createElement('p'); p.textContent = s.text_content;
      p.style.cssText = 'margin-top:6px;font-size:12px;color:var(--fg-2);overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical';
      contentDiv.appendChild(p);
    }
    el.style.width = MX + 'px'; el.style.height = MH + 'px'; s.width = MX; s.height = MH;
  }
}
function renderStrokes(ctx, strokes) {
  if (!strokes || !Array.isArray(strokes)) return;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  strokes.forEach(stroke => {
    if (!stroke.points || stroke.points.length === 0) return;
    ctx.beginPath(); ctx.strokeStyle = stroke.color || '#1c1c1e'; ctx.lineWidth = stroke.size || 3;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
    if (stroke.tool === 'eraser') ctx.lineWidth = (stroke.size || 3) * 4;
    if (stroke.shape && stroke.points.length >= 2) {
      const [sx, sy] = stroke.points[0], [ex, ey] = stroke.points[stroke.points.length - 1];
      if (stroke.shape === 'rect') ctx.strokeRect(sx, sy, ex - sx, ey - sy);
      else if (stroke.shape === 'circle') { const rx = Math.abs(ex - sx) / 2, ry = Math.abs(ey - sy) / 2; ctx.beginPath(); ctx.ellipse(sx + (ex - sx) / 2, sy + (ey - sy) / 2, rx, ry, 0, 0, Math.PI * 2); ctx.stroke(); }
    } else {
      ctx.moveTo(stroke.points[0][0], stroke.points[0][1]);
      for (let i = 1; i < stroke.points.length; i++) ctx.lineTo(stroke.points[i][0], stroke.points[i][1]);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  });
}

// ========== Detail View ==========
function openDetail(id) {
  const s = stickers.find(st => st.id === id); if (!s) return;
  currentDetailId = id;
  document.getElementById('detailAuthor').textContent = (s.author || '匿名').toUpperCase();
  document.getElementById('detailDate').textContent = s.created_at || '';
  const body = document.getElementById('detailBody'); body.innerHTML = '';
  if (s.content_type === 'text') { const d = document.createElement('div'); d.className = 'text-content'; d.innerHTML = typeof marked !== 'undefined' ? marked.parse(s.text_content || '') : (s.text_content || ''); body.appendChild(d); }
  else if (s.content_type === 'image') {
    if (s.image_path) { const img = document.createElement('img'); img.src = s.image_path; img.alt = '图片'; img.style.width = '100%'; body.appendChild(img); }
    if (s.text_content) { const p = document.createElement('p'); p.textContent = s.text_content; p.style.cssText = 'margin-top:12px;font-size:14px;color:var(--fg-2)'; body.appendChild(p); }
  } else if ((s.content_type === 'handwriting' || s.content_type === 'drawing') && (s.handwriting_data || s.drawing_data)) {
    const strokes = s.handwriting_data || s.drawing_data;
    const cvs = document.createElement('canvas'); cvs.width = 480; cvs.height = s.content_type === 'handwriting' ? 300 : 340;
    cvs.style.width = '100%'; cvs.style.height = 'auto';
    const ctx = cvs.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cvs.width, cvs.height);
    renderStrokes(ctx, strokes); body.appendChild(cvs);
  }

  // Show connections for this sticker
  var connSection = document.createElement('div');
  connSection.style.cssText = 'margin-top:16px;padding-top:12px;border-top:1px solid var(--border-ink);';
  var connTitle = document.createElement('div');
  connTitle.style.cssText = 'font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;';
  connTitle.textContent = '联系';
  connSection.appendChild(connTitle);
  var related = connections.filter(function(c) { return c.id_a === id || c.id_b === id; });
  if (related.length === 0) {
    var emptyHint = document.createElement('div');
    emptyHint.style.cssText = 'font-size:13px;color:var(--muted);';
    emptyHint.textContent = '暂无联系';
    connSection.appendChild(emptyHint);
  } else {
    related.forEach(function(c) {
      var otherId = c.id_a === id ? c.id_b : c.id_a;
      var other = stickers.find(function(st) { return st.id === otherId; });
      var item = document.createElement('div');
      item.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13px;';
      var dir = document.createElement('span');
      dir.style.cssText = 'color:var(--accent);font-size:14px;';
      dir.textContent = '\u2194';
      item.appendChild(dir);
      var txt = document.createElement('span');
      txt.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;color:var(--fg-2);';
      txt.textContent = other ? (other.author || '匿名') + ': ' + (other.text_content || '').split('\n')[0].slice(0,30) : otherId;
      txt.addEventListener('click', function() { switchDetail(otherId); });
      item.appendChild(txt);
      var delBtn = document.createElement('button');
      delBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>';
      delBtn.style.cssText = 'width:24px;height:24px;padding:0;border:none;background:transparent;color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center;border-radius:50%;flex-shrink:0;margin-left:auto;transition:color 0.15s,background 0.15s;';
      delBtn.title = '断开联系';
      delBtn.addEventListener('click', async function(e) {
        e.stopPropagation();
        await deleteConnectionApi(c.id);
        await silentRefresh();
        showToast('联系已断开');
        // 刷新详情页显示（不关闭弹窗）
        openDetail(currentDetailId);
      });
      delBtn.addEventListener('mouseenter', function() { this.style.color = 'var(--danger)'; this.style.background = 'var(--danger-soft)'; });
      delBtn.addEventListener('mouseleave', function() { this.style.color = 'var(--muted)'; this.style.background = 'transparent'; });
      item.appendChild(delBtn);
      connSection.appendChild(item);
    });
  }
  body.appendChild(connSection);
  document.getElementById('detailOverlay').style.display = 'flex';
}
function closeDetail() {
  const overlay = document.getElementById('detailOverlay');
  const card = overlay.querySelector('.detail-card');
  if (!card) return;
  card.classList.add('closing');
  overlay.style.pointerEvents = 'none';
  setTimeout(() => {
    overlay.style.display = 'none';
    card.classList.remove('closing');
    overlay.style.pointerEvents = '';
    currentDetailId = null;
  }, 280);
}
function switchDetail(newId) {
  // 取消正在进行的关闭动画，直接切换内容
  var overlay = document.getElementById('detailOverlay');
  var card = overlay.querySelector('.detail-card');
  card.classList.remove('closing');
  overlay.style.pointerEvents = '';
  openDetail(newId);
}
async function deleteFromDetail() { if (!currentDetailId) return; await deleteSticker(currentDetailId); closeDetail(); }

// ========== Sticker CRUD ==========
async function saveSticker(data) { const r = await fetch('/api/stickers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); if (!r.ok) throw new Error('fail'); return r.json(); }
async function removeSticker(id) { await fetch(`/api/stickers/${id}`, { method: 'DELETE' }); }
async function updateStickerPos(id, x, y) { await fetch(`/api/stickers/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pos_x: x, pos_y: y }) }); }
async function deleteSticker(id) { await removeSticker(id); stickers = stickers.filter(s => s.id !== id); renderStickers(); showToast('便签已删除'); }

// ========== Create Modal ==========
function openCreateModal() {
  document.getElementById('createOverlay').style.display = 'flex';
  resetCreateModal();
  const defAuthor = window.DefaultSignature ? DefaultSignature.load() : '';
  document.getElementById('createName').value = defAuthor;
  var ta = document.getElementById('createTextarea'); if (ta) { ta.focus(); }
}
function closeCreateModal() {
  const overlay = document.getElementById('createOverlay');
  const modal = overlay.querySelector('.create-modal');
  if (!modal) return;
  modal.classList.add('closing');
  overlay.classList.remove('show');
  overlay.classList.add('hide');
  overlay.style.pointerEvents = 'none';
  setTimeout(() => {
    overlay.style.display = 'none';
    overlay.classList.remove('hide');
    modal.classList.remove('closing');
    overlay.style.pointerEvents = '';
    resetCreateModal();
    pendingPosX = null;
    pendingPosY = null;
  }, 280);
}
function resetCreateModal() {
  document.getElementById('createTextarea').value = '';
  const defAuthor = window.DefaultSignature ? DefaultSignature.load() : '';
  document.getElementById('createName').value = defAuthor;
  clearCVCanvas();
  createImageFile = null;
  const zone = document.getElementById('createImageZone');
  if (zone) {
    zone.classList.remove('has-image', 'dragover');
    document.getElementById('createImgEl').src = '';
  }
  document.getElementById('createImgFile').value = '';
  setCreateMode('text');
}
function setCreateMode(mode) {
  createMode = mode;
  const btns = document.querySelectorAll('#modeToggle .create-tab');
  btns.forEach(b => { b.classList.toggle('active', b.dataset.mode === mode); });
  document.getElementById('createTextarea').style.display = mode === 'text' ? '' : 'none';
  document.getElementById('createCanvasPanel').style.display = mode === 'draw' ? '' : 'none';
  document.getElementById('createImageZone').style.display = mode === 'image' ? 'flex' : 'none';
  if (mode === 'draw') { initCreateCanvas(); } else { clearCVCanvas(); }
}

// ========== Create Canvas ==========
function initCreateCanvas() {
  cvCanvas = document.getElementById('cvCanvas');
  if (!cvCanvas) return;
  cvCtx = cvCanvas.getContext('2d');
  cvCtx.fillStyle = '#fff'; cvCtx.fillRect(0, 0, cvCanvas.width, cvCanvas.height);
  cvCtx.lineCap = 'round'; cvCtx.lineJoin = 'round';
  cvCanvas._strokes = []; cvCanvas._current = null;
  cvCanvas.onmousedown = (e) => {
    cvDrawing = true; const p = getCVPos(e); cvStartX = p.x; cvStartY = p.y;
    cvSnapshot = cvCtx.getImageData(0, 0, cvCanvas.width, cvCanvas.height);
    cvCanvas._current = { tool: cvTool, color: cvTool === 'eraser' ? '#fff' : getCVColor(), size: parseInt(document.getElementById('cvSize').value) || 3, points: [[p.x, p.y]] };
    if (cvTool === 'pen' || cvTool === 'eraser') { cvCtx.beginPath(); cvCtx.moveTo(p.x, p.y); }
  };
  cvCanvas.onmousemove = (e) => {
    if (!cvDrawing) return; const p = getCVPos(e); const s = cvCanvas._current; s.points.push([p.x, p.y]);
    if (cvTool === 'pen' || cvTool === 'eraser') drawCVSegment(s);
    else { cvCtx.putImageData(cvSnapshot, 0, 0); cvCtx.save(); cvCtx.strokeStyle = s.color; cvCtx.lineWidth = s.size;
      const w = p.x - cvStartX, h = p.y - cvStartY;
      if (cvTool === 'rect') cvCtx.strokeRect(cvStartX, cvStartY, w, h);
      else if (cvTool === 'circle') { const rx = Math.abs(w) / 2, ry = Math.abs(h) / 2; cvCtx.beginPath(); cvCtx.ellipse(cvStartX + w / 2, cvStartY + h / 2, rx, ry, 0, 0, Math.PI * 2); cvCtx.stroke(); }
      cvCtx.restore();
    }
  };
  cvCanvas.onmouseup = cvCanvas.onmouseleave = endCVDraw;
  cvCanvas.addEventListener('touchstart', (e) => { e.preventDefault(); const t = e.touches[0]; cvCanvas.onmousedown({ clientX: t.clientX, clientY: t.clientY }); }, { passive: false });
  cvCanvas.addEventListener('touchmove', (e) => { e.preventDefault(); const t = e.touches[0]; cvCanvas.onmousemove({ clientX: t.clientX, clientY: t.clientY }); }, { passive: false });
  cvCanvas.addEventListener('touchend', endCVDraw);
}
function getCVPos(e) { const r = cvCanvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * cvCanvas.width / r.width, y: (e.clientY - r.top) * cvCanvas.height / r.height }; }
function endCVDraw() { if (!cvDrawing) return; cvDrawing = false; if (cvCanvas._current && cvCanvas._current.points.length > 0) { if (cvTool === 'rect' || cvTool === 'circle') cvCanvas._current.shape = cvTool; cvCanvas._strokes.push(cvCanvas._current); } cvCanvas._current = null; }
function drawCVSegment(s) {
  cvCtx.save(); cvCtx.strokeStyle = s.color; cvCtx.lineWidth = s.size;
  cvCtx.globalCompositeOperation = s.tool === 'eraser' ? 'destination-out' : 'source-over';
  if (s.tool === 'eraser') cvCtx.lineWidth = s.size * 4;
  cvCtx.beginPath(); const pts = s.points;
  if (pts.length === 1) { cvCtx.arc(pts[0][0], pts[0][1], s.size / 2, 0, Math.PI * 2); cvCtx.fillStyle = s.color; cvCtx.fill(); }
  else { cvCtx.moveTo(pts[pts.length - 2][0], pts[pts.length - 2][1]); cvCtx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]); cvCtx.stroke(); }
  cvCtx.restore();
}
function setCVTool(tool, btn) { cvTool = tool; btn.parentElement.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); }
function clearCVCanvas() { if (cvCtx) { cvCtx.clearRect(0, 0, cvCanvas.width, cvCanvas.height); cvCtx.fillStyle = '#fff'; cvCtx.fillRect(0, 0, cvCanvas.width, cvCanvas.height); cvCanvas._strokes = []; } }

// ========== Custom Color Picker ==========
let cpData = { hue: 0, sat: 0.5, bri: 0.5 };
let cpActive = false, cpDragging = false;
function openColorPicker(e) {
  e.stopPropagation(); const popup = document.getElementById('colorPickerPopup');
  if (popup.style.display === 'flex') { closeColorPicker(); return; }
  popup.style.display = 'flex'; cpActive = true; updateColorPickerUI();
}
function closeColorPicker() {
  const popup = document.getElementById('colorPickerPopup');
  if (popup.style.display !== 'flex') return;
  popup.classList.add('closing');
  setTimeout(() => {
    popup.style.display = 'none';
    popup.classList.remove('closing');
    cpActive = false;
  }, 220);
}
document.addEventListener('click', (e) => {
  if (!cpActive) return;
  const popup = document.getElementById('colorPickerPopup');
  if (popup && e.target !== popup && !popup.contains(e.target) && e.target !== document.getElementById('cvColorBtn')) closeColorPicker();
});
function initColorPicker() {
  const area = document.getElementById('colorWheelWrap');
  area.addEventListener('mousedown', onCPDown); area.addEventListener('mousemove', onCPMove);
  area.addEventListener('mouseup', onCPUp); area.addEventListener('mouseleave', onCPUp);
  area.addEventListener('touchstart', (e) => { e.preventDefault(); onCPDown(e.touches[0]); }, { passive: false });
  area.addEventListener('touchmove', (e) => { e.preventDefault(); onCPMove(e.touches[0]); }, { passive: false });
  area.addEventListener('touchend', onCPUp);
}
function onCPDown(e) { cpDragging = true; onCPMove(e); }
function onCPMove(e) {
  if (!cpDragging) return;
  const wh = document.getElementById('colorWheelWrap').getBoundingClientRect();
  const cx = wh.left + wh.width / 2, cy = wh.top + wh.height / 2;
  const dx = e.clientX - cx, dy = e.clientY - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const outerR = wh.width / 2, ringInnerR = 57, sbR = 40;
  if (dist >= ringInnerR && dist <= outerR) { cpData.hue = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360; updateColorPickerUI(); }
  else if (dist < sbR) { cpData.sat = Math.min(1, Math.max(0, (dx + sbR) / (sbR * 2))); cpData.bri = Math.min(1, Math.max(0, (sbR - dy) / (sbR * 2))); updateColorPickerUI(); }
}
function onCPUp() { cpDragging = false; }
function updateColorPickerUI() {
  const hAngle = cpData.hue * Math.PI / 180, ringMidR = 66;
  document.getElementById('hueThumb').style.transform = `translate(${Math.cos(hAngle) * ringMidR}px, ${Math.sin(hAngle) * ringMidR}px)`;
  const sbR = 40;
  document.getElementById('sbThumb').style.transform = `translate(${(cpData.sat - 0.5) * sbR * 2}px, ${(0.5 - cpData.bri) * sbR * 2}px)`;
  const hueColor = hsvToHex(cpData.hue, 1, 1);
  document.getElementById('sbCircle').style.backgroundColor = hueColor;
  const finalColor = hsvToHex(cpData.hue, cpData.sat, cpData.bri);
  document.getElementById('cvColorBtn').style.background = finalColor;
  document.getElementById('colorPreview').style.background = finalColor;
  document.getElementById('colorHex').textContent = finalColor.toUpperCase();
}
function hsvToHex(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  let r1, g1, b1;
  if (h < 60) { r1 = c; g1 = x; b1 = 0; } else if (h < 120) { r1 = x; g1 = c; b1 = 0; }
  else if (h < 180) { r1 = 0; g1 = c; b1 = x; } else if (h < 240) { r1 = 0; g1 = x; b1 = c; }
  else if (h < 300) { r1 = x; g1 = 0; b1 = c; } else { r1 = c; g1 = 0; b1 = x; }
  const toHex = n => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r1)}${toHex(g1)}${toHex(b1)}`;
}
function getCVColor() { return hsvToHex(cpData.hue, cpData.sat, cpData.bri); }
document.addEventListener('DOMContentLoaded', () => { initColorPicker(); });

// ========== Image Upload ==========
function triggerImageUpload() { document.getElementById('createImgFile').click(); }
function loadCreateImage(file) {
  if (!file) return;
  createImageFile = file;
  const reader = new FileReader();
  reader.onload = ev => {
    const img = document.getElementById('createImgEl');
    img.src = ev.target.result;
    document.getElementById('createImageZone').classList.add('has-image');
    if (createMode !== 'image') setCreateMode('image');
  };
  reader.readAsDataURL(file);
}
function handleCreateImage(e) {
  if (e.target.files.length === 0) return;
  loadCreateImage(e.target.files[0]);
  e.target.value = '';
}
function setupImageZone() {
  const zone = document.getElementById('createImageZone');
  if (!zone) return;
  zone.addEventListener('click', () => document.getElementById('createImgFile').click());
  zone.addEventListener('dragenter', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  zone.addEventListener('dragleave', (e) => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('dragover'); });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].type.startsWith('image/')) {
      loadCreateImage(files[0]);
    } else {
      showToast('请拖入图片文件');
    }
  });
}

// ========== Submit ==========
async function submitCreateSticker() {
  const author = document.getElementById('createName').value.trim() || '匿名';
  const pos = getCreatePos(); let data;
  if (createImageFile) {
    const fd = new FormData(); fd.append('file', createImageFile); let url = '';
    try { const ur = await fetch('/api/upload', { method: 'POST', body: fd }); if (!ur.ok) throw new Error(); url = (await ur.json()).url; } catch { showToast('图片上传失败'); return; }
    data = { content_type: 'image', author, image_path: url, text_content: '', bg_color: getCreateSelectedColor(), pos_x: pos.x, pos_y: pos.y, rotation: pos.rot, width: 290, height: 300 };
  } else if (createMode === 'text') {
    const text = document.getElementById('createTextarea').value.trim();
    if (!text) { showToast('请输入内容'); return; }
    data = { content_type: 'text', author, text_content: text, bg_color: getCreateSelectedColor(), pos_x: pos.x, pos_y: pos.y, rotation: pos.rot, width: 270, height: 220 };
  } else if (createMode === 'image') {
    showToast('请先上传图片');
    return;
  } else {
    if (!cvCanvas._strokes || cvCanvas._strokes.length === 0) { showToast('请先画点什么'); return; }
    data = { content_type: 'drawing', author, drawing_data: JSON.parse(JSON.stringify(cvCanvas._strokes)), bg_color: '#FFFFFF', pos_x: pos.x, pos_y: pos.y, rotation: pos.rot, width: 320, height: 300 };
  }
  try { const s = await saveSticker(data); if (!stickers.some(st => st.id === s.id)) { stickers.unshift(s); } closeCreateModal(); renderStickers(); showToast('便签已贴上'); } catch { showToast('保存失败，请重试'); }
}
function getCreatePos() {
  if (pendingPosX !== null && pendingPosY !== null) { const p = { x: pendingPosX - 135, y: pendingPosY - 110, rot: (Math.random() - 0.5) * 4 }; pendingPosX = null; pendingPosY = null; return p; }
  return randomPos();
}
function randomPos() { return { x: 40 + Math.random() * (REF_WIDTH - 340), y: 20 + Math.random() * 400, rot: (Math.random() - 0.5) * 6 }; }
function getCreateSelectedColor() { const a = document.querySelector('#createColorDots .color-dot-sm.active'); return a ? a.dataset.color : '#FFF9E6'; }
function selectCreateColor(dot) { document.querySelectorAll('#createColorDots .color-dot-sm').forEach(d => d.classList.remove('active')); dot.classList.add('active'); }

// ========== Drag on Wall ==========
function setupDragAndDrop() {
  document.addEventListener('mousemove', onMouseMove); document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('mousemove', onConnGlobalMove); document.addEventListener('mouseup', onConnGlobalUp);
  document.addEventListener('touchmove', onTouchMove, { passive: false }); document.addEventListener('touchend', onTouchEnd);
}
function onStickerMouseDown(e) { if (e.button !== 0) return; e.preventDefault(); hasMoved = false; startDrag(e.currentTarget, e.clientX, e.clientY); }
function onStickerTouchStart(e) { hasMoved = false; const t = e.touches[0]; startDrag(e.currentTarget, t.clientX, t.clientY); }
function startDrag(el, cx, cy) {
  dragTarget = el; const r = el.getBoundingClientRect();
  dragOffsetX = cx - r.left; dragOffsetY = cy - r.top;
  dragStartX_wall = cx; dragStartY_wall = cy;
  dragZIndex = parseInt(el.style.zIndex) || 1; el.style.zIndex = 999;
}
function onMouseMove(e) { if (!dragTarget) return; if (Math.abs(e.clientX - dragStartX_wall) > DRAG_THRESHOLD || Math.abs(e.clientY - dragStartY_wall) > DRAG_THRESHOLD) { if (!hasMoved) { hasMoved = true; dragTarget.classList.add('dragging'); } } if (hasMoved) moveDrag(e.clientX, e.clientY); }
function onTouchMove(e) { if (!dragTarget) return; e.preventDefault(); const t = e.touches[0]; if (Math.abs(t.clientX - dragStartX_wall) > DRAG_THRESHOLD || Math.abs(t.clientY - dragStartY_wall) > DRAG_THRESHOLD) { if (!hasMoved) { hasMoved = true; dragTarget.classList.add('dragging'); } } if (hasMoved) moveDrag(t.clientX, t.clientY); }
function moveDrag(cx, cy) {
  const wall = document.getElementById('wall'), wallRect = wall.getBoundingClientRect(), s = getScale();
  let newLeft = (cx - wallRect.left) / s - dragOffsetX / s;
  let newTop = (cy - wallRect.top + wall.scrollTop) / s - dragOffsetY / s;
  const stickerWidth = parseFloat(dragTarget.style.width) || 200;
  newLeft = Math.max(0, Math.min(newLeft, REF_WIDTH - stickerWidth));
  newTop = Math.max(0, newTop);
  dragTarget.style.left = newLeft + 'px'; dragTarget.style.top = newTop + 'px';
  // Update sticker position in array in real-time for connection line rendering
  const sid = dragTarget.dataset.id;
  const sdata = stickers.find(function(st) { return st.id === sid; });
  if (sdata) { sdata.pos_x = newLeft; sdata.pos_y = newTop; }
  renderConnections(sid);
}
function onMouseUp() { endDrag(); }
function onTouchEnd() { endDrag(); }
async function endDrag() {
  if (!dragTarget) return;
  const id = dragTarget.dataset.id, wasMoved = hasMoved;
  dragTarget.classList.remove('dragging'); dragTarget.style.zIndex = dragZIndex;
  if (wasMoved) {
    const l = parseFloat(dragTarget.style.left) || 0, t = parseFloat(dragTarget.style.top) || 0;
    dragTarget = null; hasMoved = false;
    try { await updateStickerPos(id, l, t); const s = stickers.find(s => s.id === id); if (s) { s.pos_x = l; s.pos_y = t; } } catch {}
  } else { dragTarget = null; hasMoved = false; openDetail(id); }
}

// ========== Settings UI ==========
function initSettingsUI() {
  const s = window.AISettings ? AISettings.load() : {};
  document.getElementById('setAuthor').value = window.DefaultSignature ? DefaultSignature.load() : '';
  document.getElementById('setAIEnabled').checked = !!s.enabled;
  document.getElementById('setPlatform').value = s.platform || 'openai';
  document.getElementById('setApiKey').value = s.apiKey || '';
  document.getElementById('setBaseUrl').value = s.baseUrl || 'https://api.openai.com/v1';
  document.getElementById('setModel').value = s.model || 'gpt-3.5-turbo';
  const block = document.getElementById('aiSettingsBlock');
  if (s.enabled) { block.classList.remove('collapsed'); } else { block.classList.add('collapsed'); }
  var wrap = document.getElementById('aiChatWrap');
  if (s.enabled) { wrap.classList.remove('hidden'); } else { wrap.classList.add('hidden'); }
}

function openSettings() {
  initSettingsUI();
  document.getElementById('settingsOverlay').style.display = 'flex';
}
function closeSettings() {
  const overlay = document.getElementById('settingsOverlay');
  const modal = overlay.querySelector('.settings-modal');
  if (!modal) return;
  modal.classList.add('closing');
  overlay.style.pointerEvents = 'none';
  setTimeout(() => {
    overlay.style.display = 'none';
    modal.classList.remove('closing');
    overlay.style.pointerEvents = '';
  }, 280);
}
function onSettingAIEnabled() {
  const enabled = document.getElementById('setAIEnabled').checked;
  const block = document.getElementById('aiSettingsBlock');
  if (enabled) { block.classList.remove('collapsed'); } else { block.classList.add('collapsed'); }
}
function onSettingPlatformChange() {
  const platform = document.getElementById('setPlatform').value;
  const baseUrl = document.getElementById('setBaseUrl'), model = document.getElementById('setModel');
  if (platform === 'openai') { baseUrl.value = 'https://api.openai.com/v1'; model.value = 'gpt-3.5-turbo'; }
  else { if (baseUrl.value === 'https://api.openai.com/v1') baseUrl.value = ''; }
}
function saveSettings() {
  if (!window.AISettings || !window.DefaultSignature) { showToast('设置模块未加载，请刷新页面'); return; }
  DefaultSignature.save(document.getElementById('setAuthor').value);
  const enabled = document.getElementById('setAIEnabled').checked;
  AISettings.save({
    enabled: enabled,
    platform: document.getElementById('setPlatform').value,
    apiKey: document.getElementById('setApiKey').value.trim(),
    baseUrl: document.getElementById('setBaseUrl').value.trim() || 'https://api.openai.com/v1',
    model: document.getElementById('setModel').value.trim() || 'gpt-3.5-turbo'
  });
  const wrap = document.getElementById('aiChatWrap');
  if (enabled) { wrap.classList.remove('hidden'); } else { wrap.classList.add('hidden'); }
  closeSettings();
  showToast('设置已保存');
}

// ========== AI / Agent Chat ==========
let lastAIReply = '';
let agentSteps = [];      // 记录 Agent 调用步骤，用于展示

async function sendAIChat() {
  const input = document.getElementById('aiChatInput'), sendBtn = document.getElementById('aiChatSend'),
        bubble = document.getElementById('aiReplyBubble'), contentEl = document.getElementById('aiBubbleContent'),
        toStickerBtn = document.getElementById('aiBubbleToStickerBtn');
  const msg = input.value.trim();
  if (!msg) return;
  if (!window.AgentChat && !window.AIChat) { showToast('AI 模块未加载，请刷新页面'); return; }
  input.value = '';
  sendBtn.classList.add('loading');
  toStickerBtn.classList.remove('visible');

  // Agent 模式：流式展示每一步
  agentSteps = [];
  bubble.style.display = 'block';
  contentEl.innerHTML = '<div class="agent-waiting"><div class="agent-pulse"></div><div>🤔 Agent 思考中…</div></div>';

  (window.AgentChat || window.AIChat).send(msg, {
    onThinking: function(tool, args) {
      var stepHtml = '<div class="agent-step">' +
        '<span class="agent-step-icon">🔍</span>' +
        '<span class="agent-step-name">' + toolNameZh(tool) + '</span>' +
        '</div>';
      contentEl.innerHTML = stepHtml + '<div class="agent-waiting"><div class="agent-pulse"></div><div>等待结果…</div></div>';
    },
    onToolResult: function(tool, result) {
      var resultSummary = '';
      if (Array.isArray(result)) {
        resultSummary = '✅ 返回 ' + result.length + ' 条结果';
      } else if (result && result.error) {
        resultSummary = '⚠️ ' + result.error;
      } else if (result && result.total_stickers !== undefined) {
        resultSummary = '✅ 统计完成';
      } else {
        resultSummary = '✅ 已获取';
      }
      var steps = contentEl.querySelectorAll('.agent-step');
      if (steps.length > 0) {
        var lastStep = steps[steps.length - 1];
        lastStep.innerHTML = lastStep.innerHTML.replace('🔍', '✅');
        var resultSpan = document.createElement('span');
        resultSpan.className = 'agent-step-result';
        resultSpan.textContent = resultSummary;
        lastStep.appendChild(resultSpan);
      }
    },
    onDone: function(text) {
      lastAIReply = text;
      contentEl.innerHTML = typeof marked !== 'undefined' ? marked.parse(text) : text;
      toStickerBtn.classList.add('visible');
      sendBtn.classList.remove('loading');
    },
    onError: function(err) {
      lastAIReply = '';
      contentEl.innerHTML = '❌ ' + err;
      toStickerBtn.classList.remove('visible');
      sendBtn.classList.remove('loading');
      setTimeout(hideBubble, 6000);
    }
  });
}

// 工具名中文化
function toolNameZh(name) {
  var map = {
    'search_stickers': '搜索便签',
    'get_all_stickers': '读取便签列表',
    'get_sticker_detail': '读取便签详情',
    'get_sticker_connections': '读取便签关联',
    'get_all_connections': '读取关联网络',
    'get_wall_stats': '统计墙面数据',
    'get_stickers_by_author': '按作者查询便签'
  };
  return map[name] || name;
}

function hideBubble() {
  const b = document.getElementById('aiReplyBubble');
  if (b.style.display !== 'block') return;
  b.classList.add('hiding');
  setTimeout(function() { b.style.display = 'none'; b.classList.remove('hiding'); }, 240);
}
function convertAIReplyToSticker() {
  if (!lastAIReply) return;
  hideBubble();
  pendingPosX = 40 + Math.random() * (REF_WIDTH - 340);
  pendingPosY = 20 + Math.random() * 400;
  var clean = lastAIReply.replace(/\n{4,}/g, '\x00').replace(/\n\n/g, '\n').replace(/\x00/g, '\n\n');
  openCreateModal();
  document.getElementById('createTextarea').value = clean;
  var aiModel = (window.AISettings ? AISettings.load().model : null) || 'AI'; document.getElementById('createName').value = aiModel;
  lastAIReply = '';
}

function showToast(msg) {
  const ex = document.querySelector('.toast'); if (ex) ex.remove();
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
  t.style.animation = 'toastOut 0.28s var(--ease-spring-soft) forwards';
  setTimeout(() => t.remove(), 2400);
}

// ========== 便签关联线 ==========
let connections = [];
let connDragSource = null;
let connDragLine = null;
let activeConnId = null;
let connPickerCurrentId = null;

async function fetchConnections() {
  try { const r = await fetch('/api/connections'); connections = await r.json(); renderConnections(); } catch {}
}
async function createConnectionApi(idA, idB) {
  const r = await fetch('/api/connections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id_a: idA, id_b: idB }) });
  if (!r.ok) { const e = await r.json(); throw new Error(e.error || '创建失败'); }
  return r.json();
}
async function deleteConnectionApi(id) {
  await fetch(`/api/connections/${id}`, { method: 'DELETE' });
}
function computeAnchor(s) {
  if (!s) return { x: 0, y: 0 };
  const cx = s.pos_x + s.width / 2;
  const cy = s.pos_y + s.height / 2;
  const rad = (s.rotation || 0) * Math.PI / 180;
  const cosR = Math.cos(rad), sinR = Math.sin(rad);
  return { x: cx + (s.height / 2) * sinR, y: cy - (s.height / 2) * cosR };
}
function buildConnPath(p1, p2) {
  var midX = (p1.x + p2.x) / 2, midY = Math.min(p1.y, p2.y);
  var dist = Math.max(Math.abs(p2.x - p1.x), Math.abs(p2.y - p1.y));
  var offset = Math.max(dist * 0.25, 30);
  return 'M ' + p1.x + ',' + p1.y + ' Q ' + midX + ',' + (midY - offset) + ' ' + p2.x + ',' + p2.y;
}
function createConnPathPair(svg, d, connId, skipAnim) {
  // 透明宽路径（点击热区，stroke-width=14）
  var hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  hit.setAttribute('d', d);
  hit.setAttribute('class', 'conn-hit');
  hit.dataset.connId = connId;
  hit.addEventListener('click', function(e) { onConnLineClick(e, connId); });
  svg.appendChild(hit);
  // 可见细路径（无 pointer-events，不拦截点击）
  var vis = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  vis.setAttribute('class', 'conn-line' + (skipAnim ? '' : ' entering'));
  vis.setAttribute('d', d);
  vis.style.pointerEvents = 'none';
  svg.appendChild(vis);
  if (!skipAnim) {
    setTimeout(function() { vis.classList.remove('entering'); }, 650);
  }
  connPathMap.set(connId, { hit: hit, vis: vis });
  return { hit: hit, vis: vis };
}
function updateConnPathPair(svg, connId, d) {
  var pair = connPathMap.get(connId);
  if (pair) {
    pair.hit.setAttribute('d', d);
    pair.vis.setAttribute('d', d);
  }
}
var connPathMap = new Map();
var connFirstRender = true;
function renderConnections(stickerId) {
  const svg = document.getElementById('connectionsLayer');
  if (!svg) return;
  if (stickerId) {
    // 增量更新：只重绘涉及该便签的联系线（拖拽时调用）
    connections.forEach(function(c) {
      if (c.id_a !== stickerId && c.id_b !== stickerId) return;
      var a = stickers.find(function(s) { return s.id === c.id_a; });
      var b = stickers.find(function(s) { return s.id === c.id_b; });
      if (!a || !b) return;
      var d = buildConnPath(computeAnchor(a), computeAnchor(b));
      updateConnPathPair(svg, c.id, d);
    });
  } else {
    // 全量重建（初始加载 / 创建 / 删除 / WebSocket）
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    connPathMap.clear();
    connections.forEach(function(c) {
      var a = stickers.find(function(s) { return s.id === c.id_a; });
      var b = stickers.find(function(s) { return s.id === c.id_b; });
      if (!a || !b) return;
      var d = buildConnPath(computeAnchor(a), computeAnchor(b));
      createConnPathPair(svg, d, c.id, !connFirstRender);
    });
    connFirstRender = false;
  }
}
function onConnLineClick(e, connId) {
  e.stopPropagation();
  activeConnId = connId;
  var bubble = document.getElementById('connBubble');
  bubble.classList.remove('closing');
  bubble.style.display = 'flex';
  bubble.style.left = '0px';
  bubble.style.top = '0px';
  // 等待布局完成后计算智能位置
  requestAnimationFrame(function() {
    var bw = bubble.offsetWidth, bh = bubble.offsetHeight;
    var gap = 8;
    // 默认：水平居中于鼠标，下边缘与鼠标 Y 齐平（气泡在上方）
    var left = e.clientX - bw / 2;
    var top = e.clientY - bh - gap;
    // 上边界溢出 → 改到鼠标下方
    if (top < 0) {
      top = e.clientY + gap;
    }
    // 左边界溢出
    if (left < gap) left = gap;
    // 右边界溢出
    if (left + bw > window.innerWidth - gap) {
      left = window.innerWidth - bw - gap;
    }
    bubble.style.left = left + 'px';
    bubble.style.top = top + 'px';
  });
}
function hideConnBubble() {
  var bubble = document.getElementById('connBubble');
  if (bubble.style.display === 'none') return;
  bubble.classList.add('closing');
  setTimeout(function() {
    bubble.style.display = 'none';
    bubble.classList.remove('closing');
  }, 240);
  activeConnId = null;
}
function setupConnBubbleDelete() {
  var btn = document.getElementById('connBubbleDelete');
  if (btn._setup) return; btn._setup = true;
  btn.addEventListener('click', async function() {
    if (!activeConnId) return;
    await deleteConnectionApi(activeConnId);
    hideConnBubble();
    await silentRefresh();
    showToast('联系已删除');
  });
}
function onStickerContextMenu(e) { e.preventDefault(); }
function onStickerRightMouseDown(e) {
  if (e.button !== 2) return;
  connDragSource = e.currentTarget;
  connDragSource.classList.add('conn-drag-source');
  var s = stickers.find(function(st) { return st.id === connDragSource.dataset.id; });
  if (!s) { connDragSource = null; return; }
  var anchor = computeAnchor(s);
  var svg = document.getElementById('connectionsLayer');
  var line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  line.setAttribute('class', 'conn-drag-temp');
  line.setAttribute('d', 'M ' + anchor.x + ',' + anchor.y + ' L ' + anchor.x + ',' + anchor.y);
  svg.appendChild(line);
  connDragLine = line;
}
function onConnGlobalMove(e) {
  if (!connDragSource || !connDragLine) return;
  var s = stickers.find(function(st) { return st.id === connDragSource.dataset.id; });
  if (!s) return;
  var anchor = computeAnchor(s);
  var wall = document.getElementById('wall');
  var wallRect = wall.getBoundingClientRect();
  var sc = getScale();
  var mx = (e.clientX - wallRect.left + wall.scrollLeft) / sc;
  var my = (e.clientY - wallRect.top + wall.scrollTop) / sc;
  connDragLine.setAttribute('d', 'M ' + anchor.x + ',' + anchor.y + ' L ' + mx + ',' + my);
  document.querySelectorAll('.conn-drag-hover').forEach(function(el) { el.classList.remove('conn-drag-hover'); });
  var els = document.elementsFromPoint(e.clientX, e.clientY);
  for (var i = 0; i < els.length; i++) {
    if (els[i].classList && els[i].classList.contains('sticker') && els[i] !== connDragSource) {
      els[i].classList.add('conn-drag-hover'); break;
    }
  }
}
function onConnGlobalUp(e) {
  if (!connDragSource) return;
  var srcId = connDragSource.dataset.id;
  if (connDragLine) { connDragLine.remove(); connDragLine = null; }
  connDragSource.classList.remove('conn-drag-source');
  document.querySelectorAll('.conn-drag-hover').forEach(function(el) { el.classList.remove('conn-drag-hover'); });
  var targets = [];
  var els = document.elementsFromPoint(e.clientX, e.clientY);
  for (var i = 0; i < els.length; i++) {
    if (els[i].classList && els[i].classList.contains('sticker') && els[i].dataset.id !== srcId) {
      targets.push(els[i].dataset.id);
    }
  }
  if (targets.length === 1) {
    doCreateConnection(srcId, targets[0]);
  } else if (targets.length > 1) {
    showConnSelectMenu(e.clientX, e.clientY, srcId, targets);
  }
  connDragSource = null;
}
async function silentRefresh() {
  try {
    var sr = await fetch('/api/stickers');
    var cr = await fetch('/api/connections');
    stickers = await sr.json();
    connections = await cr.json();
    stickers.sort(function(a, b) { return new Date(b.created_at) - new Date(a.created_at); });
    renderStickers();
  } catch {}
}
async function doCreateConnection(idA, idB) {
  try {
    await createConnectionApi(idA, idB);
    await silentRefresh();
    showToast('已建立联系');
  } catch (err) {
    if (err.message && err.message.indexOf('已存在') > -1) {
      showToast('已存在相同联系');
    } else { showToast('创建联系失败'); }
  }
}
function showConnSelectMenu(cx, cy, srcId, targetIds) {
  var existing = document.querySelector('.conn-select-menu');
  if (existing) existing.remove();
  var menu = document.createElement('div');
  menu.className = 'conn-select-menu';
  menu.style.left = cx + 'px'; menu.style.top = cy + 'px';
  targetIds.forEach(function(tid) {
    var s = stickers.find(function(st) { return st.id === tid; });
    if (!s) return;
    var btn = document.createElement('button');
    btn.className = 'conn-select-item';
    var title = (s.text_content || '(无内容)').split('\n')[0].slice(0, 30);
    btn.textContent = (s.author || '匿名') + ': ' + title;
    btn.addEventListener('click', function(e) {
      e.stopPropagation(); menu.remove(); doCreateConnection(srcId, tid);
    });
    menu.appendChild(btn);
  });
  document.body.appendChild(menu);
  setTimeout(function() {
    function closeMenu(e) { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', closeMenu); } }
    document.addEventListener('click', closeMenu);
  }, 10);
}
function openConnPicker() {
  if (!currentDetailId) return;
  connPickerCurrentId = currentDetailId;
  document.getElementById('connPickerOverlay').style.display = 'flex';
  document.getElementById('connPickerSearch').value = '';
  renderConnPickerList();
  document.getElementById('connPickerSearch').focus();
}
function closeConnPicker() {
  document.getElementById('connPickerOverlay').style.display = 'none';
  connPickerCurrentId = null;
}
function renderConnPickerList(filter) {
  var list = document.getElementById('connPickerList');
  var currentId = connPickerCurrentId;
  if (!currentId) return;
  var connectedIds = {};
  connections.forEach(function(c) {
    if (c.id_a === currentId) connectedIds[c.id_b] = true;
    if (c.id_b === currentId) connectedIds[c.id_a] = true;
  });
  var items = stickers.filter(function(s) { return s.id !== currentId; });
  if (filter) {
    var f = filter.toLowerCase();
    items = items.filter(function(s) { return (s.text_content || '').toLowerCase().indexOf(f) > -1; });
  }
  list.innerHTML = '';
  if (items.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'conn-picker-empty';
    empty.textContent = filter ? '无匹配便签' : '没有可添加的便签';
    list.appendChild(empty); return;
  }
  items.forEach(function(s) {
    var item = document.createElement('div');
    item.className = 'conn-picker-item';
    item.dataset.id = s.id;
    var isConnected = connectedIds[s.id];
    if (isConnected) item.classList.add('disabled');
    var text = s.text_content || '(无内容)';
    var lines = text.split('\n');
    var maxLines = Math.min(4, lines.length);
    for (var i = 0; i < maxLines; i++) {
      var line = document.createElement('div');
      line.className = 'conn-picker-line';
      var lineText = lines[i];
      if (i === 3 && lines.length > 4) lineText = lineText.slice(0, 50);
      if (i === 3 && lines.length > 4) line.textContent = lineText + '...';
      else line.textContent = lineText;
      item.appendChild(line);
    }
    if (lines.length > 4) {
      var dots = document.createElement('div');
      dots.className = 'conn-picker-line'; dots.textContent = '...';
      item.appendChild(dots);
    }
    if (!isConnected) {
      item.addEventListener('click', function() { this.classList.toggle('selected'); });
    }
    list.appendChild(item);
  });
}
async function confirmConnPicker() {
  var currentId = connPickerCurrentId;
  if (!currentId) return;
  var selected = document.querySelectorAll('#connPickerList .conn-picker-item.selected');
  var count = 0;
  for (var i = 0; i < selected.length; i++) {
    try {
      await createConnectionApi(currentId, selected[i].dataset.id);
      count++;
    } catch (err) { if (err.message && err.message.indexOf('已存在') === -1) showToast('部分创建失败'); }
  }
  if (count > 0) { await silentRefresh(); showToast('已建立 ' + count + ' 条联系'); }
  closeConnPicker();
}
function setupConnectionUI() {
  setupConnBubbleDelete();
  document.addEventListener('click', function(e) {
    var bubble = document.getElementById('connBubble');
    if (bubble.style.display !== 'none' && !bubble.contains(e.target)) {
      hideConnBubble();
    }
  });
  document.getElementById('connPickerOverlay').addEventListener('click', function(e) {
    if (e.target === this) closeConnPicker();
  });
  document.getElementById('connPickerSearch').addEventListener('input', function(e) {
    renderConnPickerList(e.target.value);
  });
  document.getElementById('connPickerConfirm').addEventListener('click', confirmConnPicker);
  var connBtn = document.getElementById('detailConnBtn');
  if (connBtn) connBtn.addEventListener('click', openConnPicker);
  document.addEventListener('contextmenu', onStickerContextMenu);
}
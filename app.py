"""
便签墙 (StickerWall) - Flask 后端
摄影社团课堂 Ideas 记录工具
"""

import os
import sqlite3
import json
import base64
import uuid
from datetime import datetime, timezone, timedelta

from flask import Flask, request, jsonify, send_from_directory
from PIL import Image
from io import BytesIO

app = Flask(__name__, static_folder="static", static_url_path="/static")

DATABASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "stickers.db")
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# ------------------ 数据库初始化 ------------------
def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn

def init_db():
    conn = get_db()
    conn.execute("""
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
    """)
    conn.commit()
    conn.close()

init_db()

# ------------------ 时区工具 ------------------
def now_cst():
    """返回北京时间字符串"""
    return datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m-%d %H:%M:%S")

def format_sticker(row):
    d = dict(row)
    if d.get("drawing_data"):
        try:
            d["drawing_data"] = json.loads(d["drawing_data"])
        except Exception:
            d["drawing_data"] = None
    if d.get("handwriting_data"):
        try:
            d["handwriting_data"] = json.loads(d["handwriting_data"])
        except Exception:
            d["handwriting_data"] = None
    return d

# ------------------ API 路由 ------------------
@app.route("/api/stickers", methods=["GET"])
def list_stickers():
    conn = get_db()
    rows = conn.execute("SELECT * FROM stickers ORDER BY created_at DESC").fetchall()
    conn.close()
    return jsonify([format_sticker(r) for r in rows])

@app.route("/api/stickers", methods=["POST"])
def create_sticker():
    data = request.get_json(force=True)
    sid = data.get("id") or str(uuid.uuid4())[:8]
    author = (data.get("author") or "匿名").strip()
    if not author:
        author = "匿名"
    content_type = data.get("content_type", "text")
    text_content = data.get("text_content", "")
    drawing_data = data.get("drawing_data")
    handwriting_data = data.get("handwriting_data")
    bg_color = data.get("bg_color", "#FFF9E6")
    pos_x = data.get("pos_x", 0)
    pos_y = data.get("pos_y", 0)
    rotation = data.get("rotation", 0)
    width = data.get("width", 280)
    height = data.get("height", 280)
    image_path = data.get("image_path", "")

    if isinstance(drawing_data, (list, dict)):
        drawing_data = json.dumps(drawing_data, ensure_ascii=False)
    if isinstance(handwriting_data, (list, dict)):
        handwriting_data = json.dumps(handwriting_data, ensure_ascii=False)

    ts = now_cst()
    conn = get_db()
    conn.execute("""
        INSERT INTO stickers (id, author, content_type, text_content, image_path,
            drawing_data, handwriting_data, bg_color, pos_x, pos_y, rotation,
            width, height, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (sid, author, content_type, text_content, image_path,
          drawing_data, handwriting_data, bg_color, pos_x, pos_y, rotation,
          width, height, ts, ts))
    conn.commit()
    row = conn.execute("SELECT * FROM stickers WHERE id=?", (sid,)).fetchone()
    conn.close()
    return jsonify(format_sticker(row)), 201

@app.route("/api/stickers/<sid>", methods=["PUT"])
def update_sticker(sid):
    data = request.get_json(force=True)
    fields = []
    values = []
    for key in ("author", "text_content", "bg_color", "pos_x", "pos_y",
                "rotation", "width", "height", "image_path"):
        if key in data:
            fields.append(f"{key}=?")
            values.append(data[key])
    for key in ("drawing_data", "handwriting_data"):
        if key in data:
            v = data[key]
            if isinstance(v, (list, dict)):
                v = json.dumps(v, ensure_ascii=False)
            fields.append(f"{key}=?")
            values.append(v)
    if "content_type" in data:
        fields.append("content_type=?")
        values.append(data["content_type"])
    if not fields:
        return jsonify({"error": "无更新字段"}), 400
    fields.append("updated_at=?")
    values.append(now_cst())
    values.append(sid)
    conn = get_db()
    conn.execute(f"UPDATE stickers SET {', '.join(fields)} WHERE id=?", values)
    conn.commit()
    row = conn.execute("SELECT * FROM stickers WHERE id=?", (sid,)).fetchone()
    conn.close()
    if not row:
        return jsonify({"error": "未找到便签"}), 404
    return jsonify(format_sticker(row))

@app.route("/api/stickers/<sid>", methods=["DELETE"])
def delete_sticker(sid):
    conn = get_db()
    row = conn.execute("SELECT * FROM stickers WHERE id=?", (sid,)).fetchone()
    if row and row["image_path"]:
        fp = os.path.join(os.path.dirname(os.path.abspath(__file__)), row["image_path"].lstrip("/"))
        if os.path.isfile(fp):
            try:
                os.remove(fp)
            except Exception:
                pass
    conn.execute("DELETE FROM stickers WHERE id=?", (sid,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})

@app.route("/api/upload", methods=["POST"])
def upload_image():
    if "file" not in request.files:
        return jsonify({"error": "无文件"}), 400
    f = request.files["file"]
    if f.filename == "":
        return jsonify({"error": "空文件名"}), 400
    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"):
        return jsonify({"error": "不支持的图片格式"}), 400
    filename = f"{uuid.uuid4().hex}{ext}"
    save_path = os.path.join(UPLOAD_DIR, filename)
    img = Image.open(f.stream)
    img.thumbnail((1200, 1200), Image.LANCZOS)
    if img.mode == "RGBA":
        img = img.convert("RGBA")
    elif img.mode != "RGB":
        img = img.convert("RGB")
    img.save(save_path, quality=85, optimize=True)
    return jsonify({"url": f"/static/uploads/{filename}", "filename": filename})

@app.route("/")
def index():
    return send_from_directory("static", "index.html")

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5050)

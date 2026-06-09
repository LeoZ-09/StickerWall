# StickerWall · 便签墙 — 项目全景

> 摄影社团课堂 Ideas 记录工具  
> 生成于 2026-06-09，基于全量源码分析

---

## 一、项目定位

一个**可视化便签墙**单页应用。用户可以在类似 Pinterest 的"墙"上自由放置便签，支持文字、绘图、手写、图片四种内容类型。附带 AI 助手，可以根据墙上的便签内容做汇总和灵感建议。面向摄影社团课堂场景，用于快速记录和整理创作 Ideas。

---

## 二、技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端 | 原生 HTML / CSS / JS | 单页应用，无框架依赖 |
| 后端 A | Node.js + Express | 主力后端，生产运行版 |
| 后端 B | Python + Flask + Pillow | 备选后端，同 API 接口 |
| 数据层 | JSON 文件 → SQLite | 两套后端各自存储，格式不同 |
| 图片处理 | sharp (Node) / Pillow (Python) | 上传压缩、缩略图 |
| AI 集成 | OpenAI 兼容 API | 前端直连或经后端代理 |

### 依赖清单

**Node.js（package.json）**
- express ^4.21.0 — Web 框架
- multer ^1.4.5 — 文件上传中间件
- sharp ^0.33.0 — 高性能图片处理
- uuid ^10.0.0 — ID 生成

**Python（requirements.txt）**
- flask ==3.1.0
- Pillow ==11.1.0

---

## 三、项目目录结构

```
J:\StickerWall
├── server.js              # Node.js 后端（主力）
├── app.py                 # Python/Flask 后端（备选）
├── package.json           # Node 依赖配置
├── requirements.txt       # Python 依赖配置
├── 橡皮擦.svg             # 绘图工具的橡皮擦图标
├── PROJECT_OVERVIEW.md    # 本文件
│
├── data/
│   └── stickers.json      # Node 后端的 JSON DB
│
├── static/
│   ├── index.html          # 前端 UI（1216 行，含全部 CSS + JS）
│   ├── ai.js               # AI 聊天模块（独立 JS）
│   ├── uploads/            # 上传图片存储目录（当前为空）
│   └── stickers.db         # Python 后端的 SQLite DB
│
├── node_modules/           # Node 依赖安装目录
└── .git/
```

---

## 四、数据模型

### 便签（Sticker）字段

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `id` | string | UUID8 | 唯一标识 |
| `author` | string | '匿名' | 署名 |
| `content_type` | string | 'text' | text / drawing / handwriting / image |
| `text_content` | string | '' | 文字内容或图片说明 |
| `image_path` | string | '' | 上传图片 URL 路径 |
| `drawing_data` | array|null | null | 绘图笔画数据（JSON） |
| `handwriting_data` | array|null | null | 手写笔画数据（JSON） |
| `bg_color` | string | '#FFF9E6' | 便签背景色（7 种预设） |
| `pos_x` | float | 0 | 在墙上的 X 位置 |
| `pos_y` | float | 0 | 在墙上的 Y 位置 |
| `rotation` | float | 0 | 旋转角度（度） |
| `width` | int | 280 | 宽度（部分自动计算） |
| `height` | int | 280 | 高度（部分自动计算） |
| `created_at` | string (CST) | now | 创建时间 |
| `updated_at` | string (CST) | now | 最后更新时间 |

### 存储对比

- **Node 后端（server.js）**：使用 `data/stickers.json`，全量读写，JSON 数组存储
- **Python 后端（app.py）**：使用 `static/stickers.db`（SQLite），WAL 模式，`stickers` 表，`drawing_data`/`handwriting_data` 字段 JSON 序列化

---

## 五、API 接口

两套后端实现相同接口，Node 为默认运行版。

| 方法 | 路由 | 说明 |
|------|------|------|
| GET | `/api/stickers` | 获取全部便签（按创建时间倒序） |
| POST | `/api/stickers` | 创建便签 |
| PUT | `/api/stickers/:id` | 更新便签（部分字段） |
| DELETE | `/api/stickers/:id` | 删除便签（附带清理图片文件） |
| POST | `/api/upload` | 上传图片（multipart/form-data） |
| POST | `/api/ai/chat` | AI 聊天代理（Node 特有，避免 CORS） |
| GET | `/` | 返回前端主页 |

---

## 六、前端架构（static/index.html）

### UI 结构

1. **便签墙（Wall）** — 主视图，带点阵背景，响应式缩放
2. **底部工具栏** — AI 输入框 + 设置按钮
3. **创建弹窗（Create Modal）** — 四种模式切换
4. **详情弹窗（Detail Overlay）** — 查看/编辑单条便签
5. **AI 回复气泡** — 浮动在墙上
6. **设置弹窗（Settings Overlay）** — 署名 / AI 配置

### 核心交互逻辑

- **响应式缩放**：以 1600px 为参考宽度，通过 `scale()` 适配不同屏幕
- **拖拽**：拖拽便签改变位置，轻点打开详情
- **8 秒自动刷新**：轮询 `/api/stickers` 保持多端同步
- **便签内容自适应**：文字按字符数 / 绘图按 BoundingBox 动态计算尺寸
- **7 种预设背景色**：暖黄、淡蓝、粉红、淡绿、暖橙、淡紫、纯白

### 四种创建模式

| 模式 | 交互方式 | 数据存储 |
|------|---------|---------|
| 文字（text） | textarea 输入 | `text_content` |
| 绘图（drawing） | Canvas 画笔 | `drawing_data`（笔画数组） |
| 手写（handwriting） | Canvas 画笔 | `handwriting_data`（笔画数组） |
| 图片（image） | 文件选择 + 说明 | `image_path` + `text_content` |

绘图工具栏支持：钢笔、矩形、圆形、橡皮擦、颜色选择（含 HSV 色轮）、清空、撤销。

---

## 七、AI 模块（static/ai.js）

### 架构

```
用户输入 → AIChat.send() / sendStream()
            ├─ 获取全部便签数据作为上下文
            ├─ 通过后端代理 /api/ai/chat 转发到 LLM
            └─ 非流式返回，展示在浮动气泡中
```

### 特性

- **API 兼容**：支持任何 OpenAI 兼容接口（可配置 baseUrl / model / apiKey）
- **上下文注入**：自动将当前墙上所有便签的结构化数据作为 system prompt 发送
- **转为便签**：AI 回复可一键转成便签贴到墙上
- **默认 Prompt**：汇总 ideas、完善创意、补充背景材料
- **设置持久化**：Settings 存 localStorage（键名 `sw_ai_settings`、`sw_default_author`）

---

## 八、Git 历史与开发脉络

共 6 次提交，由 LeoZ-09 在 2026-04-25 ~ 04-30 之间完成：

1. **d3e7f0e** — 基本搭建，第一版样式
2. **21cdaad** — 便签大小自适应
3. **c482904** — 优化便签添加弹窗设计与交互
4. **4dacb47** — 细化新建绘制便签窗口
5. **3300365** — 全面细化页面设计
6. **3e5d985** — 修复不同显示器溢出问题

当前有两处未提交的变更：`server.js` 和 `index.html` 有未 staged 修改，`static/ai.js` 和 `.codewhale/` 为未跟踪新文件。

---

## 九、可以优化的方向（供后续开发参考）

### 功能层面
1. **双后端统一** — 当前 Node 和 Python 两套后端并存，数据不互通。可选方向：统一为一种方案，或加一层网关
2. **持久化存储升级** — JSON 文件适合小规模，SQLite 已由 Python 版引入但 Node 版未跟进
3. **用户系统** — 当前仅靠 author 字段区分，无认证
4. **便签模板** — 可预设一些模板（如"光圈/快门/ISO"笔记模板）
5. **分享/导出** — 将便签墙导出为图片或分享链接

### 体验层面
6. **多端同步** — 当前靠 8 秒轮询，可升级为 WebSocket 实时同步
7. **便签筛选/搜索** — 按 author、日期、关键词筛选
8. **无限画布** — 当前靠滚动，可升级为 Canvas 无限画布（类似 Figma/Miro）

### 代码质量
9. **前端模块化** — index.html 内 500+ 行 JS 内联，可拆分为独立模块
10. **TypeScript** — 增加类型安全
11. **测试** — 目前无任何测试
12. **Docker 化** — 标准化部署

---

## 十、如何启动

```bash
# Node.js 版（默认）
npm install
npm start
# → http://localhost:5050

# Python 版（备选）
pip install -r requirements.txt
python app.py
# → http://localhost:5050
```

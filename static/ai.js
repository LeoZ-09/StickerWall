// ============================================================
// AI Chat Module – 便签墙 StickerWall
// ============================================================

const AISettings = {
  _defaults: {
    enabled: false,
    platform: 'openai',
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-3.5-turbo',
    systemPrompt: '你是一个友好的便签墙助手。user将会给你输入一段文本，可能是词、短语或句子，包含一个主题。请查询该主题有关的所有便签，汇总其内容，帮助用户汇总idea、完善idea、提供创意灵感、补全适当的背景材料。请用中文回复，保持简洁，只输出汇总后的便签内容，不输出汇总便签的信息列举、进一步引导提问等内容。\n\n格式限制：只能使用标题（# / ## / ###）和纯文本段落两种 Markdown 样式，不使用列表、代码块、表格、引用等其他格式。'
  },

  load() {
    try {
      const raw = localStorage.getItem('sw_ai_settings');
      return raw ? { ...this._defaults, ...JSON.parse(raw) } : { ...this._defaults };
    } catch { return { ...this._defaults }; }
  },

  save(settings) {
    localStorage.setItem('sw_ai_settings', JSON.stringify(settings));
  },

  update(key, value) {
    const s = this.load();
    s[key] = value;
    this.save(s);
  }
};

// -------- Default signature --------
const DefaultSignature = {
  load() {
    return localStorage.getItem('sw_default_author') || '';
  },

  save(author) {
    localStorage.setItem('sw_default_author', author.trim());
  }
};

// -------- AI Chat API --------
const AIChat = {
  /** 获取并格式化全部便签数据，附带字段说明 */
  async getStickersContext() {
    try {
      const res = await fetch('/api/stickers');
      const stickers = await res.json();
      if (!stickers.length) return '当前便签墙上没有任何便签。';

      const fieldsDesc = `便签数据字段说明：
- id: 该信息无用，请忽略
- author: 署名（创建者昵称）
- content_type: 内容类型（text=纯文字, drawing=绘图, handwriting=手写, image=图片）
- text_content: 文字内容（纯文本或图片附带的说明）
- bg_color: 该信息无用，请忽略
- pos_x / pos_y: 该信息无用，请忽略
- rotation: 该信息无用，请忽略
- width / height: 该信息无用，请忽略
- created_at: 创建时间
- updated_at: 最后更新时间`;

      const stickersJson = stickers.map(s => ({
        id: s.id,
        author: s.author,
        type: s.content_type,
        text: (s.text_content || '').slice(0, 200),
        color: s.bg_color,
        created: s.created_at
      }));
      
      return `${fieldsDesc}\n\n以下是当前便签墙上的全部便签数据（共 ${stickers.length} 条）：\n${JSON.stringify(stickersJson, null, 2)}`;
    } catch {
      return '（无法获取便签数据）';
    }
  },

  /** Non-streaming request */
  async send(message, { onToken, onDone, onError } = {}) {
    const settings = AISettings.load();
    if (!settings.enabled) { onError?.('AI 功能未启用，请在设置中开启'); return; }
    if (!settings.apiKey)     { onError?.('请先在设置中填写 API Key'); return; }

    const stickersContext = await this.getStickersContext();

    const messages = [
      { role: 'system', content: settings.systemPrompt },
      { role: 'user', content: stickersContext },
      { role: 'user', content: message }
    ];

    try {
      const resp = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages,
          apiKey: settings.apiKey,
          baseUrl: settings.baseUrl,
          model: settings.model
        })
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `请求失败 (${resp.status})`);
      }

      const data = await resp.json();
      const content = data.choices?.[0]?.message?.content || '';
      onDone?.(content);
    } catch (e) {
      onError?.(e.message);
    }
  },

  /** Streaming request －逐 token 回调 */
  async sendStream(message, { onToken, onDone, onError } = {}) {
    const settings = AISettings.load();
    if (!settings.enabled) { onError?.('AI 功能未启用，请在设置中开启'); return; }
    if (!settings.apiKey)     { onError?.('请先在设置中填写 API Key'); return; }

    const stickersContext = await this.getStickersContext();

    const messages = [
      { role: 'system', content: settings.systemPrompt },
      { role: 'user', content: stickersContext },
      { role: 'user', content: message }
    ];

    try {
      const resp = await fetch(`${settings.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.apiKey}`
        },
        body: JSON.stringify({
          model: settings.model,
          messages: messages,
          stream: true
        })
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`API 错误 (${resp.status}): ${text}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(l => l.trim().startsWith('data: '));

        for (const line of lines) {
          const data = line.replace('data: ', '').trim();
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            const token = parsed.choices?.[0]?.delta?.content || '';
            if (token) {
              fullText += token;
              onToken?.(token, fullText);
            }
          } catch { /* ignore malformed json */ }
        }
      }
      onDone?.(fullText);
    } catch (e) {
      onError?.(e.message);
    }
  }
};

// Expose to global scope
window.AISettings = AISettings;
window.DefaultSignature = DefaultSignature;
window.AIChat = AIChat;

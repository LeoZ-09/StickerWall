/**
 * StickerWall AI 模块
 * 提供 AIChat、AISettings、DefaultSignature 三个全局对象
 * API Key 在前端配置，通过后端代理转发 AI 请求
 */
(function() {
  'use strict';

  const STORAGE_KEY_AI = 'stickerwall_ai_settings';
  const STORAGE_KEY_SIG = 'stickerwall_default_signature';

  // ==================== DefaultSignature ====================
  const DefaultSignature = {
    load: function() {
      try {
        const v = localStorage.getItem(STORAGE_KEY_SIG);
        return v != null ? v : '';
      } catch (e) {
        return '';
      }
    },
    save: function(val) {
      try {
        localStorage.setItem(STORAGE_KEY_SIG, String(val || ''));
      } catch (e) { /* ignore */ }
    }
  };

  // ==================== AISettings ====================
  const DEFAULT_SETTINGS = {
    enabled: false,
    platform: 'openai',
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-3.5-turbo',
    systemPrompt: '你是一个友好的便签墙助手，帮助用户记录想法、润色文字、提供创意灵感。请用中文回复，保持简洁。\n\n格式限制：只能使用标题（# / ## / ###）和纯文本段落两种 Markdown 样式，不使用列表、代码块、表格、引用等其他格式。'
  };

  const AISettings = {
    load: function() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY_AI);
        if (raw) {
          const parsed = JSON.parse(raw);
          return Object.assign({}, DEFAULT_SETTINGS, parsed);
        }
      } catch (e) { /* ignore */ }
      return Object.assign({}, DEFAULT_SETTINGS);
    },
    save: function(settings) {
      try {
        localStorage.setItem(STORAGE_KEY_AI, JSON.stringify(settings));
      } catch (e) { /* ignore */ }
    }
  };

  // ==================== AIChat ====================
  const AIChat = {
    send: function(userMessage, callbacks) {
      const settings = AISettings.load();

      if (!settings.apiKey) {
        callbacks.onError('请在设置中配置 API Key');
        return;
      }
      if (!userMessage) {
        callbacks.onError('请输入消息');
        return;
      }

      // Build connection context for AI
      var connContext = '';
      try {
        var stickersData = window.stickers || [];
        var connectionsData = window.connections || [];
        if (connectionsData.length > 0) {
          connContext = '\n\n当前便签间的关联网络：\n';
          connectionsData.forEach(function(c) {
            var a = stickersData.find(function(s) { return s.id === c.id_a; });
            var b = stickersData.find(function(s) { return s.id === c.id_b; });
            var aText = a ? (a.text_content || a.id).slice(0, 40) : c.id_a;
            var bText = b ? (b.text_content || b.id).slice(0, 40) : c.id_b;
            connContext += '- "' + aText + '" ↔ "' + bText + '"\n';
          });
        }
      } catch(e) {}

      const fullSystemPrompt = settings.systemPrompt + connContext;

      // Call backend proxy — API Key is sent and forwarded, never stored server-side
      fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: settings.apiKey.trim(),
          message: userMessage,
          systemPrompt: fullSystemPrompt,
          model: settings.model || 'gpt-3.5-turbo',
          baseUrl: settings.baseUrl || 'https://api.openai.com/v1'
        })
      })
      .then(function(response) {
        if (!response.ok) {
          return response.json().then(function(err) {
            throw new Error(err.error || ('请求失败: HTTP ' + response.status));
          }).catch(function() {
            throw new Error('请求失败: HTTP ' + response.status);
          });
        }
        return response.json();
      })
      .then(function(data) {
        if (data.content) {
          callbacks.onDone(data.content);
        } else {
          callbacks.onError('AI 返回了空响应');
        }
      })
      .catch(function(err) {
        callbacks.onError(err.message || '请求失败，请检查网络和配置');
      });
    }
  };

  // Expose to window
  window.DefaultSignature = DefaultSignature;
  window.AISettings = AISettings;
  window.AIChat = AIChat;
})();

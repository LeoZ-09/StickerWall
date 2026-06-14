/**
 * StickerWall AI 模块
 * 提供 AIChat、AISettings、DefaultSignature 三个全局对象
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

      const url = (settings.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '') + '/chat/completions';

      const messages = [
        { role: 'system', content: settings.systemPrompt },
        { role: 'user', content: userMessage }
      ];

      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + settings.apiKey.trim()
        },
        body: JSON.stringify({
          model: settings.model || 'gpt-3.5-turbo',
          messages: messages,
          temperature: 0.7,
          max_tokens: 2000
        })
      })
      .then(function(response) {
        if (!response.ok) {
          return response.json().then(function(err) {
            throw new Error(err.error ? err.error.message : ('HTTP ' + response.status));
          }).catch(function() {
            throw new Error('HTTP ' + response.status);
          });
        }
        return response.json();
      })
      .then(function(data) {
        if (data.choices && data.choices.length > 0 && data.choices[0].message) {
          callbacks.onDone(data.choices[0].message.content);
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
/**
 * StickerWall AI / Agent 前端模块
 * 提供 AIChat（兼容旧版）、AgentChat（新版带工具调用）、AISettings、DefaultSignature
 *
 * Agent 模式通过 SSE 流式读取后端编排过程，逐帧回调给 UI
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

  // ==================== Agent System Prompt ====================

  const AGENT_SYSTEM_PROMPT = `你是 StickerWall（便签墙）的 AI 助手。你有以下工具可以使用：

## 可用工具
- **search_stickers(query)** —— 搜索便签文本内容
- **get_all_stickers(limit)** —— 获取所有便签列表
- **get_sticker_detail(id)** —— 获取指定便签的完整详情
- **get_sticker_connections(id)** —— 获取某便签的所有关联
- **get_all_connections()** —— 获取全部关联网络
- **get_wall_stats()** —— 获取墙面统计（总数、类型分布、关联数、作者）
- **get_stickers_by_author(author)** —— 按作者查找便签

## 工作方式
1. 先理解用户需要什么，选择合适的工具获取数据
2. 一次只调用一个工具，看结果后再决定下一步
3. 获取足够信息后，用中文给出清晰、有结构的回答
4. 如果工具返回空结果，如实告诉用户
5. 不需要调用工具时直接回答

## 回答风格
- 用中文回复，自然口语化
- 适当使用 Markdown 列表和标题
- 涉及便签内容时指出创建时间和作者
- 总结性的信息优先`;

  // ==================== AISettings ====================

  const DEFAULT_SETTINGS = {
    enabled: false,
    platform: 'openai',
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-3.5-turbo',
    systemPrompt: AGENT_SYSTEM_PROMPT
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

  // ==================== AgentChat (SSE 流式) ====================

  const AgentChat = {
    /**
     * 发送 Agent 请求，通过 SSE 流式接收事件
     *
     * @param {string} userMessage - 用户消息
     * @param {object} callbacks - { onThinking, onToolResult, onDone, onError }
     */
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

      // 构建请求体
      const payload = {
        message: userMessage,
        systemPrompt: settings.systemPrompt,
        model: settings.model || 'gpt-3.5-turbo',
        baseUrl: settings.baseUrl || 'https://api.openai.com/v1',
        apiKey: settings.apiKey.trim()
      };

      // 用 fetch 消费 SSE 流
      fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function(response) {
        if (!response.ok) {
          // 非 SSE 错误（如 400/500）
          return response.json().then(function(err) {
            throw new Error(err.error || ('请求失败: HTTP ' + response.status));
          }).catch(function() {
            throw new Error('请求失败: HTTP ' + response.status);
          });
        }

        // 读取流
        var reader = response.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';

        function readChunk() {
          reader.read().then(function(result) {
            if (result.done) {
              // 流结束
              return;
            }

            buffer += decoder.decode(result.value, { stream: true });

            // 解析 SSE 消息（event: xxx\ndata: {...}\n\n）
            var parts = buffer.split('\n\n');
            // 最后一段可能不完整，留到下次
            buffer = parts.pop() || '';

            for (var i = 0; i < parts.length; i++) {
              var block = parts[i];
              if (!block.trim()) continue;

              var lines = block.split('\n');
              var eventType = '';
              var dataStr = '';

              for (var j = 0; j < lines.length; j++) {
                var line = lines[j];
                if (line.startsWith('event: ')) {
                  eventType = line.slice(7).trim();
                } else if (line.startsWith('data: ')) {
                  dataStr = line.slice(6).trim();
                }
              }

              if (!eventType || !dataStr) continue;

              try {
                var data = JSON.parse(dataStr);
              } catch (e) {
                continue;
              }

              switch (eventType) {
                case 'thinking':
                  if (callbacks.onThinking) {
                    callbacks.onThinking(data.tool, data.args || {});
                  }
                  break;
                case 'tool_result':
                  if (callbacks.onToolResult) {
                    callbacks.onToolResult(data.tool, data.result || {});
                  }
                  break;
                case 'done':
                  if (callbacks.onDone) {
                    callbacks.onDone(data.content || '');
                  }
                  break;
                case 'error':
                  if (callbacks.onError) {
                    callbacks.onError(data.message || '未知错误');
                  }
                  break;
              }
            }

            // 继续读取
            readChunk();
          }).catch(function(err) {
            if (callbacks.onError) {
              callbacks.onError('流读取失败: ' + err.message);
            }
          });
        }

        readChunk();
      }).catch(function(err) {
        if (callbacks.onError) {
          callbacks.onError(err.message || '请求失败，请检查网络和配置');
        }
      });
    }
  };

  // ==================== Legacy AIChat（向后兼容，也走 Agent 端点） ====================

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

      // Build connection context for AI (legacy mode only)
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

      // Call backend proxy — same as before
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

  // ==================== Expose to window ====================
  window.DefaultSignature = DefaultSignature;
  window.AISettings = AISettings;
  window.AgentChat = AgentChat;
  window.AIChat = AIChat;  // 保留旧版兼容
})();

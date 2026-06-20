/**
 * StickerWall Agent 引擎
 * Tool Registry + 工具执行器 + Agent 编排器
 * 单回合设计：每轮用户请求独立，不传递历史对话
 */
(function() {
  'use strict';

  // ==================== Tool Registry ====================

  const TOOL_DEFINITIONS = [
    {
      type: 'function',
      function: {
        name: 'search_stickers',
        description: '搜索便签。按文本内容关键词搜索，返回匹配的便签列表（摘要信息）',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: '搜索关键词，支持模糊匹配'
            }
          },
          required: ['query']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_all_stickers',
        description: '获取所有便签的列表，返回摘要信息（id、作者、内容前80字、类型、背景色、创建时间、位置）',
        parameters: {
          type: 'object',
          properties: {
            limit: {
              type: 'integer',
              description: '返回条数上限（默认 50）'
            }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_sticker_detail',
        description: '获取指定便签的完整详情，包括全部文本内容、绘画数据、关联的图片URL等',
        parameters: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: '便签的 id'
            }
          },
          required: ['id']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_sticker_connections',
        description: '获取某个便签的所有关联（连接线）——即和哪些便签有联系',
        parameters: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: '便签的 id'
            }
          },
          required: ['id']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_all_connections',
        description: '获取墙面所有便签之间的关联网络（全部连接线）',
        parameters: {
          type: 'object',
          properties: {}
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_wall_stats',
        description: '获取墙面统计信息：便签总数、各类型数量、关联总数、作者列表、时间范围',
        parameters: {
          type: 'object',
          properties: {}
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_stickers_by_author',
        description: '按作者名查询便签',
        parameters: {
          type: 'object',
          properties: {
            author: {
              type: 'string',
              description: '作者名（精确匹配）'
            }
          },
          required: ['author']
        }
      }
    }
  ];

  // ==================== Tool Executors ====================
  // 这些函数接收参数对象，返回结果（直接可序列化为 JSON 的数据）

  function execSearchStickers(args, { dbQuery, formatSticker }) {
    const query = (args.query || '').trim();
    if (!query) return { error: '搜索关键词不能为空' };
    const rows = dbQuery(
      'SELECT id, author, content_type, text_content, bg_color, pos_x, pos_y, created_at FROM stickers WHERE text_content LIKE ? ORDER BY created_at DESC LIMIT 30',
      [`%${query}%`]
    );
    return rows.map(r => ({
      id: r.id,
      author: r.author,
      type: r.content_type,
      summary: (r.text_content || '').slice(0, 80),
      bg_color: r.bg_color,
      created_at: r.created_at
    }));
  }

  function execGetAllStickers(args, { dbQuery, formatSticker }) {
    const limit = Math.min(args.limit || 50, 200);
    const rows = dbQuery('SELECT id, author, content_type, text_content, bg_color, pos_x, pos_y, created_at FROM stickers ORDER BY created_at DESC LIMIT ?', [limit]);
    return rows.map(r => ({
      id: r.id,
      author: r.author,
      type: r.content_type,
      summary: (r.text_content || '').slice(0, 80),
      bg_color: r.bg_color,
      created_at: r.created_at
    }));
  }

  function execGetStickerDetail(args, { dbQuery, formatSticker }) {
    const id = (args.id || '').trim();
    if (!id) return { error: '便签 id 不能为空' };
    const rows = dbQuery('SELECT * FROM stickers WHERE id = ?', [id]);
    if (rows.length === 0) return { error: `未找到 id 为 "${id}" 的便签` };
    const s = formatSticker(rows[0]);
    return {
      id: s.id,
      author: s.author,
      content_type: s.content_type,
      text_content: s.text_content,
      image_path: s.image_path,
      drawing_data: s.drawing_data,
      handwriting_data: s.handwriting_data,
      bg_color: s.bg_color,
      pos_x: s.pos_x,
      pos_y: s.pos_y,
      rotation: s.rotation,
      width: s.width,
      height: s.height,
      created_at: s.created_at,
      updated_at: s.updated_at
    };
  }

  function execGetStickerConnections(args, { dbQuery }) {
    const id = (args.id || '').trim();
    if (!id) return { error: '便签 id 不能为空' };
    const rows = dbQuery('SELECT * FROM connections WHERE id_a = ? OR id_b = ? ORDER BY created_at DESC', [id, id]);
    return rows.map(r => ({
      id: r.id,
      id_a: r.id_a,
      id_b: r.id_b,
      label: r.label,
      created_at: r.created_at
    }));
  }

  function execGetAllConnections(args, { dbQuery }) {
    const rows = dbQuery('SELECT * FROM connections ORDER BY created_at DESC');
    return rows.map(r => ({
      id: r.id,
      id_a: r.id_a,
      id_b: r.id_b,
      label: r.label,
      created_at: r.created_at
    }));
  }

  function execGetWallStats(args, { dbQuery }) {
    const total = dbQuery('SELECT COUNT(*) AS c FROM stickers')[0].c;
    const byType = dbQuery('SELECT content_type, COUNT(*) AS c FROM stickers GROUP BY content_type');
    const connCount = dbQuery('SELECT COUNT(*) AS c FROM connections')[0].c;
    const authors = dbQuery('SELECT DISTINCT author FROM stickers ORDER BY author');
    const timeRange = dbQuery('SELECT MIN(created_at) AS first, MAX(created_at) AS last FROM stickers')[0];
    return {
      total_stickers: total,
      by_type: byType.reduce((acc, r) => { acc[r.content_type] = r.c; return acc; }, {}),
      total_connections: connCount,
      authors: authors.map(r => r.author),
      time_range: timeRange.first ? { first: timeRange.first, last: timeRange.last } : null
    };
  }

  function execGetStickersByAuthor(args, { dbQuery, formatSticker }) {
    const author = (args.author || '').trim();
    if (!author) return { error: '作者名不能为空' };
    const rows = dbQuery(
      'SELECT id, author, content_type, text_content, bg_color, pos_x, pos_y, created_at FROM stickers WHERE author = ? ORDER BY created_at DESC',
      [author]
    );
    return rows.map(r => ({
      id: r.id,
      author: r.author,
      type: r.content_type,
      summary: (r.text_content || '').slice(0, 80),
      bg_color: r.bg_color,
      created_at: r.created_at
    }));
  }

  // ==================== Tool Executor Map ====================

  const TOOL_EXECUTOR_MAP = {
    search_stickers: execSearchStickers,
    get_all_stickers: execGetAllStickers,
    get_sticker_detail: execGetStickerDetail,
    get_sticker_connections: execGetStickerConnections,
    get_all_connections: execGetAllConnections,
    get_wall_stats: execGetWallStats,
    get_stickers_by_author: execGetStickersByAuthor
  };

  // ==================== Agent Orchestrator ====================

  const MAX_ROUNDS = 10;

  /**
   * 运行 Agent 单回合循环
   *
   * @param {object} opts
   * @param {string} opts.userMessage - 用户消息
   * @param {string} opts.systemPrompt - 系统提示词
   * @param {string} opts.apiKey - API Key
   * @param {string} opts.baseUrl - API 地址
   * @param {string} opts.model - 模型名
   * @param {object} opts.db - 数据库依赖 { dbQuery, formatSticker }
   * @param {function} opts.onEvent - 事件回调 function(eventType, data)
   *       事件类型: 'thinking', 'tool_result', 'done', 'error'
   * @returns {Promise<string>} 最终回答文本
   */
  async function runAgent(opts) {
    const { userMessage, systemPrompt, apiKey, baseUrl, model, db, onEvent } = opts;

    if (!apiKey) {
      const err = '请在设置中配置 API Key';
      onEvent('error', { message: err });
      throw new Error(err);
    }

    const targetUrl = (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '') + '/chat/completions';

    // 构建 messages——单回合，不传历史
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ];

    let round = 0;

    while (round < MAX_ROUNDS) {
      round++;

      let response;
      try {
        response = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: model || 'gpt-3.5-turbo',
            messages: messages,
            tools: TOOL_DEFINITIONS,
            tool_choice: 'auto',
            temperature: 0.3,
            max_tokens: 4000
          })
        });
      } catch (err) {
        const msg = `AI 请求失败: ${err.message}`;
        onEvent('error', { message: msg });
        throw new Error(msg);
      }

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        const msg = `AI 服务响应错误: ${response.status}`;
        onEvent('error', { message: msg, detail: errBody });
        throw new Error(msg);
      }

      const data = await response.json();
      const choice = data.choices?.[0];
      if (!choice) {
        const msg = 'AI 返回了空响应';
        onEvent('error', { message: msg });
        throw new Error(msg);
      }

      const finishReason = choice.finish_reason;

      // 如果是最终回答（非 tool_calls）
      if (finishReason !== 'tool_calls' && finishReason !== 'function_call') {
        const content = choice.message?.content || '';
        onEvent('done', { content });
        return content;
      }

      // 处理工具调用
      const toolCalls = choice.message?.tool_calls || [];
      // 把 assistant 消息追加到对话
      messages.push(choice.message);

      for (const tc of toolCalls) {
        if (tc.type !== 'function') continue;
        const funcName = tc.function.name;
        let funcArgs;
        try {
          funcArgs = JSON.parse(tc.function.arguments || '{}');
        } catch {
          funcArgs = {};
        }

        onEvent('thinking', { tool: funcName, args: funcArgs, call_id: tc.id });

        // 执行工具
        const executor = TOOL_EXECUTOR_MAP[funcName];
        let result;
        if (executor) {
          try {
            result = executor(funcArgs, db);
          } catch (err) {
            result = { error: `工具执行出错: ${err.message}` };
          }
        } else {
          result = { error: `未知工具: ${funcName}` };
        }

        onEvent('tool_result', { tool: funcName, result, call_id: tc.id });

        // 将工具结果追加到 messages
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result)
        });
      }
    }

    // 超过最大轮次
    const msg = `Agent 已达到最大推理轮次 (${MAX_ROUNDS})，请简化你的请求`;
    onEvent('error', { message: msg });
    throw new Error(msg);
  }

  // ==================== Exports ====================

  module.exports = {
    TOOL_DEFINITIONS,
    TOOL_EXECUTOR_MAP,
    runAgent
  };
})();

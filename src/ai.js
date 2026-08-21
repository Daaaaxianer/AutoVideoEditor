'use strict';
/**
 * 可选 AI 增强（默认关闭，属于"最后手段"）：
 *  - mode 'auto'  ：自动探测本地 Ollama (127.0.0.1:11434)，没有则关闭
 *  - mode 'ollama'：强制使用本地 Ollama（数据不出本机）
 *  - mode 'api'   ：OpenAI 兼容在线 API（需用户自备 key，如 DeepSeek/硅基流动/OpenAI）
 * 任何失败都会返回 null，由调用方回退到启发式，绝不中断主流程。
 */
const http = require('http');
const https = require('https');
const { log } = require('./utils');

const AI_MODES = ['off', 'auto', 'ollama', 'api'];
const OLLAMA_URL = 'http://127.0.0.1:11434';

function httpJson(url, { method = 'GET', headers = {}, body = null, timeout = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.request(url, { method, headers, timeout }, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (_) {
            reject(new Error('AI 响应解析失败'));
          }
        } else {
          reject(new Error(`AI HTTP ${res.statusCode}: ${data.slice(0, 160)}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('AI 请求超时'));
    });
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function ollamaAvailable() {
  try {
    const t = await httpJson(`${OLLAMA_URL}/api/tags`, { timeout: 1500 });
    return !!(t && Array.isArray(t.models) && t.models.length);
  } catch (_) {
    return false;
  }
}

/** 归一化 ai 配置；返回 null 表示 AI 不可用。 */
async function resolveAi(ai) {
  if (!ai || ai.mode === 'off' || ai.mode === 'none') return null;
  if (ai.mode === 'auto') {
    if (await ollamaAvailable()) return { ...ai, mode: 'ollama' };
    log('ai', '未检测到本地 Ollama，AI 增强关闭（启发式照常工作）');
    return null;
  }
  if (ai.mode === 'ollama' && !(await ollamaAvailable())) {
    log('ai', '本地 Ollama 未运行，AI 增强关闭');
    return null;
  }
  if (ai.mode === 'api' && !ai.apiKey) {
    log('ai', '未配置 API Key，AI 增强关闭');
    return null;
  }
  return ai;
}

/** 通用对话。 */
async function chat(ai, messages, { temperature = 0.7 } = {}) {
  if (!ai) return null;
  if (ai.mode === 'ollama') {
    const model = ai.model || 'qwen2.5:7b';
    const r = await httpJson(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      timeout: 90000,
      headers: { 'Content-Type': 'application/json' },
      body: { model, messages, stream: false, options: { temperature } },
    });
    return (r.message && r.message.content) || null;
  }
  if (ai.mode === 'api') {
    const base = (ai.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const model = ai.model || 'gpt-4o-mini';
    const r = await httpJson(`${base}/chat/completions`, {
      method: 'POST',
      timeout: 120000,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ai.apiKey}` },
      body: { model, messages, temperature },
    });
    return (r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content) || null;
  }
  return null;
}

/** 要求模型只返回 JSON，解析失败返回 null。 */
async function askJson(ai, system, user) {
  try {
    const text = await chat(ai, [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ], { temperature: 0.4 });
    if (!text) return null;
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const obj = JSON.parse(m[0]);
    return obj;
  } catch (e) {
    log('ai', `AI JSON 解析失败: ${e.message}`);
    return null;
  }
}

/** AI 生成标题 / 副标题 / 结尾语。 */
async function genTitle(ai, { templateName, mood, photos, videos, dateRange }) {
  const sys =
    '你是短视频文案策划。只输出 JSON 对象，不要任何多余文字。格式：{"title":"主标题（不超过12字）","subtitle":"副标题（英文或短句，不超过20字符）","endText":"结尾语（不超过16字）"}';
  const user =
    `模板：${templateName}；风格情绪：${mood}；素材：照片${photos}张、视频${videos}段；时间跨度：${dateRange}。` +
    `请为这个家庭纪念视频写一个标题、副标题和结尾语，温暖自然，贴合情绪。`;
  return askJson(ai, sys, user);
}

/** AI 智能选片排序：从候选照片中挑 N 张并按叙事顺序排列，返回文件名数组。 */
async function aiPickOrder(ai, { target, candidates, hint = '兼顾人物、场景与时间分布，画面清晰有故事感' }) {
  const sys =
    '你是资深家庭视频剪辑师。根据每张照片的信息挑选最适合入片的照片，只输出 JSON 数组（照片文件名，按时间叙事顺序排列）。不要任何多余文字。';
  const list = candidates
    .map((c) => `${c.name} | 质量分${c.score} | ${c.width}x${c.height} | ${c.date} | ${c.desc || ''}`)
    .join('\n');
  const user = `请从下列照片中挑选 ${target} 张，并按叙事顺序输出 JSON 数组：\n${list}\n挑选要求：${hint}`;
  try {
    const text = await chat(ai, [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ], { temperature: 0.3 });
    if (!text) return null;
    const m = text.match(/\[[\s\S]*\]/);
    if (!m) return null;
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr)) return null;
    const byName = new Map(candidates.map((c) => [c.name, c]));
    return arr.map((n) => byName.get(String(n))).filter(Boolean).map((c) => c.name);
  } catch (e) {
    log('ai', `AI 选片失败: ${e.message}`);
    return null;
  }
}

module.exports = { AI_MODES, resolveAi, chat, genTitle, aiPickOrder, ollamaAvailable };

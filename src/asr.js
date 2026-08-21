'use strict';
/**
 * 语音识别字幕（可选，默认关闭；失败自动跳过，不影响出片）：
 *  - mode 'off'  ：关闭
 *  - mode 'auto' ：优先探测本地 whisper（whisper.cpp / openai-whisper CLI），否则用 API（需 Key）
 *  - mode 'local'：强制本地 whisper
 *  - mode 'api'  ：OpenAI 兼容 /audio/transcriptions（如 OpenAI / 硅基流动 / Groq）
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn, spawnSync } = require('child_process');
const { FFMPEG, run, log } = require('./utils');

function whisperAvailable() {
  try {
    const r = spawnSync('whisper', ['--help'], {
      timeout: 8000, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'],
    });
    return r.status === 0;
  } catch (_) {
    return false;
  }
}

/** 归一化 ASR 配置；返回 null 表示不可用。 */
async function resolveAsr(cfg) {
  const mode = (cfg && cfg.mode) || 'off';
  if (mode === 'off' || mode === 'none') return null;
  if (mode === 'auto') {
    if (whisperAvailable()) {
      log('asr', '使用本地 whisper 语音识别');
      return { mode: 'local' };
    }
    if (cfg.apiKey) return { mode: 'api', baseUrl: cfg.baseUrl || 'https://api.openai.com/v1', apiKey: cfg.apiKey, model: cfg.model || 'whisper-1' };
    log('asr', '未检测到本地 whisper 且未配置 API Key，语音字幕关闭（可用 --asr api --asr-key xxx 开启）');
    return null;
  }
  if (mode === 'local') {
    if (whisperAvailable()) return { mode: 'local' };
    log('asr', '本地 whisper 不可用，语音字幕关闭');
    return null;
  }
  if (mode === 'api') {
    if (!cfg.apiKey) {
      log('asr', 'API 模式缺少 --asr-key，语音字幕关闭');
      return null;
    }
    return { mode: 'api', baseUrl: cfg.baseUrl || 'https://api.openai.com/v1', apiKey: cfg.apiKey, model: cfg.model || 'whisper-1' };
  }
  return null;
}

/** 提取视频片段音频为 16k 单声道 wav。 */
async function extractAudio(videoFile, start, dur, outWav) {
  await run(FFMPEG, ['-v', 'error', '-y', '-ss', String(start), '-t', String(dur), '-i', videoFile, '-ac', '1', '-ar', '16000', outWav]);
}

function httpJson(url, { method = 'POST', headers = {}, body, timeout = 120000 }) {
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
            reject(new Error('ASR 响应解析失败'));
          }
        } else reject(new Error(`ASR HTTP ${res.statusCode}: ${data.slice(0, 160)}`));
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('ASR 超时')); });
    if (body) req.write(body);
    req.end();
  });
}

/** API 转写（multipart 上传 wav）。 */
async function apiTranscribe(asr, wavPath) {
  const boundary = '----aved' + Date.now().toString(36);
  const buf = fs.readFileSync(wavPath);
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`
  );
  const mid = Buffer.from(
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${asr.model || 'whisper-1'}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nzh\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\njson\r\n` +
    `--${boundary}--\r\n`
  );
  const body = Buffer.concat([head, buf, mid]);
  const base = (asr.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const r = await httpJson(`${base}/audio/transcriptions`, {
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      Authorization: `Bearer ${asr.apiKey}`,
      'Content-Length': body.length,
    },
    body,
  });
  return r;
}

/** 本地 whisper 转写（输出 json 到临时目录）。 */
async function localTranscribe(wavPath, tmpDir) {
  return new Promise((resolve, reject) => {
    const child = spawn('whisper', [wavPath, '--model', 'base', '--language', 'zh', '--output_format', 'json', '--output_dir', tmpDir, '--fp16', 'False'], {
      windowsHide: true,
    });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error('whisper 退出码 ' + code + ': ' + err.slice(0, 200)));
      const jf = path.join(tmpDir, path.basename(wavPath, '.wav') + '.json');
      try {
        resolve(JSON.parse(fs.readFileSync(jf, 'utf8')));
      } catch (e) {
        reject(e);
      }
    });
  });
}

/**
 * 转写一段视频。
 * @returns {Promise<{text:string}|null>} 失败返回 null
 */
async function transcribeSegment(asr, videoFile, start, dur, tmpDir) {
  try {
    const wav = path.join(tmpDir, `asr_${Date.now()}_${Math.floor(Math.random() * 1e5)}.wav`);
    await extractAudio(videoFile, start, dur, wav);
    let text = '';
    if (asr.mode === 'api') {
      const r = await apiTranscribe(asr, wav);
      text = (r && r.text) || '';
    } else {
      const r = await localTranscribe(wav, tmpDir);
      text = ((r && r.text) || '').trim();
    }
    try { fs.unlinkSync(wav); } catch (_) { /* ignore */ }
    return text ? { text } : null;
  } catch (e) {
    log('asr', `转写失败: ${e.message}`);
    return null;
  }
}

module.exports = { resolveAsr, transcribeSegment, whisperAvailable };

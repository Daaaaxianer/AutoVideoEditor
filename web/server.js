'use strict';
/**
 * Web 服务器（零依赖）：
 *  - 静态页面与素材/成片文件服务（支持 Range 以便视频拖动）
 *  - GET  /api/state            扫描结果（模板/素材/音乐/历史成片）
 *  - GET  /api/thumb?p=..&w=..  缩略图（缓存）
 *  - PUT  /api/upload?name=..   上传素材（流式写入 input 目录）
 *  - POST /api/render           创建渲染任务（后台运行 cli.js）
 *  - GET  /api/jobs[/:id]       任务状态 / 日志
 *  - POST /api/scan             重新扫描素材
 * 用法: node web/server.js [--port 8088]
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { resolveConfig, ROOT } = require('../src/config');
const { scanAll } = require('../src/scanner');
const { listTemplates } = require('../src/template');
const { FFMPEG } = require('../src/utils');
const { detectEncoders } = require('../src/hwenc');
const { pythonAvailable } = require('../src/face');

const { cfg } = resolveConfig({});
const PORT = Number(process.env.PORT || cfg.webPort || 8088);
const JOBS_DIR = path.join(ROOT, '.jobs');
const THUMBS_DIR = path.join(ROOT, '.thumbs');
fs.mkdirSync(JOBS_DIR, { recursive: true });
fs.mkdirSync(THUMBS_DIR, { recursive: true });

const { PRESET_LABELS, PRESET_IDS } = require('../src/filters');
const { MOTION_LABELS, MOTIONS } = require('../src/motion');
const { XFADE_TRANSITIONS } = require('../src/template');
const { STYLE_LABELS, STYLE_FONTS } = require('../src/textstyle');
const { ollamaAvailable } = require('../src/ai');

// Ollama 探测缓存（30 秒）
let _ollamaCache = null;
let _ollamaAt = 0;
async function aiStatus() {
  if (Date.now() - _ollamaAt > 30000 || _ollamaCache === null) {
    _ollamaAt = Date.now();
    _ollamaCache = await ollamaAvailable().catch(() => false);
  }
  return _ollamaCache;
}

// 系统概览缓存（30 秒）
let _sysCache = null;
let _sysAt = 0;
async function systemInfo() {
  if (_sysCache && Date.now() - _sysAt < 30000) return _sysCache;
  _sysAt = Date.now();
  let ffmpeg = false;
  try {
    ffmpeg = spawnSync('ffmpeg', ['-version'], { windowsHide: true, timeout: 8000, stdio: ['ignore', 'ignore', 'ignore'] }).status === 0;
  } catch (_) { /* ignore */ }
  let gpu = [];
  try {
    const enc = await detectEncoders();
    gpu = [...new Set(
      [...enc]
        .filter((n) => /^(h264|hevc)_(qsv|nvenc|amf|mf)$/.test(n))
        .map((n) => n.replace(/^h264_|^hevc_/, '').toUpperCase())
    )];
  } catch (_) { /* ignore */ }
  _sysCache = {
    node: process.version,
    ffmpeg,
    gpu,
    face: pythonAvailable(),
    cpus: os.cpus().length,
    platform: process.platform,
  };
  return _sysCache;
}

/** 打开默认浏览器（仅本机工具使用）。 */
function openBrowser(url) {
  try {
    const cmd = process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch (_) { /* ignore */ }
}

// ---- 素材来源：优先 inputDir；为空时回退 samples（演示） ----
function effectiveInputDir() {
  return hasMedia(cfg.inputDir) ? cfg.inputDir : path.join(ROOT, 'samples', 'input');
}
function effectiveMusicDir() {
  return hasMedia(cfg.musicDir) ? cfg.musicDir : path.join(ROOT, 'samples', 'music');
}
function mediaRoots() {
  const roots = [];
  const eff = effectiveInputDir();
  roots.push({ label: eff === cfg.inputDir ? 'input' : 'samples/input', dir: eff });
  return roots;
}
function musicRoots() {
  const roots = [];
  const eff = effectiveMusicDir();
  roots.push({ label: eff === cfg.musicDir ? 'music' : 'samples/music', dir: eff });
  return roots;
}
function hasMedia(dir) {
  try {
    return fs.readdirSync(dir).some((n) => fs.statSync(path.join(dir, n)).isFile());
  } catch (_) {
    return false;
  }
}

// ---- 素材库"移除链接"（不删本地文件，可恢复） ----
const IGNORE_FILE = path.join(ROOT, '.aved-ignored.json');
function readIgnore() {
  try {
    const j = JSON.parse(fs.readFileSync(IGNORE_FILE, 'utf8'));
    return Array.isArray(j.files) ? j.files : [];
  } catch (_) {
    return [];
  }
}
function writeIgnore(list) {
  fs.writeFileSync(IGNORE_FILE, JSON.stringify({ files: list }, null, 2));
}

// ---- 任务管理 ----
function jobMeta(id) {
  try {
    return JSON.parse(fs.readFileSync(path.join(JOBS_DIR, id + '.json'), 'utf8'));
  } catch (_) {
    return null;
  }
}
function saveJob(j) {
  fs.writeFileSync(path.join(JOBS_DIR, j.id + '.json'), JSON.stringify(j, null, 2));
}
function listJobs() {
  const jobs = [];
  for (const name of fs.readdirSync(JOBS_DIR)) {
    if (!name.endsWith('.json')) continue;
    const j = jobMeta(name.replace('.json', ''));
    if (j) jobs.push(j);
  }
  return jobs.sort((a, b) => b.createdAt - a.createdAt);
}

function startRender(body) {
  const id = 'job_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const j = {
    id, status: 'running', createdAt: Date.now(),
    params: body, output: null, cover: null, error: null,
  };
  saveJob(j);

  const args = [path.join(ROOT, 'src', 'cli.js')];
  const push = (k, v) => { if (v !== undefined && v !== null && v !== '') args.push(k, String(v)); };
  push('--input', effectiveInputDir());
  push('--music', effectiveMusicDir());
  push('--output', cfg.outputDir);
  push('--template', body.template || 'family-moments');
  push('--variant', body.variant);
  push('--title', body.title);
  push('--subtitle', body.subtitle);
  push('--end-text', body.endText);
  if (body.coverMode === 'time') push('--cover', 'time:' + (body.coverTime || 5));
  else if (body.coverMode === 'file' && body.coverFile) push('--cover', 'file:' + body.coverFile);
  else push('--cover', 'random');
  push('--photos', body.photos);
  push('--videos', body.videos);
  push('--duration', body.duration);
  push('--photo-duration', body.photoDuration);
  push('--filter', body.filter);
  push('--motion', body.motion);
  push('--transition', body.transition);
  push('--font-style', body.fontStyle);
  push('--aspect', body.aspect);
  push('--fps', body.fps);
  push('--music-mood', body.musicMood);
  push('--music-volume', body.musicVolume);
  if (body.keepAudio === true) args.push('--keep-audio');
  if (body.keepAudio === false) args.push('--no-keep-audio');
  push('--watermark', body.watermark === true ? undefined : body.watermark);
  push('--seed', body.seed);
  if (body.captions === false) args.push('--no-captions');
  if (Array.isArray(body.exclude) && body.exclude.length) push('--exclude', body.exclude.join(';'));
  push('--hw-enc', body.hwEnc);
  push('--quality', body.quality);
  push('--face-weight', body.faceWeight);
  if (body.faceSafe === false) args.push('--no-face-safe');
  if (body.transitionZoom) args.push('--transition-zoom');
  if (Array.isArray(body.useFiles) && body.useFiles.length) push('--use-files', body.useFiles.join(';'));
  push('--music-file', body.musicFile);
  if (body.ai && body.ai.mode && body.ai.mode !== 'off') {
    push('--ai', body.ai.mode);
    push('--ai-model', body.ai.model);
    push('--ai-base-url', body.ai.baseUrl);
    push('--ai-key', body.ai.apiKey);
  }
  if (body.asr && body.asr.mode && body.asr.mode !== 'off') {
    push('--asr', body.asr.mode);
    push('--asr-model', body.asr.model);
    push('--asr-base-url', body.asr.baseUrl);
    push('--asr-key', body.asr.apiKey);
  }

  const logPath = path.join(JOBS_DIR, id + '.log');
  const logFd = fs.openSync(logPath, 'a');
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
  });
  child.on('error', (e) => {
    j.status = 'error';
    j.error = '启动失败: ' + e.message;
    saveJob(j);
  });
  child.on('close', (code) => {
    fs.closeSync(logFd);
    j.status = code === 0 ? 'done' : 'error';
    if (code !== 0) {
      j.error = `渲染进程退出码 ${code}`;
      const tail = readLogTail(id, 4000);
      if (tail) j.error += '\n' + tail.split('\n').slice(-8).join('\n');
    } else {
      const log = readLogTail(id, 8000);
      const mOut = /成片:\s+(\S+\.mp4)/.exec(log);
      const mCover = /封面:\s+(\S+\.jpg)/.exec(log);
      if (mOut) j.output = mOut[1];
      if (mCover) j.cover = mCover[1];
      if (!j.output) {
        // 兜底：输出目录最新 mp4
        try {
          const files = fs.readdirSync(cfg.outputDir).filter((n) => n.endsWith('.mp4'));
          files.sort((a, b) => fs.statSync(path.join(cfg.outputDir, b)).mtimeMs - fs.statSync(path.join(cfg.outputDir, a)).mtimeMs);
          if (files[0]) j.output = path.join(cfg.outputDir, files[0]);
        } catch (_) { /* ignore */ }
      }
    }
    saveJob(j);
  });
  return j;
}

function readLogTail(id, max) {
  try {
    const p = path.join(JOBS_DIR, id + '.log');
    const st = fs.statSync(p);
    const start = Math.max(0, st.size - max);
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(st.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    return buf.toString('utf8');
  } catch (_) {
    return '';
  }
}

// ---- HTTP ----
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function serveFile(res, file, { download = false } = {}) {
  let st;
  try {
    st = fs.statSync(file);
  } catch (_) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }
  if (!st.isFile()) {
    res.writeHead(404);
    res.end();
    return;
  }
  const mime = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const headers = { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
  if (download) headers['Content-Disposition'] = `attachment; filename="${path.basename(file)}"`;
  const range = res.req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      const start = m[1] ? parseInt(m[1], 10) : 0;
      const end = m[2] ? parseInt(m[2], 10) : st.size - 1;
      if (start < st.size && end >= start) {
        headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
        headers['Content-Length'] = end - start + 1;
        res.writeHead(206, headers);
        const stream = fs.createReadStream(file, { start, end });
        stream.pipe(res);
        return;
      }
    }
  }
  headers['Content-Length'] = st.size;
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}

/** 安全地把项目内相对路径解析为绝对路径（防目录穿越）。 */
function safeResolve(rel) {
  const p = path.resolve(ROOT, String(rel).replace(/^\/+/, ''));
  if (!p.startsWith(ROOT + path.sep) && p !== ROOT) return null;
  return p;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  // pathname 为百分号编码形式，解码以支持中文文件名（音乐试听/成片/素材等）
  const p = decodeURIComponent(url.pathname);
  res.req = req; // serveFile 取 range 头

  try {
    // ---------- API ----------
    if (p === '/api/state') {
      const media = { images: [], videos: [], music: [] };
      const ignored = new Set(readIgnore());
      const toRel = (file) => file.replace(/\\/g, '/').replace(ROOT.replace(/\\/g, '/') + '/', '');
      for (const r of mediaRoots()) {
        const s = scanAll(r.dir, null);
        for (const it of s.images) {
          if (ignored.has(it.file)) continue;
          media.images.push({ file: it.file, rel: toRel(it.file), name: path.basename(it.file), mtime: it.mtime, size: it.size, src: it.file });
        }
        for (const it of s.videos) {
          if (ignored.has(it.file)) continue;
          media.videos.push({ file: it.file, rel: toRel(it.file), name: path.basename(it.file), mtime: it.mtime, size: it.size, src: it.file });
        }
      }
      for (const r of musicRoots()) {
        const s = scanAll(null, r.dir);
        for (const it of s.music) media.music.push({ file: it.file, rel: toRel(it.file), name: it.name, src: it.file });
      }
      let outputs = [];
      try {
        outputs = fs.readdirSync(cfg.outputDir).filter((n) => n.endsWith('.mp4')).map((n) => ({ file: path.join(cfg.outputDir, n), rel: toRel(path.join(cfg.outputDir, n)) }));
      } catch (_) { /* ignore */ }
      sendJson(res, 200, {
        templates: listTemplates(cfg.templateDir),
        media,
        outputs,
        jobs: listJobs(),
        config: { inputDir: cfg.inputDir, musicDir: cfg.musicDir, outputDir: cfg.outputDir },
        ai: { ollama: await aiStatus() },
        system: await systemInfo(),
      });
      return;
    }

    if (p === '/api/scan') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (p === '/api/meta') {
      sendJson(res, 200, {
        filters: Object.fromEntries([['auto', '自动（按模板推荐）'], ['none', '原片'], ...PRESET_IDS.map((id) => [id, PRESET_LABELS[id]])]),
        motions: Object.fromEntries([['auto', '自动'], ...MOTIONS.map((m) => [m, MOTION_LABELS[m]])]),
        transitions: XFADE_TRANSITIONS,
        fontStyles: Object.fromEntries([['auto', '自动'], ...Object.keys(STYLE_FONTS).map((k) => [k, STYLE_LABELS[k]])]),
      });
      return;
    }

    if (p === '/api/thumb') {
      const rel = url.searchParams.get('p') || '';
      const w = Math.min(480, parseInt(url.searchParams.get('w') || '320', 10) || 320);
      const file = safeResolve(rel);
      if (!file || !fs.existsSync(file)) return sendJson(res, 404, { error: 'not found' });
      const key = crypto.createHash('md5').update(file + fs.statSync(file).size).digest('hex');
      const thumb = path.join(THUMBS_DIR, `${key}_${w}.jpg`);
      if (!fs.existsSync(thumb)) {
        const args = ['-v', 'error', '-y'];
        const ext = path.extname(file).toLowerCase();
        const isVideo = ['.mp4', '.mov', '.m4v', '.mkv', '.avi', '.webm', '.3gp'].includes(ext);
        if (isVideo) args.push('-ss', '0.6');
        args.push('-i', file, '-vf', `scale=${w}:-2`, '-frames:v', '1', '-q:v', '4', thumb);
        await new Promise((resolveP) => {
          const c = spawn(FFMPEG, args, { windowsHide: true, stdio: 'ignore' });
          c.on('close', resolveP);
          c.on('error', resolveP);
        });
      }
      if (!fs.existsSync(thumb)) return sendJson(res, 404, { error: 'thumb fail' });
      serveFile(res, thumb);
      return;
    }

    if (p === '/api/media-remove' && req.method === 'POST') {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        try {
          const { files } = JSON.parse(body || '{}');
          const list = readIgnore();
          let n = 0;
          for (const f of Array.isArray(files) ? files : []) {
            const full = path.resolve(String(f));
            if (!list.includes(full)) { list.push(full); n++; }
          }
          writeIgnore(list);
          sendJson(res, 200, { ok: true, removed: n });
        } catch (e) {
          sendJson(res, 500, { error: e.message });
        }
      });
      return;
    }

    if (p === '/api/media-restore' && req.method === 'POST') {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        try {
          const { files } = JSON.parse(body || '{}');
          const set = new Set((files || []).map((f) => path.resolve(String(f))));
          writeIgnore(readIgnore().filter((f) => !set.has(f)));
          sendJson(res, 200, { ok: true });
        } catch (e) {
          sendJson(res, 500, { error: e.message });
        }
      });
      return;
    }

    if (p === '/api/media-ignored') {
      sendJson(res, 200, { files: readIgnore() });
      return;
    }

    if (p === '/api/delete-media' && req.method === 'POST') {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        try {
          const { files } = JSON.parse(body || '{}');
          const roots = [path.resolve(cfg.inputDir), path.resolve(ROOT, 'samples', 'input')];
          let n = 0;
          for (const f of Array.isArray(files) ? files : []) {
            const full = path.resolve(String(f));
            const okRoot = roots.some((r) => full.startsWith(r + path.sep));
            if (!okRoot) continue;
            if (fs.existsSync(full)) { fs.unlinkSync(full); n++; }
          }
          sendJson(res, 200, { ok: true, deleted: n });
        } catch (e) {
          sendJson(res, 500, { error: e.message });
        }
      });
      return;
    }

    if (p === '/api/delete-job' && req.method === 'POST') {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        try {
          const { id } = JSON.parse(body || '{}');
          const safe = String(id || '').replace(/[^a-zA-Z0-9_-]/g, '');
          for (const ext of ['.json', '.log']) {
            const fp = path.join(JOBS_DIR, safe + ext);
            if (fs.existsSync(fp)) fs.unlinkSync(fp);
          }
          sendJson(res, 200, { ok: true });
        } catch (e) {
          sendJson(res, 500, { error: e.message });
        }
      });
      return;
    }

    if (p === '/api/upload' && req.method === 'PUT') {
      const target = url.searchParams.get('target') || 'input';
      const baseDir = target === 'music' ? cfg.musicDir : target === 'cover' ? path.join(cfg.outputDir, 'covers') : cfg.inputDir;
      const name = path.basename(url.searchParams.get('name') || 'upload_' + Date.now());
      const dest = path.join(baseDir, name);
      fs.mkdirSync(baseDir, { recursive: true });
      const ws = fs.createWriteStream(dest);
      req.pipe(ws);
      req.on('end', () => sendJson(res, 200, { ok: true, file: dest, target }));
      req.on('error', () => sendJson(res, 500, { error: 'upload failed' }));
      return;
    }

    if (p === '/api/open-folder' && req.method === 'POST') {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        try {
          const { path: fp } = JSON.parse(body || '{}');
          const full = path.resolve(String(fp || ''));
          if (!full.startsWith(ROOT) && full !== ROOT) return sendJson(res, 403, { error: 'forbidden' });
          // explorer 规范用法：/select, 与路径分两个参数（路径含中文由 UTF-16 命令行传递，无需引号）
          const cmd = process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
          const args = process.platform === 'win32' ? ['/select,', full] : [path.dirname(full)];
          const c = spawn(cmd, args, { detached: true, stdio: 'ignore' });
          c.on('error', (e) => sendJson(res, 500, { error: '打开目录失败: ' + e.message }));
          c.unref();
          sendJson(res, 200, { ok: true });
        } catch (e) {
          sendJson(res, 500, { error: e.message });
        }
      });
      return;
    }

    if (p === '/api/delete-file' && req.method === 'POST') {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        try {
          const { path: fp } = JSON.parse(body || '{}');
          const full = path.resolve(String(fp || ''));
          // 仅允许删除输出目录中的文件
          if (!full.startsWith(cfg.outputDir)) return sendJson(res, 403, { error: 'forbidden' });
          // 彻底删除：成片 + 同名封面
          if (fs.existsSync(full)) fs.unlinkSync(full);
          const coverPath = full.replace(/\.mp4$/, '.jpg');
          if (coverPath !== full && fs.existsSync(coverPath)) fs.unlinkSync(coverPath);
          // 同步清理引用该成片的任务记录
          for (const name of fs.readdirSync(JOBS_DIR)) {
            if (!name.endsWith('.json')) continue;
            const jp = path.join(JOBS_DIR, name);
            try {
              const j = JSON.parse(fs.readFileSync(jp, 'utf8'));
              if (j.output === full || j.cover === full.replace(/\.mp4$/, '.jpg')) fs.unlinkSync(jp);
            } catch (_) { /* ignore */ }
          }
          sendJson(res, 200, { ok: true });
        } catch (e) {
          sendJson(res, 500, { error: e.message });
        }
      });
      return;
    }

    if (p === '/api/render' && req.method === 'POST') {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        try {
          const j = startRender(JSON.parse(body || '{}'));
          sendJson(res, 200, j);
        } catch (e) {
          sendJson(res, 400, { error: e.message });
        }
      });
      return;
    }

    if (p === '/api/jobs') {
      sendJson(res, 200, listJobs());
      return;
    }
    const jobsMatch = /^\/api\/jobs\/([^/]+)$/.exec(p);
    if (jobsMatch) {
      const j = jobMeta(jobsMatch[1]);
      if (!j) return sendJson(res, 404, { error: 'no job' });
      sendJson(res, 200, { ...j, log: readLogTail(j.id, 6000) });
      return;
    }

    // ---------- 静态文件 ----------
    if (p === '/' || p === '/index.html') {
      return serveFile(res, path.join(ROOT, 'web', 'index.html'));
    }
    if (p.startsWith('/web/')) {
      const f = safeResolve(p.slice(1));
      if (f) return serveFile(res, f);
    }
    for (const dir of ['output', 'input', 'music', 'samples']) {
      if (p.startsWith('/' + dir + '/')) {
        const f = safeResolve(p.slice(1));
        if (f) return serveFile(res, f, { download: url.searchParams.get('dl') === '1' });
      }
    }
    sendJson(res, 404, { error: 'not found: ' + p });
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
});

server.on('error', (e) => {
  // EADDRINUSE 由下面的自动端口检测处理
  if (e.code === 'EADDRINUSE') return;
  console.error('服务器启动失败:', e.message);
  process.exit(1);
});

/** 尝试在指定端口监听；被占用返回 null。 */
function tryListen(port) {
  return new Promise((resolve) => {
    server.removeAllListeners('error');
    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE') resolve(null);
      else {
        console.error('服务器启动失败:', e.message);
        process.exit(1);
      }
    });
    server.listen(port, () => resolve(port));
  });
}

(async () => {
  // 自动检测可用端口（从配置端口开始向后探测）
  let actual = null;
  for (let i = 0; i < 20; i++) {
    actual = await tryListen(PORT + i);
    if (actual) break;
  }
  if (!actual) {
    console.error(`端口 ${PORT}~${PORT + 19} 均被占用，无法启动。请先关闭占用这些端口的程序。`);
    process.exit(1);
  }
  const url = `http://127.0.0.1:${actual}`;
  console.log('==============================================');
  console.log('  AutoVideoEditor · 照片视频自动剪辑工具');
  console.log('  --------------------------------------------------');
  console.log('  功能简介：');
  console.log('  · 自动挑选照片/视频（质量分+人脸优先+多样性）');
  console.log('  · 自动剪辑：运镜 / 转场 / 节奏 / 滤镜 / 字幕');
  console.log('  · 自动匹配音乐与字体，内置多套模板与风格');
  console.log('  · 支持手动精选素材、自定义全部参数');
  console.log('  · 全部本地 CPU/GPU 处理，数据不出本机');
  console.log('  --------------------------------------------------');
  console.log(`  实际端口: ${actual}`);
  console.log(`  访问地址: ${url}`);
  console.log(`  素材目录: ${cfg.inputDir}`);
  console.log(`  音乐目录: ${cfg.musicDir}`);
  console.log(`  输出目录: ${cfg.outputDir}`);
  console.log('  关闭本窗口即可停止服务');
  console.log('==============================================');
  setTimeout(() => openBrowser(url), 800);
})();

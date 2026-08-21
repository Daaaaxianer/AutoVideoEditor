'use strict';
/**
 * 通用工具：子进程封装、临时目录、ffmpeg 过滤器转义、日志。
 * 零依赖：仅使用 Node 内置模块。
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || 'ffprobe';

function log(tag, msg) {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`[${t}][${tag}] ${msg}`);
}

/** 异步执行命令，返回 {code, out, err}；非 0 退出码抛错（带输出）。 */
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true, ...opts });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => reject(e));
    p.on('close', (code) => {
      if (code === 0) resolve({ code, out, err });
      else {
        const e = new Error(`${cmd} exited with code ${code}`);
        e.code = code;
        e.out = out;
        e.err = err;
        reject(e);
      }
    });
  });
}

/** 同步执行（用于快速探测）。 */
function runSync(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { windowsHide: true, encoding: 'utf8', ...opts });
  return r;
}

/** 异步执行，stdout 保留为 Buffer（用于读取 rawvideo 等二进制输出）。 */
function runBuf(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true, ...opts });
    const chunks = [];
    let err = '';
    p.stdout.on('data', (d) => chunks.push(d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => reject(e));
    p.on('close', (code) => {
      const out = Buffer.concat(chunks);
      if (code === 0) resolve({ code, out, err });
      else {
        const e = new Error(`${cmd} exited with code ${code}`);
        e.code = code;
        e.out = out;
        e.err = err;
        reject(e);
      }
    });
  });
}

/** 创建临时目录并返回路径。 */
function makeTmp(prefix = 'aved-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmrf(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch (_) {
    /* ignore */
  }
}

/** 安全文件名。 */
function safeName(s, fallback = 'out') {
  const cleaned = String(s || '')
    .replace(/[\\/:*?"<>|\s]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

function sha1(s) {
  return crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 12);
}

/**
 * 转义 filter graph 中作为「选项值」使用的字符串。
 * ffmpeg filter 语法中 : 分隔选项、' 引号、\ 转义符、% 展开宏。
 */
function escFilter(s) {
  return String(s)
    .replace(/\\/g, '/')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%');
}

/** 转义 drawtext 的 text= 值（text 中 : ' \ % 需要转义）。 */
function escText(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%');
}

/** 解析 ffprobe 输出中的时长字符串 "12.34" / "00:00:12.34" / "12.340000"。 */
function parseDuration(s) {
  if (!s) return 0;
  const n = parseFloat(s);
  if (!Number.isNaN(n)) return n;
  const m = /^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(String(s).trim());
  if (m) {
    const h = m[1] ? parseInt(m[1], 10) : 0;
    return h * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3]);
  }
  return 0;
}

module.exports = {
  FFMPEG,
  FFPROBE,
  log,
  run,
  runBuf,
  runSync,
  makeTmp,
  rmrf,
  safeName,
  sha1,
  escFilter,
  escText,
  parseDuration,
};

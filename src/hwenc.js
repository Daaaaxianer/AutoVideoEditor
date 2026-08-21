'use strict';
/**
 * 本地硬件编码探测与选择（GPU 优先，回退 CPU 软件编码）：
 *  - 自动按优先级探测：Intel QSV → NVIDIA NVENC → AMD AMF → Windows MediaFoundation
 *  - 探测通过后缓存结果；调用方编码失败时还应回退 libx264（见 render.js）
 * 全部在本地完成，不上传任何数据。
 */
const { FFMPEG, run, log } = require('./utils');

let _encoderSet = null;
async function detectEncoders() {
  if (_encoderSet) return _encoderSet;
  const set = new Set();
  try {
    const { out } = await run(FFMPEG, ['-hide_banner', '-encoders']);
    for (const line of out.split(/\r?\n/)) {
      const m = /^\s*\S+\s+([A-Za-z0-9_]+)\s+/.exec(line);
      if (m) set.add(m[1]);
    }
  } catch (_) {
    /* ignore */
  }
  _encoderSet = set;
  return set;
}

/** 候选硬件编码器（优先级从高到低）+ 探测参数。 */
const HW_CANDIDATES = [
  { name: 'h264_nvenc', label: 'NVIDIA NVENC (GPU)', probe: ['-c:v', 'h264_nvenc', '-cq', '21', '-preset', 'p5'] },
  { name: 'h264_qsv', label: 'Intel QSV (GPU)', probe: ['-c:v', 'h264_qsv', '-global_quality', '24', '-preset', 'veryfast'] },
  { name: 'h264_amf', label: 'AMD AMF (GPU)', probe: ['-c:v', 'h264_amf', '-quality', 'quality', '-qp_i', '22', '-qp_p', '22'] },
  { name: 'h264_mf', label: 'Windows MediaFoundation (GPU)', probe: ['-c:v', 'h264_mf', '-b:v', '4M'] },
];

async function probeEncoder(name, args) {
  try {
    await run(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=s=96x96:d=0.4', ...args, '-f', 'null', '-']);
    return true;
  } catch (_) {
    return false;
  }
}

let _pickCache = null;

/**
 * 选择 H.264 编码器。
 * @param {object} cfg { hwEnc: 'auto'|'qsv'|'nvenc'|'amf'|'mf'|'off' }
 * @returns {Promise<{name, label, args, hw:boolean}>}
 */
async function pickH264Encoder(cfg = {}) {
  const want = String(cfg.hwEnc || 'auto').toLowerCase();
  if (_pickCache) return _pickCache;
  if (['off', 'none', 'software', 'cpu'].includes(want)) {
    _pickCache = { name: 'libx264', label: 'libx264 (CPU)', args: [], hw: false };
    return _pickCache;
  }
  const encoders = await detectEncoders();
  const explicit = HW_CANDIDATES.find((c) => c.name === 'h264_' + want);
  const cands = explicit ? [explicit] : HW_CANDIDATES.filter((c) => encoders.has(c.name));
  for (const c of cands) {
    if (await probeEncoder(c.name, c.probe)) {
      _pickCache = { name: c.name, label: c.label, args: c.probe.slice(2), hw: true };
      log('hwenc', `使用硬件编码: ${c.label}`);
      return _pickCache;
    }
  }
  _pickCache = { name: 'libx264', label: 'libx264 (CPU)', args: [], hw: false };
  log('hwenc', '未检测到可用硬件编码器，使用 CPU 软件编码 (libx264)');
  return _pickCache;
}

/** 生成编码器参数数组（不含 -c:v 之前的内容）。 */
function encArgs(enc, preset = 'veryfast', crf = 20) {
  if (!enc || enc.name === 'libx264') {
    return ['-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-pix_fmt', 'yuv420p'];
  }
  // 硬件编码器：附加探测参数 + 预设（QSV 支持 veryfast..veryslow；NVENC p1..p7 用 p 系列）
  const extra = [];
  if (enc.name === 'h264_qsv') extra.push('-preset', preset);
  if (enc.name === 'h264_nvenc') extra.push('-preset', 'p5');
  if (enc.name === 'h264_amf') extra.push('-quality', 'quality');
  return ['-c:v', enc.name, ...enc.args.filter((a) => a !== '-preset' && a !== 'veryfast'), ...extra];
}

module.exports = { pickH264Encoder, encArgs, detectEncoders, HW_CANDIDATES };

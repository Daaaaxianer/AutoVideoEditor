'use strict';
/**
 * 素材质量分析：
 *  - 亮度 / 对比度 / 饱和度：signalstats（缩放到小图，取首帧）
 *  - 清晰度（边缘能量）：edgedetect 后 signalstats YAVG
 *  - 平均颜色（去重 / 多样性用）：scale=1:1 rawvideo 取 RGB
 *  - 综合质量分
 */
const { FFMPEG, run, runBuf, parseDuration, log } = require('./utils');
const { probeImage, probeVideo } = require('./probe');
const { detectFacesBatch, faceSummary } = require('./face');

/** 执行 ffmpeg 并返回合并后的 stdout+stderr（用于解析 metadata 输出）。 */
async function ffmpegCapture(args) {
  try {
    const r = await run(FFMPEG, args);
    return (r.out || '') + (r.err || '');
  } catch (e) {
    return (e.out || '') + (e.err || '');
  }
}

/** 解析 metadata=print 的输出，返回 key 对应的数值数组（按出现顺序）。 */
function parseMetaValues(text, key) {
  const re = new RegExp(`(?:^|\\n)\\s*${key}=([-0-9.]+)`, 'g');
  const vals = [];
  let m;
  while ((m = re.exec(text)) !== null) vals.push(parseFloat(m[1]));
  return vals;
}

/**
 * 提取单帧统计：{ luma, min, max, contrast, sat, edge }
 * 在指定时间（视频）或首帧（图片）取 96x96 缩略图。
 * 注意：metadata=print 多条输出为逆序，因此原图统计与边缘统计
 * 拆成两次独立调用，按 key 名解析（与打印顺序无关）。
 */
async function extractStats(file, atSec = 0) {
  const pre = ['-v', 'error'];
  if (atSec > 0) pre.push('-ss', String(atSec));
  const base = [...pre, '-i', file, '-frames:v', '1'];

  // 1) 原图：亮度/对比度/饱和度
  const vf1 = [
    'scale=96:96:flags=bicubic',
    'signalstats',
    'metadata=print:key=lavfi.signalstats.YAVG:file=-',
    'metadata=print:key=lavfi.signalstats.YMIN:file=-',
    'metadata=print:key=lavfi.signalstats.YMAX:file=-',
    'metadata=print:key=lavfi.signalstats.SATAVG:file=-',
  ].join(',');
  const out1 = await ffmpegCapture([...base, '-vf', vf1, '-f', 'null', '-']);

  // 2) 边缘能量：edgedetect 之后只剩边缘亮度
  const vf2 = [
    'scale=96:96:flags=bicubic',
    'edgedetect=low=0.08:high=0.2',
    'signalstats',
    'metadata=print:key=lavfi.signalstats.YAVG:file=-',
  ].join(',');
  const out2 = await ffmpegCapture([...base, '-vf', vf2, '-f', 'null', '-']);

  const ymin = parseMetaValues(out1, 'lavfi.signalstats.YMIN');
  const ymax = parseMetaValues(out1, 'lavfi.signalstats.YMAX');
  const sat = parseMetaValues(out1, 'lavfi.signalstats.SATAVG');
  const luma = parseMetaValues(out1, 'lavfi.signalstats.YAVG');
  const edge = parseMetaValues(out2, 'lavfi.signalstats.YAVG');

  const lumaV = luma.length > 0 ? luma[0] : 128;
  const edgeV = edge.length > 0 ? edge[0] : 0;
  const min = ymin.length > 0 ? ymin[0] : 0;
  const max = ymax.length > 0 ? ymax[0] : 255;
  const contrast = max > min ? (max - min) / 255 : 0;
  const satVal = sat.length > 0 ? sat[0] / 255 : 0.3;
  return { luma: lumaV, min, max, contrast, sat: satVal, edge: edgeV };
}

/** 提取平均颜色 [r, g, b]（0-255）。 */
async function extractAvgColor(file) {
  const args = ['-v', 'error', '-i', file, '-frames:v', '1', '-vf', 'scale=1:1,format=rgb24', '-f', 'rawvideo', '-'];
  try {
    const r = await runBuf(FFMPEG, args);
    if (r.out.length >= 3) {
      return [r.out[0], r.out[1], r.out[2]];
    }
  } catch (_) {
    /* fallthrough */
  }
  return [128, 128, 128];
}

/** 综合质量分（0-100 上下浮动，仅用于相对比较）。 */
function qualityScore({ luma, contrast, sat, edge, width, height, duration }) {
  let score = 50;
  // 亮度适中
  if (luma >= 40 && luma <= 215) {
    score += 15 - Math.abs(luma - 125) * 0.09;
  } else {
    score -= 22;
  }
  // 对比度
  score += Math.min(12, contrast * 30);
  // 清晰度（边缘能量）
  score += Math.min(15, edge * 1.5);
  // 分辨率
  const minDim = Math.min(width || 0, height || 0);
  if (minDim >= 1080) score += 10;
  else if (minDim >= 720) score += 7;
  else if (minDim >= 480) score += 4;
  else score -= 6;
  // 饱和度适中偏好
  if (sat >= 0.15 && sat <= 0.9) score += 3;
  else score -= 3;
  // 视频时长偏好（成片快剪）
  if (duration !== undefined && duration > 0) {
    if (duration >= 4 && duration <= 30) score += 8;
    else if (duration >= 2 && duration <= 60) score += 4;
    else score -= 8;
  }
  return Math.round(score);
}

/** 分析单张照片。 */
async function analyzeImage(file) {
  const info = await probeImage(file);
  if (!info || !info.width || !info.height) return null;
  const stats = await extractStats(file, 0);
  const color = await extractAvgColor(file);
  const score = qualityScore({ ...stats, width: info.width, height: info.height });
  return {
    kind: 'image',
    file,
    width: info.width,
    height: info.height,
    aspect: info.width / info.height,
    codec: info.codec,
    ...stats,
    color,
    score,
  };
}

/** 分析单个视频（采样 3 帧取平均）。 */
async function analyzeVideo(file) {
  const info = await probeVideo(file);
  if (!info || !info.width || !info.height) return null;
  const samples = [];
  for (const f of [0.12, 0.5, 0.88]) {
    const s = await extractStats(file, info.duration * f);
    if (s) samples.push(s);
  }
  const avg = (k) => {
    const vals = samples.map((s) => s[k]).filter((v) => Number.isFinite(v));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  };
  const stats = {
    luma: avg('luma'),
    min: avg('min'),
    max: avg('max'),
    contrast: avg('contrast'),
    sat: avg('sat'),
    edge: avg('edge'),
  };
  const color = await extractAvgColor(file);
  const score = qualityScore({ ...stats, width: info.width, height: info.height, duration: info.duration });
  return {
    kind: 'video',
    file,
    width: info.width,
    height: info.height,
    aspect: info.width / info.height,
    duration: info.duration,
    fps: info.fps,
    hasAudio: info.hasAudio,
    ...stats,
    color,
    score,
  };
}

/**
 * 批量分析。
 * @param {Array} items scanDir 输出 [{file, mtime}]
 * @param {'image'|'video'} kind
 * @param {(i:number,total:number)=>void} onProgress
 */
async function analyzeBatch(items, kind, onProgress) {
  const out = [];
  const fn = kind === 'image' ? analyzeImage : analyzeVideo;
  for (let i = 0; i < items.length; i++) {
    const a = await fn(items[i].file);
    if (a) {
      a.mtime = items[i].mtime;
      a.size = items[i].size;
      out.push(a);
    }
    if (onProgress) onProgress(i + 1, items.length);
  }
  // 批量人脸识别（仅照片，本地 ONNX；失败自动跳过）
  if (kind === 'image' && out.length) {
    log('analyze', `照片人脸识别（本地）…`);
    const faces = await detectFacesBatch(out.map((a) => a.file));
    if (faces.size) {
      for (const a of out) {
        const fs = faces.get(a.file);
        if (fs && fs.length) a.face = faceSummary(fs, a.width, a.height);
      }
    }
  }
  log('analyze', `${kind} 分析完成: ${out.length}/${items.length}`);
  return out;
}

module.exports = { analyzeImage, analyzeVideo, analyzeBatch, extractStats, extractAvgColor, qualityScore };

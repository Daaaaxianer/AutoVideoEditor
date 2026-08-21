'use strict';
/**
 * 运镜引擎：基于 zoompan 的 Ken Burns 推拉摇移。
 * 照片默认加运镜；视频可选轻微缩放（subtle）。
 */

const MOTIONS = ['zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down', 'subtle', 'none'];

const MOTION_LABELS = {
  'zoom-in': '缓慢推近',
  'zoom-out': '缓慢拉远',
  'pan-left': '从左向右',
  'pan-right': '从右向左',
  'pan-up': '从上向下',
  'pan-down': '从下向上',
  subtle: '轻微推近',
  none: '静止',
};

function pickMotion(seed = 0, prefer = 'zoom-in') {
  if (prefer && prefer !== 'auto') return prefer;
  const r = Math.random();
  if (r < 0.3) return 'zoom-in';
  if (r < 0.5) return 'zoom-out';
  if (r < 0.65) return 'pan-left';
  if (r < 0.8) return 'pan-right';
  if (r < 0.9) return 'pan-up';
  return 'pan-down';
}

/**
 * 生成 zoompan 滤镜串（输入需已 cover-crop 到目标画幅的 2 倍尺寸）。
 * @param {string} motion
 * @param {object} o { width, height, fps, frames, rate, fx, fy } fx/fy 为焦点（画布归一化）
 */
function zoompan(motion, { width, height, fps, frames, rate = 0.0011, fx = 0.5, fy = 0.5 }) {
  const s = `${width}x${height}`;
  const f = Math.max(2, Math.round(frames));
  const end = Math.max(1, f - 1);
  const w2 = width * 2;
  const h2 = height * 2;
  const fxPx = fx * w2;
  const fyPx = fy * h2;
  const zc = 1.18;
  const availX = w2 - w2 / zc;
  const availY = h2 - h2 / zc;
  const cx = `'${fxPx.toFixed(1)}-(iw/zoom/2)'`;
  const cy = `'${fyPx.toFixed(1)}-(ih/zoom/2)'`;
  switch (motion) {
    case 'zoom-in':
      return `zoompan=z='min(zoom+${rate},1.35)':x=${cx}:y=${cy}:d=${f}:s=${s}:fps=${fps}`;
    case 'zoom-out':
      return `zoompan=z='if(eq(on,0),1.35,max(zoom-${rate},1))':x=${cx}:y=${cy}:d=${f}:s=${s}:fps=${fps}`;
    case 'pan-left': { // 从左到右，以人脸为中心小幅横移
      const a = fxPx - (w2 / zc) / 2 - availX * 0.06;
      const b = availX * 0.12;
      return `zoompan=z='${zc}':x='${a.toFixed(1)}+${b.toFixed(1)}*(on/${end})':y='${(fyPx - (h2 / zc) / 2).toFixed(1)}':d=${f}:s=${s}:fps=${fps}`;
    }
    case 'pan-right': { // 从右到左
      const a = fxPx - (w2 / zc) / 2 + availX * 0.06;
      const b = availX * 0.12;
      return `zoompan=z='${zc}':x='${a.toFixed(1)}-${b.toFixed(1)}*(on/${end})':y='${(fyPx - (h2 / zc) / 2).toFixed(1)}':d=${f}:s=${s}:fps=${fps}`;
    }
    case 'pan-up': { // 从上到下
      const a = fyPx - (h2 / zc) / 2 - availY * 0.06;
      const b = availY * 0.12;
      return `zoompan=z='${zc}':x='${(fxPx - (w2 / zc) / 2).toFixed(1)}':y='${a.toFixed(1)}+${b.toFixed(1)}*(on/${end})':d=${f}:s=${s}:fps=${fps}`;
    }
    case 'pan-down': { // 从下到上
      const a = fyPx - (h2 / zc) / 2 + availY * 0.06;
      const b = availY * 0.12;
      return `zoompan=z='${zc}':x='${(fxPx - (w2 / zc) / 2).toFixed(1)}':y='${a.toFixed(1)}-${b.toFixed(1)}*(on/${end})':d=${f}:s=${s}:fps=${fps}`;
    }
    case 'subtle':
      return `zoompan=z='min(zoom+${rate * 0.5},1.12)':x=${cx}:y=${cy}:d=${f}:s=${s}:fps=${fps}`;
    case 'none':
    default:
      return '';
  }
}

/**
 * 计算人脸居中焦点（画布归一化 0-1）。
 * @param {object} face faceSummary（归一化到原图）
 * @param {number} srcW 原图宽
 * @param {number} srcH 原图高
 * @param {number} W 目标宽
 * @param {number} H 目标高
 * @returns {{fx:number, fy:number}} 焦点（安全区钳制）
 */
function computeFocus(face, srcW, srcH, W, H) {
  if (!face || !srcW || !srcH) return { fx: 0.5, fy: 0.5 };
  const cw = W * 2;
  const ch = H * 2;
  const scale = Math.max(cw / srcW, ch / srcH);
  const cropW = srcW * scale;
  const cropH = srcH * scale;
  const cropX = (cropW - cw) / 2;
  const cropY = (cropH - ch) / 2;
  const fx = (face.cx * srcW * scale - cropX) / cw;
  const fy = (face.cy * srcH * scale - cropY) / ch;
  return {
    fx: Math.min(0.75, Math.max(0.25, fx)),
    fy: Math.min(0.7, Math.max(0.3, fy)),
  };
}

function clampExpr(v, lo, hi) {
  const n = Math.min(hi, Math.max(lo, v));
  return `max(0\\,min(${hi}\\,${n.toFixed(2)}))`;
}

/**
 * 照片预处理链：cover-crop 到 2 倍尺寸（供 zoompan 采样），无运镜时直接 cover-crop 到目标。
 * focus 存在时以焦点（人脸）为中心取景，保证人脸在画面合适位置。
 */
function photoChain({ width, height, motion, fps, frames, focus }) {
  const w2 = width * 2;
  const h2 = height * 2;
  const fx = focus ? focus.fx : 0.5;
  const fy = focus ? focus.fy : 0.5;
  const crop = `scale=${w2}:${h2}:force_original_aspect_ratio=increase,crop=${w2}:${h2},setsar=1`;
  const zp = zoompan(motion, { width, height, fps, frames, fx, fy });
  if (!zp) {
    // 静态：以焦点为中心裁剪（人脸保持在画面内）
    const cx = clampExpr(fx * w2 - width / 2, 0, w2 - width);
    const cy = clampExpr(fy * h2 - height / 2, 0, h2 - height);
    return `scale=${w2}:${h2}:force_original_aspect_ratio=increase,crop=${width}:${height}:x='${cx}':y='${cy}',setsar=1,fps=${fps}`;
  }
  return `${crop},${zp}`;
}

/** 视频预处理链：cover-crop + 统一帧率；可选轻微运镜。 */
function videoChain({ width, height, fps, motion }) {
  const base = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=${fps}`;
  if (motion && motion !== 'none' && motion !== 'auto') {
    const frames = 300; // zoompan 需要 d；视频输入会逐帧处理，d 仅对单帧输入有意义
    // 视频走轻微运镜：先放大到 1.12 倍再缩放回来开销大，这里仅支持 subtle 之外由调用方决定
    if (motion === 'subtle') {
      const w2 = Math.round(width * 1.12);
      const h2 = Math.round(height * 1.12);
      return `scale=${w2}:${h2}:force_original_aspect_ratio=increase,crop=${w2}:${h2},setsar=1,scale=${width}:${height},fps=${fps}`;
    }
  }
  return base;
}

module.exports = { MOTIONS, MOTION_LABELS, pickMotion, zoompan, photoChain, videoChain, computeFocus };

'use strict';
/**
 * 媒体探测：用 ffprobe 读取视频/图片的时长、分辨率、帧率、音轨、旋转等。
 */
const { FFPROBE, run, parseDuration } = require('./utils');

async function ffprobeJson(file) {
  const { out } = await run(FFPROBE, [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    file,
  ]);
  return JSON.parse(out);
}

/** 视频信息。返回 null 表示无法解析为视频。 */
async function probeVideo(file) {
  let j;
  try {
    j = await ffprobeJson(file);
  } catch (e) {
    return null;
  }
  const vs = (j.streams || []).find((s) => s.codec_type === 'video');
  if (!vs) return null;
  const as = (j.streams || []).find((s) => s.codec_type === 'audio');
  const duration = parseDuration((j.format || {}).duration || vs.duration);
  let width = vs.width || 0;
  let height = vs.height || 0;
  // 处理旋转元数据
  const rot = parseFloat(vs.rotation || 0);
  if (Math.abs(rot) % 180 === 90) [width, height] = [height, width];
  const fps = evalFps(vs.r_frame_rate || vs.avg_frame_rate);
  return {
    kind: 'video',
    duration,
    width,
    height,
    rotation: rot,
    fps,
    hasAudio: !!as,
    audioCodec: as ? as.codec_name : null,
    fileSize: j.format ? parseInt(j.format.size || '0', 10) : 0,
  };
}

/** 图片信息。返回 null 表示无法解析为图片。 */
async function probeImage(file) {
  let j;
  try {
    j = await ffprobeJson(file);
  } catch (e) {
    return null;
  }
  const vs = (j.streams || []).find((s) => s.codec_type === 'video');
  if (!vs) return null;
  return {
    kind: 'image',
    width: vs.width || 0,
    height: vs.height || 0,
    codec: vs.codec_name || null,
    fileSize: j.format ? parseInt(j.format.size || '0', 10) : 0,
  };
}

/** "30000/1001" → 29.97 */
function evalFps(rate) {
  if (!rate) return 0;
  const [a, b] = String(rate).split('/').map(Number);
  if (!a) return 0;
  return b ? a / b : a;
}

module.exports = { ffprobeJson, probeVideo, probeImage, evalFps };

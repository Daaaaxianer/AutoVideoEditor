'use strict';
/**
 * 本地人脸识别（数据不出本机）：
 *  - 首选：Python + OpenCV FaceDetectorYN（加载本地 ONNX 模型，由 OpenCV 原生解码，最可靠）
 *  - 无 Python / 无 cv2 / 失败：返回空结果，主流程不受影响
 * 用于：① 素材人脸筛选（有脸照片优先）② 人脸保持画面位置（运镜/裁剪以人脸为中心）
 */
const { spawn } = require('child_process');
const path = require('path');
const { log } = require('./utils');

const MODEL = path.join(__dirname, '..', 'models', 'face_detection_yunet.onnx');
const TOOL = path.join(__dirname, '..', 'tools', 'face_detect.py');

let _avail = null;
/** 探测 Python+OpenCV 是否可用。 */
function pythonAvailable() {
  if (_avail !== null) return _avail;
  _avail = false;
  try {
    const { spawnSync } = require('child_process');
    const r = spawnSync('python', ['-c', 'import cv2,sys;print(cv2.__version__)'], {
      windowsHide: true, timeout: 15000, encoding: 'utf8',
    });
    _avail = r.status === 0 && r.stdout.trim().length > 0;
  } catch (_) {
    _avail = false;
  }
  if (!_avail) log('face', '未检测到 Python+OpenCV，人脸识别关闭（可选安装: pip install opencv-python）');
  return _avail;
}

/**
 * 批量检测人脸。
 * @param {string[]} files
 * @param {object} o { threshold=0.6, nms=0.3 }
 * @returns {Promise<Map<string, Array<{x,y,w,h}>>>}
 */
function detectFacesBatch(files, o = {}) {
  return new Promise((resolve) => {
    if (!files || !files.length || !pythonAvailable()) return resolve(new Map());
    const payload = JSON.stringify({
      model: MODEL,
      threshold: o.threshold || 0.6,
      nms: o.nms || 0.3,
      files,
    });
    const child = spawn('python', [TOOL], {
      windowsHide: true,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill(); resolve(new Map()); }, 120000);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', () => { clearTimeout(timer); resolve(new Map()); });
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        const j = JSON.parse(out);
        if (!j.ok) {
          if (err.trim()) log('face', `人脸识别子进程: ${err.trim().slice(0, 200)}`);
          return resolve(new Map());
        }
        const map = new Map();
        for (const [f, faces] of Object.entries(j.faces || {})) {
          map.set(f, (faces || []).map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })));
        }
        resolve(map);
      } catch (_) {
        resolve(new Map());
      }
    });
    child.stdin.write(payload);
    child.stdin.end();
  });
}

const _cache = new Map();
async function detectFaces(file, o = {}) {
  const m = await detectFacesBatch([file], o);
  return m.get(file) || [];
}

/** 缓存版单文件检测。 */
async function detectFacesCached(file, o = {}) {
  if (_cache.has(file)) return _cache.get(file);
  const faces = await detectFaces(file, o);
  if (_cache.size > 500) _cache.clear();
  _cache.set(file, faces);
  return faces;
}

/** 人脸中心（归一化 0-1）+ 数量。 */
function faceSummary(faces, width, height) {
  if (!faces || !faces.length || !width || !height) return null;
  let sx = 0;
  let sy = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const f of faces) {
    sx += f.x + f.w / 2;
    sy += f.y + f.h / 2;
    minX = Math.min(minX, f.x);
    maxX = Math.max(maxX, f.x + f.w);
    minY = Math.min(minY, f.y);
    maxY = Math.max(maxY, f.y + f.h);
  }
  const n = faces.length;
  return {
    count: n,
    // 人脸整体中心（归一化）
    cx: sx / n / width,
    cy: sy / n / height,
    // 人脸包围盒（归一化）
    x: minX / width,
    y: minY / height,
    w: (maxX - minX) / width,
    h: (maxY - minY) / height,
    // 最大人脸占比（用于判读人脸大小）
    maxArea: Math.max(...faces.map((f) => (f.w * f.h) / (width * height))),
  };
}

module.exports = { detectFaces, detectFacesBatch, detectFacesCached, faceSummary, pythonAvailable, MODEL };

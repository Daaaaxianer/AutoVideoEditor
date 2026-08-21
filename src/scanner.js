'use strict';
/**
 * 素材扫描：递归扫描输入目录，按扩展名分类为照片 / 视频。
 */
const fs = require('fs');
const path = require('path');
const { log } = require('./utils');

const IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.bmp', '.heic', '.heif', '.gif', '.avif', '.tif', '.tiff',
]);
const VIDEO_EXTS = new Set([
  '.mp4', '.mov', '.m4v', '.mkv', '.avi', '.3gp', '.webm', '.wmv', '.flv',
  '.ts', '.mts', '.m2ts', '.mpeg', '.mpg', '.rmvb',
]);

function classify(file) {
  const ext = path.extname(file).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  return null;
}

/** 递归扫描目录，返回 { images: [{file, mtime, size}], videos: [...] }。 */
function scanDir(dir, { recursive = true } = {}) {
  const images = [];
  const videos = [];
  if (!fs.existsSync(dir)) return { images, videos };

  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const ent of entries) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) {
        if (recursive) walk(full);
        continue;
      }
      if (!ent.isFile()) continue;
      const kind = classify(full);
      if (!kind) continue;
      let st;
      try {
        st = fs.statSync(full);
      } catch (e) {
        continue;
      }
      const item = { file: full, mtime: st.mtimeMs, size: st.size };
      if (kind === 'image') images.push(item);
      else videos.push(item);
    }
  };
  walk(dir);

  images.sort((a, b) => a.mtime - b.mtime);
  videos.sort((a, b) => a.mtime - b.mtime);
  log('scan', `扫描 ${dir}: 照片 ${images.length} 张, 视频 ${videos.length} 段`);
  return { images, videos };
}

/** 扫描输入目录与音乐目录。 */
function scanAll(inputDir, musicDir) {
  const media = scanDir(inputDir);
  const music = scanMusic(musicDir);
  return { ...media, music };
}

const MUSIC_EXTS = new Set(['.mp3', '.m4a', '.wav', '.flac', '.aac', '.ogg', '.opus', '.wma']);

/** 扫描音乐目录（非递归）。 */
function scanMusic(dir) {
  const list = [];
  if (!fs.existsSync(dir)) return list;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    let st;
    try {
      st = fs.statSync(full);
    } catch (e) {
      continue;
    }
    if (!st.isFile()) continue;
    if (!MUSIC_EXTS.has(path.extname(name).toLowerCase())) continue;
    list.push({ file: full, name, mtime: st.mtimeMs, size: st.size });
  }
  list.sort((a, b) => a.mtime - b.mtime);
  log('scan', `扫描音乐: ${dir} 共 ${list.length} 首`);
  return list;
}

module.exports = { scanDir, scanAll, scanMusic, classify, IMAGE_EXTS, VIDEO_EXTS, MUSIC_EXTS };

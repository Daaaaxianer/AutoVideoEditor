'use strict';
/**
 * 字体自动选择：扫描系统字体目录，按风格（现代/楷体/圆体/宋体/标题粗体）匹配。
 * 输出 drawtext 可直接使用的 fontfile 路径（斜杠形式）。
 */
const fs = require('fs');
const path = require('path');

const FONT_DIRS = [
  'C:\\Windows\\Fonts',
  '/System/Library/Fonts',
  '/Library/Fonts',
  '/usr/share/fonts/truetype',
  '/usr/share/fonts/opentype',
];

/** 风格 → 候选字体文件名（按优先级），Windows 字体名。 */
const STYLE_FONTS = {
  modern: ['msyh.ttc', 'msyhbd.ttc', 'Deng.ttf', 'Dengb.ttf', 'simhei.ttf', 'SourceHanSansSC-Regular.otf', 'NotoSansCJK-Regular.ttc'],
  title: ['msyhbd.ttc', 'simhei.ttf', 'Dengb.ttf', 'impact.ttf', 'arialbd.ttf', 'Bahnschrift.ttf'],
  kaiti: ['simkai.ttf', 'STKAITI.TTF', 'STXINGKA.TTF', 'simli.ttf', 'KaiTi.ttf', 'STCAIYUN.TTF'],
  round: ['youyuan.ttf', 'Yuanti.ttc', 'msyh.ttc'],
  serif: ['simsun.ttc', 'NSimSun.ttf', 'STSONG.TTF', 'STZHONGS.TTF'],
  mono: ['consola.ttf', 'cour.ttf', 'lucon.ttf'],
};

const STYLE_LABELS = {
  modern: '现代黑体（微软雅黑/思源黑体）',
  title: '标题粗体',
  kaiti: '书法手写（楷体/行楷/隶书）',
  round: '圆润可爱（幼圆）',
  serif: '宋体衬线',
  mono: '等宽',
};

/** 扫描所有存在的字体文件。 */
function listFonts() {
  const found = [];
  for (const dir of FONT_DIRS) {
    if (!fs.existsSync(dir)) continue;
    try {
      for (const name of fs.readdirSync(dir)) {
        const ext = path.extname(name).toLowerCase();
        if (ext === '.ttf' || ext === '.otf' || ext === '.ttc') {
          found.push({ name, file: path.join(dir, name) });
        }
      }
    } catch (_) {
      /* ignore */
    }
  }
  return found;
}

let _cache = null;
function fontCache() {
  if (!_cache) _cache = listFonts();
  return _cache;
}

/**
 * 按风格选字体。
 * @param {string} style modern | title | kaiti | round | serif | mono | auto
 * @returns {{file, name, style}}
 */
function pickFont(style = 'auto', mood = 'warm') {
  if (style && style !== 'auto' && fs.existsSync(style)) {
    return { file: style.replace(/\\/g, '/'), name: path.basename(style), style: 'custom' };
  }
  const buckets = STYLE_FONTS[style] ? [style] : defaultStyle(mood);
  for (const b of buckets) {
    for (const cand of STYLE_FONTS[b] || []) {
      const hit = fontCache().find((f) => f.name.toLowerCase() === cand.toLowerCase());
      if (hit) {
        return { file: hit.file.replace(/\\/g, '/'), name: hit.name, style: b };
      }
    }
  }
  // 兜底：任意第一个存在的字体
  const any = fontCache()[0];
  if (any) return { file: any.file.replace(/\\/g, '/'), name: any.name, style: 'fallback' };
  return { file: '', name: '', style: 'none' };
}

/** 根据 mood 推荐默认风格。 */
function defaultStyle(mood) {
  switch (mood) {
    case 'sweet':
    case 'happy':
      return ['round', 'modern'];
    case 'retro':
    case 'nostalgic':
      return ['kaiti', 'serif'];
    case 'epic':
      return ['title', 'modern'];
    case 'calm':
      return ['serif', 'modern'];
    default:
      return ['modern', 'title'];
  }
}

function fontLabel(style) {
  return STYLE_LABELS[style] || '自定义字体';
}

module.exports = { pickFont, listFonts, fontCache, STYLE_FONTS, STYLE_LABELS, fontLabel };

'use strict';
/**
 * 模板系统：加载 / 校验 / 默认值合并。
 * 模板 = 场景（家庭回忆、生日、旅行…）× 风格变体（色调/音乐/字体）。
 */
const fs = require('fs');
const path = require('path');

const XFADE_TRANSITIONS = [
  'fade', 'fadeblack', 'fadewhite', 'dissolve', 'wipeleft', 'wiperight', 'wipeup', 'wipedown',
  'slideleft', 'slideright', 'slideup', 'slidedown', 'circleopen', 'circleclose', 'hlslice',
  'hrslice', 'smoothleft', 'smoothright', 'zoomin', 'pixelize', 'radial', 'squeezeh',
  'squeezev', 'distance', 'diagtl', 'diagtr', 'diagbl', 'diagbr',
];

const ASPECTS = {
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
  '16:9': { width: 1920, height: 1080 },
  '4:3': { width: 1440, height: 1080 },
  '21:9': { width: 2560, height: 1080 },
};

const TEMPLATE_DEFAULTS = {
  platform: 'douyin',
  mood: 'warm',
  aspect: '9:16',
  fps: 30,
  transition: 'fade',
  transitionDuration: 0.6,
  filter: 'auto',
  motion: 'auto',
  selection: { photos: 10, videos: 3, minScore: 25 },
  photoDuration: 2.6,
  videoDuration: { min: 2, max: 4, target: 3 },
  minTotal: 18,
  maxTotal: 60,
  music: { mood: 'warm', volume: 0.32, duck: false },
  keepAudio: false,
  text: {
    title: '',
    subtitle: '',
    watermark: '',
    titleDuration: 3.5,
    endDuration: 3,
    showDateLabels: true,
    titleStyle: { fontStyle: 'title', color: '#FFF7E6', size: 0.11, y: 0.32 },
    subtitleStyle: { fontStyle: 'kaiti', color: '#FFD9A0', size: 0.05, y: 0.46 },
    captionStyle: { fontStyle: 'modern', color: '#FFFFFF', size: 0.038, y: 0.88 },
    endText: '愿时光温柔，家人常在',
  },
  endCard: { bg: '#2B1F3D', bg2: '#12101F' },
  variants: [
    { id: 'default', name: '默认', filter: 'auto', musicMood: '', fontStyle: 'auto' },
  ],
};

function hexToFf(c) {
  let s = String(c || '#FFFFFF').replace('#', '');
  if (s.length === 3) s = s.split('').map((x) => x + x).join('');
  return '0x' + s.toUpperCase();
}

/** 三大平台风格通用变体（自动附加到所有模板，实现"模板×风格"矩阵）。 */
const GLOBAL_STYLES = [
  { id: '__douyin', name: '🎵 抖音风·卡点', filter: 'vivid', musicMood: 'happy', fontStyle: 'title', transition: 'smoothleft' },
  { id: '__social', name: '🌿 社媒风·清新', filter: 'fresh', musicMood: 'fresh', fontStyle: 'modern', transition: 'fade' },
  { id: '__media', name: '📰 正式媒体·沉稳', filter: 'formal', musicMood: 'calm', fontStyle: 'serif', transition: 'fadeblack' },
];

/** 读取并规范化一个模板。 */
function loadTemplate(id, templateDir) {
  const file = path.join(templateDir, id + '.json');
  if (!fs.existsSync(file)) throw new Error(`模板不存在: ${id} (${file})`);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const t = deepMerge(TEMPLATE_DEFAULTS, raw);
  t.id = String(raw.id || id);
  // 画幅解析
  const asp = ASPECTS[t.aspect] || ASPECTS['9:16'];
  t.width = asp.width;
  t.height = asp.height;
  if (t.aspect === '9:16') t.platform = t.platform || 'douyin';
  // 转场校验
  if (!XFADE_TRANSITIONS.includes(t.transition)) t.transition = 'fade';
  if (!t.variants || !t.variants.length) t.variants = TEMPLATE_DEFAULTS.variants;
  // 附加三大平台风格变体（不重复）
  const have = new Set(t.variants.map((v) => v.id));
  for (const g of GLOBAL_STYLES) {
    if (!have.has(g.id)) t.variants.push({ ...g });
  }
  return t;
}

/** 列出模板目录中所有模板的元信息（Web UI 用）。 */
function listTemplates(templateDir) {
  if (!fs.existsSync(templateDir)) return [];
  const out = [];
  for (const name of fs.readdirSync(templateDir)) {
    if (!name.endsWith('.json')) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(templateDir, name), 'utf8'));
      const baseVariants = (raw.variants || TEMPLATE_DEFAULTS.variants).map((v) => ({
        id: v.id, name: v.name, filter: v.filter || 'auto',
        musicMood: v.musicMood || '', fontStyle: v.fontStyle || 'auto', transition: v.transition || '',
      }));
      const have = new Set(baseVariants.map((v) => v.id));
      for (const g of GLOBAL_STYLES) if (!have.has(g.id)) baseVariants.push({ ...g });
      out.push({
        id: raw.id || name.replace('.json', ''),
        name: raw.name || raw.id,
        desc: raw.desc || '',
        platform: raw.platform || 'douyin',
        aspect: raw.aspect || '9:16',
        mood: raw.mood || 'warm',
        filter: raw.filter || 'auto',
        motion: raw.motion || 'auto',
        transition: raw.transition || 'fade',
        musicMood: (raw.music && raw.music.mood) || raw.mood || 'warm',
        musicVolume: (raw.music && raw.music.volume) || 0.32,
        keepAudio: !!raw.keepAudio,
        selection: raw.selection || {},
        photoDuration: raw.photoDuration || 2.6,
        videoDuration: raw.videoDuration || { target: 3 },
        text: raw.text || {},
        thumb: raw.thumb || null,
        variants: baseVariants,
      });
    } catch (_) {
      /* skip broken */
    }
  }
  return out;
}

/** 应用风格变体到模板（变体覆盖 filter / musicMood / fontStyle / transition）。 */
function applyVariant(template, variantId) {
  const v = (template.variants || []).find((x) => x.id === variantId) || template.variants[0];
  if (!v) return template;
  const t = JSON.parse(JSON.stringify(template));
  if (v.filter) t.filter = v.filter;
  if (v.transition) t.transition = v.transition;
  if (v.musicMood) t.music = { ...t.music, mood: v.musicMood };
  if (v.fontStyle) t.text.titleStyle = { ...t.text.titleStyle, fontStyle: v.fontStyle };
  t._variant = v;
  return t;
}

function deepMerge(base, over) {
  if (Array.isArray(base) || Array.isArray(over)) return over !== undefined ? over : base;
  if (typeof base === 'object' && base && typeof over === 'object' && over) {
    const out = { ...base };
    for (const k of Object.keys(over)) out[k] = deepMerge(base[k], over[k]);
    return out;
  }
  return over !== undefined ? over : base;
}

module.exports = { loadTemplate, listTemplates, applyVariant, XFADE_TRANSITIONS, ASPECTS, TEMPLATE_DEFAULTS, hexToFf };

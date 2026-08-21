'use strict';
/**
 * 滤镜预设库：每种风格是一组 ffmpeg 滤镜串（作用于 1080p 级别片段）。
 * 所有预设尽量温和，避免过度处理。
 */
const PRESETS = {
  none: '',
  /** 电影青橙 / 强对比 */
  cinema:
    'curves=preset=strong_contrast,' +
    'colorbalance=bs=.08:bm=.05:bh=-.03,' +
    'eq=contrast=1.06:saturation=1.04,' +
    'vignette=PI/5',
  /** 日系清新 */
  fresh:
    'eq=saturation=1.16:brightness=0.03:contrast=0.97,' +
    'colorbalance=bs=.06:bm=.04:bh=.03,' +
    'unsharp=5:5:0.5:5:5:0.0',
  /** 复古胶片 */
  retro:
    "curves=r='0/0.08 0.5/0.5 1/0.92':g='0/0.06 0.5/0.5 1/0.94':b='0/0.05 0.5/0.52 1/0.95'," +
    'colorbalance=rs=.07:gs=.02:bs=-.06,' +
    'vignette=PI/4,' +
    'noise=alls=6:allf=t',
  /** 黑白 */
  bw: 'hue=s=0,eq=contrast=1.18:brightness=0.01,curves=preset=lighter',
  /** 暖阳 */
  warm:
    'colorbalance=rs=.09:gs=.04:bs=-.07,' +
    'eq=saturation=1.12:brightness=0.02:contrast=1.01',
  /** 冷调 */
  cool:
    'colorbalance=rs=-.05:gs=.02:bs=.09,' +
    'eq=saturation=1.05:brightness=0.01',
  /** 活力高饱和 */
  vivid: 'eq=saturation=1.38:contrast=1.09:brightness=0.01',
  /** 梦幻柔光 */
  soft: 'gblur=sigma=1.4,eq=contrast=0.92:brightness=0.05:saturation=1.06',
  /** 金色黄昏 */
  golden:
    'colorbalance=rs=.07:gs=.05:bs=-.11,' +
    'eq=saturation=1.18:contrast=1.05,' +
    'vignette=PI/5',
  /** 情绪暗调 */
  moody:
    'eq=contrast=1.13:brightness=-0.03:saturation=0.84,' +
    'colorbalance=bs=.05:bm=.03:bh=-.02,' +
    'vignette=PI/4',
  /** 旧照片怀旧 */
  nostalgia:
    'colorchannelmixer=rr=.86:gg=.9:bb=.82,' +
    'eq=saturation=.78:contrast=1.04,' +
    'noise=alls=5:allf=t,' +
    'vignette=PI/4',
  /** 拍立得 */
  polaroid:
    'eq=saturation=.76:brightness=.06:contrast=.9,' +
    'colorbalance=rs=.04:gs=.03:bs=.02,' +
    'vignette=PI/3.4,' +
    'noise=alls=4:allf=t',
  /** 森系淡雅 */
  forest:
    'eq=saturation=1.02:brightness=0.02:contrast=0.95,' +
    'colorbalance=gs=.05:bs=.04:bm=.02,' +
    'gblur=sigma=0.6',
  /** 奶油甜暖（适合宝宝/生日） */
  cream:
    'eq=saturation=1.08:brightness=0.05:contrast=0.9,' +
    'colorbalance=rs=.05:gs=.03:bs=.01,' +
    'vignette=PI/6',
  /** 正式媒体·沉稳（低饱和、干净、微对比） */
  formal:
    'eq=saturation=0.82:contrast=1.08:brightness=0.01,' +
    'colorbalance=bs=.02:gs=.01:hs=.01,' +
    'unsharp=5:5:0.4:5:5:0.0',
  /** 赛博霓虹 */
  cyber:
    'eq=saturation=1.3:contrast=1.1,' +
    'colorbalance=bs=.12:ms=.06:hs=-.05,rs=-.02:gs=.02:bm=.04,' +
    'vignette=PI/4',
  /** 粉彩甜酷 */
  pastel:
    'eq=saturation=0.95:brightness=0.06:contrast=0.88,' +
    'colorbalance=rs=.05:gs=.04:bs=.05,' +
    'gblur=sigma=0.8',
  /** 老电影 */
  oldfilm:
    "curves=r='0/0.1 0.5/0.5 1/0.9':g='0/0.08 0.5/0.5 1/0.92':b='0/0.06 0.5/0.5 1/0.94'," +
    'hue=h=8,' +
    'noise=alls=9:allf=t,' +
    'vignette=PI/3.2',
  /** 黑白高对比（正式/大片） */
  bwhard: 'hue=s=0,eq=contrast=1.3:brightness=-0.01,unsharp=5:5:1',
};

const PRESET_IDS = Object.keys(PRESETS).filter((k) => k !== 'none');

const PRESET_LABELS = {
  none: '原片（不过滤镜）',
  cinema: '电影感（青橙·强对比）',
  fresh: '日系清新',
  retro: '复古胶片',
  bw: '黑白',
  warm: '暖阳',
  cool: '冷调',
  vivid: '活力高饱和',
  soft: '梦幻柔光',
  golden: '金色黄昏',
  moody: '情绪暗调',
  nostalgia: '旧照片怀旧',
  polaroid: '拍立得',
  forest: '森系淡雅',
  cream: '奶油甜暖',
  formal: '正式媒体·沉稳',
  cyber: '赛博霓虹',
  pastel: '粉彩甜酷',
  oldfilm: '老电影',
  bwhard: '黑白高对比',
};

/** 根据 mood 推荐滤镜。 */
const MOOD_FILTER = {
  warm: 'warm',
  happy: 'vivid',
  calm: 'fresh',
  epic: 'cinema',
  retro: 'retro',
  sweet: 'cream',
  cool: 'cool',
  fresh: 'fresh',
  nostalgic: 'nostalgia',
  golden: 'golden',
};

/**
 * 解析滤镜配置：'auto' 根据模板 mood；'none' 返回空；其它按 id。
 * @param {string} filter 用户/模板指定的滤镜（'auto' | 'none' | id）
 * @param {string} mood 模板 mood（auto 时使用）
 */
function resolveFilter(filter, mood = 'warm') {
  if (!filter || filter === 'none') return { id: 'none', graph: '' };
  if (filter === 'auto') {
    const id = MOOD_FILTER[mood] || 'fresh';
    return { id, graph: PRESETS[id] };
  }
  if (PRESETS[filter] !== undefined) return { id: filter, graph: PRESETS[filter] };
  // 未知滤镜名回退到模板 mood
  const id = MOOD_FILTER[mood] || 'fresh';
  return { id, graph: PRESETS[id] };
}

module.exports = { PRESETS, PRESET_IDS, PRESET_LABELS, MOOD_FILTER, resolveFilter };

'use strict';
/**
 * 配置加载与合并：默认值 < 项目根 config.json < 模板 < 用户参数（CLI / Web）。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const DEFAULTS = {
  inputDir: path.join(ROOT, 'input'),
  musicDir: path.join(ROOT, 'music'),
  outputDir: path.join(ROOT, 'output'),
  templateDir: path.join(ROOT, 'templates'),
  templates: [], // 模板 id 列表，空 = 全部
  // 渲染选项
  template: 'family-moments',
  title: '',
  subtitle: '',
  endText: '', // 结尾文字覆盖（空=模板默认）
  coverMode: 'random', // 'random' | 'time'
  coverTime: 5, // coverMode=time 时的封面时间（秒）
  photos: 0, // 0 = 模板默认
  videos: 0,
  duration: 0, // 目标成片时长（秒），0 = 模板自动
  aspect: '', // 空 = 模板默认；可覆盖如 '9:16' | '1:1' | '16:9'
  width: 0,
  height: 0,
  fps: 0,
  filter: '', // '' | 'auto' | 预设名（空 = 用模板/变体滤镜，auto = 按模板 mood 自动推荐）
  motion: 'auto', // 'auto' | 'zoom-in' | 'zoom-out' | 'pan-left' | ...
  transition: '', // 空 = 模板默认
  music: '', // 指定音乐文件；空 = 自动选择
  musicMood: '', // 覆盖模板音乐 mood
  musicVolume: 0, // 0 = 模板默认
  keepAudio: null, // null = 模板默认；true/false 覆盖
  watermark: null, // null = 模板默认
  captions: null, // null = 模板默认（分段标题）
  font: 'auto', // 'auto' | 字体文件路径
  fontFamily: '', // 字体风格：modern | kaiti | hei | round | ...
  seed: 0, // 随机种子，便于复现
  hwEnc: 'auto', // 'auto' 自动探测 GPU 硬件编码 | 'qsv' | 'nvenc' | 'amf' | 'mf' | 'off'(纯CPU)
  quality: '', // ''=1080P | '720p'
  faceWeight: 0.6, // 人脸优先权重 0-1（0=不偏好人脸）
  faceSafe: true, // 人脸保持画面位置（裁剪/运镜以人脸为中心）
  transitionZoom: false, // 转场缩放：视频片段在转场时轻微推近
  useFiles: [], // 手动精选：只使用指定素材（按顺序），空=自动选片
  asr: { mode: 'off', baseUrl: '', apiKey: '', model: 'whisper-1' }, // 语音识别字幕（默认关闭）
  ai: { mode: 'off', baseUrl: '', apiKey: '', model: '' }, // 可选 AI 增强，默认关闭
  webPort: 8088, // Web 界面端口
  ffmpegArgs: [], // 额外 ffmpeg 参数
  quiet: false,
};

/** 读取项目根 config.json（存在则合并）。 */
function loadFileConfig() {
  const p = path.join(ROOT, 'config.json');
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return {};
  }
}

/**
 * 合并：defaults < fileConfig < overrides
 * 返回 { cfg, fileConfig }，cfg 中保留未覆盖项。
 */
function resolveConfig(overrides = {}) {
  const fileConfig = loadFileConfig();
  const cfg = {
    ...DEFAULTS,
    ...fileConfig,
    ...overrides,
  };
  // 路径解析：相对路径基于项目根
  for (const k of ['inputDir', 'musicDir', 'outputDir', 'templateDir']) {
    if (typeof cfg[k] === 'string' && !path.isAbsolute(cfg[k])) {
      cfg[k] = path.resolve(ROOT, cfg[k]);
    }
  }
  return { cfg, fileConfig };
}

module.exports = { DEFAULTS, resolveConfig, ROOT };

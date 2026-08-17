'use strict';
/* AutoVideoEditor · 前端（简洁现代版，零依赖） */

const state = {
  templates: [],
  meta: { filters: {}, motions: {}, transitions: [], fontStyles: {} },
  media: { images: [], videos: [], music: [] },
  config: {},
  ai: { ollama: false },
  selTemplate: null,
  selVariant: 'default',
  excluded: new Set(), // 未勾选（不使用）的素材
  gSelected: new Set(), // 最近成片批量勾选
  currentOutput: null,
  tab: 'images',
  engine: 'auto',
  jobs: [],
  polling: null,
  durationManual: false,
};

const $ = (id) => document.getElementById(id);

const MOOD = {
  warm: ['#f5a25d', '#ffd9a0'], happy: ['#ff7ab8', '#ffd36b'], sweet: ['#ffb3c8', '#fff0d6'],
  epic: ['#2c3e6b', '#8ea8d8'], fresh: ['#3ecf8e', '#c9f2e0'], golden: ['#d99a3b', '#ffd98e'],
  nostalgic: ['#a58a5f', '#e0cba0'],
};
const MOOD_EMOJI = { warm: '🏠', happy: '🎉', sweet: '👶', epic: '🎬', fresh: '🌿', golden: '🍂', nostalgic: '📻' };
const PLATFORM_LABEL = { douyin: '抖音', moments: '朋友圈', bilibili: 'B站', youtube: 'YouTube', xiaohongshu: '小红书' };
const ASPECT_LABEL = { '9:16': '竖屏', '1:1': '方屏', '16:9': '横屏' };

const STEPS = [
  { key: 'scan', label: '扫描分析' },
  { key: 'select', label: '智能选片' },
  { key: 'build', label: '生成片段' },
  { key: 'mix', label: '转场合成' },
  { key: 'cover', label: '导出封面' },
];

async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error(path + ' -> ' + r.status);
  return r.json();
}

async function loadState() {
  const [s, m] = await Promise.all([api('/api/state'), api('/api/meta')]);
  state.templates = s.templates;
  state.meta = m;
  state.media = s.media;
  state.config = s.config;
  state.ai = s.ai || { ollama: false };
  state.jobs = s.jobs || [];
  const nImg = state.media.images.length + state.media.videos.length;
  $('chipMedia').textContent = `素材 ${nImg}`;
  $('chipTpl').textContent = `模板 ${state.templates.length}`;
  $('imgCount').textContent = state.media.images.length;
  $('vidCount').textContent = state.media.videos.length;
  updateAiStatus();
  renderBannerStats();
  renderTemplateGrid();
  renderThumbs();
  renderGallery();
  fillSelects();
  fillMusicSelect();
  if (!state.selTemplate && state.templates.length) selectTemplate(state.templates[0].id, 'default');
  syncPanelHeights();
  syncPlayerHeight();
}

/** 三栏等高：以「自定义 & 生成」实际内容高度为基准（含 AI 增强/渲染引擎/开始生成等全部内容）。
 *  自定义面板 align-self:start 永不被裁剪；其余两栏以 --panel-h 对齐等高。 */
function syncPanelHeights() {
  const custom = document.querySelector('.custom-panel');
  if (!custom) return;
  document.documentElement.style.setProperty('--panel-h', Math.max(340, custom.scrollHeight) + 'px');
}

/** 底部2栏：以「成片播放」栏高度为固定等高，「最近成片」高度跟随且内部滚动。 */
function syncPlayerHeight() {
  const player = document.querySelector('.player-panel');
  const galleryPanel = document.querySelector('.gallery-panel');
  if (!player || !galleryPanel) return;
  const h = player.offsetHeight;
  if (h > 0) galleryPanel.style.height = h + 'px';
}

/** 自动监听内容高度变化，保证永不遮挡（AI 展开/进度出现/字体加载等）。 */
function initObservers() {
  const custom = document.querySelector('.custom-panel');
  const player = document.querySelector('.player-panel');
  if (typeof ResizeObserver === 'undefined') return;
  if (custom) new ResizeObserver(() => syncPanelHeights()).observe(custom);
  if (player) new ResizeObserver(() => syncPlayerHeight()).observe(player);
}

/** 重置播放区为占位状态。 */
function resetPlayer() {
  const v = $('resultVideo');
  v.removeAttribute('src');
  v.hidden = true;
  $('playerPlaceholder').hidden = false;
  $('playerActions').hidden = true;
  $('downloadCover').hidden = true;
  $('playerMeta').textContent = '暂无播放内容';
  state.currentOutput = null;
  setTimeout(syncPlayerHeight, 120);
}

/** 顶部横幅数据条：整体基本情况（与品牌/特点色块合并为单一横幅栏）。 */
function renderBannerStats() {
  const bs = $('bannerStats');
  if (!bs) return;
  const sys = state.system || {};
  const doneJobs = (state.jobs || []).filter((j) => j.status === 'done' && j.output).length;
  const engine = sys.gpu && sys.gpu.length ? `GPU(${sys.gpu.join('/')})` : 'CPU';
  const face = sys.face ? '开' : '关';
  bs.innerHTML = `
    <span class="bstat">📷 照片 <b>${state.media.images.length}</b></span>
    <span class="bstat">🎥 视频 <b>${state.media.videos.length}</b></span>
    <span class="bstat">🎵 音乐 <b>${state.media.music.length}</b></span>
    <span class="bstat">🧩 模板 <b>${state.templates.length}</b></span>
    <span class="bstat ok">🎬 已生成 <b>${doneJobs}</b></span>
    <span class="bstat acc">⚙️ ${engine}</span>
    <span class="bstat ${sys.face ? 'ok' : 'warn'}">🧠 人脸 ${face}</span>`;
}

function fillMusicSelect() {
  const sel = $('inMusic');
  const cur = sel.value;
  sel.innerHTML = '<option value="">🎵 自动匹配</option>';
  for (const m of state.media.music || []) {
    const o = document.createElement('option');
    o.value = m.file;
    o.dataset.rel = m.rel || '';
    o.textContent = '🎶 ' + m.name;
    sel.appendChild(o);
  }
  if (cur) sel.value = cur;
}

/** 音乐试听。 */
function initMusicPreview() {
  const btn = $('btnMusicPreview');
  const audio = $('musicPreview');
  const sel = $('inMusic');
  if (!btn || !audio || !sel) return;
  btn.addEventListener('click', () => {
    if (!audio.paused) {
      audio.pause();
      btn.textContent = '▶ 试听';
      return;
    }
    const opt = sel.options[sel.selectedIndex];
    const rel = opt && opt.dataset.rel;
    if (!rel) {
      alert('请先在上方选择一首具体音乐（“自动匹配”无法试听）');
      return;
    }
    audio.src = '/' + rel.replace(/^\/+/, '') + '?t=' + Date.now();
    audio.play().catch(() => { btn.textContent = '▶ 试听'; });
    btn.textContent = '⏸ 停止';
  });
  audio.addEventListener('ended', () => { btn.textContent = '▶ 试听'; });
  audio.addEventListener('error', () => { btn.textContent = '▶ 试听'; });
  sel.addEventListener('change', () => { audio.pause(); btn.textContent = '▶ 试听'; });
}

/* ---------- 模板 ---------- */
function renderTemplateGrid() {
  const g = $('templateGrid');
  g.innerHTML = '';
  for (const t of state.templates) {
    const emoji = MOOD_EMOJI[t.mood] || '📷';
    const cols = MOOD[t.mood] || ['#7a8cff', '#a8c0ff'];
    const card = document.createElement('div');
    card.className = 'tcard' + (state.selTemplate === t.id ? ' sel' : '');
    card.innerHTML = `
      <div class="preview" style="background:linear-gradient(135deg,${cols[0]},${cols[1]})">${emoji}</div>
      <div class="tname">${t.name}</div>
      <div class="tdesc">${t.desc || ''}</div>
      <div class="variants" data-tid="${t.id}"></div>`;
    card.addEventListener('click', () => selectTemplate(t.id, state.selVariant));
    const vbox = card.querySelector('.variants');
    const icons = { __douyin: '🎵', __social: '🌿', __media: '📰' };
    for (const v of t.variants || []) {
      const chip = document.createElement('span');
      chip.className = 'vchip' + (state.selTemplate === t.id && state.selVariant === v.id ? ' sel' : '');
      const ico = icons[v.id] || '·';
      chip.innerHTML = `<span class="vi">${ico}</span>${v.name}`;
      chip.addEventListener('click', (e) => { e.stopPropagation(); selectTemplate(t.id, v.id); });
      vbox.appendChild(chip);
    }
    g.appendChild(card);
  }
}

function selectTemplate(id, variantId) {
  state.selTemplate = id;
  state.selVariant = variantId || 'default';
  renderTemplateGrid();
  const t = state.templates.find((x) => x.id === id);
  if (!t) return;
  const v = (t.variants || []).find((x) => x.id === state.selVariant) || t.variants[0] || {};
  const text = t.text || {};
  $('inTitle').value = text.title || '';
  $('inSubtitle').value = text.subtitle || '';
  $('inFilter').value = v.filter || t.filter || 'auto';
  $('inMotion').value = t.motion || 'auto';
  $('inTransition').value = v.transition || t.transition || 'fade';
  $('inFontStyle').value = v.fontStyle || 'auto';
  $('inDuration').value = 0;
  $('inEndText').value = text.endText || '';
  $('inMood').value = v.musicMood || t.musicMood || '';
  const vol = t.musicVolume || 0;
  $('inMusicVolume').value = vol;
  $('musicVolLabel').textContent = vol > 0 ? vol.toFixed(2) : '模板默认';
  $('inAspect').value = '';
  $('inWatermark').value = '';
  $('inKeepAudio').checked = !!t.keepAudio;
  $('inCaptions').checked = text.showDateLabels !== false;
  updateCounts();
}

/* ---------- 素材 ---------- */
function renderThumbs() {
  const grid = $('thumbGrid');
  grid.innerHTML = '';
  const items = state.tab === 'images' ? state.media.images : state.media.videos;
  if (!items.length) {
    grid.innerHTML = '<p style="grid-column:1/-1;color:var(--muted);font-size:13px;padding:12px 0;">暂无素材，请上传或把文件放入 input 目录</p>';
    return;
  }
  for (const it of items) {
    const d = document.createElement('div');
    const excluded = state.excluded.has(it.file);
    d.className = 'thumb' + (excluded ? ' excluded' : '');
    const rel = it.rel || it.file.replace(/\\/g, '/').split('/').slice(-3).join('/');
    d.innerHTML = `
      <img loading="lazy" src="/api/thumb?p=${encodeURIComponent(rel)}&w=200" alt="">
      <input type="checkbox" class="ex" ${excluded ? '' : 'checked'}>
      <div class="name">${it.name}</div>`;
    d.querySelector('.ex').addEventListener('change', (e) => {
      if (e.target.checked) state.excluded.delete(it.file);
      else state.excluded.add(it.file);
      d.classList.toggle('excluded', !e.target.checked);
      updateCounts();
    });
    grid.appendChild(d);
  }
  // 全选复选框状态：当前页签是否全部勾选
  const selAll = $('btnSelectAll');
  if (selAll) selAll.checked = items.length > 0 && items.every((x) => !state.excluded.has(x.file));
  updateCounts();
}

/** 勾选统计联动：照片/视频数量 = 勾选（使用）数量；并给出成片时长默认值。 */
function updateCounts() {
  const images = state.media.images.filter((x) => !state.excluded.has(x.file)).length;
  const videos = state.media.videos.filter((x) => !state.excluded.has(x.file)).length;
  $('imgCount').textContent = images;
  $('vidCount').textContent = videos;
  $('inPhotos').value = images;
  $('inVideos').value = videos;
  const used = images + videos;
  const hint = $('pickHint');
  if (hint) hint.textContent = `已勾选 ${used} 个素材（照片 ${images} · 视频 ${videos}）`;
  // 成片时长默认值：仅当用户未手动修改时自动估算
  if (!state.durationManual) {
    const sug = Math.min(120, Math.max(8, Math.round(3.2 + images * 2.6 + videos * 3.2 + 2.8)));
    $('inDuration').value = sug;
    const dh = $('durationHint');
    if (dh) dh.textContent = `自动估算 ${sug}s（可修改）`;
  }
}

function currentTabItems() {
  return state.tab === 'images' ? state.media.images : state.media.videos;
}

/** 全选切换：全部勾选 / 再次点击全部取消（与最近成片一致，无动效）。 */
function toggleSelectAll(force) {
  const items = currentTabItems();
  const allChecked = items.length > 0 && items.every((x) => !state.excluded.has(x.file));
  const want = force !== undefined ? force : !allChecked;
  for (const x of items) {
    if (want) state.excluded.delete(x.file);
    else state.excluded.add(x.file);
  }
  renderThumbs();
}
function pulseThumbs() {
  const thumbs = document.querySelectorAll('#thumbGrid .thumb');
  thumbs.forEach((t, i) => {
    t.style.animationDelay = (i * 22) + 'ms';
    t.classList.add('pulse');
    setTimeout(() => {
      t.classList.remove('pulse');
      t.style.animationDelay = '';
    }, 700 + i * 22);
  });
}

/* ---------- 表单 ---------- */
function fillSelects() {
  const fill = (id, map) => {
    const sel = $(id);
    sel.innerHTML = '';
    for (const [k, v] of Object.entries(map)) {
      const o = document.createElement('option');
      o.value = k; o.textContent = v;
      sel.appendChild(o);
    }
  };
  fill('inFilter', state.meta.filters || {});
  fill('inMotion', state.meta.motions || {});
  const trans = $('inTransition');
  trans.innerHTML = '';
  for (const t of state.meta.transitions || []) {
    const o = document.createElement('option');
    o.value = t; o.textContent = t;
    trans.appendChild(o);
  }
  fill('inFontStyle', state.meta.fontStyles || {});
  $('inMusicVolume').addEventListener('input', () => {
    const v = parseFloat($('inMusicVolume').value);
    $('musicVolLabel').textContent = v > 0 ? v.toFixed(2) : '模板默认';
  });
}

/* ---------- 引擎 / AI ---------- */
function initEngine() {
  const seg = $('engineSeg');
  const HINTS = {
    auto: '自动探测并使用 <b>GPU 硬件编码</b>（按 NVIDIA NVENC → Intel QSV → AMD AMF → Windows MF 优先级），任一步骤失败自动回退 CPU 软件编码。本机若检测到 GPU 即默认走 GPU 渲染。',
    qsv: '<b>Intel QSV（GPU）</b>：Intel 核显/Arc 独显的硬件编码器，速度快、占用低。',
    nvenc: '<b>NVIDIA NVENC（GPU）</b>：NVIDIA 显卡专用硬件编码器，需 N 卡驱动支持。',
    amf: '<b>AMD AMF（GPU）</b>：AMD 显卡硬件编码器，需 A 卡驱动支持。',
    mf: '<b>Windows MF（GPU）</b>：系统 Media Foundation 硬件编码（通常走显卡）。',
    off: '<b>纯 CPU 软件编码</b>（libx264）：兼容性最好，速度较慢。',
  };
  const hintEl = $('engineHint');
  const show = (key) => {
    state.engine = key;
    seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.v === key));
    const label = { auto: '自动', qsv: 'QSV', nvenc: 'NVENC', amf: 'AMF', mf: 'MF', off: '纯CPU' }[key] || key;
    $('chipEngine').textContent = '引擎 ' + label;
    if (hintEl) hintEl.innerHTML = HINTS[key] || '';
  };
  for (const b of seg.querySelectorAll('button')) {
    b.addEventListener('click', () => show(b.dataset.v));
  }
  show('auto');
}

function updateAiStatus() {
  const mode = $('inAiMode').value;
  const el = $('aiStatus');
  if (mode === 'off') { el.className = 'ai-status'; el.textContent = 'AI 增强关闭，使用本地启发式选片。'; }
  else if (mode === 'auto' || mode === 'ollama') {
    if (state.ai.ollama) { el.className = 'ai-status ok'; el.textContent = '✅ 已检测到本地 Ollama，数据不出本机。'; }
    else { el.className = 'ai-status warn'; el.textContent = '⚠ 未检测到本地 Ollama（127.0.0.1:11434）。' + (mode === 'ollama' ? ' 请先启动 Ollama。' : ' 将自动退回启发式。'); }
  } else {
    el.className = 'ai-status'; el.textContent = '在线模式：数据将发送到你配置的 API 地址，请确认隐私与版权。';
  }
  const on = mode !== 'off';
  $('chipAi').textContent = on ? 'AI ' + mode : 'AI 关闭';
}

function initAi() {
  const box = $('aiBox');
  const modeSel = $('inAiMode');
  const sync = () => {
    const m = modeSel.value;
    $('inAiModel').disabled = m === 'off';
    $('inAiBaseUrl').disabled = m === 'off';
    $('inAiKey').disabled = m !== 'api';
    updateAiStatus();
  };
  modeSel.addEventListener('change', sync);
  sync();
}

/* ---------- 生成 ---------- */
function collectBody() {
  const num = (id) => { const v = parseInt($(id).value, 10); return Number.isFinite(v) && v > 0 ? v : 0; };
  const str = (id) => $(id).value.trim();
  const wm = str('inWatermark');
  const body = {
    template: state.selTemplate,
    variant: state.selVariant,
    title: str('inTitle') || undefined,
    subtitle: str('inSubtitle') || undefined,
    endText: str('inEndText') || undefined,
    filter: str('inFilter') || 'auto',
    motion: str('inMotion') || 'auto',
    transition: str('inTransition') || undefined,
    fontStyle: str('inFontStyle') || undefined,
    photos: num('inPhotos'),
    videos: num('inVideos'),
    duration: num('inDuration'),
    musicMood: str('inMood') || undefined,
    musicFile: str('inMusic') || undefined,
    musicVolume: parseFloat($('inMusicVolume').value) || undefined,
    aspect: str('inAspect') || undefined,
    coverMode: $('inCoverMode').value || 'random',
    coverTime: $('inCoverMode').value === 'time' ? (parseInt($('inCoverTime').value, 10) || 5) : undefined,
    coverFile: $('inCoverMode').value === 'file' ? ($('inCoverFile').value || undefined) : undefined,
    watermark: wm ? (wm === 'off' ? 'off' : wm) : undefined,
    keepAudio: $('inKeepAudio').checked,
    captions: $('inCaptions').checked,
    seed: num('inSeed'),
    hwEnc: state.engine,
    quality: $('inQuality').value || undefined,
    faceWeight: parseFloat($('inFaceWeight').value) || 0,
    faceSafe: $('inFaceSafe').checked,
    transitionZoom: $('inTransitionZoom').checked,
    ai: {
      mode: $('inAiMode').value,
      model: $('inAiModel').value.trim() || undefined,
      baseUrl: $('inAiBaseUrl').value.trim() || undefined,
      apiKey: $('inAiKey').value.trim() || undefined,
    },
    asr: {
      mode: $('inAsrMode').value,
      model: $('inAsrModel').value.trim() || undefined,
      apiKey: $('inAsrKey').value.trim() || undefined,
    },
  };
  if (state.excluded.size) body.exclude = [...state.excluded];
  return body;
}

function stageIndex(stage) {
  if (stage === 'scan' || stage === 'analyze' || stage === 'probe') return 0;
  if (stage === 'select' || stage === 'ai' || stage === 'music') return 1;
  if (stage === 'plan' || stage === 'build' || stage === 'hwenc') return 2;
  if (stage === 'mix' || stage === 'render') return 3;
  if (stage === 'cover') return 4;
  return 0;
}

function renderSteps(idx, done) {
  const box = $('steps');
  box.innerHTML = '';
  STEPS.forEach((s, i) => {
    const d = document.createElement('div');
    d.className = 'step' + (i < done || (done && idx === i) ? ' done' : i === idx ? ' on' : '');
    d.innerHTML = `<span class="step-ico">${i < done || (done && idx === i) ? '✓' : '○'}</span>${s.label}`;
    box.appendChild(d);
  });
}

async function generate() {
  const nPhotos = parseInt($('inPhotos').value, 10) || 0;
  const nVideos = parseInt($('inVideos').value, 10) || 0;
  if (!nPhotos && !nVideos) {
    alert('请先在素材库勾选至少一个素材（照片或视频）');
    return;
  }
  const btn = $('btnGenerate');
  btn.disabled = true;
  btn.textContent = '⏳ 生成中…';
  $('progress').hidden = false;
  resetPlayer();
  setTimeout(syncPanelHeights, 80);
  $('progressText').textContent = '提交任务…';
  $('progressLog').textContent = '';
  renderSteps(0, false);
  let job;
  try {
    job = await api('/api/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(collectBody()),
    });
  } catch (e) {
    $('progressText').textContent = '提交失败: ' + e.message;
    $('progressStatus').textContent = '❌';
    btn.disabled = false;
    btn.textContent = '✨ 开始自动生成';
    return;
  }
  startPolling(job.id);
}

function startPolling(id) {
  if (state.polling) clearInterval(state.polling);
  state.polling = setInterval(async () => {
    let j;
    try { j = await api('/api/jobs/' + id); } catch (_) { return; }
    const stage = detectStage(j.log);
    $('progressText').textContent = stageText(j.status, j);
    $('progressStatus').textContent = j.status === 'running' ? '⏳' : (j.status === 'done' ? '✅' : '❌');
    renderSteps(stageIndex(stage), j.status === 'done');
    if (j.log) $('progressLog').textContent = j.log.split('\n').slice(-20).join('\n');
    if (j.status === 'done') {
      clearInterval(state.polling); state.polling = null;
      renderSteps(4, true);
      showResult(j);
    }
    if (j.status === 'error') {
      clearInterval(state.polling); state.polling = null;
      $('progressStatus').textContent = '❌';
      $('progressLog').textContent = (j.error || '') + '\n\n' + (j.log || '');
      $('btnGenerate').disabled = false;
      $('btnGenerate').textContent = '✨ 开始自动生成';
    }
  }, 1500);
}

function detectStage(log) {
  const lines = (log || '').split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /\[(\d\d:\d\d:\d\d)\]\[([a-z]+)\]/.exec(lines[i]);
    if (m) return m[2];
  }
  return 'scan';
}

function stageText(status, j) {
  if (status === 'done') return '成片已生成 🎉';
  if (status === 'error') return '渲染失败，查看下方日志';
  if (!j.log) return '任务排队中…';
  const lines = j.log.split('\n').filter(Boolean);
  const last = lines[lines.length - 1] || '';
  return last.replace(/^\[\d\d:\d\d:\d\d\]\[[a-z]+\]\s*/, '');
}

function showResult(j) {
  const out = j.output || '';
  const cover = j.cover || '';
  const base = out.split(/[\\/]/).pop();
  const url = '/output/' + encodeURIComponent(base);
  state.currentOutput = out;
  const v = $('resultVideo');
  v.src = url + '?t=' + Date.now();
  v.hidden = false;
  $('playerPlaceholder').hidden = true;
  $('playerActions').hidden = false;
  $('playerMeta').textContent = out;
  // 点击后直接在播放区播放，无需再点播放键
  v.play().catch(() => { /* 自动播放被浏览器限制时忽略 */ });
  $('downloadLink').href = url + '?dl=1';
  if (cover) {
    const cb = cover.split(/[\\/]/).pop();
    $('downloadCover').href = '/output/' + encodeURIComponent(cb) + '?dl=1';
    $('downloadCover').hidden = false;
  } else {
    $('downloadCover').hidden = true;
  }
  $('btnGenerate').disabled = false;
  $('btnGenerate').textContent = '✨ 再生成一版';
  $('playerMeta').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  setTimeout(syncPlayerHeight, 120);
  loadState();
}

async function openFolder(path) {
  try {
    await api('/api/open-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
  } catch (e) { alert('打开目录失败: ' + e.message); }
}

async function deleteOutput(path) {
  if (!confirm('确定删除该成片文件吗？（封面会一并删除，不可恢复）')) return;
  try {
    await api('/api/delete-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    if (state.currentOutput === path) resetPlayer();
    await loadState();
  } catch (e) { alert('删除失败: ' + e.message); }
}

/** 上传本机音乐到音乐库并选中。 */
async function uploadLocalMusic(files) {
  if (!files || !files.length) return;
  for (const f of files) {
    try {
      const r = await fetch('/api/upload?target=music&name=' + encodeURIComponent(f.name), { method: 'PUT', body: f });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      await loadState();
      const sel = $('inMusic');
      for (const opt of sel.options) {
        if (opt.textContent.includes(f.name)) { sel.value = opt.value; break; }
      }
    } catch (e) {
      alert('音乐上传失败: ' + e.message);
    }
  }
}

/* ---------- 画廊 ---------- */
async function deleteJob(id) {
  if (!confirm('确定删除该任务记录吗？（失败/运行中的任务记录将被清除）')) return;
  try {
    await api('/api/delete-job', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    await loadState();
  } catch (e) { alert('删除失败: ' + e.message); }
}

function renderGallery() {
  const g = $('gallery');
  g.innerHTML = '';
  for (const j of state.jobs) {
    const d = document.createElement('div');
    // 运行中
    if (j.status === 'running') {
      d.className = 'gitem job';
      d.innerHTML = `<div class="gstatus running">⏳ 渲染中…</div>`;
      g.appendChild(d);
      continue;
    }
    // 失败：可删除任务记录
    if (j.status === 'error' || !j.output) {
      d.className = 'gitem gfail';
      d.innerHTML = `
        <div class="gthumb gthumb-fail">❌</div>
        <div class="gname">${j.id || '任务失败'}</div>
        <div class="gacts"><span class="ga del">🗑 删除</span></div>`;
      d.querySelector('.del').addEventListener('click', (e) => { e.stopPropagation(); deleteJob(j.id); });
      g.appendChild(d);
      continue;
    }
    // 成功
    const base = j.output.split(/[\\/]/).pop();
    const coverBase = base.replace(/\.mp4$/, '.jpg');
    const dlUrl = '/output/' + encodeURIComponent(base) + '?dl=1';
    d.className = 'gitem';
    const sel = state.gSelected.has(j.output);
    d.innerHTML = `
      <div class="gthumb">
        <img src="/output/${encodeURIComponent(coverBase)}" alt="">
        <input type="checkbox" class="gsel" ${sel ? 'checked' : ''} title="勾选用于批量下载">
        <div class="gplay"><span class="pb">▶</span></div>
      </div>
      <div class="gname">${base}</div>
      <div class="gacts">
        <a class="ga dl" href="${dlUrl}" download>⬇ 下载</a>
        <span class="ga dir">📂 目录</span>
        <span class="ga del">🗑 删除</span>
      </div>`;
    d.querySelector('.gthumb').addEventListener('click', (e) => {
      if (e.target.classList.contains('gsel')) return; // 勾选框不触发放映
      e.stopPropagation();
      showResult(j);
    });
    const gsel = d.querySelector('.gsel');
    gsel.addEventListener('click', (e) => e.stopPropagation());
    gsel.addEventListener('change', (e) => {
      if (e.target.checked) state.gSelected.add(j.output);
      else state.gSelected.delete(j.output);
      updateGallerySel();
    });
    d.querySelector('.dir').addEventListener('click', (e) => { e.stopPropagation(); openFolder(j.output); });
    d.querySelector('.del').addEventListener('click', (e) => { e.stopPropagation(); deleteOutput(j.output); });
    g.appendChild(d);
  }
  updateGallerySel();
}

/** 批量勾选统计与全选状态。 */
function updateGallerySel() {
  const sel = $('gallerySelCount');
  if (sel) sel.textContent = `已选 ${state.gSelected.size} 项`;
  const all = $('gallerySelectAll');
  if (all) {
    const done = state.jobs.filter((j) => j.status === 'done' && j.output).length;
    all.checked = done > 0 && state.gSelected.size === done;
  }
}

/** 批量下载已勾选的成片。 */
function batchDownload() {
  const items = state.jobs.filter((j) => j.status === 'done' && j.output && state.gSelected.has(j.output));
  if (!items.length) return alert('请先勾选要下载的成片');
  for (const j of items) {
    const base = j.output.split(/[\\/]/).pop();
    const a = document.createElement('a');
    a.href = '/output/' + encodeURIComponent(base) + '?dl=1';
    a.download = base;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}

/** 批量删除已勾选的成片（文件+封面+任务记录）。 */
async function batchDeleteOutputs() {
  const items = state.jobs.filter((j) => j.status === 'done' && j.output && state.gSelected.has(j.output));
  if (!items.length) return alert('请先勾选要删除的成片');
  if (!confirm(`确定删除 ${items.length} 个成片（含封面与任务记录）吗？不可恢复！`)) return;
  for (const j of items) {
    try {
      await api('/api/delete-file', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: j.output }),
      });
    } catch (_) { /* 单个失败继续 */ }
  }
  state.gSelected.clear();
  await loadState();
}

/** 删除素材库中"勾选（使用）"素材的链接：仅从库中移除，不删除本地文件。 */
async function deleteCheckedMedia() {
  const files = state.media.images.concat(state.media.videos)
    .filter((x) => !state.excluded.has(x.file))
    .map((x) => x.file);
  if (!files.length) return alert('当前没有勾选（使用）的素材');
  if (!confirm(`确定从素材库移除 ${files.length} 个勾选素材吗？\n仅移除链接，不会删除本地文件。`)) return;
  try {
    const r = await api('/api/media-remove', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files }),
    });
    await loadState();
    alert(`已移除 ${r.removed} 个素材（本地文件保留）`);
  } catch (e) { alert('操作失败: ' + e.message); }
}

/** 预览缩放（素材库 / 最近成片），带平滑过渡与百分比显示。 */
function initZoom() {
  const mk = (rangeId, valId, resetId, prop, base) => {
    const range = $(rangeId);
    const val = $(valId);
    const reset = $(resetId);
    if (!range) return;
    const apply = (v) => {
      const pct = Math.round(v * 100);
      document.documentElement.style.setProperty(prop, Math.round(base * v) + 'px');
      if (val) val.textContent = pct + '%';
    };
    range.addEventListener('input', () => apply(parseFloat(range.value)));
    if (reset) reset.addEventListener('click', () => { range.value = 1; apply(1); });
    apply(parseFloat(range.value));
  };
  mk('thumbZoom', 'thumbZoomVal', 'thumbZoomReset', '--thumb-min', 92);
  mk('galleryZoom', 'galleryZoomVal', 'galleryZoomReset', '--gitem-w', 220);
}

/* ---------- 上传 ---------- */
async function uploadFiles(files) {
  if (!files || !files.length) return;
  $('uploadProgress').hidden = false;
  const total = files.length;
  let done = 0;
  for (const f of files) {
    $('uploadFill').style.width = (done / total * 100) + '%';
    $('uploadText').textContent = `上传 ${f.name} (${done + 1}/${total})`;
    try {
      const r = await fetch('/api/upload?name=' + encodeURIComponent(f.name), { method: 'PUT', body: f });
      if (!r.ok) throw new Error('HTTP ' + r.status);
    } catch (e) {
      $('uploadText').textContent = `上传失败: ${f.name} — ${e.message}`;
      return;
    }
    done++;
  }
  $('uploadFill').style.width = '100%';
  $('uploadText').textContent = '✅ 上传完成，重新扫描…';
  await loadState();
  setTimeout(() => { $('uploadProgress').hidden = true; }, 1500);
}

/* ---------- 事件 ---------- */
document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    state.tab = t.dataset.tab;
    renderThumbs();
  });
});
$('btnGenerate').addEventListener('click', generate);
$('btnOpenFolder').addEventListener('click', () => { if (state.currentOutput) openFolder(state.currentOutput); });
$('btnOpenFolder').addEventListener('click', () => { if (state.currentOutput) openFolder(state.currentOutput); });
$('btnDeleteFile').addEventListener('click', () => { if (state.currentOutput) deleteOutput(state.currentOutput); });
$('btnPickLocalMusic').addEventListener('click', () => $('musicFileInput').click());
$('musicFileInput').addEventListener('change', (e) => uploadLocalMusic([...e.target.files]));
$('btnRescan').addEventListener('click', async () => { await loadState(); });
$('btnUpload2').addEventListener('click', () => $('fileInput').click());
$('btnSelectAll').addEventListener('change', (e) => toggleSelectAll(e.target.checked));
$('fileInput').addEventListener('change', (e) => uploadFiles([...e.target.files]));
const dz = $('dropzone');
dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag'); });
dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
dz.addEventListener('drop', (e) => {
  e.preventDefault(); dz.classList.remove('drag');
  uploadFiles([...e.dataTransfer.files]);
});

initEngine();
initAi();
initZoom();
initMusicPreview();
initObservers();
// 封面模式切换：时间输入 / 本地图片上传
$('inCoverMode').addEventListener('change', () => {
  $('inCoverTime').hidden = $('inCoverMode').value !== 'time';
  $('btnCoverUpload').hidden = $('inCoverMode').value !== 'file';
});
$('btnCoverUpload').addEventListener('click', () => $('coverFileInput').click());
$('coverFileInput').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const r = await fetch('/api/upload?target=cover&name=' + encodeURIComponent('cover_' + Date.now() + '_' + f.name), { method: 'PUT', body: f });
    const j = await r.json();
    if (!r.ok || !j.file) throw new Error('上传失败');
    $('inCoverFile').value = j.file;
    $('btnCoverUpload').textContent = '✅ 已选封面图片';
  } catch (err) {
    alert('封面上传失败: ' + err.message);
  }
});
// 最近成片批量操作
$('gallerySelectAll').addEventListener('change', (e) => {
  state.gSelected.clear();
  if (e.target.checked) {
    for (const j of state.jobs) if (j.status === 'done' && j.output) state.gSelected.add(j.output);
  }
  renderGallery();
});
$('btnBatchDownload').addEventListener('click', batchDownload);
$('btnBatchDelete').addEventListener('click', batchDeleteOutputs);
$('btnDeleteMedia').addEventListener('click', deleteCheckedMedia);
$('aiBox').addEventListener('toggle', () => setTimeout(syncPanelHeights, 250));
window.addEventListener('resize', () => { syncPanelHeights(); syncPlayerHeight(); });
window.addEventListener('load', () => setTimeout(() => { syncPanelHeights(); syncPlayerHeight(); }, 200));
$('inDuration').addEventListener('input', () => {
  state.durationManual = true;
  const dh = $('durationHint');
  if (dh) { dh.textContent = '手动设置（点击恢复自动）'; dh.classList.add('clickable'); }
});
$('durationHint').addEventListener('click', () => {
  state.durationManual = false;
  updateCounts();
  $('durationHint').classList.remove('clickable');
});
$('inFaceWeight').addEventListener('input', () => {
  $('faceWeightLabel').textContent = parseFloat($('inFaceWeight').value).toFixed(2);
});
loadState().catch((e) => { $('chipMedia').textContent = '加载失败: ' + e.message; });

'use strict';
/**
 * 渲染引擎：
 *  1. 规划时间轴（标题卡 + 素材片段 + 结尾卡，含转场重叠）
 *  2. 逐段预处理为统一规格的中间片段（照片走 zoompan 运镜，视频 cover-crop + 可选轻运镜）
 *  3. xfade 链式转场合成视频
 *  4. 音频：音乐（自动循环/淡入淡出）+ 可选素材原声（acrossfade 或 concat）
 *  5. drawtext 叠加水印 / 日期字幕
 *  6. 导出 mp4 + 封面 jpg
 */
const fs = require('fs');
const path = require('path');
const { FFMPEG, run, log, makeTmp, rmrf, safeName, escFilter, escText } = require('./utils');
const { probeVideo } = require('./probe');
const { photoChain, videoChain, pickMotion, computeFocus } = require('./motion');
const { resolveFilter } = require('./filters');
const { pickFont } = require('./textstyle');
const { pickH264Encoder, encArgs } = require('./hwenc');
const { resolveAsr, transcribeSegment } = require('./asr');
const { fmtDate } = require('./selector');
const { hexToFf } = require('./template');

/** 银幕黑边效果（宽银幕 2.35:1 视觉）：上下黑条。 */
function letterboxGraph(W, H) {
  const bar = Math.round(H * 0.115);
  return `drawbox=x=0:y=0:w=${W}:h=${bar}:color=black:t=fill,drawbox=x=0:y=${H - bar}:w=${W}:h=${bar}:color=black:t=fill`;
}

/** 按字符数折行（中文友好）。 */
function wrapText(text, perLine) {
  const t = String(text || '').trim();
  if (!t) return [];
  const out = [];
  for (let i = 0; i < t.length; i += perLine) out.push(t.slice(i, i + perLine));
  return out;
}

/** 带硬件编码与 CPU 回退的 ffmpeg 执行。 */
async function ffmpegEncode(prefix, enc, out, { preset = 'veryfast', crf = 20 } = {}) {
  try {
    await run(FFMPEG, [...prefix, ...encArgs(enc, preset, crf), out]);
    return enc.name;
  } catch (e) {
    log('render', `编码器 ${enc.name} 失败，回退 libx264 (CPU)`);
    await run(FFMPEG, [...prefix, '-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-pix_fmt', 'yuv420p', out]);
    return 'libx264';
  }
}

let _capCache = null;
async function ffmpegFilters() {
  if (_capCache) return _capCache;
  const { run: r, FFMPEG: F } = require('./utils');
  const set = new Set();
  try {
    const { out } = await r(F, ['-hide_banner', '-filters']);
    for (const line of out.split(/\r?\n/)) {
      const m = /^\s*\S+\s+([A-Za-z0-9_]+)\s/.exec(line);
      if (m) set.add(m[1]);
    }
  } catch (_) {
    /* ignore */
  }
  _capCache = set;
  return set;
}

/** 分段：标题卡 / 素材 / 结尾卡。 */
function planTimeline({ template, cfg, photos, videos }) {
  const titleDur = template.text.titleDuration || 3.5;
  const endDur = template.text.endDuration || 3;
  const photoDur = cfg.photoDuration || template.photoDuration || 2.6;
  const vidTarget = (template.videoDuration && template.videoDuration.target) || 3;

  const clips = [];
  for (const p of photos) clips.push({ type: 'image', item: p });
  for (const v of videos) clips.push({ type: 'video', item: v });
  clips.sort((a, b) => a.item.mtime - b.item.mtime);

  const segs = [];
  segs.push({ kind: 'title', duration: titleDur });
  for (const c of clips) {
    let d;
    if (c.type === 'video') {
      const avail = c.item.duration || vidTarget;
      d = Math.min(Math.max(avail - 0.8, 1.8), vidTarget);
    } else {
      d = photoDur;
    }
    segs.push({ kind: c.type, item: c.item, duration: d });
  }
  segs.push({ kind: 'end', duration: endDur });

  // 转场时长：不得大于最短片段的一半
  let trans = template.transitionDuration || 0.6;
  const minD = Math.min(...segs.map((s) => s.duration));
  trans = Math.min(trans, Math.max(0.3, minD * 0.45));

  // 用户指定总时长：缩放素材片段时长（标题/结尾不动）
  if (cfg.duration > 0) {
    let guard = 0;
    while (guard++ < 5) {
      const sumClip = segs.filter((s) => s.kind === 'clip' || s.kind === 'image' || s.kind === 'video').reduce((a, s) => a + s.duration, 0);
      const nTrans = segs.length - 1;
      const cur = segs.reduce((a, s) => a + s.duration, 0) - nTrans * trans;
      const factor = cfg.duration / cur;
      let changed = false;
      for (const s of segs) {
        if (s.kind === 'image' || s.kind === 'video' || s.kind === 'clip') {
          const nd = Math.min(8, Math.max(1.6, s.duration * factor));
          if (Math.abs(nd - s.duration) > 0.05) changed = true;
          s.duration = nd;
        }
      }
      if (!changed) break;
    }
  }

  const totalD = segs.reduce((a, s) => a + s.duration, 0) - (segs.length - 1) * trans;
  return { segs, trans, totalD };
}

async function buildSegmentImage({ file, duration, width, height, fps, motion, filterGraph, keepAudio, enc, focus, out }) {
  const frames = Math.max(2, Math.round(duration * fps));
  const chain = photoChain({ width, height, fps, frames, motion, focus });
  const vf = [chain, filterGraph].filter(Boolean).join(',');
  const args = ['-v', 'error', '-y', '-i', file];
  if (keepAudio) args.push('-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo');
  args.push('-frames:v', String(frames), '-vf', vf, '-r', String(fps));
  if (keepAudio) {
    args.push('-map', '0:v:0', '-map', '1:a:0', '-c:a', 'aac', '-b:a', '96k', '-ar', '44100', '-ac', '2', '-shortest');
  }
  await ffmpegEncode(args, enc, out);
}

async function buildSegmentVideo({ file, duration, width, height, fps, motion, filterGraph, keepAudio, enc, out }) {
  const info = await probeVideo(file);
  if (!info) throw new Error(`无法读取视频: ${file}`);
  const avail = info.duration;
  let start = Math.max(0, (avail - duration) / 2 - 0.5);
  start = Math.min(start, Math.max(0, avail - duration - 0.2));
  const remaining = avail - start;
  const chain = videoChain({ width, height, fps, motion });
  const filters = [chain];
  if (filterGraph) filters.push(filterGraph);
  if (remaining < duration) {
    filters.push(`tpad=stop_mode=clone:stop_duration=${(duration - remaining).toFixed(3)}`);
  }
  const args = ['-v', 'error', '-y', '-ss', start.toFixed(3), '-i', file];
  if (keepAudio && !info.hasAudio) args.push('-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo');
  args.push('-vf', filters.join(','));
  if (keepAudio) {
    args.push('-t', duration.toFixed(3), '-r', String(fps));
    if (info.hasAudio) args.push('-map', '0:v:0', '-map', '0:a:0');
    else args.push('-map', '0:v:0', '-map', '1:a:0');
    args.push('-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2');
  } else {
    args.push('-t', duration.toFixed(3), '-r', String(fps), '-an');
  }
  await ffmpegEncode(args, enc, out);
}

/** 标题卡 / 结尾卡：渐变背景 + 大字。 */
async function buildCard({ text, sub, duration, width, height, fps, font, color, subColor, size, subSize, y, subY, bg, bg2, keepAudio, enc, effectGraph, out }) {
  const caps = await ffmpegFilters();
  const useGrad = caps.has('gradients');
  const src = useGrad
    ? `gradients=s=${width}x${height}:c0=${bg}:c1=${bg2}:d=${duration}:speed=0.03:type=radial`
    : `color=c=${bg}:s=${width}x${height}:d=${duration}`;
  const vfParts = [];
  if (useGrad) {
    vfParts.push('vignette=PI/3.6');
    vfParts.push('noise=alls=4:allf=t');
  }
  if (text) {
    vfParts.push(drawtextFilter({
      text,
      font,
      color,
      size: Math.round(height * size),
      x: '(w-text_w)/2',
      y: `h*${(y || 0.32)}`,
      shadow: true,
    }));
  }
  if (sub) {
    vfParts.push(drawtextFilter({
      text: sub,
      font,
      color: subColor,
      size: Math.round(height * subSize),
      x: '(w-text_w)/2',
      y: `h*${(subY || 0.46)}`,
      shadow: true,
    }));
  }
  if (effectGraph) vfParts.push(effectGraph);
  vfParts.push('format=yuv420p');
  const args = ['-v', 'error', '-y', '-f', 'lavfi', '-i', src];
  if (keepAudio) args.push('-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo');
  args.push('-vf', vfParts.join(','), '-r', String(fps));
  if (keepAudio) {
    args.push('-map', '0:v:0', '-map', '1:a:0', '-c:a', 'aac', '-b:a', '96k', '-ar', '44100', '-ac', '2', '-shortest');
  }
  await ffmpegEncode(args, enc, out);
}

/** 构建 drawtext 滤镜串。 */
function drawtextFilter({ text, font, color, size, x, y, shadow = true, enable, alpha }) {
  let c = color;
  if (alpha !== undefined && /^0x/.test(c)) {
    // 0xRRGGBB -> 0xRRGGBBAA
    c = c + alpha.toString(16).padStart(2, '0');
  }
  const parts = [
    `fontfile='${escFilter(font.file)}'`,
    `text='${escText(text)}'`,
    `fontcolor=${c}`,
    `fontsize=${Math.round(size)}`,
    `x=${x}`,
    `y=${y}`,
    'expansion=none',
  ];
  if (shadow) parts.push('shadowcolor=0x000000A0:shadowx=2:shadowy=2');
  else parts.push('shadowcolor=0x00000000:shadowx=0:shadowy=0');
  if (enable) parts.push(`enable='${enable}'`);
  return `drawtext=${parts.join(':')}`;
}

async function buildCover({ output, at, coverOut }) {
  await run(FFMPEG, ['-v', 'error', '-y', '-ss', String(at), '-i', output, '-frames:v', '1', '-q:v', '3', coverOut]);
}

/**
 * 主渲染入口。
 * @returns {Promise<{output, cover, duration, segments, music, filterId}>}
 */
async function render(opts) {
  const { cfg, template, photos, videos, music, title, subtitle, outputDir, onProgress = () => {} } = opts;
  const t0 = Date.now();
  onProgress('plan', '规划时间轴…');
  let W = cfg.width || template.width;
  let H = cfg.height || template.height;
  const fps = cfg.fps || template.fps;
  // 画质：相对模板基准尺寸缩放（4K=2x / 2K=1.5x / 1080P=1x / 720P=0.5x / 480P=1/3）
  const QSCALE = { '2160p': 2, '1440p': 1.5, '1080p': 1, '720p': 0.5, '480p': 1 / 3 };
  const qs = QSCALE[cfg.quality] || 1;
  W = Math.round(W * qs);
  H = Math.round(H * qs);

  const { segs, trans, totalD } = planTimeline({ template, cfg, photos, videos });
  const enc = await pickH264Encoder(cfg);
  const filter = resolveFilter(cfg.filter || template.filter || 'auto', template.mood);
  const transition = cfg.transition || template.transition || 'fade';
  const fontStyle = cfg.fontStyle || template.text.titleStyle.fontStyle || 'auto';
  const font = cfg.font && cfg.font !== 'auto' ? pickFont(cfg.font) : pickFont(fontStyle, template.mood);
  log('render', `时间轴: ${segs.length} 段, 转场 ${trans}s, 总时长 ${totalD.toFixed(1)}s, 滤镜 ${filter.id}, 编码 ${enc.label}`);

  const tmp = makeTmp('aved-render-');
  try {
    // 语音识别字幕（可选）
    const asr = await resolveAsr(cfg.asr);
    if (asr) onProgress('build', '语音识别字幕已启用…');
    const segFiles = [];
    let i = 0;
    // ---- 标题卡 ----
    const tStyle = template.text.titleStyle || {};
    const subStyle = template.text.subtitleStyle || {};
    const titleText = title !== undefined && title !== '' ? title : template.text.title;
    const subText = subtitle !== undefined && subtitle !== '' ? subtitle : template.text.subtitle;
    onProgress('build', '生成标题卡…');
    const titleFile = path.join(tmp, `seg_${String(i++).padStart(3, '0')}.mp4`);
    await buildCard({
      text: titleText,
      sub: subText,
      duration: segs[0].duration,
      width: W, height: H, fps,
      font,
      color: hexToFf(tStyle.color || '#FFF7E6'),
      subColor: hexToFf(subStyle.color || '#FFD9A0'),
      size: tStyle.size || 0.11,
      subSize: subStyle.size || 0.05,
      y: tStyle.y || 0.32,
      subY: subStyle.y || 0.46,
      bg: hexToFf(template.endCard.bg),
      bg2: hexToFf(template.endCard.bg2),
      keepAudio: template.keepAudio,
      enc,
      effectGraph: template.effect === 'letterbox' ? letterboxGraph(W, H) : '',
      out: titleFile,
    });
    segFiles.push(titleFile);

    // ---- 素材片段 ----
    const motionPrefer = cfg.motion || template.motion || 'auto';
    const transitionZoom = !!(cfg.transitionZoom || template.transitionZoom);
    const effectGraph = template.effect === 'letterbox' ? letterboxGraph(W, H) : '';
    for (let k = 1; k < segs.length - 1; k++) {
      const s = segs[k];
      onProgress('build', `处理素材 ${k}/${segs.length - 2}: ${path.basename(s.item.file)}`);
      const outFile = path.join(tmp, `seg_${String(i++).padStart(3, '0')}.mp4`);
      if (s.kind === 'image') {
        const motion = pickMotion(cfg.seed, motionPrefer === 'auto' ? 'zoom-in' : motionPrefer);
        const focus = s.item.face && cfg.faceSafe !== false
          ? computeFocus(s.item.face, s.item.width, s.item.height, W, H)
          : null;
        await buildSegmentImage({
          file: s.item.file, duration: s.duration, width: W, height: H, fps,
          motion: motionPrefer === 'auto' ? motion : motionPrefer,
          filterGraph: [filter.graph, effectGraph].filter(Boolean).join(','),
          keepAudio: template.keepAudio,
          enc,
          focus,
          out: outFile,
        });
      } else {
        const vMotion = motionPrefer === 'auto' ? (transitionZoom ? 'subtle' : 'none') : motionPrefer;
        await buildSegmentVideo({
          file: s.item.file, duration: s.duration, width: W, height: H, fps,
          motion: vMotion,
          filterGraph: [filter.graph, effectGraph].filter(Boolean).join(','),
          keepAudio: template.keepAudio,
          enc,
          out: outFile,
        });
        if (asr) {
          const avail = s.item.duration || s.duration;
          let st = Math.max(0, (avail - s.duration) / 2 - 0.5);
          st = Math.min(st, Math.max(0, avail - s.duration - 0.2));
          const sub = await transcribeSegment(asr, s.item.file, st, s.duration, tmp);
          if (sub) s.subtitle = sub.text;
        }
      }
      segFiles.push(outFile);
    }

    // ---- 结尾卡 ----
    onProgress('build', '生成结尾卡…');
    const endFile = path.join(tmp, `seg_${String(i++).padStart(3, '0')}.mp4`);
    await buildCard({
      text: template.text.endText || '',
      sub: titleText,
      duration: segs[segs.length - 1].duration,
      width: W, height: H, fps,
      font,
      color: hexToFf(tStyle.color || '#FFF7E6'),
      subColor: hexToFf(subStyle.color || '#FFD9A0'),
      size: 0.07,
      subSize: 0.04,
      y: 0.42,
      subY: 0.55,
      bg: hexToFf(template.endCard.bg),
      bg2: hexToFf(template.endCard.bg2),
      keepAudio: template.keepAudio,
      enc,
      effectGraph: template.effect === 'letterbox' ? letterboxGraph(W, H) : '',
      out: endFile,
    });
    segFiles.push(endFile);

    // ---- 合成 ----
    onProgress('mix', '转场合成与音频混合…');
    const caps = await ffmpegFilters();
    const hasAcrossfade = caps.has('acrossfade');
    const musicVol = cfg.musicVolume || template.music.volume || 0.32;
    const mv = template.keepAudio ? musicVol : Math.max(0.55, musicVol * 2.4);
    const keepAudio = template.keepAudio;

    const { output, coverOut } = await assemble({
      segFiles, segs, trans, template, transition, W, H, fps, totalD,
      music, mv, keepAudio, hasAcrossfade, enc,
      font, cfg, outputDir, onProgress,
    });

    // ---- 封面（随机 / 指定时间 / 本地图片） ----
    onProgress('cover', '生成封面…');
    if (cfg.coverMode === 'file' && cfg.coverFile) {
      // 本地图片作为封面（统一转为 jpg）
      await run(FFMPEG, ['-v', 'error', '-y', '-i', cfg.coverFile, '-vf', 'scale=720:-2', '-q:v', '2', coverOut]);
    } else {
      let coverAt;
      if (cfg.coverMode === 'time' && cfg.coverTime > 0) {
        coverAt = Math.min(Math.max(cfg.coverTime, 1), Math.max(1, totalD - 1));
      } else {
        const lo = Math.min(segs[0].duration + 1, Math.max(2, totalD - 2));
        const hi = Math.max(lo + 1, totalD - 1);
        coverAt = lo + Math.random() * (hi - lo);
      }
      await buildCover({ output, at: coverAt, coverOut });
    }

    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    log('render', `完成: ${output} (${totalD.toFixed(1)}s, 用时 ${dt}s)`);
    return {
      output,
      cover: coverOut,
      duration: totalD,
      segments: segs,
      music: music ? music.file : null,
      filterId: filter.id,
      enc: enc.label,
      tmp,
    };
  } catch (e) {
    rmrf(tmp);
    throw e;
  }
}

/** 合成主函数：视频 xfade 链 + 音频链 + drawtext 叠加 + 输出。 */
async function assemble({ segFiles, segs, trans, template, transition, W, H, fps, totalD, music, mv, keepAudio, hasAcrossfade, enc, font, cfg, outputDir, onProgress }) {
  const n = segFiles.length;
  const parts = [];

  // ---- 视频 xfade 链 ----
  let prev = '[0:v]';
  let off = segs[0].duration - trans;
  for (let k = 1; k < n; k++) {
    const label = k === n - 1 ? '[vchain]' : `[vx${k}]`;
    parts.push(`${prev}[${k}:v]xfade=transition=${transition}:duration=${trans.toFixed(3)}:offset=${off.toFixed(3)}${label}`);
    prev = label;
    off += segs[k].duration - trans;
  }

  // ---- 音频 ----
  const musicIdx = n; // 音乐输入位于片段之后
  let audioOut;
  if (keepAudio) {
    if (hasAcrossfade) {
      let aPrev = '[0:a]';
      for (let k = 1; k < n; k++) {
        const al = `[ac${k}]`;
        // 各段音频已按段长裁剪；acrossfade 与视频 xfade 用同一转场时长
        parts.push(`${aPrev}[${k}:a]acrossfade=d=${trans.toFixed(3)}:c1=tri:c2=tri${al}`);
        aPrev = al;
      }
      parts.push(`${aPrev}volume=1.0[origA]`);
    } else {
      const ins = segFiles.map((_, k) => `[${k}:a]`).join('');
      parts.push(`${ins}concat=n=${n}:v=0:a=1,atrim=0:${totalD.toFixed(3)},asetpts=PTS-STARTPTS,volume=1.0[origA]`);
    }
    audioOut = '[origA]';
  }

  if (music) {
    const fadeOutStart = Math.max(0, totalD - 2.5);
    const musicChain =
      `[${musicIdx}:a]atrim=0:${totalD.toFixed(3)},asetpts=PTS-STARTPTS,` +
      `afade=t=in:st=0:d=1.5,afade=t=out:st=${fadeOutStart.toFixed(3)}:d=2.5,` +
      `volume=${mv.toFixed(3)}[mA]`;
    parts.push(musicChain);
    if (keepAudio) {
      parts.push(`[origA][mA]amix=inputs=2:duration=first:normalize=0,volume=1.0[aout]`);
    } else {
      parts.push(`[mA]volume=1.0[aout]`);
    }
    audioOut = '[aout]';
  } else if (keepAudio) {
    parts.push(`[origA]volume=1.0[aout]`);
    audioOut = '[aout]';
  }

  // ---- drawtext 叠加 ----
  const over = [];
  const wm = cfg.watermark === false ? '' : cfg.watermark || template.text.watermark;
  if (wm) {
    over.push(drawtextFilter({
      text: wm,
      font,
      color: hexToFf('#FFFFFF'),
      alpha: 0x66,
      size: Math.round(H * 0.028),
      x: 'w-text_w-36',
      y: 'h-text_h-30',
      shadow: true,
      enable: `between(t,0,${totalD.toFixed(3)})`,
    }));
  }
  const showDates = template.text.showDateLabels !== false && cfg.captions !== false;
  if (showDates) {
    const capStyle = template.text.captionStyle || {};
    let t = segs[0].duration;
    for (let k = 1; k < n - 1; k++) {
      const s = segs[k];
      const start = t + 0.5;
      const end = Math.min(t + s.duration - trans - 0.4, totalD);
      if (end > start) {
        if (s.subtitle) {
          // 语音识别字幕：最多两行
          const lines = wrapText(s.subtitle, 15).slice(0, 2);
          const baseY = Math.round(H * (capStyle.y || 0.8));
          lines.forEach((ln, li) => {
            over.push(drawtextFilter({
              text: ln,
              font: pickFont(capStyle.fontStyle || 'modern'),
              color: hexToFf(capStyle.color || '#FFFFFF'),
              alpha: 0xE0,
              size: Math.round(H * (capStyle.size || 0.042)),
              x: '(w-text_w)/2',
              y: `h-${baseY - li * Math.round(H * 0.055)}`,
              shadow: true,
              enable: `between(t,${start.toFixed(2)},${end.toFixed(2)})`,
            }));
          });
        } else if (s.item && s.item.mtime) {
          const label = fmtDate(s.item.mtime, true);
          over.push(drawtextFilter({
            text: label,
            font: pickFont(capStyle.fontStyle || 'modern'),
            color: hexToFf(capStyle.color || '#FFFFFF'),
            alpha: 0xC8,
            size: Math.round(H * (capStyle.size || 0.038)),
            x: '42',
            y: `h-${Math.round(H * (capStyle.y || 0.88))}`,
            shadow: true,
            enable: `between(t,${start.toFixed(2)},${end.toFixed(2)})`,
          }));
        }
      }
      t += s.duration - trans;
    }
  }
  over.push('format=yuv420p');
  parts.push(`[vchain]${over.join(',')}[vout]`);

  // ---- 输出 ----
  const stamp = new Date();
  const pad = (x) => String(x).padStart(2, '0');
  const base = `${template.id}_${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}_${pad(stamp.getHours())}${pad(stamp.getMinutes())}`;
  const outBase = path.join(outputDir, safeName(base));
  const output = outBase + '.mp4';
  const coverOut = outBase + '.jpg';
  fs.mkdirSync(outputDir, { recursive: true });

  const args = ['-v', 'error', '-y'];
  for (const f of segFiles) args.push('-i', f);
  if (music) args.push('-stream_loop', '-1', '-i', music.file);
  args.push('-filter_complex', parts.join(';'));
  args.push('-map', '[vout]');
  if (audioOut) args.push('-map', audioOut);
  if (audioOut) args.push('-c:a', 'aac', '-b:a', '192k');
  args.push('-movflags', '+faststart', '-t', totalD.toFixed(3));

  onProgress('mix', 'ffmpeg 渲染成片（转场/滤镜/字幕/音乐）…');
  log('render', `filter_complex 共 ${parts.length} 条`);
  await ffmpegEncode(args, enc, output, { preset: 'medium', crf: 20 });
  return { output, coverOut };
}

module.exports = { render, planTimeline, drawtextFilter, buildCard };

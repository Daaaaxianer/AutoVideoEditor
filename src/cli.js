'use strict';
/**
 * 命令行入口：
 *   node src/cli.js --input ./input --template family-moments --title "我们的2026" ...
 *   node src/cli.js --list-templates
 *   node src/cli.js --list-filters
 */
const path = require('path');
const fs = require('fs');
const { resolveConfig, ROOT } = require('./config');
const { loadTemplate, listTemplates, applyVariant, ASPECTS } = require('./template');
const { scanAll } = require('./scanner');
const { analyzeBatch } = require('./analyze');
const { selectPhotos, selectVideos } = require('./selector');
const { PRESET_LABELS, PRESET_IDS } = require('./filters');
const { MOTION_LABELS, MOTIONS } = require('./motion');
const { STYLE_LABELS, STYLE_FONTS, fontCache } = require('./textstyle');
const { autoPick, pickFile, generateAmbientBed } = require('./music');
const { resolveAi, genTitle, aiPickOrder } = require('./ai');
const { render } = require('./render');
const { log } = require('./utils');

const HELP = `
自动家庭视频剪辑工具 - 用法:
  node src/cli.js [选项]

基础:
  --input <目录>        素材目录（照片/视频），默认 ./input
  --music <目录>        音乐目录，默认 ./music
  --output <目录>       输出目录，默认 ./output
  --template <id>       模板，默认 family-moments（--list-templates 查看）
  --variant <id>        模板风格变体
  --title <文案>        主标题
  --subtitle <文案>     副标题
  --end-text <文案>     结尾文字（成片最后出现）
  --cover <random|time:N>   封面：random=随机时刻（默认），time:N=指定第 N 秒

选片:
  --photos <数量>       照片数量（0=模板默认）
  --videos <数量>       视频片段数量（0=模板默认）
  --duration <秒>       目标成片时长（0=模板自动）
  --photo-duration <秒> 每张照片时长

风格:
  --filter <id|auto>    滤镜（--list-filters 查看）
  --motion <auto|zoom-in|zoom-out|pan-left|pan-right|pan-up|pan-down|subtle|none>
  --transition <名字>   转场（fade/dissolve/slideleft/...）
  --font-style <modern|title|kaiti|round|serif|mono>
  --font <字体文件路径>  自定义字体

音乐:
  --music-file <文件>   指定音乐
  --music-mood <mood>   warm/happy/calm/epic/retro/sweet/fresh/golden/dance
  --music-volume <0-1>  音乐音量（相对原声）
  --keep-audio          保留素材原声（与音乐混合）
  --no-keep-audio       纯音乐成片

其它:
  --watermark <文案|off>
  --no-captions         关闭日期字幕
  --seed <数字>         随机种子
  --quiet               减少日志

本地 GPU/CPU 与人脸:
  --hw-enc <auto|qsv|nvenc|amf|mf|off>   编码器：auto=自动探测 GPU 硬件编码（默认），off=纯 CPU
  --quality <''|720p>                     输出画质（空=1080P）
  --face-weight <0-1>                     人脸优先权重（默认 0.6，0=不偏好人脸）
  --face-safe | --no-face-safe            人脸保持画面位置（默认开启）
  --transition-zoom                       转场缩放：视频片段轻微推近
  --use-files "a.jpg;b.mp4"               手动精选：只使用指定素材（按顺序）

语音识别字幕（可选，默认关闭）:
  --asr <off|auto|api>   auto=探测本地 whisper；api=OpenAI 兼容 /audio/transcriptions
  --asr-model <模型>     api 模式模型名（默认 whisper-1）
  --asr-base-url <地址>  api 兼容地址（默认 https://api.openai.com/v1）
  --asr-key <密钥>       api 模式必填

可选 AI 增强（最后手段，失败自动回退启发式）:
  --ai <off|auto|ollama|api>   默认 off；auto=探测本地 Ollama，ollama=强制本地，api=在线 API
  --ai-model <模型名>          如 qwen2.5:7b / deepseek-chat
  --ai-base-url <地址>         API 模式兼容接口地址（默认 https://api.openai.com/v1）
  --ai-key <密钥>              API 模式必填

信息:
  --list-templates      列出模板
  --list-filters        列出滤镜
  --list-fonts          列出可用字体
  -h, --help            帮助
`;

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--input': o.inputDir = next(); break;
      case '--music': o.musicDir = next(); break;
      case '--output': o.outputDir = next(); break;
      case '--template': o.template = next(); break;
      case '--variant': o.variant = next(); break;
      case '--title': o.title = next(); break;
      case '--subtitle': o.subtitle = next(); break;
      case '--end-text': o.endText = next(); break;
      case '--cover': {
        const v = next();
        const mT = /^time:([\d.]+)$/.exec(v);
        const mF = /^file:(.+)$/.exec(v);
        if (mT) { o.coverMode = 'time'; o.coverTime = parseFloat(mT[1]); }
        else if (mF) { o.coverMode = 'file'; o.coverFile = mF[1]; }
        else o.coverMode = v === 'time' ? 'time' : 'random';
        break;
      }
      case '--photos': o.photos = parseInt(next(), 10) || 0; break;
      case '--videos': o.videos = parseInt(next(), 10) || 0; break;
      case '--duration': o.duration = parseFloat(next()) || 0; break;
      case '--photo-duration': o.photoDuration = parseFloat(next()) || 0; break;
      case '--aspect': o.aspect = next(); break;
      case '--fps': o.fps = parseInt(next(), 10) || 0; break;
      case '--filter': o.filter = next(); break;
      case '--motion': o.motion = next(); break;
      case '--transition': o.transition = next(); break;
      case '--font-style': o.fontStyle = next(); break;
      case '--font': o.font = next(); break;
      case '--music-file': o.musicFile = next(); break;
      case '--music-mood': o.musicMood = next(); break;
      case '--music-volume': o.musicVolume = parseFloat(next()); break;
      case '--exclude': {
        const v = next();
        o.exclude = o.exclude || [];
        for (const x of v.split(';')) if (x.trim()) o.exclude.push(x.trim());
        break;
      }
      case '--keep-audio': o.keepAudio = true; break;
      case '--no-keep-audio': o.keepAudio = false; break;
      case '--watermark': o.watermark = next() === 'off' ? false : next(); break;
      case '--no-captions': o.captions = false; break;
      case '--seed': o.seed = parseInt(next(), 10) || 0; break;
      case '--hw-enc': o.hwEnc = next(); break;
      case '--quality': o.quality = next(); break;
      case '--face-weight': o.faceWeight = parseFloat(next()); break;
      case '--face-safe': o.faceSafe = next() !== 'off'; break;
      case '--no-face-safe': o.faceSafe = false; break;
      case '--transition-zoom': o.transitionZoom = true; break;
      case '--use-files': {
        const v = next();
        o.useFiles = o.useFiles || [];
        for (const x of v.split(';')) if (x.trim()) o.useFiles.push(x.trim());
        break;
      }
      case '--asr': o.asr = { ...(o.asr || {}), mode: next() }; break;
      case '--asr-model': o.asr = { ...(o.asr || {}), model: next() }; break;
      case '--asr-base-url': o.asr = { ...(o.asr || {}), baseUrl: next() }; break;
      case '--asr-key': o.asr = { ...(o.asr || {}), apiKey: next() }; break;
      case '--ai': o.ai = { ...(o.ai || {}), mode: next() }; break;
      case '--ai-model': o.ai = { ...(o.ai || {}), model: next() }; break;
      case '--ai-base-url': o.ai = { ...(o.ai || {}), baseUrl: next() }; break;
      case '--ai-key': o.ai = { ...(o.ai || {}), apiKey: next() }; break;
      case '--quiet': o.quiet = true; break;
      case '--list-templates': o._listTemplates = true; break;
      case '--list-filters': o._listFilters = true; break;
      case '--list-fonts': o._listFonts = true; break;
      case '-h':
      case '--help': o._help = true; break;
      default:
        if (a.startsWith('-')) console.error(`未知参数: ${a}`);
    }
  }
  return o;
}

function listTemplatesCmd(templateDir) {
  const ts = listTemplates(templateDir);
  console.log('可用模板:');
  for (const t of ts) {
    console.log(`  ${t.id.padEnd(18)} ${t.name.padEnd(10)} ${t.aspect.padEnd(5)} ${t.mood.padEnd(10)} ${(t.desc || '').slice(0, 40)}`);
    for (const v of t.variants || []) console.log(`     风格变体: ${v.id} - ${v.name} (滤镜 ${v.filter})`);
  }
}

function listFiltersCmd() {
  console.log('可用滤镜:');
  for (const id of PRESET_IDS) console.log(`  ${id.padEnd(12)} ${PRESET_LABELS[id]}`);
  console.log('  auto        自动（按模板 mood 推荐）');
  console.log('  none        原片');
}

function listFontsCmd() {
  const fonts = fontCache();
  console.log('可用字体:');
  for (const s of Object.keys(STYLE_FONTS)) console.log(`  风格[${s}]: ${STYLE_LABELS[s]}`);
  console.log(`共检测到 ${fonts.length} 个字体文件`);
  for (const f of fonts.slice(0, 40)) console.log(`  ${f.name}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args._help) {
    console.log(HELP);
    return;
  }
  const { cfg } = resolveConfig(args);
  if (args._listTemplates) return listTemplatesCmd(cfg.templateDir);
  if (args._listFilters) return listFiltersCmd();
  if (args._listFonts) return listFontsCmd();

  const template = applyVariant(loadTemplate(cfg.template, cfg.templateDir), cfg.variant);
  // 结尾文字覆盖（--end-text / Web 界面）
  if (cfg.endText) template.text.endText = cfg.endText;
  // 画幅覆盖（--aspect / Web 界面）
  if (cfg.aspect && ASPECTS[cfg.aspect]) {
    template.aspect = cfg.aspect;
    template.width = ASPECTS[cfg.aspect].width;
    template.height = ASPECTS[cfg.aspect].height;
  }
  log('cli', `模板: ${template.id}「${template.name}」画幅 ${template.aspect}(${template.width}x${template.height}) fps=${template.fps} mood=${template.mood}`);

  // 扫描
  const { images, videos } = scanAll(cfg.inputDir, cfg.musicDir);
  if (!images.length && !videos.length) {
    console.error(`\n没有找到素材！请把手机里的照片/视频放入: ${cfg.inputDir}\n（可用 --input 指定其它目录，或先运行 node samples/make_samples.js 生成演示素材）`);
    process.exit(1);
  }
  // 排除指定素材
  const ex = new Set((cfg.exclude || []).map((x) => path.basename(x).toLowerCase()));
  // 过滤"已从素材库移除链接"的素材（不删本地文件）
  let igSet = new Set();
  try {
    const ig = JSON.parse(fs.readFileSync(path.join(ROOT, '.aved-ignored.json'), 'utf8'));
    if (Array.isArray(ig.files)) igSet = new Set(ig.files);
  } catch (_) { /* ignore */ }
  const filterEx = (arr) => arr.filter((i) => !ex.has(path.basename(i.file).toLowerCase()) && !ex.has(i.file.toLowerCase()) && !igSet.has(i.file));
  const imagesF = filterEx(images);
  const videosF = filterEx(videos);
  if (!imagesF.length && !videosF.length) {
    console.error('所有素材都被排除，没有可用素材。');
    process.exit(1);
  }

  // 分析
  const sel = template.selection || {};
  const needPhotos = cfg.photos || sel.photos || 0;
  const needVideos = cfg.videos || sel.videos || 0;
  log('cli', `分析素材（需要照片 ${needPhotos} / 视频 ${needVideos}）…`);
  const [imgA, vidA] = await Promise.all([
    analyzeBatch(imagesF, 'image'),
    analyzeBatch(videosF, 'video'),
  ]);

  // 选片（自动 或 手动精选）
  const targetAspect = template.width / template.height;
  let photos;
  let vids;
  if (cfg.useFiles && cfg.useFiles.length) {
    const pick = (arr) => {
      const out = [];
      for (const f of cfg.useFiles) {
        const key = f.toLowerCase();
        const hit = arr.find(
          (a) => a.file.toLowerCase() === key || path.basename(a.file).toLowerCase() === key || a.file.toLowerCase().endsWith(key)
        );
        if (hit && !out.includes(hit)) out.push(hit);
      }
      return out;
    };
    photos = pick(imgA);
    vids = pick(vidA);
    log('cli', `手动精选模式: 照片 ${photos.length} 张 / 视频 ${vids.length} 段（按勾选顺序）`);
  } else {
    photos = selectPhotos(imgA, needPhotos, { targetAspect, minScore: sel.minScore || 25, seed: cfg.seed, faceWeight: cfg.faceWeight });
    vids = selectVideos(vidA, needVideos, {
      targetAspect,
      minDur: (template.videoDuration && template.videoDuration.min) || 2,
      maxDur: (template.videoDuration && template.videoDuration.max) || 15,
      seed: cfg.seed,
      faceWeight: cfg.faceWeight,
    });
  }
  if (!photos.length && !vids.length) {
    console.error('选片失败：没有可用素材（素材可能过暗/过模糊/无法解码，或精选清单无匹配）。');
    process.exit(1);
  }
  const faceCnt = photos.filter((p) => p.face && p.face.count).length;
  if (faceCnt) log('select', `其中 ${faceCnt} 张照片含人脸（已优先选中并自动保持人脸位置）`);

  // ---- 可选 AI 增强（失败自动回退启发式） ----
  let title = cfg.title;
  let subtitle = cfg.subtitle;
  const ai = await resolveAi(cfg.ai);
  if (ai) {
    log('ai', `AI 增强已启用 (${ai.mode})，尝试生成标题与优化选片…`);
    if (!title || !subtitle || !template.text.endText) {
      const t0 = Date.now();
      const range = dateRangeOf(imgA.concat(vidA));
      const r = await genTitle(ai, {
        templateName: template.name,
        mood: template.mood,
        photos: photos.length,
        videos: vids.length,
        dateRange: range,
      }).catch(() => null);
      if (r) {
        if (!title && r.title) title = r.title;
        if (!subtitle && r.subtitle) subtitle = r.subtitle;
        if (r.endText) template.text.endText = r.endText;
        log('ai', `AI 文案: ${title} / ${subtitle} / ${template.text.endText} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
      }
    }
    if (photos.length && imgA.length) {
      const candidates = imgA
        .slice()
        .sort((a, b) => b.score - a.score)
        .slice(0, 30)
        .map((c) => ({
          name: path.basename(c.file),
          score: c.score,
          width: c.width,
          height: c.height,
          date: new Date(c.mtime).toISOString().slice(0, 10),
        }));
      const order = await aiPickOrder(ai, { target: photos.length, candidates }).catch(() => null);
      if (order && order.length >= Math.min(photos.length, 3)) {
        const byName = new Map(imgA.map((c) => [path.basename(c.file), c]));
        const picked = order.map((n) => byName.get(n)).filter(Boolean);
        const rest = photos.filter((p) => !picked.includes(p));
        const merged = picked.concat(rest).slice(0, photos.length);
        if (merged.length) {
          log('ai', `AI 优化选片: ${merged.length} 张`);
          photos = merged;
        }
      }
    }
  }

  // 音乐
  let music = null;
  if (cfg.musicFile) {
    music = await pickFile(cfg.musicFile);
  } else {
    music = await autoPick(cfg.musicDir, {
      mood: cfg.musicMood || template.music.mood || template.mood,
      targetDuration: cfg.duration || 30,
    });
  }
  if (!music) {
    log('music', '未找到音乐，生成氛围垫底音轨（可把歌曲放入 music 目录自动选用）');
    music = { file: await generateAmbientBed({ duration: Math.max(20, cfg.duration || 30), mood: template.music.mood || template.mood }), name: '(生成的氛围音轨)', duration: 0, score: -1 };
  }

  // 渲染
  const result = await render({
    cfg,
    template,
    photos,
    videos: vids,
    music,
    title,
    subtitle,
    outputDir: cfg.outputDir,
    onProgress: (stage, msg) => {
      if (!cfg.quiet) log(stage, msg);
    },
  });

  console.log('\n===== 渲染完成 =====');
  console.log(`  模板:     ${template.name}`);
  console.log(`  照片:     ${photos.length} 张 / 视频: ${vids.length} 段${faceCnt ? `（${faceCnt} 张含人脸）` : ''}`);
  console.log(`  滤镜:     ${result.filterId}`);
  console.log(`  编码:     ${result.enc}`);
  console.log(`  音乐:     ${music.name}`);
  console.log(`  成片:     ${result.output}  (${result.duration.toFixed(1)}s)`);
  console.log(`  封面:     ${result.cover}`);
}

/** 素材时间跨度描述。 */
function dateRangeOf(items) {
  if (!items.length) return '未知';
  const ts = items.map((i) => i.mtime).filter(Boolean).sort((a, b) => a - b);
  if (!ts.length) return '未知';
  const f = (t) => new Date(t).toISOString().slice(0, 10);
  const a = f(ts[0]);
  const b = f(ts[ts.length - 1]);
  return a === b ? a : `${a} 至 ${b}`;
}

main().catch((e) => {
  console.error('\n渲染失败:', e.message);
  if (e.err) console.error(e.err.slice(-2000));
  process.exit(1);
});

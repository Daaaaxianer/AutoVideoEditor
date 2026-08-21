'use strict';
/**
 * 生成演示素材（无真实照片时用于测试完整流程）：
 *  - samples/input/  12 张渐变"照片" + 6 段"家庭视频"（带测试音频）
 *  - samples/music/  3 首测试音乐（happy / calm / epic）
 * 用法: node samples/make_samples.js [--dir samples] [--music 1|2|3]
 */
const fs = require('fs');
const path = require('path');
const { FFMPEG, run, log } = require('../src/utils');

const PALETTES = [
  ['0x2E5E88', '0xA8D8F0'], ['0xD96A2E', '0xFFD9A0'], ['0x2E6B4F', '0xA8E0C0'],
  ['0xC05A7A', '0xFFC8D8'], ['0x8A6D3B', '0xE8C88A'], ['0x3A3A6A', '0x98A8E8'],
  ['0x2E7E8A', '0xA8E8E0'], ['0x8A2E4A', '0xE898B8'], ['0x6B5A2E', '0xD8C89A'],
  ['0x5A4A8A', '0xC0B8E8'], ['0x2E8A6A', '0xB8E8D0'], ['0x8A2E2E', '0xE8A8A0'],
];

const FONT = 'C:/Windows/Fonts/msyh.ttc'.replace(/:/g, '\\:');

function draw(text, size = 90, y = 'h*0.40') {
  return `drawtext=fontfile='${FONT}':text='${text}':fontcolor=0xFFFFFFFF:fontsize=${size}:x=(w-text_w)/2:y=${y}:shadowcolor=0x000000A0:shadowx=2:shadowy=2`;
}

async function makePhotos(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const aspects = ['1350x2400', '2400x1350', '2000x2000', '1350x2400', '2400x1350', '2000x2000'];
  for (let i = 0; i < 12; i++) {
    const [c0, c1] = PALETTES[i % PALETTES.length];
    const s = aspects[i % aspects.length];
    const out = path.join(dir, `photo_${String(i + 1).padStart(2, '0')}.jpg`);
    const vf = [
      draw(`PHOTO ${String(i + 1).padStart(2, '0')}`, 120),
      'format=yuv420p',
    ].join(',');
    await run(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `gradients=s=${s}:c0=${c0}:c1=${c1}:nb_colors=2:type=linear`, '-vf', vf, '-frames:v', '1', '-q:v', '2', out]);
    log('samples', `照片 ${path.basename(out)} (${s})`);
  }
}

async function makeVideos(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const notes = [220, 261.63, 293.66, 329.63, 349.23, 392];
  for (let i = 0; i < 6; i++) {
    const [c0, c1] = PALETTES[i % PALETTES.length];
    const freq = notes[i];
    const out = path.join(dir, `clip_${String(i + 1).padStart(2, '0')}.mp4`);
    const vf = [
      draw(`CLIP ${String(i + 1).padStart(2, '0')}`, 130),
      'format=yuv420p',
    ].join(',');
    const args = [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', `gradients=s=1920x1080:c0=${c0}:c1=${c1}:nb_colors=2:type=linear:d=6:speed=0.04`,
      '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=6:sample_rate=44100`,
      '-vf', vf,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-shortest', out,
    ];
    await run(FFMPEG, args);
    log('samples', `视频 ${path.basename(out)} (${freq}Hz)`);
  }
}

function chordExpr(base, step) {
  // 每 4 秒换一个和弦（根音 × 2^(step/12)），三音叠置；逗号用 \, 转义一次
  const f = `${base}*pow(2\\,mod(floor(t/4)\\,4)*${step}/12)`;
  return `0.22*sin(2*PI*${f}*t)+0.16*sin(2*PI*${f}*1.26*t)+0.11*sin(2*PI*${f}*1.5*t)`;
}

async function makeMusic(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const tracks = [
    { name: 'music_happy_轻快.m4a', expr: chordExpr(220, 2), extra: 'tremolo=f=2:d=0.5' },
    { name: 'music_calm_舒缓钢琴.m4a', expr: chordExpr(196, 0), extra: 'tremolo=f=0.2:d=0.6,lowpass=f=2800' },
    { name: 'music_epic_大气.m4a', expr: chordExpr(174.61, 4), extra: 'tremolo=f=0.15:d=0.8,lowpass=f=2000' },
  ];
  for (const t of tracks) {
    const out = path.join(dir, t.name);
    const af = `${t.extra},volume=0.8,afade=t=in:st=0:d=2,afade=t=out:st=38:d=2`;
    await run(FFMPEG, [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', `aevalsrc=${t.expr}:s=44100:d=40`,
      '-af', af,
      '-ac', '2',
      '-c:a', 'aac', '-b:a', '160k', out,
    ]);
    log('samples', `音乐 ${t.name}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dirArg = (args.indexOf('--dir') >= 0) ? args[args.indexOf('--dir') + 1] : 'samples';
  const base = path.resolve(__dirname, '..', dirArg);
  await makePhotos(path.join(base, 'input'));
  await makeVideos(path.join(base, 'input'));
  await makeMusic(path.join(base, 'music'));
  console.log('\n演示素材已生成:');
  console.log(`  照片/视频: ${path.join(base, 'input')}`);
  console.log(`  音乐:     ${path.join(base, 'music')}`);
  console.log('\n运行演示:  node src/cli.js --input samples/input --music samples/music --output output --template family-moments');
}

main().catch((e) => {
  console.error('生成失败:', e.message);
  if (e.err) console.error(e.err.slice(-1500));
  process.exit(1);
});

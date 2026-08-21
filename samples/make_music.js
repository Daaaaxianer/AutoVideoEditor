'use strict';
/**
 * 生成"内置音乐库"（抖音/社媒风格占位曲库，可自行替换为有版权音乐）。
 * 输出到 ./music（默认音乐目录），文件名含情绪关键词，便于自动选曲匹配。
 * 用法: node samples/make_music.js
 */
const fs = require('fs');
const path = require('path');
const { FFMPEG, run, log } = require('../src/utils');

// 每个音轨：名称（含 mood 关键词）、根音、和弦进行（半音偏移）、bpm、风格参数
const TRACKS = [
  { name: '抖音热门_欢快卡点.m4a', root: 220, prog: [0, 5, 7, 5], bpm: 120, arp: true, beat: true, mood: 'happy' },
  { name: '治愈钢琴_舒缓.m4a', root: 196, prog: [0, -2, 3, 5], bpm: 70, arp: false, beat: false, mood: 'calm' },
  { name: '电子节拍_活力.m4a', root: 174.61, prog: [0, 3, 7, 10], bpm: 128, arp: true, beat: true, mood: 'dance' },
  { name: '国风古韵_温婉.m4a', root: 220, prog: [0, 2, 5, 7], bpm: 72, arp: true, beat: false, mood: 'retro' },
  { name: '轻快律动_清新.m4a', root: 246.94, prog: [0, 4, 5, 9], bpm: 96, arp: true, beat: true, mood: 'fresh' },
  { name: '大气史诗_大气.m4a', root: 164.81, prog: [0, -4, 5, 7], bpm: 66, arp: false, beat: false, mood: 'epic' },
  { name: '温馨家庭_温暖.m4a', root: 220, prog: [0, 5, 9, 4], bpm: 84, arp: false, beat: false, mood: 'warm' },
  { name: '复古迪斯科_复古.m4a', root: 185, prog: [0, 5, 7, 2], bpm: 112, arp: true, beat: true, mood: 'retro' },
  { name: '甜美可可爱爱_可爱.m4a', root: 293.66, prog: [0, 4, 9, 5], bpm: 100, arp: true, beat: true, mood: 'sweet' },
  { name: '金色黄昏_金色.m4a', root: 220, prog: [0, 3, 8, 10], bpm: 80, arp: true, beat: false, mood: 'golden' },
];

function esc(s) {
  // 只转义裸逗号（前面已有反斜杠的 \, 保持原样，避免二次转义）
  return String(s).replace(/,/g, (m, off) => (off > 0 && s[off - 1] === '\\' ? m : '\\,'));
}

function chordFreq(root, step, t) {
  // 每 4 秒一个和弦
  const semis = `(${step})`;
  return `${root}*pow(2\\,${semis}/12)*pow(2\\,mod(floor(t/4)\\,4)*0/12)`;
}

function padExpr(track) {
  // 三音叠加和弦垫底（根音/大三度/纯五度）
  const f0 = `${track.root}*pow(2\\,mod(floor(t/4)\\,${track.prog.length})*0/12+${track.prog[0]}/12)`;
  // 直接按进行索引：每 4s 换和弦
  const step = `mod(floor(t/4)\\,${track.prog.length})`;
  const progIdx = `${track.prog.join('\\,')}`;
  // 用 if 链选根音半音
  let sel = '';
  for (let i = 0; i < track.prog.length; i++) {
    const cond = i === 0 ? `lt(${step}\\,0.5)` : `gte(${step}\\,${i - 0.5})*lt(${step}\\,${i + 0.5})`;
    sel += `${i === 0 ? '' : '+'}${cond}*${track.prog[i]}`;
  }
  const rootHz = `${track.root}*pow(2\\,(${sel})/12)`;
  const m3 = `${rootHz}*pow(2\\,4/12)`;
  const p5 = `${rootHz}*pow(2\\,7/12)`;
  return `0.16*sin(2*PI*${rootHz}*t)+0.12*sin(2*PI*${m3}*t)+0.09*sin(2*PI*${p5}*t)`;
}

function arpExpr(track) {
  // 八分音符琶音（和弦音轮流）
  const step = `mod(floor(t/4)\\,${track.prog.length})`;
  let sel = '';
  for (let i = 0; i < track.prog.length; i++) {
    sel += `${i === 0 ? '' : '+'}${i === 0 ? `lt(${step}\\,0.5)` : `gte(${step}\\,${i - 0.5})*lt(${step}\\,${i + 0.5})`}*${track.prog[i]}`;
  }
  const note = `${track.root}*pow(2\\,(${sel})/12)`;
  const grid = `mod(t\\,${60 / track.bpm / 2})`;
  const arpN = `pow(2\\,mod(floor(t/${60 / track.bpm / 2})\\,4)*2/12)`;
  return `0.10*sin(2*PI*${note}*${arpN}*t)*exp(-6*${grid})`;
}

function beatExpr(track) {
  const beat = 60 / track.bpm;
  // 底鼓：每拍一个音高下坠短音
  const kick = `if(lt(mod(t\\,${beat})\\,${(beat * 0.35).toFixed(3)})\\,0.7*sin(2*PI*(${track.root / 2}+80*(1-mod(t\\,${beat})/${(beat * 0.35).toFixed(3)}))*t)\\,0)`;
  return kick;
}

function hatArgs(track) {
  const beat = 60 / track.bpm;
  const dur = 40;
  return [
    '-f', 'lavfi', '-i', `anoisesrc=color=white:duration=${dur}:sample_rate=44100`,
    '-af',
    `highpass=f=6000,volume='if(lt(mod(t\\,${beat / 2})\\,${(beat * 0.12).toFixed(3)})\\,0.12\\,0)':eval=frame,afade=t=out:st=${dur - 3}:d=3`,
  ];
}

async function makeTrack(track, dir) {
  const dur = 40;
  const build = (withArp, withBeat) => {
    const parts = [padExpr(track)];
    if (withArp) parts.push(arpExpr(track));
    if (withBeat) parts.push(beatExpr(track));
    return parts.join('+');
  };
  const inputs = (expr, withBeat) => {
    const args = ['-v', 'error', '-y', '-f', 'lavfi', '-i', `aevalsrc=${esc(expr)}:s=44100:d=${dur}`];
    if (withBeat) args.push(...hatArgs(track));
    return args;
  };
  const fin = (args, withBeat) => {
    if (withBeat) {
      args.push('-filter_complex', '[0:a][1:a]amix=inputs=2:duration=first:normalize=0[out]');
      args.push('-map', '[out]');
    }
    args.push('-af', `volume=0.9,lowpass=f=5200,afade=t=in:st=0:d=2,afade=t=out:st=${dur - 3}:d=3`,
      '-ac', '2', '-c:a', 'aac', '-b:a', '160k', path.join(dir, track.name));
    return args;
  };
  try {
    await run(FFMPEG, fin(inputs(build(true, !!track.beat), !!track.beat), !!track.beat));
  } catch (e) {
    // 降级：去掉琶音层重试
    try {
      await run(FFMPEG, fin(inputs(build(false, !!track.beat), !!track.beat), !!track.beat));
    } catch (e2) {
      // 再降级：纯垫底
      await run(FFMPEG, fin(inputs(build(false, false), false), false));
    }
  }
  log('music', `生成 ${track.name}`);
}

async function main() {
  const base = path.resolve(__dirname, '..', 'music');
  fs.mkdirSync(base, { recursive: true });
  for (const t of TRACKS) {
    try {
      await makeTrack(t, base);
    } catch (e) {
      log('music', `失败 ${t.name}: ${e.message}`);
    }
  }
  console.log(`\n内置音乐库已生成到: ${base}`);
  console.log('（这些为本地生成的无版权占位曲，正式发布请替换为有授权音乐）');
}

main().catch((e) => {
  console.error('生成失败:', e.message);
  if (e.err) console.error(e.err.slice(-1500));
  process.exit(1);
});

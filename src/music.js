'use strict';
/**
 * 音乐自动选择：mood 关键词匹配 + 时长匹配 + 响度过滤。
 * 无音乐时可用 aevalsrc 生成氛围垫底音轨（占位/兜底）。
 */
const { FFMPEG, FFPROBE, run, parseDuration, log } = require('./utils');
const { scanMusic } = require('./scanner');

/** mood → 关键词（匹配文件名，忽略大小写）。 */
const MOOD_KEYWORDS = {
  warm: ['warm', '温暖', '温馨', '爱', 'love', '家', 'home', '幸福', 'happiness', 'family'],
  happy: ['happy', '欢快', '快乐', '活力', '卡点', '抖音', '快手', '热门', 'energetic', 'party', 'fun', '阳光', 'sunny', 'cheerful', 'upbeat', 'viral'],
  calm: ['calm', '宁静', '舒缓', '钢琴', 'piano', 'soft', '安静', '温柔', 'peace', 'relax', '轻音乐'],
  epic: ['epic', '大气', '震撼', '磅礴', 'cinematic', '史诗', 'heroic', 'grand'],
  retro: ['retro', '复古', '爵士', 'jazz', '老歌', 'vintage', 'swing', 'classic'],
  sweet: ['sweet', '甜', '宝宝', 'baby', '童年', '天真', 'cute', '可爱'],
  fresh: ['fresh', '清新', '旅行', 'travel', '轻快', 'bright', '清新'],
  golden: ['golden', '黄昏', '秋', 'autumn', '夕阳', 'sunset', 'amber'],
  dance: ['dance', '舞曲', '电子', 'edm', '节奏', 'beat'],
};

/** 探测纯音频文件时长。 */
async function probeAudioDuration(file) {
  try {
    const { out } = await run(FFPROBE, [
      '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file,
    ]);
    const j = JSON.parse(out);
    const as = (j.streams || []).find((s) => s.codec_type === 'audio');
    if (!as) return 0;
    return parseDuration((j.format || {}).duration || as.duration);
  } catch (_) {
    return 0;
  }
}

/**
 * 自动选曲。
 * @param {string} musicDir
 * @param {object} o { mood, targetDuration, seed }
 * @returns {Promise<{file,name,duration,score}|null>}
 */
async function autoPick(musicDir, { mood = 'warm', targetDuration = 30 } = {}) {
  const tracks = scanMusic(musicDir);
  if (!tracks.length) return null;
  const keys = MOOD_KEYWORDS[mood] || MOOD_KEYWORDS.warm;
  const scored = [];
  for (const t of tracks) {
    const name = t.name.toLowerCase();
    let kw = 0;
    for (const k of keys) if (name.includes(k.toLowerCase())) kw += 1;
    const dur = await probeAudioDuration(t.file);
    let durScore = 0;
    if (dur > 0) {
      const ratio = dur / Math.max(1, targetDuration);
      if (ratio >= 0.7 && ratio <= 2.5) durScore = 12 - Math.abs(ratio - 1) * 10;
      else if (ratio < 0.7) durScore = -4; // 太短，循环次数多
      else durScore = 6; // 较长曲目会被自动截取/循环，给予基础分
    }
    // 内置真实曲库（"内置_" 前缀）优先
    const builtin = name.includes('内置') ? 20 : 0;
    const score = kw * 20 + durScore + builtin;
    scored.push({ file: t.file, name: t.name, duration: dur, score });
  }
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const best = scored[0];
  log('music', `自动选曲: ${best.name} (score=${best.score}, 时长 ${best.duration.toFixed(1)}s, mood=${mood})`);
  return best;
}

/** 选指定文件。 */
async function pickFile(file) {
  const dur = await probeAudioDuration(file);
  return { file, name: file.split(/[\\/]/).pop(), duration: dur, score: 999 };
}

/**
 * 生成氛围垫底音轨（占位）：A 大调和弦琶音 + 低频。
 * @returns {Promise<string>} wav 文件路径
 */
async function generateAmbientBed({ duration = 30, outFile, mood = 'warm' } = {}) {
  const os = require('os');
  const path = require('path');
  const fs = require('fs');
  const out = outFile || path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aved-bed-')), 'bed.wav');
  // 不同 mood 用不同和弦根音
  const base = { warm: 220, calm: 196, happy: 261.63, epic: 174.61, sweet: 293.66, retro: 246.94 }[mood] || 220;
  const m3 = base * Math.pow(2, 4 / 12); // 大三度
  const p5 = base * 1.5;
  const expr =
    `0.22*sin(2*PI*${base}*t)+0.16*sin(2*PI*${m3}*t)+0.11*sin(2*PI*${p5}*t)` +
    `+0.05*sin(2*PI*${base * 2}*t)*sin(2*PI*0.25*t)`;
  const args = [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', `aevalsrc=${expr}:s=44100:d=${duration}`,
    '-af', 'tremolo=f=0.25:d=0.7,lowpass=f=3200,volume=0.7,afade=t=in:st=0:d=2,afade=t=out:st=' + Math.max(0, duration - 3) + ':d=3',
    '-ac', '2',
    '-c:a', 'pcm_s16le', out,
  ];
  try {
    await run(FFMPEG, args);
    log('music', `已生成氛围垫底音轨 ${duration}s (mood=${mood})`);
    return out;
  } catch (e) {
    throw new Error(`生成垫底音轨失败: ${e.message}`);
  }
}

module.exports = { autoPick, pickFile, probeAudioDuration, generateAmbientBed, MOOD_KEYWORDS };

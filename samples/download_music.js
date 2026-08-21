'use strict';
/**
 * 下载内置背景音乐（抖音/快手热门风格）到 ./music：
 * 曲目来自 incompetech（Kevin MacLeod，CC-BY 4.0，需署名，见 music/版权说明.txt）。
 * 文件名含情绪关键词，供自动选曲匹配。下载失败自动跳过，不影响其它曲目。
 * 用法: node samples/download_music.js
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawnSync } = require('child_process');
const { FFPROBE, runSync, log } = require('../src/utils');

const BASE = 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/';

// [源文件名, 本地文件名（"内置_"前缀=官方内置真实曲库，含 mood 关键词）]
const TRACKS = [
  ['Carefree.mp3', '内置_抖音热门_尤克里里欢快卡点.mp3'],
  ['Monkeys Spinning Monkeys.mp3', '内置_抖音_猴子可爱搞怪甜.mp3'],
  ['Sunshine Samba.mp3', '内置_抖音_阳光桑巴清新.mp3'],
  ['Happy Alley.mp3', '内置_快手_木吉他温馨温暖家.mp3'],
  ['Life of Riley.mp3', '内置_治愈_吉他宁静舒缓.mp3'],
  ['Bossa Antigua.mp3', '内置_旅行_波萨诺瓦轻快清新.mp3'],
  ['Inspired.mp3', '内置_大气_史诗氛围.mp3'],
  ['Cipher.mp3', '内置_电子_节奏暗调.mp3'],
  ['Wallpaper.mp3', '内置_氛围_宁静远景.mp3'],
  // 第二批：更多抖音/快手热门风格
  ['Sneaky Snitch.mp3', '内置_抖音_搞怪趣味.mp3'],
  ['Fluffing a Duck.mp3', '内置_抖音_可爱轻快.mp3'],
  ['Scheming Weasel faster.mp3', '内置_抖音_古灵精怪可爱.mp3'],
  ['Mr. Peppy.mp3', '内置_抖音_欢快活力.mp3'],
  ['Bumbly March.mp3', '内置_快手_呆萌喜感.mp3'],
  ['Funk Game Loop.mp3', '内置_电子_放克节奏.mp3'],
  ['Voxel Revolution.mp3', '内置_电子_像素动感.mp3'],
  ['The Curtain Rises.mp3', '内置_大气_序幕激昂.mp3'],
  ['Acoustic Breeze.mp3', '内置_清新_木吉他微风.mp3'],
  ['Wholesome.mp3', '内置_治愈_温暖阳光.mp3'],
  ['Happy Bee.mp3', '内置_可爱_蜜蜂嗡嗡.mp3'],
  ['Sweeter Verification.mp3', '内置_复古_俏皮摇摆.mp3'],
  ['Lobby Time.mp3', '内置_宁静_大堂轻音乐.mp3'],
  ['Mining by Moonlight.mp3', '内置_宁静_星空漫游.mp3'],
  ['The Builder.mp3', '内置_清新_手作轻快.mp3'],
  ['Blippy Trance.mp3', '内置_电子_迷幻节奏.mp3'],
  ['Gingerbread Happy Time.mp3', '内置_可爱_姜饼快乐.mp3'],
  ['Marty Gots a Plan.mp3', '内置_快手_计划进行中.mp3'],
];

/** 用 curl 下载（Windows 自带；失败回退 Node https）。 */
function download(url, dest, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const curl = spawnSync('curl.exe', ['-sL', '--max-time', String(Math.floor(timeoutMs / 1000)), '-o', dest, url], {
      timeout: timeoutMs + 15000,
      windowsHide: true,
      encoding: 'utf8',
    });
    if (curl.status === 0 && fs.existsSync(dest) && fs.statSync(dest).size > 0) return resolve(true);
    // 回退：Node https
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return resolve(false);
      }
      const ws = fs.createWriteStream(dest);
      res.pipe(ws);
      ws.on('finish', () => ws.close(() => resolve(true)));
      ws.on('error', () => resolve(false));
      res.on('error', () => resolve(false));
    });
    req.on('error', () => resolve(false));
    req.setTimeout(timeoutMs, () => req.destroy());
  });
}

function durationOk(file, minSec = 20) {
  try {
    const r = runSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { timeout: 20000 });
    return parseFloat(r.stdout) >= minSec;
  } catch (_) {
    return false;
  }
}

async function main() {
  const dir = path.resolve(__dirname, '..', 'music');
  fs.mkdirSync(dir, { recursive: true });
  let ok = 0;
  let fail = 0;
  const seen = new Set();
  for (const [src, name] of TRACKS) {
    if (seen.has(src)) continue;
    seen.add(src);
    const tmp = path.join(dir, '.dl_tmp.mp3');
    const dest = path.join(dir, name);
    if (fs.existsSync(dest)) { ok++; log('music', `已存在 ${name}`); continue; }
    log('music', `下载 ${src} → ${name}`);
    const got = await download(BASE + encodeURIComponent(src), tmp);
    if (!got || !fs.existsSync(tmp) || fs.statSync(tmp).size < 300000 || !durationOk(tmp)) {
      fail++;
      log('music', `跳过 ${src}（下载失败或时长不足）`);
      try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
      continue;
    }
    fs.renameSync(tmp, dest);
    ok++;
    log('music', `完成 ${name}`);
  }
  // 版权说明
  const att = path.join(dir, '版权说明.txt');
  if (!fs.existsSync(att)) {
    fs.writeFileSync(att,
      '本目录内置背景音乐（抖音/快手热门风格）来源与版权：\n' +
      '  - 由 Kevin MacLeod (incompetech.com) 创作，CC-BY 4.0 许可\n' +
      '  - 许可要求署名：Kevin MacLeod (incompetech.com) - CC-BY 4.0\n' +
      '  - 曲目链接: https://incompetech.com/music/royalty-free/mp3-royaltyfree/\n' +
      '  - 若商用或正式发布，请保留署名或在片尾致谢；亦可删除后放入自有授权音乐。\n', 'utf8');
  }
  console.log(`\n内置音乐下载完成: 成功 ${ok} 首，跳过 ${fail} 首 → ${dir}`);
}

main().catch((e) => { console.error('下载失败:', e.message); process.exit(1); });

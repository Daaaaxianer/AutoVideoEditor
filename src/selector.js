'use strict';
/**
 * 自动选片引擎：
 *  1. 质量分过滤（模糊/过暗/损坏的素材剔除）
 *  2. 时间覆盖（按天分组，保证不同日期都有素材入选）
 *  3. MMR 多样性贪心（质量 + 色彩差异度 + 画幅匹配）
 *  4. 近重复抑制（平均颜色距离过近的素材降权）
 */
const { log } = require('./utils');

/** RGB 欧氏距离（0-255 空间）。 */
function colorDist(a, b) {
  if (!a || !b) return 255;
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

function dayLabel(mtime) {
  const d = new Date(mtime);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDate(mtime, withTime = false) {
  const d = new Date(mtime);
  const base = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (!withTime) return base;
  return `${base} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * 通用贪心选择。
 * @param {Array} items 已分析素材
 * @param {number} need 需要数量
 * @param {object} opts { targetAspect, seed, minScore, perDayCap, dupThresh, lambda }
 * @param {Function} scoreFn 附加打分 (item, chosen) => number
 */
function greedySelect(items, need, opts = {}, scoreFn = null) {
  const {
    targetAspect = 1,
    seed = 0,
    minScore = 25,
    perDayCap = 4,
    dupThresh = 16,
    lambda = 16,
    aspectWeight = 14,
  } = opts;
  if (need <= 0 || !items.length) return [];

  const pool = items
    .filter((it) => it.score >= minScore)
    .map((it) => ({ it, day: dayLabel(it.mtime) }))
    .sort((a, b) => (seed ? Math.random() - 0.5 : 0) || b.it.score - a.it.score);

  if (!pool.length) {
    // 质量分普遍过低时放宽阈值
    const relaxed = items
      .map((it) => ({ it, day: dayLabel(it.mtime) }))
      .sort((a, b) => b.it.score - a.it.score);
    return relaxed.slice(0, need);
  }

  const chosen = [];
  const dayCounts = new Map();
  const dayTotal = new Set(pool.map((p) => p.day)).size;
  const cap = Math.max(perDayCap, Math.ceil((need / Math.max(1, dayTotal)) * 1.6));

  while (chosen.length < need && pool.length) {
    let bestIdx = -1;
    let bestVal = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const { it, day } = pool[i];
      const cnt = dayCounts.get(day) || 0;
      let v = it.score;
      // 画幅匹配：越接近目标画幅越好
      const ratioDist = Math.abs(Math.log((it.aspect || 1) / targetAspect));
      v -= ratioDist * aspectWeight;
      // 人脸优先：有脸（尤其多人）的照片加分
      if (opts.faceWeight && it.face && it.face.count) {
        v += opts.faceWeight * Math.min(22, 10 + (it.face.count - 1) * 5);
      }
      // 每日期限
      if (cnt >= cap) v -= 40;
      // 多样性：与已选集合的最小色彩距离
      if (chosen.length) {
        let minD = Infinity;
        for (const c of chosen) minD = Math.min(minD, colorDist(it.color, c.color));
        v += lambda * Math.min(1, minD / 60);
        // 近重复抑制
        if (minD < dupThresh && chosen.length >= Math.min(need, 6)) v -= 25;
      }
      if (scoreFn) v += scoreFn(it, chosen);
      if (v > bestVal) {
        bestVal = v;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;
    const pick = pool.splice(bestIdx, 1)[0];
    chosen.push(pick.it);
    dayCounts.set(pick.day, (dayCounts.get(pick.day) || 0) + 1);
  }
  return chosen;
}

/**
 * 自动选择照片。
 * @returns {Array} 选中照片（按 mtime 排序）
 */
function selectPhotos(items, need, opts = {}) {
  if (need <= 0) return [];
  const sel = greedySelect(items, need, opts);
  sel.sort((a, b) => a.mtime - b.mtime);
  log('select', `照片: 需要 ${need}, 选中 ${sel.length}`);
  return sel;
}

/**
 * 自动选择视频片段。
 * @param {number} minDur 最短时长（秒）
 * @param {number} maxDur 最长时长（秒）
 */
function selectVideos(items, need, { minDur = 2, maxDur = 15, ...rest } = {}) {
  if (need <= 0) return [];
  const ok = items.filter((it) => {
    if (!it.duration) return false;
    if (it.duration < minDur * 0.8) return false;
    if (it.duration > maxDur * 2.5) return false;
    return true;
  });
  const sel = greedySelect(ok, need, { minScore: 20, ...rest });
  sel.sort((a, b) => a.mtime - b.mtime);
  log('select', `视频: 需要 ${need}, 候选 ${ok.length}, 选中 ${sel.length}`);
  return sel;
}

module.exports = { selectPhotos, selectVideos, colorDist, dayLabel, fmtDate };

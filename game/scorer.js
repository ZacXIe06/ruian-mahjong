'use strict';

const { getSuit, isHonor, isBai, isFlower } = require('./tiles');
const { tileIdx, TOTAL, isWinningHand, canFormSets } = require('./win-check');

const PINGYANG_QIFAN = 13;
const PINGYANG_DOUBLE_THRESHOLD = 30;
const FLOWER_GROUPS = [
  ['chun', 'xia', 'qiu', 'dong'],
  ['mei', 'lan', 'zhu', 'ju'],
];

function getCaijinSet(caijinTile, ctx = {}) {
  if (Array.isArray(ctx.caijinTiles) && ctx.caijinTiles.length) return new Set(ctx.caijinTiles);
  return new Set(caijinTile ? [caijinTile] : []);
}

function isPingyang(ctx = {}) {
  return ctx.ruleset === 'pingyang_taipao';
}

function baiActsAsFace(caijinTile, ctx = {}) {
  return !isPingyang(ctx) && !!caijinTile;
}

function isWildcardTile(tile, caijinTile, ctx = {}) {
  return getCaijinSet(caijinTile, ctx).has(tile);
}

function asFaceTile(tile, caijinTile, ctx = {}) {
  return isBai(tile) && baiActsAsFace(caijinTile, ctx) ? caijinTile : tile;
}

function canFormTripletsOnly(counts, wildcards, setsLeft) {
  if (setsLeft === 0) return Object.values(counts).every(c => c === 0) && wildcards === 0;
  const first = Object.entries(counts).find(([, c]) => c > 0);
  if (!first) return wildcards === setsLeft * 3;
  const [key] = first;
  const c = counts[key];
  const tryWith = (remove, wild) => {
    counts[key] -= remove;
    const ok = canFormTripletsOnly(counts, wildcards - wild, setsLeft - 1);
    counts[key] += remove;
    return ok;
  };
  if (c >= 3 && tryWith(3, 0)) return true;
  if (c >= 2 && wildcards >= 1 && tryWith(2, 1)) return true;
  if (c >= 1 && wildcards >= 2 && tryWith(1, 2)) return true;
  return false;
}

function detectPengPengHu(concealed, openMelds, caijinTile, ctx = {}) {
  if (openMelds.some(m => m.type === 'chi')) return false;
  const counts = {};
  let wilds = 0;
  for (const t of concealed) {
    if (isWildcardTile(t, caijinTile, ctx)) { wilds += 1; continue; }
    const k = asFaceTile(t, caijinTile, ctx);
    counts[k] = (counts[k] || 0) + 1;
  }
  const setsNeeded = 5 - openMelds.length;
  for (const [k, c] of Object.entries(counts)) {
    if (c >= 2) {
      const cc = { ...counts };
      cc[k] -= 2;
      if (!cc[k]) delete cc[k];
      if (canFormTripletsOnly({ ...cc }, wilds, setsNeeded)) return true;
    }
    if (c >= 1 && wilds >= 1) {
      const cc = { ...counts };
      cc[k] -= 1;
      if (!cc[k]) delete cc[k];
      if (canFormTripletsOnly({ ...cc }, wilds - 1, setsNeeded)) return true;
    }
  }
  return wilds >= 2 && canFormTripletsOnly({ ...counts }, wilds - 2, setsNeeded);
}

function detect8DuiWithUsage(concealed, openMelds, caijinTile, normalCaijinCount, ctx = {}) {
  if (openMelds.length > 0) return false;
  const counts = {};
  let actualCaijin = 0;
  for (const t of concealed) {
    if (isWildcardTile(t, caijinTile, ctx)) { actualCaijin += 1; continue; }
    const k = asFaceTile(t, caijinTile, ctx);
    counts[k] = (counts[k] || 0) + 1;
  }
  if (normalCaijinCount > actualCaijin) return false;
  if (normalCaijinCount > 0) counts[caijinTile] = (counts[caijinTile] || 0) + normalCaijinCount;
  const wilds = actualCaijin - normalCaijinCount;
  const total = Object.values(counts).reduce((sum, c) => sum + c, 0) + wilds;
  if (total !== 16 && total !== 17) return false;

  const canFormPairs = (pairCounts, pairWilds) => {
    let odd = 0;
    for (const c of Object.values(pairCounts)) odd += c % 2;
    return odd <= pairWilds && (pairWilds - odd) % 2 === 0;
  };

  if (total % 2 === 0) return canFormPairs(counts, wilds);
  for (const k of Object.keys(counts)) {
    if (counts[k] <= 0) continue;
    counts[k] -= 1;
    const ok = canFormPairs(counts, wilds);
    counts[k] += 1;
    if (ok) return true;
  }
  return wilds > 0 && canFormPairs(counts, wilds - 1);
}

function detect8Dui(concealed, openMelds, caijinTile, ctx = {}) {
  const actualCaijin = concealed.filter(t => isWildcardTile(t, caijinTile, ctx)).length;
  for (let n = actualCaijin; n >= 0; n--) {
    if (detect8DuiWithUsage(concealed, openMelds, caijinTile, n, ctx)) return true;
  }
  return false;
}

function detectQuanqiushen(concealed, openMelds) {
  const openTiles = openMelds.reduce((s, m) => s + m.tiles.length, 0);
  return openTiles >= 12 && concealed.length <= 2 && openMelds.some(m => m.type === 'chi' || m.type === 'peng' || m.type === 'gang');
}

function detectQing(allTiles, caijinTile, ctx = {}) {
  const normal = allTiles.filter(t => !isWildcardTile(t, caijinTile, ctx)).map(t => asFaceTile(t, caijinTile, ctx));
  if (normal.length === 0) return null;
  const hasHonor = normal.some(t => isHonor(t) || isBai(t));
  const suited = normal.filter(t => !isHonor(t) && !isBai(t));
  if (!hasHonor && suited.length > 0) {
    const suits = new Set(suited.map(t => getSuit(t)));
    if (suits.size === 1) return 'qingyise';
  }
  if (hasHonor && suited.length > 0) {
    const suits = new Set(suited.map(t => getSuit(t)));
    if (suits.size === 1) return 'banqing';
  }
  return null;
}

function canWinWithCaijinUsage(concealed, openMelds, caijinTile, normalCaijinCount, ctx = {}) {
  const allTiles = [...concealed, ...openMelds.flatMap(m => m.tiles)];
  const actualCaijin = allTiles.filter(t => isWildcardTile(t, caijinTile, ctx)).length;
  if (normalCaijinCount > actualCaijin) return false;
  const counts = new Array(TOTAL).fill(0);
  const wildcards = actualCaijin - normalCaijinCount;
  for (const t of allTiles) {
    if (isWildcardTile(t, caijinTile, ctx)) continue;
    const idx = tileIdx(asFaceTile(t, caijinTile, ctx));
    if (idx >= 0) counts[idx] += 1;
  }
  if (normalCaijinCount > 0) counts[tileIdx(caijinTile)] += normalCaijinCount;
  return isWinningHand(counts, wildcards);
}

function maxCaijinGuiCount(concealed, openMelds, caijinTile, ctx = {}) {
  const allTiles = [...concealed, ...openMelds.flatMap(m => m.tiles)];
  const actualCaijin = allTiles.filter(t => isWildcardTile(t, caijinTile, ctx)).length;
  for (let n = actualCaijin; n >= 1; n--) {
    if (canWinWithCaijinUsage(concealed, openMelds, caijinTile, n, ctx)) return n;
    if (detect8DuiWithUsage(concealed, openMelds, caijinTile, n, ctx)) return n;
  }
  return 0;
}

function detectCaijinGui(concealed, openMelds, caijinTile, wildcardCount, ctx = {}) {
  return maxCaijinGuiCount(concealed, openMelds, caijinTile, ctx) >= Math.min(1, wildcardCount);
}

function getRuianHandType(concealed, openMelds, caijinTile, ctx) {
  const allTiles = [...concealed, ...openMelds.flatMap(m => m.tiles)];
  const wildcards = allTiles.filter(t => isWildcardTile(t, caijinTile, ctx)).length;
  const guiCount = maxCaijinGuiCount(concealed, openMelds, caijinTile, ctx);
  const isPengPeng = detectPengPengHu(concealed, openMelds, caijinTile, ctx);
  const is8Dui = detect8Dui(concealed, openMelds, caijinTile, ctx);
  const isHard8Dui = is8Dui && (wildcards === 0 || guiCount >= 1);
  const qing = detectQing(allTiles, caijinTile, ctx);
  const isQuanqiushen = detectQuanqiushen(concealed, openMelds);

  if (ctx.isTianHu) return { type: '天胡', mult: 4 };
  if (ctx.isDiHu) return { type: '地胡', mult: 4 };
  if (wildcards >= 3 && ctx.isStandardWin) return { type: '三财神胡', mult: 4 };
  if (qing === 'qingyise') return { type: '清一色', mult: 4 };
  if (qing === 'banqing') return { type: '半清', mult: 4 };
  if (wildcards === 0 && isPengPeng) return { type: '无财碰碰胡', mult: 4 };
  if (isHard8Dui) return { type: '硬8对', mult: 4 };
  if (ctx.isGangWin) return { type: '杠上开花', mult: 4 };
  if (isQuanqiushen) return { type: '全球神', mult: 4 };
  if (wildcards >= 2 && guiCount >= 2) return { type: '双财神归位', mult: 4 };

  if (wildcards >= 3) return { type: '三财神推倒', mult: 2 };
  if (wildcards === 0) return ctx.isSelfDraw
    ? { type: '平胡自摸', mult: 1 }
    : { type: '无财神', mult: 1 };
  if (guiCount >= 1) return { type: '财神归位', mult: 2 };
  if (ctx.isQiangGang) return { type: '抢杠胡', mult: 2 };
  if (wildcards > 0 && is8Dui) return { type: '软8对', mult: 2 };
  if (wildcards > 0 && isPengPeng) return { type: '有财碰碰胡', mult: 2 };
  if (ctx.isPaoma) return { type: '跑马', mult: 2 };

  return { type: '软牌', mult: 1 };
}

function pushTai(details, label, tai, meta = {}) {
  if (!tai) return;
  details.push({ label, tai, ...meta });
}

function flowerGroupTai(count) {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 3;
  if (count === 3) return 5;
  return 10;
}

function isSeatWindOrDragon(tile, seatWind) {
  return tile === seatWind || tile === 'zhong' || tile === 'fa';
}

function getAllTiles(concealed, openMelds) {
  return [...concealed, ...openMelds.flatMap(m => m.tiles)];
}

function countTile(allTiles, tile) {
  return allTiles.filter(t => t === tile).length;
}

function buildWinningConcealed(concealed, ctx = {}) {
  if (ctx.isSelfDraw || !ctx.winTile) return [...concealed];
  return [...concealed, ctx.winTile];
}

function detectCaishenHui(concealed, openMelds, caijinTile, ctx = {}) {
  const allTiles = getAllTiles(concealed, openMelds);
  const wildcardCount = allTiles.filter(t => isWildcardTile(t, caijinTile, ctx)).length;
  return wildcardCount >= 3 && canWinWithCaijinUsage(concealed, openMelds, caijinTile, 3, ctx);
}

function detectSingleWait(concealed, openMelds, caijinTile, ctx = {}) {
  const winningConcealed = buildWinningConcealed(concealed, ctx);
  if (!winningConcealed.length) return false;
  const winTile = ctx.winTile || winningConcealed[winningConcealed.length - 1];
  if (!winTile) return false;
  const tileCount = winningConcealed.filter(t => t === winTile).length;
  if (tileCount < 2) return false;

  const stripped = [...winningConcealed];
  const first = stripped.indexOf(winTile);
  if (first === -1) return false;
  stripped.splice(first, 1);
  const second = stripped.indexOf(winTile);
  if (second === -1) return false;
  stripped.splice(second, 1);

  const counts = new Array(TOTAL).fill(0);
  let wildcards = 0;
  for (const tile of stripped) {
    if (isWildcardTile(tile, caijinTile, ctx)) wildcards += 1;
    else {
      const idx = tileIdx(asFaceTile(tile, caijinTile, ctx));
      if (idx >= 0) counts[idx] += 1;
    }
  }
  return canFormSets(counts, wildcards, 5 - openMelds.length);
}

function detectPingyangPatterns(concealed, openMelds, caijinTile, ctx = {}) {
  const allTiles = getAllTiles(concealed, openMelds);
  const caijinTiles = [...getCaijinSet(caijinTile, ctx)];
  const wildcardCount = allTiles.filter(t => isWildcardTile(t, caijinTile, ctx)).length;
  const qing = detectQing(allTiles, caijinTile, ctx);
  const pengpeng = detectPengPengHu(concealed, openMelds, caijinTile, ctx);
  const hard8Dui = detect8Dui(concealed, openMelds, caijinTile, ctx) && wildcardCount === 0;
  const caishenHui = detectCaishenHui(concealed, openMelds, caijinTile, ctx);
  const singleWait = detectSingleWait(concealed, openMelds, caijinTile, ctx);
  const fourWinds = ['east', 'south', 'west', 'north'].every(tile => countTile(allTiles, tile) > 0);
  const menqing = wildcardCount === 0 && (ctx.flowers?.length || 0) === 0 && openMelds.length === 0;
  const hardPai = wildcardCount === 0;
  const flowerHu = (ctx.flowers?.length || 0) === 8;
  const sameCaijinReveal = isPingyang(ctx) && Array.isArray(ctx.caijinTiles) && ctx.caijinTiles.length === 1;
  const caijinCounts = {};
  for (const tile of caijinTiles) caijinCounts[tile] = countTile(allTiles, tile);
  const killPig = wildcardCount >= 4 && (sameCaijinReveal
    ? Object.values(caijinCounts).some(count => count >= 2)
    : Object.values(caijinCounts).some(count => count >= 3));

  return {
    wildcardCount,
    qing,
    pengpeng,
    hard8Dui,
    caishenHui,
    singleWait,
    fourWinds,
    menqing,
    hardPai,
    flowerHu,
    sameCaijinReveal,
    caijinCounts,
    killPig,
  };
}

function calcFlowerTai(flowers = []) {
  const details = [];
  if (!flowers.length) return details;
  const grouped = FLOWER_GROUPS.map(group => flowers.filter(tile => group.includes(tile)));
  for (const groupTiles of grouped) {
    if (!groupTiles.length) continue;
    pushTai(details, `花牌${groupTiles.join(' ')}`, flowerGroupTai(groupTiles.length));
  }
  return details;
}

function calcBaiTai(allTiles, ctx = {}) {
  const count = (ctx.baiCount || 0) + allTiles.filter(isBai).length;
  if (!count) return [];
  return [{ label: `白板${count}张`, tai: flowerGroupTai(count) }];
}

function calcPingyangCaijinTai(allTiles, ctx = {}) {
  const details = [];
  const caijinTiles = Array.isArray(ctx.caijinTiles) ? ctx.caijinTiles : [];
  if (!caijinTiles.length) return details;
  const sameReveal = caijinTiles.length === 1;

  for (const tile of caijinTiles) {
    const count = countTile(allTiles, tile);
    if (!count) continue;
    if (sameReveal) {
      if (count >= 2) pushTai(details, '双翻同财神2张', 13, { qifan: true });
      else pushTai(details, '双翻同财神1张', 7);
      continue;
    }
    const honorLike = isHonor(tile) || isBai(tile) || isFlower(tile);
    if (count >= 3) pushTai(details, `${tile}财神3张`, honorLike ? 11 : 8);
    else if (count === 2) pushTai(details, `${tile}财神2张`, honorLike ? 7 : 5);
    else pushTai(details, `${tile}财神1张`, honorLike ? 3 : 2);
  }
  return details;
}

function calcPingyangGangTai(openMelds, seatWind) {
  const details = [];
  for (const meld of openMelds) {
    if (meld.type !== 'gang' && meld.type !== 'concealed_gang') continue;
    const tile = meld.tiles[0];
    const high = isSeatWindOrDragon(tile, seatWind);
    const tai = meld.type === 'concealed_gang'
      ? (high ? 5 : 4)
      : (high ? 4 : 3);
    pushTai(details, `${meld.type === 'concealed_gang' ? '暗杠' : '明杠'} ${tile}`, tai);
  }
  return details;
}

function calcPingyangHonorTripletTai(allTiles, openMelds, seatWind) {
  const details = [];
  const tracked = [seatWind, 'zhong', 'fa'];
  for (const tile of tracked) {
    const meldHit = openMelds.some(m => ['peng', 'gang', 'concealed_gang'].includes(m.type) && m.tiles[0] === tile);
    const count = countTile(allTiles, tile);
    if (meldHit || count >= 3) pushTai(details, `${tile}刻/碰`, 1);
  }
  return details;
}

function calcPingyangWinTai(concealed, openMelds, caijinTile, ctx = {}) {
  const allTiles = getAllTiles(concealed, openMelds);
  const details = [];
  const patterns = detectPingyangPatterns(concealed, openMelds, caijinTile, ctx);

  if (patterns.flowerHu) {
    pushTai(details, '花胡', 52, { qifan: true });
    return { type: '花胡', totalTai: 52, details, qifan: true, double: true };
  }

  details.push(...calcPingyangGangTai(openMelds, ctx.seatWind));
  details.push(...calcPingyangHonorTripletTai(allTiles, openMelds, ctx.seatWind));
  details.push(...calcPingyangCaijinTai(allTiles, ctx));
  details.push(...calcFlowerTai(ctx.flowers || []));
  details.push(...calcBaiTai(allTiles, ctx));

  if (ctx.isSelfDraw) pushTai(details, '自摸', 1);
  if (ctx.isGangWin) pushTai(details, '杠上开花', 2);
  if (ctx.isQiangGang) pushTai(details, '抢杠胡', 2);
  if (ctx.isLastTile) pushTai(details, '海底捞月', 1);
  if (patterns.caishenHui) pushTai(details, '财神汇', 7);
  if (patterns.singleWait) {
    const waitIsCaijin = ctx.winTile && isWildcardTile(ctx.winTile, caijinTile, ctx);
    pushTai(details, '单钓将', waitIsCaijin ? 7 : PINGYANG_QIFAN, { qifan: !waitIsCaijin });
  }
  if (patterns.qing === 'banqing') pushTai(details, '混一色', 7);
  if (patterns.pengpeng) pushTai(details, '对对胡', 7);
  if (patterns.hardPai) pushTai(details, '硬牌', PINGYANG_QIFAN, { qifan: true });
  if (patterns.qing === 'qingyise') pushTai(details, '清一色', PINGYANG_QIFAN, { qifan: true });
  if (patterns.fourWinds) pushTai(details, '四风齐', PINGYANG_QIFAN, { qifan: true });
  if (patterns.menqing) pushTai(details, '门清', PINGYANG_QIFAN, { qifan: true });
  if (ctx.isTianHu) pushTai(details, '天胡', PINGYANG_QIFAN, { qifan: true });
  if (ctx.isDiHu) pushTai(details, '地胡', PINGYANG_QIFAN, { qifan: true });
  if (patterns.hard8Dui) pushTai(details, '硬八对', PINGYANG_QIFAN, { qifan: true });
  if (patterns.killPig) {
    const base = patterns.wildcardCount >= 6 ? 50 : patterns.wildcardCount >= 5 ? 25 : 4;
    pushTai(details, '杀猪', base + PINGYANG_QIFAN, { qifan: true });
  }

  const totalTai = details.reduce((sum, item) => sum + item.tai, 0);
  const qifan = totalTai >= PINGYANG_QIFAN || details.some(item => item.qifan);
  const double = totalTai >= PINGYANG_DOUBLE_THRESHOLD;

  let primary = '平胡';
  if (patterns.flowerHu) primary = '花胡';
  else if (patterns.killPig) primary = '杀猪胡';
  else if (patterns.caishenHui) primary = '财神汇';
  else if (patterns.singleWait) primary = '单钓将';
  else if (patterns.qing === 'qingyise') primary = '清一色';
  else if (patterns.fourWinds) primary = '四风齐';
  else if (patterns.hard8Dui) primary = '硬八对';
  else if (patterns.pengpeng) primary = '对对胡';
  else if (patterns.qing === 'banqing') primary = '混一色';
  else if (ctx.isGangWin) primary = '杠上开花';
  else if (ctx.isQiangGang) primary = '抢杠胡';
  else if (ctx.isTianHu) primary = '天胡';
  else if (ctx.isDiHu) primary = '地胡';
  else if (ctx.isSelfDraw) primary = '自摸';

  return {
    type: primary,
    totalTai,
    taiDetails: details,
    qifan,
    double,
    multiplier: double ? 2 : 1,
  };
}

function calcWinScore(concealed, openMelds, caijinTile, ctx = {}) {
  if (isPingyang(ctx)) {
    const pingyang = calcPingyangWinTai(concealed, openMelds, caijinTile, ctx);
    return {
      type: pingyang.type,
      mult: pingyang.multiplier,
      totalTai: pingyang.totalTai,
      taiDetails: pingyang.taiDetails,
      qifan: pingyang.qifan,
      double: pingyang.double,
      qifanTai: PINGYANG_QIFAN,
      doubleThreshold: PINGYANG_DOUBLE_THRESHOLD,
      caijinFen: 0,
      dealerRate: 0,
      nondealerRate: 0,
      total: pingyang.totalTai,
      ruleset: 'pingyang_taipao',
    };
  }

  const allTiles = [...concealed, ...openMelds.flatMap(m => m.tiles)];
  const wildcards = allTiles.filter(t => isWildcardTile(t, caijinTile, ctx)).length;
  const { type, mult } = getRuianHandType(concealed, openMelds, caijinTile, { ...ctx, isStandardWin: true });
  return {
    type,
    mult,
    caijinFen: wildcards,
    dealerRate: mult + wildcards,
    nondealerRate: wildcards,
    total: mult + wildcards,
  };
}

function gangPoints(gangType) {
  return gangType === 'concealed_gang' ? 2 : 1;
}

module.exports = {
  calcWinScore,
  gangPoints,
  detectPengPengHu,
  detect8Dui,
  detectCaijinGui,
  calcPingyangWinTai,
};

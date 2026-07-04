'use strict';
const { isNumbered, isHonor, isWind, isYaojiu, isBai, isFlower, getSuit, getValue } = require('./tiles');

// Map tile string -> index (0-32)
// 0-8: 1m-9m, 9-17: 1t-9t, 18-26: 1b-9b
// 27:east 28:south 29:west 30:north 31:zhong 32:fa 33:bai
const HONOR_IDX = { east: 27, south: 28, west: 29, north: 30, zhong: 31, fa: 32, bai: 33 };
const TOTAL = 34;

function getCaijinSet(caijinTile, options = {}) {
  if (Array.isArray(options.caijinTiles) && options.caijinTiles.length) return new Set(options.caijinTiles);
  return new Set(caijinTile ? [caijinTile] : []);
}

function isRuianRuleset(options = {}) {
  return !options.ruleset || options.ruleset === 'ruian';
}

function isPingyangRuleset(options = {}) {
  return options.ruleset === 'pingyang_taipao';
}

function tileIdx(tile) {
  // Check honors FIRST — 'east'/'west' end with 't', would match tong otherwise
  if (HONOR_IDX[tile] !== undefined) return HONOR_IDX[tile];
  if (tile.endsWith('m')) return parseInt(tile) - 1;
  if (tile.endsWith('t')) return 9 + parseInt(tile) - 1;
  if (tile.endsWith('b')) return 18 + parseInt(tile) - 1;
  return -1;
}

function idxToTile(idx) {
  if (idx < 9) return `${idx + 1}m`;
  if (idx < 18) return `${idx - 8}t`;
  if (idx < 27) return `${idx - 17}b`;
  if (idx === 33) return 'bai';
  const rev = Object.entries(HONOR_IDX).find(([, v]) => v === idx);
  return rev ? rev[0] : null;
}

// Convert hand (array of tile strings) to count array, treating bai as caijin
// Returns { counts: Int32Array(33), baiCount, caijinInHand }
// caijin tiles in hand are wildcards, bai tiles become caijin-equivalent (not wildcards)
function handToCounts(hand, caijinTile, baiTile, options = {}) {
  const counts = new Array(TOTAL).fill(0);
  let wildcards = 0; // actual caijin tiles (wildcards)
  let baiCount = 0;
  const caijinSet = getCaijinSet(caijinTile, options);
  const baiActsAsFace = isRuianRuleset(options) && !!baiTile;

  for (const tile of hand) {
    if (isBai(tile) && baiActsAsFace) {
      // bai acts as caijin tile type (not wildcard)
      baiCount++;
      if (baiTile) counts[tileIdx(baiTile)]++;
    } else if (caijinSet.has(tile)) {
      wildcards++; // this is a wildcard
    } else {
      counts[tileIdx(tile)]++;
    }
  }
  return { counts, wildcards, baiCount };
}

// Check if counts + wildcards can form N sets (triplets or sequences)
// Always works with the smallest available tile first
function canFormSets(counts, wildcards, setsLeft) {
  if (setsLeft === 0) return counts.every(c => c === 0);
  if (wildcards < 0) return false;

  // Find first non-zero tile
  let first = -1;
  for (let i = 0; i < TOTAL; i++) {
    if (counts[i] > 0) { first = i; break; }
  }

  if (first === -1) {
    // Only wildcards left; must complete setsLeft sets
    return wildcards >= setsLeft * 3;
  }

  // Try triplet (first, first, first)
  if (counts[first] >= 3) {
    counts[first] -= 3;
    if (canFormSets(counts, wildcards, setsLeft - 1)) { counts[first] += 3; return true; }
    counts[first] += 3;
  }
  if (counts[first] >= 2 && wildcards >= 1) {
    counts[first] -= 2;
    if (canFormSets(counts, wildcards - 1, setsLeft - 1)) { counts[first] += 2; return true; }
    counts[first] += 2;
  }
  if (counts[first] >= 1 && wildcards >= 2) {
    counts[first] -= 1;
    if (canFormSets(counts, wildcards - 2, setsLeft - 1)) { counts[first] += 1; return true; }
    counts[first] += 1;
  }

  // Try every sequence that contains the first numbered tile. This is important
  // when wildcards stand before the first visible tile, e.g. *-2-3 or *-*-5.
  if (first < 27) {
    const suitBase = Math.floor(first / 9) * 9;
    const posInSuit = first - suitBase;
    for (const startPos of [posInSuit - 2, posInSuit - 1, posInSuit]) {
      if (startPos < 0 || startPos > 6) continue;
      const seq = [suitBase + startPos, suitBase + startPos + 1, suitBase + startPos + 2];
      if (!seq.includes(first)) continue;

      const removed = [];
      let needWild = 0;
      for (const idx of seq) {
        if (counts[idx] > 0) {
          counts[idx]--;
          removed.push(idx);
        } else {
          needWild++;
        }
      }
      if (needWild <= wildcards && canFormSets(counts, wildcards - needWild, setsLeft - 1)) {
        for (const idx of removed) counts[idx]++;
        return true;
      }
      for (const idx of removed) counts[idx]++;
    }
  }

  return false;
}

// Try to form pair + N sets. Returns true if winning.
function isWinningHandWithSetCount(counts, wildcards, setsNeeded) {
  const c = [...counts];
  // Try each tile as pair head
  for (let i = 0; i < TOTAL; i++) {
    if (c[i] >= 2) {
      c[i] -= 2;
      if (canFormSets([...c], wildcards, setsNeeded)) { c[i] += 2; return true; }
      c[i] += 2;
    }
    if (c[i] >= 1 && wildcards >= 1) {
      c[i] -= 1;
      if (canFormSets([...c], wildcards - 1, setsNeeded)) { c[i] += 1; return true; }
      c[i] += 1;
    }
  }
  // Pair from 2 wildcards
  if (wildcards >= 2) {
    if (canFormSets([...c], wildcards - 2, setsNeeded)) return true;
  }
  return false;
}

function isWinningHand(counts, wildcards) {
  return isWinningHandWithSetCount(counts, wildcards, 5);
}

function canFormEightPairs(concealed, caijinTile, options = {}) {
  const counts = {};
  let wildcards = 0;
  const caijinSet = getCaijinSet(caijinTile, options);
  const baiActsAsFace = isRuianRuleset(options) && !!caijinTile;
  for (const tile of concealed) {
    if (caijinSet.has(tile)) {
      wildcards++;
      continue;
    }
    const face = isBai(tile) && baiActsAsFace ? caijinTile : tile;
    counts[face] = (counts[face] || 0) + 1;
  }
  const total = Object.values(counts).reduce((sum, c) => sum + c, 0) + wildcards;
  if (total !== 16 && total !== 17) return false;

  const canPairRest = (restCounts, restWildcards) => {
    let odd = 0;
    for (const c of Object.values(restCounts)) odd += c % 2;
    return odd <= restWildcards && (restWildcards - odd) % 2 === 0;
  };

  if (total % 2 === 0) return canPairRest(counts, wildcards);
  for (const key of Object.keys(counts)) {
    counts[key]--;
    const ok = canPairRest(counts, wildcards);
    counts[key]++;
    if (ok) return true;
  }
  return wildcards > 0 && canPairRest(counts, wildcards - 1);
}

// Main win check entry point
// hand: player's concealed tiles + open melds (all tile strings)
// openMelds: [{type:'peng'|'chi'|'gang', tiles:[...]}]
// caijinTile: the wildcard tile type (string)
// Returns { win: bool, special: string|null }
function checkWin(concealed, openMelds, caijinTile, options = {}) {
  if (isPingyangRuleset(options)) {
    const flowerCount = Array.isArray(options.flowers) ? options.flowers.length : 0;
    if (flowerCount >= 8) {
      return { win: true, special: 'flowerHu', wildcards: 0, baiCount: 0 };
    }
    if (concealed.some(tile => isFlower(tile))) {
      return { win: false };
    }
  }

  // Count bai and caijin in concealed tiles only. Open melds are already fixed sets.
  let wildcards = 0;
  let baiCount = 0;
  const normalTiles = [];
  const caijinSet = getCaijinSet(caijinTile, options);
  const baiActsAsFace = isRuianRuleset(options) && !!caijinTile;
  for (const t of concealed) {
    if (isBai(t) && baiActsAsFace) { baiCount++; }
    else if (caijinSet.has(t)) { wildcards++; }
    else normalTiles.push(t);
  }

  // Bai tiles act as caijin's tile type (not wildcards)
  const baiAsTile = baiActsAsFace ? caijinTile : null;
  const handWithBai = [...normalTiles, ...Array(baiCount).fill(baiAsTile)];

  // Check special 500-hu hands first
  const totalMelds = openMelds.length;
  if (isPingyangRuleset(options)) {
    const allTiles = [...concealed, ...openMelds.flatMap(m => m.tiles)];
    const sameReveal = Array.isArray(options.caijinTiles) && options.caijinTiles.length === 1;
    const counts = {};
    for (const tile of allTiles) {
      if (!caijinSet.has(tile)) continue;
      counts[tile] = (counts[tile] || 0) + 1;
    }
    const canKillPig = wildcards >= 4 && (sameReveal
      ? Object.values(counts).some(count => count >= 2)
      : Object.values(counts).some(count => count >= 3));
    if (canKillPig) return { win: true, special: 'killPig', wildcards, baiCount };
  }
  // 500胡/清一色/四风齐 shortcuts are Ruian-only; Pingyang uses structure + tai scoring.
  const special500 = isRuianRuleset(options)
    ? checkSpecial500(concealed, openMelds, caijinTile, wildcards, baiCount, options)
    : null;
  if (special500) return { win: true, special: special500, wildcards, baiCount };
  if (totalMelds === 0 && canFormEightPairs(concealed, caijinTile, options)) {
    return { win: true, special: 'eightPairs', wildcards, baiCount };
  }

  // Build count array
  const counts = new Array(TOTAL).fill(0);
  for (const t of handWithBai) counts[tileIdx(t)]++;

  if (isWinningHandWithSetCount(counts, wildcards, 5 - totalMelds)) {
    return { win: true, special: null, wildcards, baiCount };
  }
  return { win: false };
}

// Check 500-hu special hands
function checkSpecial500(concealed, openMelds, caijinTile, wildcards, baiCount, options = {}) {
  const all = [...concealed, ...openMelds.flatMap(m => m.tiles)];
  const baiActsAsFace = isRuianRuleset(options) && !!caijinTile;

  // Three 财神 (wildcards) = 500 hu
  if (wildcards >= 3) return 'caijin3';

  // 清一色: all tiles same suit (no honors), wildcards allowed to fill
  // With bai/wildcards, check if non-special tiles are all same suit
  const caijinSet = getCaijinSet(caijinTile, options);
  const nonSpecial = all.filter(t => !(isBai(t) && baiActsAsFace) && !caijinSet.has(t));
  if (nonSpecial.length > 0) {
    const suits = new Set(nonSpecial.map(t => getSuit(t)));
    if (suits.size === 1 && !suits.has(null)) return 'qingyise';
  }

  // 四风齐: all four winds present as triplets
  const allExpanded = [...nonSpecial, ...Array(baiCount).fill(caijinTile)];
  const windCounts = { east: 0, south: 0, west: 0, north: 0 };
  for (const t of allExpanded) if (t in windCounts) windCounts[t]++;
  if (Object.values(windCounts).every(c => c >= 3)) return 'sifengqi';

  return null;
}

// Detect hand pattern details for scoring
function analyzeHand(concealed, openMelds, caijinTile, winTile, isSelfDraw, seatWind) {
  const wildcards = [...concealed, ...openMelds.flatMap(m => m.tiles)].filter(t => t === caijinTile).length;
  const baiCount = [...concealed, ...openMelds.flatMap(m => m.tiles)].filter(t => isBai(t)).length;

  const info = {
    wildcards,
    baiCount,
    isSelfDraw,
    openMelds,
    concealed,
    winTile,
    seatWind,
    caijinTile,
    isPengPengHu: false,
    isHunYise: false,
    isQingYise: false,
    isSifengqi: false,
    isPingHu: false,
    isGangShangKaiHua: false,
    isHaidilao: false,
    isQiangGangHu: false,
    isJianganghu: false,
    isTianHu: false,
    isDiHu: false,
    isCaijin3: false,
  };

  return info;
}

module.exports = { checkWin, analyzeHand, tileIdx, idxToTile, TOTAL, handToCounts, canFormSets, isWinningHand };

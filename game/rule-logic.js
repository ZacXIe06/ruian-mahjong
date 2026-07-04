'use strict';

const { isBai } = require('./tiles');

const RUIAN_RULESET = 'ruian';
const PINGYANG_RULESET = 'pingyang_taipao';

function getRuleset(source = {}) {
  return source.ruleset || RUIAN_RULESET;
}

function isPingyangRuleset(source = {}) {
  return getRuleset(source) === PINGYANG_RULESET;
}

function isRuianRuleset(source = {}) {
  return getRuleset(source) === RUIAN_RULESET;
}

function meldFace(source, tile, caijinTile = source.caijinTile) {
  if (!tile) return tile;
  if (isRuianRuleset(source) && isBai(tile)) return caijinTile;
  return tile;
}

function canUseTileForMeld(source, tile, caijinTile = source.caijinTile) {
  if (!tile) return false;
  if (isRuianRuleset(source)) return tile !== caijinTile;
  return true;
}

function meldTilesMatch(source, candidate, target, caijinTile = source.caijinTile) {
  if (!canUseTileForMeld(source, candidate, caijinTile)) return false;
  if (!canUseTileForMeld(source, target, caijinTile)) return false;
  return meldFace(source, candidate, caijinTile) === meldFace(source, target, caijinTile);
}

function countMeldMatches(source, hand, tile, caijinTile = source.caijinTile) {
  if (!canUseTileForMeld(source, tile, caijinTile)) return 0;
  return (hand || []).filter(t => meldTilesMatch(source, t, tile, caijinTile)).length;
}

function isValidChiMeld(source, tile, handTiles, caijinTile = source.caijinTile) {
  if (!canUseTileForMeld(source, tile, caijinTile)) return false;
  if (!Array.isArray(handTiles) || handTiles.length !== 2) return false;
  if (!handTiles.every(t => canUseTileForMeld(source, t, caijinTile))) return false;
  const faces = [tile, ...handTiles].map(t => meldFace(source, t, caijinTile));
  if (!faces.every(t => /^\d[mtb]$/.test(t))) return false;
  const suit = faces[0].slice(-1);
  if (!faces.every(t => t.slice(-1) === suit)) return false;
  const values = faces.map(t => parseInt(t, 10)).sort((a, b) => a - b);
  return values[0] + 1 === values[1] && values[1] + 1 === values[2];
}

function getChiOptions(source, hand, tile, caijinTile = source.caijinTile) {
  if (!canUseTileForMeld(source, tile, caijinTile)) return [];
  const tileFace = meldFace(source, tile, caijinTile);
  if (!tileFace || !tileFace.match(/^\d[mtb]$/)) return [];

  const suit = tileFace.slice(-1);
  const val = parseInt(tileFace, 10);
  const opts = [];

  for (const [a, b] of [[val - 2, val - 1], [val - 1, val + 1], [val + 1, val + 2]]) {
    if (a < 1 || b > 9) continue;
    const t1 = `${a}${suit}`;
    const t2 = `${b}${suit}`;
    const candidates = (hand || []).map((actual, idx) => ({
      actual,
      idx,
      face: meldFace(source, actual, caijinTile),
      usable: canUseTileForMeld(source, actual, caijinTile),
    }));
    const first = candidates.find(entry => entry.usable && entry.face === t1);
    if (!first) continue;
    const second = candidates.find(entry => entry.usable && entry.idx !== first.idx && entry.face === t2);
    if (!second) continue;
    opts.push([first.actual, second.actual]);
  }

  return opts;
}

module.exports = {
  RUIAN_RULESET,
  PINGYANG_RULESET,
  getRuleset,
  isRuianRuleset,
  isPingyangRuleset,
  meldFace,
  canUseTileForMeld,
  meldTilesMatch,
  countMeldMatches,
  isValidChiMeld,
  getChiOptions,
};

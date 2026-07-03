'use strict';

const SUITS = { MAN: 'm', TONG: 't', TIAO: 'b' };
const HONORS = ['east', 'south', 'west', 'north', 'zhong', 'fa'];
const WINDS = ['east', 'south', 'west', 'north'];
const BAI = 'bai';
const FLOWERS = ['chun', 'xia', 'qiu', 'dong', 'mei', 'lan', 'zhu', 'ju'];
const PINGYANG_RULESET = 'pingyang_taipao';

function buildBaseDeck() {
  const deck = [];
  for (const suit of [SUITS.MAN, SUITS.TONG, SUITS.TIAO]) {
    for (let v = 1; v <= 9; v++) {
      for (let i = 0; i < 4; i++) deck.push(`${v}${suit}`);
    }
  }
  for (const h of HONORS) {
    for (let i = 0; i < 4; i++) deck.push(h);
  }
  for (let i = 0; i < 4; i++) deck.push(BAI);
  return deck;
}

function buildDeck(ruleset = 'ruian') {
  const deck = buildBaseDeck();
  if (ruleset === PINGYANG_RULESET) {
    for (const flower of FLOWERS) deck.push(flower);
  }
  return deck;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function isNumbered(tile) {
  return tile.endsWith('m') || tile.endsWith('t') || tile.endsWith('b');
}

function isHonor(tile) { return HONORS.includes(tile); }
function isWind(tile) { return WINDS.includes(tile); }
function isBai(tile) { return tile === BAI; }
function isFlower(tile) { return FLOWERS.includes(tile); }

function isYaojiu(tile) {
  if (isHonor(tile)) return true;
  if (isNumbered(tile)) {
    const v = parseInt(tile, 10);
    return v === 1 || v === 9;
  }
  return false;
}

function getSuit(tile) {
  if (HONORS.includes(tile) || tile === BAI || isFlower(tile)) return null;
  if (tile.endsWith('m')) return 'm';
  if (tile.endsWith('t')) return 't';
  if (tile.endsWith('b')) return 'b';
  return null;
}

function getValue(tile) {
  if (isNumbered(tile)) return parseInt(tile, 10);
  return null;
}

function nextEligibleCaijinIndex(wall, startIndex) {
  for (let offset = 0; offset < wall.length; offset++) {
    const idx = (startIndex + offset) % wall.length;
    const candidate = wall[idx];
    if (!isFlower(candidate) && candidate !== BAI) return idx;
  }
  return 0;
}

function determineCaijin(diceRoll, wall) {
  const pos = ((diceRoll - 1) * 2 + 12) % wall.length;
  return wall[nextEligibleCaijinIndex(wall, pos)];
}

function determineCaijinTiles(diceRoll, wall, ruleset = 'ruian') {
  if (ruleset !== PINGYANG_RULESET) return [determineCaijin(diceRoll, wall)];
  const firstPos = ((diceRoll - 1) * 2 + 12) % wall.length;
  const secondPos = (firstPos + 2) % wall.length;
  const first = wall[nextEligibleCaijinIndex(wall, firstPos)];
  const second = wall[nextEligibleCaijinIndex(wall, secondPos)];
  return [...new Set([first, second])];
}

function baiEquivalent(caijinTile) {
  return caijinTile;
}

module.exports = {
  SUITS, HONORS, WINDS, BAI, FLOWERS, PINGYANG_RULESET,
  buildDeck, shuffle,
  isNumbered, isHonor, isWind, isYaojiu, isBai, isFlower,
  getSuit, getValue,
  determineCaijin, determineCaijinTiles, baiEquivalent,
};

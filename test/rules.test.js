'use strict';
const assert = require('assert');
const { checkWin } = require('../game/win-check');
const { calcWinScore } = require('../game/scorer');
const { buildDeck, FLOWERS, determineCaijinTiles } = require('../game/tiles');
const { createGame, replaceFlowerTiles, getFlowerTiles, getPlayableHand } = require('../game/game-state');

function win(hand, caijin = '4m', melds = []) {
  return checkWin(hand, melds, caijin);
}

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`not ok - ${name}`);
    throw err;
  }
}

test('deck has 136 tiles and exactly 4 bai', () => {
  const deck = buildDeck();
  assert.strictEqual(deck.length, 136);
  assert.strictEqual(deck.filter(t => t === 'bai').length, 4);
});

test('pingyang deck has 144 tiles including 8 flowers', () => {
  const deck = buildDeck('pingyang_taipao');
  assert.strictEqual(deck.length, 144);
  for (const flower of FLOWERS) {
    assert.strictEqual(deck.filter(t => t === flower).length, 1);
  }
});

test('pingyang caijin reveal deduplicates equal tiles', () => {
  const wall = ['1m', '1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1t', '2t', '3t', '4t', '5t'];
  const result = determineCaijinTiles(1, wall, 'pingyang_taipao');
  assert.ok(result.length >= 1 && result.length <= 2);
  assert.strictEqual(new Set(result).size, result.length);
});

test('pingyang uses multiple caijin tiles as wildcards', () => {
  const result = checkWin([
    '1m','1m',
    '2m','3m','4m',
    '2t','3t','4t',
    '5b','6b',
    'east','east','east',
    'zhong','zhong','zhong',
    '4m','5m',
  ], [], '4m', { ruleset: 'pingyang_taipao', caijinTiles: ['4m', '5m'] });
  assert.strictEqual(result.win, true);
});

test('pingyang bai stays a normal tile instead of caijin face', () => {
  const result = checkWin([
    'bai','bai',
    '2m','3m','4m',
    '2t','3t','4t',
    '5b','6b','7b',
    'east','east','east',
    'zhong','zhong','zhong',
  ], [], '1m', { ruleset: 'pingyang_taipao', caijinTiles: ['1m', '2m'] });
  assert.strictEqual(result.win, true);
  assert.strictEqual(result.baiCount, 0);
});

test('pingyang scorer counts multiple caijin tiles but not bai as caijin', () => {
  const hand = [
    'bai','bai',
    '2m','3m','4m',
    '2t','3t','4t',
    '5b','6b',
    'east','east','east',
    'zhong','zhong','zhong',
    '4m','5m',
  ];
  const score = calcWinScore(hand, [], '4m', {
    isSelfDraw: true,
    isStandardWin: true,
    ruleset: 'pingyang_taipao',
    caijinTiles: ['4m', '5m'],
  });
  assert.ok(score.taiDetails.some(item => item.label.includes('财神')));
});

test('pingyang opening flowers stay in hand until player manually replaces them', () => {
  const game = createGame('room1', ['a', 'b', 'c', 'd']);
  game.ruleset = 'pingyang_taipao';
  game.seats.a = { hand: ['chun', '1m', 'xia'], flowers: [], openMelds: [], discards: [], baiCollected: [], score: 100 };
  assert.deepStrictEqual(getFlowerTiles(game, 'a'), ['chun', 'xia']);
});

test('manual flower replacement moves flowers out and draws from wall tail', () => {
  const game = createGame('room1', ['a', 'b', 'c', 'd']);
  game.ruleset = 'pingyang_taipao';
  game.seats.a = { hand: ['chun', '1m', 'xia'], flowers: [], openMelds: [], discards: [], baiCollected: [], score: 100 };
  game.wall = ['2m', '3m', '4m', '5m'];
  game.wallIdx = 0;
  game.wallLeft = 4;
  const result = replaceFlowerTiles(game, 'a', ['chun', 'xia']);
  assert.deepStrictEqual(result.replaced, ['chun', 'xia']);
  assert.deepStrictEqual(game.seats.a.flowers, ['chun', 'xia']);
  assert.ok(game.seats.a.hand.includes('5m'));
  assert.ok(game.seats.a.hand.includes('4m'));
});

test('pingyang bai follows flower replacement flow', () => {
  const game = createGame('room1', ['a', 'b', 'c', 'd']);
  game.ruleset = 'pingyang_taipao';
  game.seats.a = { hand: ['bai', '1m', 'xia'], flowers: [], openMelds: [], discards: [], baiCollected: [], score: 100 };
  assert.deepStrictEqual(getFlowerTiles(game, 'a'), ['bai', 'xia']);
  const result = replaceFlowerTiles(game, 'a', ['bai', 'xia']);
  assert.deepStrictEqual(result.replaced, ['bai', 'xia']);
  assert.deepStrictEqual(game.seats.a.baiCollected, ['bai']);
  assert.deepStrictEqual(game.seats.a.flowers, ['xia']);
});

test('pingyang score reports same-caijin special tai and qifan', () => {
  const hand = [
    '3m','3m',
    '1m','2m','3m',
    '4m','5m','6m',
    '7m','8m','9m',
    '2t','3t','4t',
    '5m',
  ];
  const score = calcWinScore(hand, [], '5m', {
    ruleset: 'pingyang_taipao',
    caijinTiles: ['5m'],
    isSelfDraw: true,
    flowers: [],
    seatWind: 'east',
  });
  assert.strictEqual(score.ruleset, 'pingyang_taipao');
  assert.ok(score.totalTai >= 13);
  assert.ok(score.qifan);
  assert.ok(score.taiDetails.some(item => item.tai === 7 || item.tai === 13));
});

test('pingyang flower groups contribute tai details', () => {
  const hand = [
    '1m','1m',
    '2m','3m','4m',
    '2t','3t','4t',
    '5b','6b','7b',
    'east','east','east',
    'zhong','zhong','zhong',
  ];
  const score = calcWinScore(hand, [], '9m', {
    ruleset: 'pingyang_taipao',
    caijinTiles: ['9m', '1t'],
    isSelfDraw: true,
    flowers: ['chun', 'xia'],
    seatWind: 'east',
  });
  assert.ok(score.taiDetails.some(item => item.label.includes('花牌')));
});

test('pingyang detects caishen hui detail', () => {
  const hand = [
    '5m','5m','5m',
    '1m','2m','3m',
    '4m','5m','6m',
    '2t','3t','4t',
    '7b','8b','9b',
    'east','east',
  ];
  const score = calcWinScore(hand, [], '5m', {
    ruleset: 'pingyang_taipao',
    caijinTiles: ['5m'],
    isSelfDraw: true,
    flowers: [],
    seatWind: 'east',
    winTile: 'east',
  });
  assert.ok(score.taiDetails.some(item => item.label === '财神汇'));
});

test('pingyang detects single wait detail', () => {
  const hand = [
    '1m','2m','3m',
    '4m','5m','6m',
    '2t','3t','4t',
    '7b','8b','9b',
    'east','east','east',
    'zhong','zhong',
  ];
  const score = calcWinScore(hand, [], '9m', {
    ruleset: 'pingyang_taipao',
    caijinTiles: ['9m', '1t'],
    isSelfDraw: true,
    flowers: [],
    seatWind: 'east',
    winTile: 'zhong',
  });
  assert.ok(score.taiDetails.some(item => item.label === '单钓将'));
});

test('standard 17-tile hand wins', () => {
  const result = win([
    '1m','1m',
    '2m','3m','4m',
    '2t','3t','4t',
    '5b','6b','7b',
    'east','east','east',
    'zhong','zhong','zhong',
  ], '9m');
  assert.strictEqual(result.win, true);
});

test('two caijin can complete missing tiles', () => {
  const result = win([
    '1m','1m',
    '2m','3m','4m',
    '2t','3t','4t',
    '5b','6b',
    'east','east','east',
    'zhong','zhong','zhong',
    '4m','4m',
  ], '4m');
  assert.strictEqual(result.win, true);
});

test('open meld counts as an already completed set for win check', () => {
  const result = win([
    '1m','1m',
    '2m','3m','4m',
    '2t','3t','4t',
    '5b','6b','7b',
    'east','east','east',
  ], '9m', [
    { type: 'gang', tiles: ['8t','8t','8t','8t'] },
  ]);
  assert.strictEqual(result.win, true);
});

test('eight pairs can trigger win prompt', () => {
  const result = win([
    '1m','1m',
    '2m','2m',
    '3m','3m',
    '5m','5m',
    '1t','1t',
    '2t','2t',
    'east','east',
    'south','south',
    'west',
  ], '4m');
  assert.strictEqual(result.win, true);
});

test('bai is caijin face value, not an extra wildcard', () => {
  const result = win([
    'bai','bai',
    '2m','3m','4m',
    '2t','3t','4t',
    '5b','6b','7b',
    'east','east','east',
    'zhong','zhong','zhong',
  ], '1m');
  assert.strictEqual(result.win, true);
});

test('bai face value does not count as caijin for scoring', () => {
  const hand = [
    'bai','bai',
    '2m','3m','4m',
    '2t','3t','4t',
    '5b','6b','7b',
    'east','east','east',
    'zhong','zhong','zhong',
  ];
  const score = calcWinScore(hand, [], '1m', { isSelfDraw: true, isStandardWin: true });
  assert.strictEqual(score.type, '平胡自摸');
  assert.strictEqual(score.mult, 1);
  assert.strictEqual(score.caijinFen, 0);
});

test('no caijin win is base 2 but multiplier x1', () => {
  const hand = [
    '1m','1m',
    '2m','3m','4m',
    '2t','3t','4t',
    '5b','6b','7b',
    'east','east','east',
    'zhong','zhong','zhong',
  ];
  const score = calcWinScore(hand, [], '9m', { isSelfDraw: false, isStandardWin: true });
  assert.strictEqual(score.type, '无财神');
  assert.strictEqual(score.mult, 1);
});

test('soft eight pairs scores as x2', () => {
  const hand = [
    '1m','1m','2m','2m','3m','3m','5m','5m',
    '1t','1t','2t','2t','3t','3t','4m','6b',
  ];
  const score = calcWinScore(hand, [], '4m', { isSelfDraw: true, isStandardWin: true });
  assert.strictEqual(score.mult, 2);
});

test('single caijin used as its own tile is caijin guiwei', () => {
  const hand = [
    '1m','1m',
    '2m','3m','4m',
    '2t','3t','4t',
    '5b','6b','7b',
    'east','east','east',
    'zhong','zhong','zhong',
  ];
  const score = calcWinScore(hand, [], '4m', { isSelfDraw: true, isStandardWin: true });
  assert.strictEqual(score.type, '财神归位');
  assert.strictEqual(score.mult, 2);
});

test('two caijin both used as own tiles is double caijin guiwei', () => {
  const hand = [
    '4m','4m',
    '1m','2m','3m',
    '2t','3t','4t',
    '5b','6b','7b',
    'east','east','east',
    'zhong','zhong','zhong',
  ];
  const score = calcWinScore(hand, [], '4m', { isSelfDraw: true, isStandardWin: true });
  assert.strictEqual(score.type, '双财神归位');
  assert.strictEqual(score.mult, 4);
});

test('eight pairs with returned caijin is hard eight pairs', () => {
  const hand = [
    '4m','4m',
    '1m','1m',
    '2m','2m',
    '3m','3m',
    '5t','5t',
    '6t','6t',
    'east','east',
    'south','south',
  ];
  const score = calcWinScore(hand, [], '4m', { isSelfDraw: true, isStandardWin: true });
  assert.strictEqual(score.type, '硬8对');
  assert.strictEqual(score.mult, 4);
});

test('eight pairs without caijin is hard eight pairs', () => {
  const hand = [
    '1m','1m',
    '2m','2m',
    '3m','3m',
    '5m','5m',
    '1t','1t',
    '2t','2t',
    'east','east',
    'south','south',
    'west',
  ];
  const score = calcWinScore(hand, [], '4m', { isSelfDraw: true, isStandardWin: true });
  assert.strictEqual(score.type, '硬8对');
  assert.strictEqual(score.mult, 4);
});

console.log('rules tests complete');
test('pingyang flower hu wins directly with eight flowers', () => {
  const result = checkWin([
    '1m','1m',
    '2m','3m','4m',
    '2t','3t','4t',
    '5b','6b','7b',
    'east','east','east',
    'zhong','zhong','zhong',
  ], [], '9m', {
    ruleset: 'pingyang_taipao',
    caijinTiles: ['9m', '1t'],
    flowers: ['chun','xia','qiu','dong','mei','lan','zhu','ju'],
  });
  assert.strictEqual(result.win, true);
  assert.strictEqual(result.special, 'flowerHu');
});

test('pingyang kill pig wins directly when enough matching caijin are held', () => {
  const result = checkWin([
    '5m','5m','5m','5m',
    '1m','2m','3m',
    '2t','3t','4t',
    '5b','6b','7b',
    'east','east','east',
    'zhong',
  ], [], '5m', {
    ruleset: 'pingyang_taipao',
    caijinTiles: ['5m', '7m'],
    flowers: [],
  });
  assert.strictEqual(result.win, true);
  assert.strictEqual(result.special, 'killPig');
});

test('pingyang concealed flower blocks standard hu until replaced', () => {
  const result = checkWin([
    'chun',
    '1m','1m',
    '2m','3m','4m',
    '2t','3t','4t',
    '5b','6b','7b',
    'east','east','east',
    'zhong','zhong','zhong',
  ], [], '9m', {
    ruleset: 'pingyang_taipao',
    caijinTiles: ['9m', '1t'],
    flowers: [],
  });
  assert.strictEqual(result.win, false);
});

test('pingyang playable hand ignores flower area tiles for hu structure', () => {
  const game = createGame('room1', ['a', 'b', 'c', 'd']);
  game.ruleset = 'pingyang_taipao';
  game.seats.a = {
    hand: ['2m','3m','4m','2t','3t','4t','5t','5t','5t','7b','8b','9b','east','east','chun','bai'],
    flowers: ['lan'],
    baiCollected: ['bai'],
    openMelds: [],
    discards: [],
    score: 100,
  };
  assert.deepStrictEqual(getPlayableHand(game, 'a'), ['2m','3m','4m','2t','3t','4t','5t','5t','5t','7b','8b','9b','east','east']);
});

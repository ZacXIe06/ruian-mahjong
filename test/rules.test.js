'use strict';
const assert = require('assert');
const { checkWin } = require('../game/win-check');
const { calcWinScore } = require('../game/scorer');
const { buildDeck, FLOWERS, determineCaijinTiles } = require('../game/tiles');
const { createGame, initRound, replaceFlowerTiles, getFlowerTiles, getPlayableHand, doPeng, doChi, checkPlayerWin } = require('../game/game-state');
const { getChiOptions } = require('../game/rule-logic');

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

test('pingyang caijin reveal deduplicates equal tiles and can reveal bai or flower', () => {
  const wall = ['1m', '1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1t', '2t', '3t', '4t', '5t'];
  const result = determineCaijinTiles(1, wall, 'pingyang_taipao');
  assert.ok(result.length >= 1 && result.length <= 2);
  assert.strictEqual(new Set(result).size, result.length);

  const withSpecial = ['1m', '1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1t', '2t', 'bai', '5t', 'chun'];
  assert.deepStrictEqual(determineCaijinTiles(1, withSpecial, 'pingyang_taipao'), ['bai', 'chun']);
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

test('pingyang caijin flower or bai is not replaced as flower', () => {
  const game = createGame('room1', ['a', 'b', 'c', 'd']);
  game.ruleset = 'pingyang_taipao';
  game.caijinTile = 'bai';
  game.caijinTiles = ['bai', 'chun'];
  game.seats.a = { hand: ['bai', 'chun', 'xia', '1m'], flowers: [], openMelds: [], discards: [], baiCollected: [], score: 200 };
  assert.deepStrictEqual(getFlowerTiles(game, 'a'), ['xia']);
});

test('pingyang starts with 200 points and dealer has 17 tiles after deal', () => {
  const game = createGame('room1', ['a', 'b', 'c', 'd']);
  game.ruleset = 'pingyang_taipao';
  initRound(game);
  assert.strictEqual(game.seats.a.score, 200);
  assert.strictEqual(game.seats[game.playerIds[game.dealerSeat]].hand.length, 17);
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
    flowers: ['chun', 'xia'],
    seatWind: 'east',
  });
  assert.strictEqual(score.ruleset, 'pingyang_taipao');
  assert.ok(score.totalTai >= 13);
  assert.ok(score.qifan);
  assert.ok(score.taiDetails.some(item => item.tai === 5 || item.tai === 10));
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

test('pingyang gang tai follows small and high tile table', () => {
  const hand = [
    '1m','1m',
    '2m','3m','4m',
    '2t','3t','4t',
    '5b','6b','7b',
    'east','east','east',
    'zhong','zhong','zhong',
  ];
  const score = calcWinScore(hand, [
    { type: 'gang', tiles: ['2m', '2m', '2m', '2m'] },
    { type: 'concealed_gang', tiles: ['zhong', 'zhong', 'zhong', 'zhong'] },
  ], '9m', {
    ruleset: 'pingyang_taipao',
    caijinTiles: ['9m', '1t'],
    isSelfDraw: true,
    flowers: [],
    seatWind: 'east',
  });
  assert.ok(score.taiDetails.some(item => item.label === '明杠 2m' && item.tai === 2));
  assert.ok(score.taiDetails.some(item => item.label === '暗杠 zhong' && item.tai === 4));
});

test('pingyang win prompt does not require 13 tai qifan', () => {
  const game = createGame('room1', ['a', 'b', 'c', 'd']);
  game.ruleset = 'pingyang_taipao';
  game.caijinTile = '9m';
  game.caijinTiles = ['9m', '1t'];
  game.seats.a = {
    wind: 'east',
    hand: [
      '1m','1m',
      '2m','3m','4m',
      '2t','3t','4t',
      '5b','6b','9m',
      'east','east','east',
      'zhong','zhong','zhong',
    ],
    flowers: [],
    openMelds: [],
    discards: [],
    baiCollected: [],
    score: 100,
  };
  const result = checkPlayerWin(game, 'a', null, true);
  assert.strictEqual(result.score.qifan, false);
  assert.strictEqual(result.win, true);

  game.seats.a.flowers = ['chun', 'xia', 'qiu', 'dong'];
  const qifan = checkPlayerWin(game, 'a', null, true);
  assert.strictEqual(qifan.score.qifan, true);
  assert.strictEqual(qifan.win, true);
});

test('pingyang face tai preview excludes win-only tai', () => {
  const hand = [
    '1m','1m',
    '2m','3m','4m',
    '2t','3t','4t',
    '5b','6b','9m',
    'east','east','east',
    'zhong','zhong','zhong',
  ];
  const preview = calcWinScore(hand, [], '9m', {
    ruleset: 'pingyang_taipao',
    caijinTiles: ['9m', '1t'],
    flowers: [],
    seatWind: 'east',
    faceOnly: true,
  });
  assert.strictEqual(preview.totalTai, 3);
  assert.ok(!preview.taiDetails.some(item => item.label === '自摸'));

  const winScore = calcWinScore(hand, [], '9m', {
    ruleset: 'pingyang_taipao',
    caijinTiles: ['9m', '1t'],
    flowers: [],
    seatWind: 'east',
    isSelfDraw: true,
  });
  assert.ok(winScore.totalTai > preview.totalTai);
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
  assert.strictEqual(result.special, 'killPigFlowers');
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

test('ruian standard self-draw hand wins (678 tong + bai triplet)', () => {
  const hand = [
    '2m','3m','4m','5m','6m','7m',
    '6t','7t','8t',
    '3b','3b','4b','5b','6b',
    'bai','bai','bai',
  ];
  const result = checkWin(hand, [], '9m', { ruleset: 'ruian' });
  assert.strictEqual(result.win, true);
  assert.strictEqual(result.special, null);
});

test('ruian and pingyang treat bai differently during win check', () => {
  const hand = [
    'bai','bai','bai',
    '2m','3m','4m','5m','6m','7m',
    '6t','7t','8t',
    '3b','3b','4b','5b','6b',
  ];
  const ruian = checkWin(hand, [], '1m', { ruleset: 'ruian' });
  assert.strictEqual(ruian.win, true);
  const pingyang = checkWin(hand, [], '1m', {
    ruleset: 'pingyang_taipao',
    caijinTiles: ['1m', '2m'],
  });
  assert.strictEqual(pingyang.win, true);
  assert.strictEqual(pingyang.baiCount, 0);
});

test('pingyang does not inherit ruian special500 shortcuts like loose qingyise', () => {
  const allWanNoStructure = [
    '1m','1m','3m','3m','5m','5m','7m','7m','9m','9m',
    '2m','4m','6m','8m','1m','3m','5m',
  ];
  const pingyang = checkWin(allWanNoStructure, [], '9t', {
    ruleset: 'pingyang_taipao',
    caijinTiles: ['9t', '1t'],
  });
  assert.strictEqual(pingyang.win, false);

  const ruian = checkWin(allWanNoStructure, [], '9t', { ruleset: 'ruian' });
  assert.strictEqual(ruian.win, true);
  assert.strictEqual(ruian.special, 'qingyise');
});

test('ruian caijin tile cannot be used for peng melds', () => {
  const game = createGame('room1', ['a', 'b', 'c', 'd']);
  game.ruleset = 'ruian';
  game.caijinTile = '4m';
  game.seats.a = { hand: [], flowers: [], openMelds: [], discards: [], baiCollected: [], score: 100 };
  game.seats.b = { hand: ['4m', '4m', '7m'], flowers: [], openMelds: [], discards: [], baiCollected: [], score: 100 };
  game.discardPile = [{ tile: '4m', playerId: 'a' }];
  game.lastDiscard = { tile: '4m', playerId: 'a' };
  assert.strictEqual(doPeng(game, 'b', '4m'), false);
});

test('ruian bai can participate in chi as caijin face tile', () => {
  const game = createGame('room1', ['a', 'b', 'c', 'd']);
  game.ruleset = 'ruian';
  game.caijinTile = '4m';
  game.seats.a = { hand: [], flowers: [], openMelds: [], discards: ['3m'], baiCollected: [], score: 100 };
  game.seats.b = { hand: ['2m', 'bai', '7m'], flowers: [], openMelds: [], discards: [], baiCollected: [], score: 100 };
  game.discardPile = [{ tile: '3m', playerId: 'a' }];
  game.lastDiscard = { tile: '3m', playerId: 'a' };
  assert.strictEqual(doChi(game, 'b', '3m', ['2m', 'bai']), true);
  assert.deepStrictEqual(game.seats.b.openMelds[0].tiles, ['2m', '3m', 'bai']);
});

test('ruian bai can eat as caijin face but actual caijin cannot', () => {
  const baiGame = createGame('room1', ['a', 'b', 'c', 'd']);
  baiGame.ruleset = 'ruian';
  baiGame.caijinTile = '6m';
  baiGame.seats.a = { hand: [], flowers: [], openMelds: [], discards: ['4m'], baiCollected: [], score: 100 };
  baiGame.seats.b = { hand: ['5m', 'bai'], flowers: [], openMelds: [], discards: [], baiCollected: [], score: 100 };
  baiGame.discardPile = [{ tile: '4m', playerId: 'a' }];
  baiGame.lastDiscard = { tile: '4m', playerId: 'a' };
  assert.strictEqual(doChi(baiGame, 'b', '4m', ['5m', 'bai']), true);

  const caijinGame = createGame('room2', ['a', 'b', 'c', 'd']);
  caijinGame.ruleset = 'ruian';
  caijinGame.caijinTile = '6m';
  caijinGame.seats.a = { hand: [], flowers: [], openMelds: [], discards: ['4m'], baiCollected: [], score: 100 };
  caijinGame.seats.b = { hand: ['5m', '6m'], flowers: [], openMelds: [], discards: [], baiCollected: [], score: 100 };
  caijinGame.discardPile = [{ tile: '4m', playerId: 'a' }];
  caijinGame.lastDiscard = { tile: '4m', playerId: 'a' };
  assert.strictEqual(doChi(caijinGame, 'b', '4m', ['5m', '6m']), false);
});

test('ruleset chi options stay isolated between ruian and pingyang', () => {
  const ruianBaiOpts = getChiOptions({ ruleset: 'ruian', caijinTile: '6m' }, ['5m', 'bai'], '4m');
  assert.deepStrictEqual(ruianBaiOpts, [['5m', 'bai']]);

  const ruianCaijinOpts = getChiOptions({ ruleset: 'ruian', caijinTile: '6m' }, ['5m', '6m'], '4m');
  assert.deepStrictEqual(ruianCaijinOpts, []);

  const pingyangOpts = getChiOptions({ ruleset: 'pingyang_taipao', caijinTile: '6m' }, ['5m', '6m'], '4m');
  assert.deepStrictEqual(pingyangOpts, [['5m', '6m']]);
});

console.log('rules tests complete');

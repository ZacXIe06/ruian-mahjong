'use strict';

const {
  buildDeck,
  shuffle,
  determineCaijinTiles,
  isBai,
  isFlower,
  WINDS,
} = require('./tiles');
const { checkWin } = require('./win-check');
const { calcWinScore, gangPoints } = require('./scorer');
const {
  isPingyangRuleset,
  meldFace,
  canUseTileForMeld,
  meldTilesMatch,
  isValidChiMeld,
} = require('./rule-logic');

const SEAT_WINDS = ['east', 'south', 'west', 'north'];
const OPENING_REDEAL_TILES = ['east', 'south', 'west', 'north', 'zhong', 'fa', 'bai'];

function createGame(roomId, playerIds) {
  return {
    roomId,
    playerIds,
    seats: {},
    wall: [],
    discardPile: [],
    caijinTile: null,
    caijinTiles: [],
    diceRoll: null,
    dealerSeat: 0,
    currentTurn: 0,
    phase: 'waiting',
    lastDiscard: null,
    waitingForAction: null,
    pendingActions: {},
    wallLeft: 0,
    wallIdx: 0,
    lastDrawWasGang: false,
    isLastTile: false,
    winner: null,
    scores: null,
    round: 1,
    roundWind: 'east',
    dealerStreak: 1,
    genfengStreak: null,
    ruleset: 'ruian',
    openingRedeal: null,
    pendingFlower: null,
  };
}

function createSeat(game, playerId, wind) {
  return {
    wind,
    hand: [],
    openMelds: [],
    discards: [],
    baiCollected: [],
    flowers: [],
    score: game.seats[playerId]?.score ?? 100,
  };
}

function resetRoundState(game) {
  game.discardPile = [];
  game.lastDiscard = null;
  game.waitingForAction = null;
  game.pendingActions = {};
  game.lastDrawWasGang = false;
  game.isLastTile = false;
  game.winner = null;
  game.scores = null;
  game.phase = 'dealing';
  game.genfengStreak = null;
  game.lastGenfeng = null;
  game.openingRedeal = null;
  game.pendingAutoDraw = null;
  game.pendingFlower = null;
}

function isPingyang(game) {
  return isPingyangRuleset(game);
}

function initSeats(game) {
  for (let i = 0; i < 4; i++) {
    const pid = game.playerIds[i];
    const wind = SEAT_WINDS[(i - game.dealerSeat + 4) % 4];
    game.seats[pid] = createSeat(game, pid, wind);
  }
}

function drawFromFront(game) {
  if (game.wallIdx >= game.wall.length) {
    game.phase = 'liuju';
    game.wallLeft = 0;
    return null;
  }
  const tile = game.wall[game.wallIdx++];
  game.wallLeft = game.wall.length - game.wallIdx;
  game.isLastTile = game.wallIdx >= game.wall.length;
  return tile;
}

function drawFromBack(game) {
  if (game.wallIdx >= game.wall.length) {
    game.phase = 'liuju';
    game.wallLeft = 0;
    return null;
  }
  const tile = game.wall.pop();
  game.wallLeft = game.wall.length - game.wallIdx;
  game.isLastTile = game.wallIdx >= game.wall.length;
  return tile;
}

function drawRawTileForSeat(game, playerId, fromBack = false) {
  const seat = game.seats[playerId];
  if (!seat) return null;
  const tile = fromBack ? drawFromBack(game) : drawFromFront(game);
  if (!tile) return null;
  seat.hand.push(tile);
  return tile;
}

function dealInitialHands(game, deck) {
  game.wall = [...deck];
  game.wallIdx = 0;
  game.wallLeft = game.wall.length;

  for (const caijinTile of game.caijinTiles) {
    const idx = game.wall.indexOf(caijinTile);
    if (idx !== -1) game.wall.splice(idx, 1);
  }
  game.wallLeft = game.wall.length - game.wallIdx;

  for (const pid of game.playerIds) {
    game.seats[pid].hand = [];
    game.seats[pid].openMelds = [];
    game.seats[pid].discards = [];
    game.seats[pid].baiCollected = [];
    game.seats[pid].flowers = [];
  }

  for (let round = 0; round < 4; round++) {
    for (let seatOffset = 0; seatOffset < 4; seatOffset++) {
      const pid = game.playerIds[(game.dealerSeat + seatOffset) % 4];
      for (let k = 0; k < 4; k++) {
        if (!drawRawTileForSeat(game, pid, false)) return { redealPlayer: null };
      }
    }
  }

  const redealPlayer = game.playerIds.find(pid =>
    OPENING_REDEAL_TILES.every(tile => game.seats[pid].hand.includes(tile))
  );
  return { redealPlayer };
}

function initRound(game) {
  resetRoundState(game);
  initSeats(game);

  const ruleset = game.ruleset || 'ruian';
  const firstDeck = shuffle(buildDeck(ruleset));
  game.diceRoll = Math.ceil(Math.random() * 6);
  game.caijinTiles = determineCaijinTiles(game.diceRoll, firstDeck, ruleset);
  game.caijinTile = game.caijinTiles[0] || null;

  for (let attempt = 0; attempt < 20; attempt++) {
    const deck = attempt === 0 ? firstDeck : shuffle(buildDeck(ruleset));
    const result = dealInitialHands(game, deck);
    if (!result.redealPlayer) break;
    game.openingRedeal = { playerId: result.redealPlayer, tiles: [...OPENING_REDEAL_TILES] };
  }

  game.currentTurn = game.dealerSeat;
  game.phase = 'playing';
  game.wallLeft = game.wall.length - game.wallIdx;
  return game;
}

function processBaiInHand() {}

function drawTile(game, playerId) {
  const tile = drawRawTileForSeat(game, playerId, false);
  game.lastDrawWasGang = false;
  return tile;
}

function drawTileAfterGang(game, playerId) {
  const tile = drawRawTileForSeat(game, playerId, true);
  game.lastDrawWasGang = true;
  return tile;
}

function getPlayableHand(game, playerId) {
  const seat = game.seats[playerId];
  if (!seat) return [];
  if (!isPingyang(game)) return [...seat.hand];
  return seat.hand.filter(tile => !isFlower(tile) && !isBai(tile));
}

function getFlowerTiles(game, playerId) {
  const hand = game.seats[playerId]?.hand || [];
  return isPingyang(game) ? hand.filter(tile => isFlower(tile) || isBai(tile)) : [];
}

function hasFlowersInHand(game, playerId) {
  return getFlowerTiles(game, playerId).length > 0;
}

function replaceFlowerTiles(game, playerId, requestedTiles = []) {
  const seat = game.seats[playerId];
  if (!seat || !isPingyang(game)) return { replaced: [], drawn: [] };

  const handFlowers = getFlowerTiles(game, playerId);
  if (!handFlowers.length) return { replaced: [], drawn: [] };

  const requested = Array.isArray(requestedTiles) && requestedTiles.length
    ? requestedTiles.filter(tile => isFlower(tile) || isBai(tile))
    : handFlowers;

  const replaced = [];
  for (const tile of requested) {
    const idx = seat.hand.indexOf(tile);
    if (idx === -1) continue;
    seat.hand.splice(idx, 1);
    if (isBai(tile)) seat.baiCollected.push(tile);
    else seat.flowers.push(tile);
    replaced.push(tile);
  }

  const drawn = [];
  for (let i = 0; i < replaced.length; i++) {
    const tile = drawRawTileForSeat(game, playerId, true);
    if (!tile) break;
    drawn.push(tile);
  }

  return { replaced, drawn, stillHasFlowers: hasFlowersInHand(game, playerId) };
}

function discardTile(game, playerId, tile) {
  const hand = game.seats[playerId].hand;
  const idx = hand.indexOf(tile);
  if (idx === -1) return false;
  hand.splice(idx, 1);
  game.seats[playerId].discards.push(tile);
  game.discardPile.push({ tile, playerId });
  game.lastDiscard = { tile, playerId };
  game.lastDrawWasGang = false;
  updateGenfeng(game, playerId, tile);
  return true;
}

function updateGenfeng(game, playerId, tile) {
  if (!WINDS.includes(tile)) {
    game.genfengStreak = null;
    game.lastGenfeng = null;
    return;
  }

  const streak = game.genfengStreak;
  if (streak?.tile === tile && !streak.players.includes(playerId)) {
    streak.players.push(playerId);
  } else {
    game.genfengStreak = { tile, players: [playerId] };
  }

  const activeStreak = game.genfengStreak;
  if (activeStreak.players.length === 4) {
    const leader = activeStreak.players[0];
    const followers = activeStreak.players.slice(1);
    for (const pid of followers) {
      game.seats[leader].score -= 1;
      game.seats[pid].score += 1;
    }
    game.lastGenfeng = { tile, leader, followers, points: 1 };
    game.genfengStreak = null;
  } else {
    game.lastGenfeng = null;
  }
}

function doPeng(game, playerId, tile) {
  const discard = game.lastDiscard;
  if (!discard || discard.tile !== tile) return false;
  if (!canUseTileForMeld(game, tile)) return false;
  const hand = game.seats[playerId].hand;
  let count = 0;
  const indices = [];
  for (let i = 0; i < hand.length; i++) {
    if (meldTilesMatch(game, hand[i], tile)) {
      indices.push(i);
      count += 1;
      if (count === 2) break;
    }
  }
  if (count < 2) return false;

  for (let i = indices.length - 1; i >= 0; i--) hand.splice(indices[i], 1);
  game.seats[playerId].openMelds.push({ type: 'peng', tiles: [tile, tile, tile], from: discard.playerId });

  const discardIdx = game.discardPile.findLastIndex(d => d.tile === tile && d.playerId === discard.playerId);
  if (discardIdx !== -1) game.discardPile.splice(discardIdx, 1);
  const seatDiscardIdx = game.seats[discard.playerId].discards.lastIndexOf(tile);
  if (seatDiscardIdx !== -1) game.seats[discard.playerId].discards.splice(seatDiscardIdx, 1);
  game.lastDiscard = null;
  return true;
}

function doChi(game, playerId, tile, handTiles) {
  const discard = game.lastDiscard;
  if (!discard || discard.tile !== tile) return false;
  if (!canUseTileForMeld(game, tile)) return false;
  if (!isValidChiMeld(game, tile, handTiles)) return false;
  const hand = game.seats[playerId].hand;
  for (const t of handTiles) {
    if (!canUseTileForMeld(game, t)) return false;
    const idx = hand.indexOf(t);
    if (idx === -1) return false;
    hand.splice(idx, 1);
  }
  const meldTiles = [...handTiles, tile].sort((a, b) => parseInt(meldFace(game, a), 10) - parseInt(meldFace(game, b), 10));
  game.seats[playerId].openMelds.push({ type: 'chi', tiles: meldTiles, from: discard.playerId });

  const discardIdx = game.discardPile.findLastIndex(d => d.tile === tile && d.playerId === discard.playerId);
  if (discardIdx !== -1) game.discardPile.splice(discardIdx, 1);
  const seatDiscardIdx = game.seats[discard.playerId].discards.lastIndexOf(tile);
  if (seatDiscardIdx !== -1) game.seats[discard.playerId].discards.splice(seatDiscardIdx, 1);
  game.lastDiscard = null;
  return true;
}

function doOpenGang(game, playerId, tile) {
  const seat = game.seats[playerId];
  if (!canUseTileForMeld(game, tile)) return false;
  const pengIdx = seat.openMelds.findIndex(m => m.type === 'peng' && meldFace(game, m.tiles[0]) === meldFace(game, tile));
  if (pengIdx === -1) return false;
  const handIdx = seat.hand.findIndex(t => meldTilesMatch(game, t, tile));
  if (handIdx === -1) return false;
  seat.hand.splice(handIdx, 1);
  seat.openMelds[pengIdx].type = 'gang';
  seat.openMelds[pengIdx].tiles.push(tile);
  return true;
}

function doConcealedGang(game, playerId, tile) {
  if (!canUseTileForMeld(game, tile)) return false;
  const hand = game.seats[playerId].hand;
  const count = hand.filter(t => meldTilesMatch(game, t, tile)).length;
  if (count < 4) return false;
  for (let i = 0; i < 4; i++) {
    const idx = hand.findIndex(t => meldTilesMatch(game, t, tile));
    hand.splice(idx, 1);
  }
  game.seats[playerId].openMelds.push({ type: 'concealed_gang', tiles: [tile, tile, tile, tile] });
  return true;
}

function checkPlayerWin(game, playerId, winTile, isSelfDraw) {
  const seat = game.seats[playerId];
  const hand = isSelfDraw ? getPlayableHand(game, playerId) : [...getPlayableHand(game, playerId), winTile];
  return checkWin(hand, seat.openMelds, game.caijinTile, {
    ruleset: game.ruleset,
    caijinTiles: game.caijinTiles,
    flowers: seat.flowers || [],
    baiCount: seat.baiCollected?.length || 0,
  });
}

function countCaijin(game, playerId) {
  const caijinSet = new Set(game.caijinTiles?.length ? game.caijinTiles : [game.caijinTile].filter(Boolean));
  const seat = game.seats[playerId];
  return [...seat.hand, ...seat.openMelds.flatMap(m => m.tiles)].filter(t => caijinSet.has(t)).length;
}

function addTransfer(transfers, fromPid, toPid, amount) {
  if (!amount) return;
  transfers[fromPid] = (transfers[fromPid] || 0) - amount;
  transfers[toPid] = (transfers[toPid] || 0) + amount;
}

function resolveWin(game, winnerId, loserId, isSelfDraw, winTile, winInfo) {
  winInfo ||= {};
  const dealerPid = game.playerIds[game.dealerSeat];
  const winnerIsDealer = winnerId === dealerPid;
  const concealed = getPlayableHand(game, winnerId);
  const openMelds = game.seats[winnerId].openMelds;
  const actualWinTile = winTile || concealed[concealed.length - 1] || null;

  const scoreResult = calcWinScore(concealed, openMelds, game.caijinTile, {
    isSelfDraw,
    isTianHu: winInfo.isTianHu || false,
    isDiHu: winInfo.isDiHu || false,
    isGangWin: game.lastDrawWasGang && isSelfDraw,
    isQiangGang: winInfo.isQiangGang || false,
    isPaoma: winInfo.isPaoma || false,
    isStandardWin: true,
    ruleset: game.ruleset,
    caijinTiles: game.caijinTiles,
    flowers: game.seats[winnerId].flowers || [],
    baiCount: game.seats[winnerId].baiCollected?.length || 0,
    seatWind: game.seats[winnerId].wind,
    isLastTile: game.isLastTile,
    winTile: actualWinTile,
  });

  const transfers = {};
  const { type, mult, caijinFen } = scoreResult;
  const isSoftPointWin = !isSelfDraw && type === '软牌' && caijinFen > 0;
  const base = isSoftPointWin ? 1 : 2;
  const dealerMultiplier = (game.dealerStreak || 1) * 2;
  const packagePayer = winInfo.packagePayer || null;
  const payDetails = [];

  for (const pid of game.playerIds) {
    if (pid === winnerId) continue;
    const payerIsDealer = pid === dealerPid;
    const effectiveMult = mult * (winnerIsDealer || payerIsDealer ? dealerMultiplier : 1);
    const amount = effectiveMult * base + caijinFen;
    payDetails.push({ from: pid, to: winnerId, amount, effectiveMult });
    addTransfer(transfers, pid, winnerId, amount);
  }

  const caijinSideTransfers = [];
  const nonWinners = game.playerIds.filter(pid => pid !== winnerId);
  for (let i = 0; i < nonWinners.length; i++) {
    for (let j = i + 1; j < nonWinners.length; j++) {
      const a = nonWinners[i];
      const b = nonWinners[j];
      const diff = countCaijin(game, a) - countCaijin(game, b);
      if (diff > 0) {
        addTransfer(transfers, b, a, diff);
        caijinSideTransfers.push({ from: b, to: a, amount: diff });
      } else if (diff < 0) {
        addTransfer(transfers, a, b, -diff);
        caijinSideTransfers.push({ from: a, to: b, amount: -diff });
      }
    }
  }

  game.winner = winnerId;
  game.scores = {
    transfers,
    scoreResult: { ...scoreResult, base, dealerMultiplier, packagePayer },
    type,
    total: scoreResult.total,
    payDetails,
    caijinSideTransfers,
  };
  game.phase = 'ended';
  game.pendingDealerWinner = winnerId;
  return scoreResult;
}

function resolveGangPayment(game, gangerId, gangType) {
  const pts = gangPoints(gangType);
  const transfers = {};
  for (const pid of game.playerIds) {
    if (pid === gangerId) continue;
    game.seats[pid].score -= pts;
    game.seats[gangerId].score += pts;
    transfers[pid] = -pts;
  }
  return { pts, transfers };
}

function nextTurn(game) {
  game.currentTurn = (game.currentTurn + 1) % 4;
  return game.playerIds[game.currentTurn];
}

function currentPlayer(game) {
  return game.playerIds[game.currentTurn];
}

module.exports = {
  createGame,
  initRound,
  drawTile,
  drawTileAfterGang,
  discardTile,
  doPeng,
  doChi,
  doOpenGang,
  doConcealedGang,
  checkPlayerWin,
  resolveWin,
  resolveGangPayment,
  nextTurn,
  currentPlayer,
  processBaiInHand,
  getPlayableHand,
  getFlowerTiles,
  hasFlowersInHand,
  replaceFlowerTiles,
};

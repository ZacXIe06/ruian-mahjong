'use strict';
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const https = require('https');

const {
  createGame, initRound, drawTile, drawTileAfterGang,
  drawHaidiTile,
  discardTile, doPeng, doChi, doOpenGang, doConcealedGang,
  checkPlayerWin, resolveWin, resolveGangPayment, nextTurn, currentPlayer,
  getFlowerTiles, hasFlowersInHand, replaceFlowerTiles, getPlayableHand,
} = require('./game/game-state');
const { isBai } = require('./game/tiles');
const { calcWinScore } = require('./game/scorer');
const { RULESETS, normalizeRuleset } = require('./game/rulesets');
const { countMeldMatches, canUseTileForMeld, getChiOptions } = require('./game/rule-logic');
const { STORE_MODE, loadRooms, saveRooms } = require('./storage/room-store');

const app = express();
const server = http.createServer(app);
const SOCKET_IO_OPTIONS = {
  cors: { origin: '*' },
  transports: process.env.VERCEL ? ['websocket'] : ['websocket', 'polling'],
};
const io = new Server(server, SOCKET_IO_OPTIONS);

app.use(express.static(path.join(__dirname, 'public')));

const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];
const TURN_CONFIG_PATH = path.join(__dirname, 'deploy', 'turn.local.json');
let cachedIceServers = null;
let cachedIceServersAt = 0;

function readTurnConfig() {
  const config = {};
  if (process.env.ICE_SERVERS_JSON) {
    try { config.iceServers = JSON.parse(process.env.ICE_SERVERS_JSON); } catch {}
  }
  if (process.env.METERED_TURN_URL) config.meteredTurnUrl = process.env.METERED_TURN_URL;
  if (process.env.METERED_TURN_APP && process.env.METERED_TURN_API_KEY) {
    config.meteredTurnUrl = `https://${process.env.METERED_TURN_APP}.metered.live/api/v1/turn/credentials?apiKey=${process.env.METERED_TURN_API_KEY}`;
  }
  if (fs.existsSync(TURN_CONFIG_PATH)) {
    try {
      const raw = fs.readFileSync(TURN_CONFIG_PATH, 'utf8').replace(/^\uFEFF/, '');
      Object.assign(config, JSON.parse(raw));
    } catch (err) {
      console.warn('TURN config parse failed:', err.message);
    }
  }
  return config;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 8000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(body)); } catch (err) { reject(err); }
      });
    }).on('error', reject).on('timeout', function onTimeout() {
      this.destroy(new Error('TURN request timeout'));
    });
  });
}

async function getIceServers() {
  const config = readTurnConfig();
  if (Array.isArray(config.iceServers) && config.iceServers.length) {
    return [...DEFAULT_ICE_SERVERS, ...config.iceServers];
  }
  const now = Date.now();
  if (cachedIceServers && now - cachedIceServersAt < 5 * 60 * 1000) return cachedIceServers;
  if (config.meteredTurnUrl) {
    try {
      const remoteIceServers = await fetchJson(config.meteredTurnUrl);
      if (Array.isArray(remoteIceServers) && remoteIceServers.length) {
        cachedIceServers = [...DEFAULT_ICE_SERVERS, ...remoteIceServers];
        cachedIceServersAt = now;
        return cachedIceServers;
      }
    } catch (err) {
      console.warn('TURN credentials fetch failed:', err.message);
    }
  }
  return DEFAULT_ICE_SERVERS;
}

app.get('/api/ice-servers', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await getIceServers());
});

const rooms = {}; // { roomId: { players:[{id,name,isBot}], ruleset, game } }
const BOT_NAMES = ['机器人甲', '机器人乙', '机器人丙'];
const ACTION_TIMEOUT_MS = 20000;
const LATE_HU_GRACE_MS = 8000;
const ACTION_SETTLE_GRACE_MS = 1500;
const LATE_ACTION_GRACE_MS = 5000;
let persistTimer = null;
let persistInFlight = null;

function queuePersistRooms(delay = 200) {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistInFlight = Promise.resolve(saveRooms(rooms))
      .catch(err => console.warn('room persistence failed:', err.message))
      .finally(() => { persistInFlight = null; });
  }, delay);
}

async function flushPersistRooms() {
  clearTimeout(persistTimer);
  persistTimer = null;
  try {
    await saveRooms(rooms);
  } catch (err) {
    console.warn('room persistence failed:', err.message);
  }
  if (persistInFlight) await persistInFlight;
}

// ── Helpers ──────────────────────────────────────────────────────
function isBot(pid) { return typeof pid === 'string' && pid.startsWith('bot_'); }

function makePlayerToken() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function publicPlayers(room) {
  return room.players.map(p => ({
    id: p.id,
    name: p.name,
    isBot: !!p.isBot,
    disconnected: !!p.disconnected,
  }));
}

function roomUpdatePayload(room, roomId) {
  const ruleset = room?.ruleset || 'ruian';
  return {
    players: publicPlayers(room),
    roomId,
    ruleset,
    rulesetName: RULESETS[ruleset]?.name || '瑞安麻将',
  };
}

function getRoomForPlayer(socketId) {
  return Object.values(rooms).find(r => r.players.some(p => p.id === socketId));
}

async function restorePersistedRooms() {
  try {
    const restored = await loadRooms();
    for (const [roomId, room] of Object.entries(restored || {})) {
      rooms[roomId] = room;
      rooms[roomId].mediaActive = new Set();
      for (const player of rooms[roomId].players || []) {
        if (!player.isBot) player.disconnected = true;
      }
      if (rooms[roomId]?.game) {
        rooms[roomId].game.roomId = roomId;
      }
    }
    const count = Object.keys(restored || {}).length;
    console.log(`loaded ${count} room snapshot(s) from ${STORE_MODE}`);
  } catch (err) {
    console.warn('room restore failed:', err.message);
  }
}

function replaceObjectKey(obj, oldId, newId) {
  if (!obj || oldId === newId || !(oldId in obj)) return;
  obj[newId] = obj[oldId];
  delete obj[oldId];
}

function replacePlayerId(room, oldId, newId) {
  if (!room || !oldId || !newId || oldId === newId) return;
  room.mediaActive?.delete(oldId);
  if (room.game) {
    const g = room.game;
    g.playerIds = g.playerIds.map(id => id === oldId ? newId : id);
    replaceObjectKey(g.seats, oldId, newId);
    if (g.lastDiscard?.playerId === oldId) g.lastDiscard.playerId = newId;
    if (g.winner === oldId) g.winner = newId;
    if (g.pendingDealerWinner === oldId) g.pendingDealerWinner = newId;
    if (g.pendingAutoDraw?.playerId === oldId) g.pendingAutoDraw.playerId = newId;
    for (const d of g.discardPile || []) if (d.playerId === oldId) d.playerId = newId;
    for (const seat of Object.values(g.seats || {})) {
      for (const meld of seat.openMelds || []) if (meld.from === oldId) meld.from = newId;
    }
    if (g.genfengStreak?.players) {
      g.genfengStreak.players = g.genfengStreak.players.map(id => id === oldId ? newId : id);
    }
    if (g.lastGenfeng) {
      if (g.lastGenfeng.leader === oldId) g.lastGenfeng.leader = newId;
      if (g.lastGenfeng.followers) g.lastGenfeng.followers = g.lastGenfeng.followers.map(id => id === oldId ? newId : id);
    }
    for (const actionState of [g.waitingForAction, g.lastActionWindow]) {
      if (!actionState) continue;
      if (actionState.fromPlayer === oldId) actionState.fromPlayer = newId;
      replaceObjectKey(actionState.actions, oldId, newId);
      replaceObjectKey(actionState.responded, oldId, newId);
    }
  }
  replaceObjectKey(room.settlementBaseScores, oldId, newId);
  replaceObjectKey(room.settlementPayments, oldId, newId);
  for (const payments of Object.values(room.settlementPayments || {})) replaceObjectKey(payments, oldId, newId);
  if (room.nextRoundReady?.has(oldId)) {
    room.nextRoundReady.delete(oldId);
    room.nextRoundReady.add(newId);
  }
}

function canSwapSeats(room) {
  const phase = room?.game?.phase;
  return !room?.game || phase === 'ended' || phase === 'liuju' || phase === 'waiting';
}

function refreshSeatWinds(game) {
  if (!game) return;
  const winds = ['east', 'south', 'west', 'north'];
  for (let i = 0; i < game.playerIds.length; i++) {
    const pid = game.playerIds[i];
    if (game.seats[pid]) game.seats[pid].wind = winds[(i - game.dealerSeat + 4) % 4];
  }
}

function swapPlayerOrder(room, a, b) {
  if (!room || !a || !b || a === b) return false;
  const ai = room.players.findIndex(p => p.id === a);
  const bi = room.players.findIndex(p => p.id === b);
  if (ai === -1 || bi === -1) return false;
  [room.players[ai], room.players[bi]] = [room.players[bi], room.players[ai]];
  if (room.game) {
    const gi = room.game.playerIds.indexOf(a);
    const gj = room.game.playerIds.indexOf(b);
    if (gi === -1 || gj === -1) return false;
    [room.game.playerIds[gi], room.game.playerIds[gj]] = [room.game.playerIds[gj], room.game.playerIds[gi]];
    refreshSeatWinds(room.game);
  }
  return true;
}

function broadcastGameState(roomId) {
  const room = rooms[roomId];
  if (!room?.game) return;
  const g = room.game;
  const playerNames = room.players.reduce((a, p) => { a[p.id] = p.name; return a; }, {});

  for (const pid of g.playerIds) {
    if (isBot(pid)) continue;
    const sock = io.sockets.sockets.get(pid);
    if (!sock) continue;

    const seats = {};
    for (const [id, seat] of Object.entries(g.seats)) {
      const allKnownTiles = [...seat.hand, ...seat.openMelds.flatMap(m => m.tiles || [])];
      const playableHand = getPlayableHand(g, id);
      const previewScore = calcWinScore(playableHand, seat.openMelds, g.caijinTile, {
        isSelfDraw: true,
        isStandardWin: true,
        ruleset: g.ruleset || room.ruleset || 'ruian',
        caijinTiles: g.caijinTiles,
        flowers: seat.flowers || [],
        baiCount: seat.baiCollected?.length || 0,
        seatWind: seat.wind,
        isLastTile: g.isLastTile,
        winTile: playableHand[playableHand.length - 1] || null,
        faceOnly: (g.ruleset || room.ruleset) === 'pingyang_taipao',
      });
      seats[id] = {
        wind: seat.wind,
        handCount: seat.hand.length,
        hand: id === pid || (g.phase === 'ended' && id === g.winner) ? seat.hand : null,
        openMelds: seat.openMelds,
        discards: seat.discards,
        baiCount: seat.baiCollected.length,
        baiTiles: seat.baiCollected || [],
        flowers: seat.flowers || [],
        flowerCount: (seat.flowers || []).length,
        caijinCount: g.phase === 'ended'
          ? allKnownTiles.filter(t => (g.caijinTiles?.length ? g.caijinTiles : [g.caijinTile]).includes(t)).length
          : null,
        taiCount: g.phase === 'ended'
          ? (g.scores?.scoreResult?.killPig && id !== g.winner ? 0 : (previewScore?.totalTai ?? null))
          : (id === pid && (g.ruleset || room.ruleset) === 'pingyang_taipao' ? (previewScore?.totalTai ?? 0) : null),
        score: seat.score,
        isBot: isBot(id),
      };
    }
    sock.emit('game_state', {
      roomId, caijinTile: g.caijinTile, caijinTiles: g.caijinTiles || [g.caijinTile], diceRoll: g.diceRoll,
      wallLeft: g.wallLeft, currentTurn: g.playerIds[g.currentTurn],
      phase: g.phase, lastDiscard: g.lastDiscard,
      lastGenfeng: g.lastGenfeng,
      seats, myId: pid, playerOrder: g.playerIds, playerNames,
      winner: g.winner, scores: g.scores, dealerSeat: g.dealerSeat, dealerStreak: g.dealerStreak,
      ruleset: g.ruleset || room.ruleset || 'ruian',
      rulesetName: RULESETS[g.ruleset || room.ruleset || 'ruian']?.name || '瑞安麻将',
    });
  }
  queuePersistRooms();
}

// ── Bot logic ─────────────────────────────────────────────────────
const HONOR_RE = /^(east|south|west|north|zhong|fa)$/;

function botChooseDiscard(hand, caijinTile) {
  // Prefer discarding honors > 1/9 isolated > anything non-caijin
  const safe = hand.filter(t => !isBai(t) && t !== caijinTile);
  return safe.find(t => HONOR_RE.test(t) && safe.filter(x => x === t).length === 1)
    || safe.find(t => !HONOR_RE.test(t) && (t.startsWith('1') || t.startsWith('9')))
    || safe[safe.length - 1]
    || hand[0];
}

function scheduleBotTurn(room, botId, delay = 2000) {
  const g = room.game;
  if (!g || g.phase !== 'playing') return;
  setTimeout(() => {
    if (!room.game || room.game.phase !== 'playing') return;
    if (currentPlayer(room.game) !== botId) return;
    const hand = room.game.seats[botId].hand;
    const tile = botChooseDiscard(hand, room.game.caijinTile);
    if (!tile) return;
    handleDiscard(room, botId, tile);
  }, delay);
}

function announce(roomOrId, payload) {
  const roomId = typeof roomOrId === 'string' ? roomOrId : roomOrId?.game?.roomId;
  if (roomId) io.to(roomId).emit('voice_announcement', payload);
}

function playerLabel(room, pid) {
  if (!room || !pid) return '未知玩家';
  return room.players.find(p => p.id === pid)?.name || (isBot(pid) ? '机器人' : '玩家');
}

function tileName(tile) {
  const honor = { east: '东风', south: '南风', west: '西风', north: '北风', zhong: '红中', fa: '发财', bai: '白板' };
  if (honor[tile]) return honor[tile];
  const suit = { m: '万', t: '筒', b: '条' }[tile?.slice(-1)] || '';
  return tile ? `${tile.slice(0, -1)}${suit}` : '';
}

function formatCaijinLog(caijinTiles) {
  const list = (caijinTiles || []).filter(Boolean);
  if (!list.length) return '未定';
  return list.map(tileName).join(' / ');
}

function startFlowerStage(room, queue, opening = false) {
  const g = room?.game;
  if (!g || !queue?.length) return false;
  const normalizedQueue = [...new Set(queue)].filter(pid => g.playerIds.includes(pid));
  if (!normalizedQueue.length) return false;
  if (!normalizedQueue.some(pid => hasFlowersInHand(g, pid))) return false;
  while (normalizedQueue.length && !hasFlowersInHand(g, normalizedQueue[0])) normalizedQueue.shift();
  if (!normalizedQueue.length) return false;
  g.phase = 'flowering';
  g.pendingFlower = { queue: normalizedQueue, currentPlayer: normalizedQueue[0], opening };
  g.currentTurn = g.playerIds.indexOf(normalizedQueue[0]);
  return true;
}

function maybeStartOpeningFlowerStage(room) {
  const g = room?.game;
  if (!g || g.ruleset !== 'pingyang_taipao') return false;
  const ordered = [0, 1, 2, 3].map(i => g.playerIds[(g.dealerSeat + i) % 4]);
  return startFlowerStage(room, ordered, true);
}

function continueAfterFlowerStage(room) {
  const g = room?.game;
  if (!g?.pendingFlower) return;
  const pending = g.pendingFlower;
  const pid = pending.currentPlayer;
  if (hasFlowersInHand(g, pid)) return promptFlowerReplacement(room, pid);

  pending.queue.shift();
  if (hasFlowersInHand(g, pid)) pending.queue.push(pid);
  while (pending.queue.length && !hasFlowersInHand(g, pending.queue[0])) pending.queue.shift();

  if (pending.queue.length) {
    pending.currentPlayer = pending.queue[0];
    g.currentTurn = g.playerIds.indexOf(pending.currentPlayer);
    return promptFlowerReplacement(room, pending.currentPlayer);
  }

  const opening = pending.opening;
  g.pendingFlower = null;
  g.phase = 'playing';
  if (opening) {
    const dealerPid = currentPlayer(g);
    const firstTile = g.ruleset === 'pingyang_taipao' ? null : drawTile(g, dealerPid);
    broadcastGameState(g.roomId);
    return beginTurnForPlayer(room, dealerPid, firstTile, { canTianhu: true });
  }

  broadcastGameState(g.roomId);
  return beginTurnForPlayer(room, pid, null);
}

function promptFlowerReplacement(room, playerId) {
  const g = room?.game;
  if (!g) return;
  g.phase = 'flowering';
  g.currentTurn = g.playerIds.indexOf(playerId);
  broadcastGameState(g.roomId);
  const flowers = getFlowerTiles(g, playerId);
  if (isBot(playerId)) {
    setTimeout(() => {
      if (room?.game?.pendingFlower?.currentPlayer !== playerId) return;
      handleFlowerReplace(room, playerId, flowers);
    }, 500);
    return;
  }
  io.to(playerId).emit('your_turn', {
    action: 'flower_replace',
    flowers,
    openingFlower: !!g.pendingFlower?.opening,
  });
}

function ensurePlayerFlowerStage(room, playerId, opening = false) {
  const g = room?.game;
  if (!g || g.ruleset !== 'pingyang_taipao') return false;
  if (currentPlayer(g) !== playerId) return false;
  if (!hasFlowersInHand(g, playerId)) return false;
  if (g.phase !== 'flowering' || g.pendingFlower?.currentPlayer !== playerId) {
    startFlowerStage(room, [playerId], opening);
  }
  promptFlowerReplacement(room, playerId);
  return true;
}

function beginTurnForPlayer(room, playerId, drawnTile = null, extra = {}) {
  const g = room?.game;
  if (!g) return;
  if (g.phase === 'liuju') {
    io.to(g.roomId).emit('liuju');
    return;
  }
  if (g.ruleset === 'pingyang_taipao' && hasFlowersInHand(g, playerId)) {
    startFlowerStage(room, [playerId], false);
    return promptFlowerReplacement(room, playerId);
  }
  g.phase = 'playing';
  broadcastGameState(g.roomId);
  if (isBot(playerId)) {
    scheduleBotTurn(room, playerId, extra.afterGang ? 1000 : 1500);
    return;
  }
  const wc = checkPlayerWin(g, playerId, drawnTile, true);
  if (wc.win) io.to(playerId).emit('can_hu_self', { tile: drawnTile });
  io.to(playerId).emit('your_turn', { action: 'discard_or_hu', drawnTile, canHu: wc.win, ...extra });
}

function handleFlowerReplace(room, playerId, requestedTiles = []) {
  const g = room?.game;
  if (!g || g.phase !== 'flowering' || g.pendingFlower?.currentPlayer !== playerId) return false;
  const result = replaceFlowerTiles(g, playerId, requestedTiles);
  if (!result.replaced.length) return false;
  logRoom(room, `${playerLabel(room, playerId)} 补花 ${result.replaced.map(tileName).join(' ')}`);
  const pending = g.pendingFlower;
  if (result.stillHasFlowers && pending?.currentPlayer === playerId && !pending.queue.includes(playerId)) {
    pending.queue.push(playerId);
  }
  continueAfterFlowerStage(room);
  return true;
}

function logRoom(room, text, detail = {}) {
  if (!room) return;
  room.eventLog ||= [];
  const item = { at: Date.now(), text, detail };
  room.eventLog.push(item);
  if (room.eventLog.length > 80) room.eventLog.splice(0, room.eventLog.length - 80);
  const roomId = room.game?.roomId || Object.keys(rooms).find(k => rooms[k] === room);
  if (roomId) io.to(roomId).emit('game_log_entry', item);
  queuePersistRooms();
}

function emitNextRoundReady(room) {
  if (!room?.game) return;
  const readyHumans = room.nextRoundReady || new Set();
  const botCount = room.players.filter(p => p.isBot).length;
  const ready = Math.min(4, readyHumans.size + botCount);
  io.to(room.game.roomId).emit('new_round_ready', { ready, total: 4, readyPlayers: [...readyHumans] });
}

function beginNewRound(room) {
  const oldGame = room.game;
  const roomId = oldGame.roomId;
  const dealerPid = oldGame.playerIds[oldGame.dealerSeat];
  let nextDealerSeat = oldGame.dealerSeat;
  let nextDealerStreak = oldGame.dealerStreak;
  if (oldGame.pendingDealerWinner) {
    if (oldGame.pendingDealerWinner === dealerPid && oldGame.dealerStreak < 3) {
      nextDealerStreak = oldGame.dealerStreak + 1;
    } else {
      nextDealerSeat = (oldGame.dealerSeat + 1) % 4;
      nextDealerStreak = 1;
    }
  }
  const nextGame = createGame(roomId, [...oldGame.playerIds]);
  nextGame.ruleset = oldGame.ruleset || room.ruleset || 'ruian';
  nextGame.dealerSeat = nextDealerSeat;
  nextGame.dealerStreak = nextDealerStreak;
  nextGame.round = (oldGame.round || 1) + 1;
  for (const pid of nextGame.playerIds) {
    nextGame.seats[pid] = { score: oldGame.seats[pid]?.score ?? (nextGame.ruleset === 'pingyang_taipao' ? 200 : 100) };
  }
  room.game = nextGame;
  room.eventLog = [];
  room.nextRoundReady = new Set();
  room.settlementBaseScores = null;
  room.settlementPayments = {};
  initRound(nextGame);
  if (room.game.openingRedeal?.playerId) {
    logRoom(room, `${playerLabel(room, room.game.openingRedeal.playerId)} 起手东南西北中发白，整副牌重洗并重新翻财神`);
  }
  logRoom(room, `新一局开始，财神 ${formatCaijinLog(room.game.caijinTiles || [room.game.caijinTile])}`);
  io.to(roomId).emit('game_started', {
    caijinTile: room.game.caijinTile,
    caijinTiles: room.game.caijinTiles || [room.game.caijinTile],
    diceRoll: room.game.diceRoll,
    openingRedeal: room.game.openingRedeal,
    ruleset: room.game.ruleset,
    rulesetName: RULESETS[room.game.ruleset]?.name || '瑞安麻将',
  });
  if (!maybeStartOpeningFlowerStage(room)) {
    const firstDealerPid = currentPlayer(room.game);
    const firstTile = room.game.ruleset === 'pingyang_taipao' ? null : drawTile(room.game, firstDealerPid);
    beginTurnForPlayer(room, firstDealerPid, firstTile, { canTianhu: true });
  } else {
    promptFlowerReplacement(room, room.game.pendingFlower.currentPlayer);
  }
}

function snapshotSettlementBase(room) {
  if (!room?.game) return;
  room.settlementBaseScores = {};
  for (const pid of room.game.playerIds) {
    room.settlementBaseScores[pid] = room.game.seats[pid]?.score ?? (room.game.ruleset === 'pingyang_taipao' ? 200 : 100);
  }
  room.settlementPayments = {};
}

function applySettlementPayments(room) {
  const g = room.game;
  if (!g || !room.settlementBaseScores) return;
  for (const pid of g.playerIds) {
    if (g.seats[pid]) g.seats[pid].score = room.settlementBaseScores[pid] ?? g.seats[pid].score;
  }
  for (const [from, payments] of Object.entries(room.settlementPayments || {})) {
    if (!g.seats[from]) continue;
    for (const [to, raw] of Object.entries(payments || {})) {
      if (!g.seats[to] || to === from) continue;
      const amount = Math.round(Number(raw) * 100) / 100;
      if (!Number.isFinite(amount) || amount <= 0) continue;
      g.seats[from].score -= amount;
      g.seats[to].score += amount;
    }
  }
}

function updateSettlementPayments(room, from, payments) {
  if (!room?.game || !room.settlementBaseScores) return;
  const clean = {};
  for (const [to, raw] of Object.entries(payments || {})) {
    if (!room.game.playerIds.includes(to) || to === from) continue;
    const amount = Math.round(Number(raw) * 100) / 100;
    if (Number.isFinite(amount) && amount > 0) clean[to] = amount;
  }
  room.settlementPayments[from] = clean;
  applySettlementPayments(room);
  broadcastGameState(room.game.roomId);
}

// ── Core turn flow (shared by human + bot) ───────────────────────
function handleDiscard(room, fromPid, tile) {
  const g = room.game;
  if (currentPlayer(g) !== fromPid || g.phase !== 'playing') return false;
  g.pendingAutoDraw = null;
  if (!discardTile(g, fromPid, tile)) return false;
  announce(room, { type: 'discard', playerId: fromPid, tile });
  logRoom(room, `${playerLabel(room, fromPid)} 打出 ${tileName(tile)}`);

  const allActions = computeAvailableActions(g, tile, fromPid);
  // Split: human vs bot actions
  const humanActions = {}, botPassing = {};
  for (const [pid, acts] of Object.entries(allActions)) {
    if (isBot(pid)) botPassing[pid] = { action: 'pass' }; // bots always pass
    else humanActions[pid] = acts;
  }

  if (Object.keys(humanActions).length > 0) {
    const deadline = Date.now() + ACTION_TIMEOUT_MS;
    const actionId = (room.actionWindowSeq || 0) + 1;
    room.actionWindowSeq = actionId;
    g.waitingForAction = {
      id: actionId,
      tile, fromPlayer: fromPid, actions: allActions,
      responded: { ...botPassing }, deadline,
    };
    logRoom(room, `等待操作：${Object.entries(humanActions).map(([pid, acts]) => `${playerLabel(room, pid)} 可${acts.join('/')}`).join('，')}`);
    g.lastActionWindow = { tile, fromPlayer: fromPid, actions: allActions, deadline, createdAt: Date.now(), discardSeq: g.discardPile.length };
    broadcastGameState(g.roomId);
    for (const [pid, acts] of Object.entries(humanActions)) {
      io.to(pid).emit('action_prompt', { tile, acts, fromPlayer: fromPid, deadline, timeoutMs: ACTION_TIMEOUT_MS });
    }
    if (canResolveWaitingAction(g)) {
      resolveAndContinue(room, actionId);
    } else {
      setTimeout(() => resolveAndContinue(room, actionId), ACTION_TIMEOUT_MS + ACTION_SETTLE_GRACE_MS);
    }
  } else {
    advanceTurn(room);
  }
  return true;
}

function advanceTurn(room) {
  const g = room.game;
  if (g.waitingForAction) return;
  if (maybeResolvePingyangHaidi(room)) return;
  const nextPid = nextTurn(g);
  const drawn = drawTile(g, nextPid);
  g.pendingAutoDraw = drawn ? { playerId: nextPid, tile: drawn, wallIdx: g.wallIdx, discardSeq: g.discardPile.length, createdAt: Date.now() } : null;
  beginTurnForPlayer(room, nextPid, drawn);
}

function maybeResolvePingyangHaidi(room) {
  const g = room?.game;
  if (!g || g.ruleset !== 'pingyang_taipao' || g.phase !== 'playing') return false;
  if (g.wallLeft > 20) return false;

  g.phase = 'haidi';
  const startIdx = (g.currentTurn + 1) % 4;
  const order = [0, 1, 2, 3].map(i => g.playerIds[(startIdx + i) % 4]);
  const draws = [];
  const winners = [];

  for (const pid of order) {
    const tile = drawHaidiTile(g, pid);
    if (!tile) break;
    draws.push({ playerId: pid, tile });
    const wc = checkPlayerWin(g, pid, tile, true);
    if (wc.win) winners.push({ playerId: pid, tile, winInfo: wc });
  }

  logRoom(room, `海底摸牌：${draws.map(item => `${playerLabel(room, item.playerId)} ${tileName(item.tile)}`).join('，')}`);

  if (winners.length) {
    const winner = winners[0];
    resolveWin(g, winner.playerId, null, true, winner.tile, { isLastTile: true });
    room.nextRoundReady = new Set();
    snapshotSettlementBase(room);
    broadcastGameState(g.roomId);
    io.to(g.roomId).emit('round_end', { winner: winner.playerId, scores: g.scores, haidi: true, haidiDraws: draws });
    return true;
  }

  g.phase = 'liuju';
  g.scores = {
    type: '流局',
    ruleset: 'pingyang_taipao',
    totalTai: 0,
    taiDetails: [],
    haidiDraws: draws,
  };
  room.nextRoundReady = new Set();
  snapshotSettlementBase(room);
  broadcastGameState(g.roomId);
  io.to(g.roomId).emit('liuju', { haidiDraws: draws });
  return true;
}

function resolveAndContinue(room, actionId = null) {
  const g = room.game;
  if (!g?.waitingForAction) return;
  if (actionId != null && g.waitingForAction.id !== actionId) return;
  const waiting = g.waitingForAction;
  const { tile, fromPlayer, actions, responded } = waiting;
  g.waitingForAction = null;
  g.lastActionWindow = { ...waiting, discardSeq: g.discardPile.length, resolvedAt: Date.now() };

  // Priority: hu > gang > peng > chi (find first by seat order from discard player)
  const fromIdx = g.playerIds.indexOf(fromPlayer);
  const order = [1, 2, 3].map(i => g.playerIds[(fromIdx + i) % 4]);

  let huPlayer = null, gangPlayer = null, pengPlayer = null, chiPlayer = null, chiTiles = null;
  for (const pid of order) {
    const resp = responded[pid] || { action: 'pass' };
    if (!huPlayer && resp.action === 'hu' && actions[pid]?.includes('hu')) huPlayer = pid;
    if (!gangPlayer && resp.action === 'gang' && actions[pid]?.includes('gang')) gangPlayer = pid;
    if (!pengPlayer && resp.action === 'peng' && actions[pid]?.includes('peng')) pengPlayer = pid;
    if (!chiPlayer && resp.action === 'chi' && resp.tiles?.length && actions[pid]?.includes('chi')) {
      chiPlayer = pid; chiTiles = resp.tiles;
    }
  }

  if (huPlayer) {
    logRoom(room, `${playerLabel(room, huPlayer)} 胡 ${tileName(tile)}`);
    resolveWin(g, huPlayer, fromPlayer, !!waiting.qiangGang, tile, {
      isQiangGang: !!waiting.qiangGang,
      packagePayer: waiting.qiangGang ? fromPlayer : null,
    });
    room.nextRoundReady = new Set();
    snapshotSettlementBase(room);
    broadcastGameState(g.roomId);
    io.to(g.roomId).emit('round_end', { winner: huPlayer, scores: g.scores });
    return;
  }

  if (waiting.qiangGang) {
    completeOpenGangAfterQiangGang(room, fromPlayer, tile);
    return;
  }

  if (gangPlayer) {
    g.pendingAutoDraw = null;
    const pengOk = doPeng(g, gangPlayer, tile);
    const gangOk = pengOk && doOpenGang(g, gangPlayer, tile);
    if (!gangOk) { advanceTurn(room); return; }
    announce(room, { type: 'gang', playerId: gangPlayer, tile });
    logRoom(room, `${playerLabel(room, gangPlayer)} 杠 ${tileName(tile)}`);
    const gangPayment = resolveGangPayment(g, gangPlayer, 'open_gang');
    io.to(g.roomId).emit('gang_payment', {
      gangerId: gangPlayer,
      gangType: 'open_gang',
      pts: gangPayment.pts,
      transfers: gangPayment.transfers,
    });
    const drawn = drawTileAfterGang(g, gangPlayer);
    g.currentTurn = g.playerIds.indexOf(gangPlayer);
    if (!drawn) { io.to(g.roomId).emit('liuju'); return; }
    beginTurnForPlayer(room, gangPlayer, drawn, { afterGang: true });
    return;
  }

  if (pengPlayer) {
    g.pendingAutoDraw = null;
    const ok = doPeng(g, pengPlayer, tile);
    if (!ok) { advanceTurn(room); return; }
    announce(room, { type: 'peng', playerId: pengPlayer, tile });
    logRoom(room, `${playerLabel(room, pengPlayer)} 碰 ${tileName(tile)}`);
    g.currentTurn = g.playerIds.indexOf(pengPlayer);
    broadcastGameState(g.roomId);
    if (isBot(pengPlayer)) { scheduleBotTurn(room, pengPlayer, 1500); }
    else io.to(pengPlayer).emit('your_turn', { action: 'discard_only' });
    return;
  }

  if (chiPlayer && chiTiles) {
    g.pendingAutoDraw = null;
    const ok = doChi(g, chiPlayer, tile, chiTiles);
    if (!ok) { advanceTurn(room); return; }
    announce(room, { type: 'chi', playerId: chiPlayer, tile, tiles: chiTiles });
    logRoom(room, `${playerLabel(room, chiPlayer)} 吃 ${tileName(tile)}`);
    g.currentTurn = g.playerIds.indexOf(chiPlayer);
    broadcastGameState(g.roomId);
    if (isBot(chiPlayer)) { scheduleBotTurn(room, chiPlayer, 1500); }
    else io.to(chiPlayer).emit('your_turn', { action: 'discard_only' });
    return;
  }

  advanceTurn(room);
}

function completeOpenGangAfterQiangGang(room, gangerId, tile) {
  const g = room.game;
  const ok = doOpenGang(g, gangerId, tile);
  if (!ok) {
    io.to(gangerId).emit('error', '无法杠');
    broadcastGameState(g.roomId);
    return;
  }
  announce(room, { type: 'gang', playerId: gangerId, tile });
  const gangPayment = resolveGangPayment(g, gangerId, 'open_gang');
  io.to(g.roomId).emit('gang_payment', {
    gangerId,
    gangType: 'open_gang',
    pts: gangPayment.pts,
    transfers: gangPayment.transfers,
  });
  const drawn = drawTileAfterGang(g, gangerId);
  g.currentTurn = g.playerIds.indexOf(gangerId);
  if (!drawn) { io.to(g.roomId).emit('liuju'); return; }
  beginTurnForPlayer(room, gangerId, drawn, { afterGang: true });
}

function maybeStartQiangGangWindow(room, gangerId, tile) {
  const g = room.game;
  const allActions = {};
  const humanActions = {};
  const botPassing = {};

  for (const pid of g.playerIds) {
    if (pid === gangerId) continue;
    if (!checkPlayerWin(g, pid, tile, false).win) continue;
    allActions[pid] = ['hu'];
    if (isBot(pid)) botPassing[pid] = { action: 'pass' };
    else humanActions[pid] = ['hu'];
  }

  if (Object.keys(allActions).length === 0) return false;

  const deadline = Date.now() + ACTION_TIMEOUT_MS;
  const actionId = (room.actionWindowSeq || 0) + 1;
  room.actionWindowSeq = actionId;
  g.waitingForAction = {
    id: actionId,
    tile,
    fromPlayer: gangerId,
    actions: allActions,
    responded: { ...botPassing },
    deadline,
    qiangGang: true,
  };
  logRoom(room, `${playerLabel(room, gangerId)} 补杠 ${tileName(tile)}，等待抢杠胡`);
  g.lastActionWindow = { tile, fromPlayer: gangerId, actions: allActions, deadline, createdAt: Date.now(), qiangGang: true, discardSeq: g.discardPile.length };
  broadcastGameState(g.roomId);
  for (const [pid, acts] of Object.entries(humanActions)) {
    io.to(pid).emit('action_prompt', { tile, acts, fromPlayer: gangerId, qiangGang: true, deadline, timeoutMs: ACTION_TIMEOUT_MS });
  }
  if (canResolveWaitingAction(g)) resolveAndContinue(room, actionId);
  else setTimeout(() => resolveAndContinue(room, actionId), ACTION_TIMEOUT_MS + ACTION_SETTLE_GRACE_MS);
  return true;
}

function actionEligiblePlayers(g) {
  if (!g?.waitingForAction) return [];
  return Object.keys(g.waitingForAction.actions).filter(pid => g.playerIds.includes(pid));
}

function actionOrder(g) {
  const waiting = g?.waitingForAction;
  if (!waiting) return [];
  const fromIdx = g.playerIds.indexOf(waiting.fromPlayer);
  return [1, 2, 3].map(i => g.playerIds[(fromIdx + i) % 4]).filter(pid => waiting.actions[pid]);
}

function hasUnansweredPriority(g, higherPriorityActions) {
  const { actions, responded } = g.waitingForAction;
  return actionEligiblePlayers(g).some(pid =>
    !responded[pid] && higherPriorityActions.some(action => actions[pid]?.includes(action))
  );
}

function hasResponse(g, action) {
  const { actions, responded } = g.waitingForAction;
  return actionEligiblePlayers(g).some(pid => responded[pid]?.action === action && actions[pid]?.includes(action));
}

function firstResponderForAction(g, action) {
  const { actions, responded } = g.waitingForAction;
  return actionOrder(g).find(pid => responded[pid]?.action === action && actions[pid]?.includes(action));
}

function hasUnansweredSameActionBefore(g, candidatePid, action) {
  const { actions, responded } = g.waitingForAction;
  for (const pid of actionOrder(g)) {
    if (pid === candidatePid) return false;
    if (actions[pid]?.includes(action) && !responded[pid]) return true;
  }
  return false;
}

function canResolveWaitingAction(g) {
  if (!g?.waitingForAction) return false;
  const eligible = actionEligiblePlayers(g);
  const { responded } = g.waitingForAction;

  if (eligible.every(pid => responded[pid])) return true;
  const huPlayer = firstResponderForAction(g, 'hu');
  if (huPlayer && !hasUnansweredSameActionBefore(g, huPlayer, 'hu')) return true;
  const gangPlayer = firstResponderForAction(g, 'gang');
  if (gangPlayer && !hasUnansweredPriority(g, ['hu']) && !hasUnansweredSameActionBefore(g, gangPlayer, 'gang')) return true;
  const pengPlayer = firstResponderForAction(g, 'peng');
  if (pengPlayer && !hasUnansweredPriority(g, ['hu', 'gang']) && !hasUnansweredSameActionBefore(g, pengPlayer, 'peng')) return true;
  const chiPlayer = firstResponderForAction(g, 'chi');
  if (chiPlayer && !hasUnansweredPriority(g, ['hu', 'gang', 'peng'])) return true;
  return false;
}

function tryLateHu(room, playerId) {
  const g = room.game;
  const last = g?.lastActionWindow;
  if (!last || last.qiangGang || g.phase !== 'playing') return false;
  if (!last.actions?.[playerId]?.includes('hu')) return false;
  if (Date.now() > last.deadline + LATE_HU_GRACE_MS) return false;
  if (g.discardPile.length !== last.discardSeq) return false;
  if (!g.lastDiscard || g.lastDiscard.tile !== last.tile || g.lastDiscard.playerId !== last.fromPlayer) return false;
  if (!checkPlayerWin(g, playerId, last.tile, false).win) return false;

  g.waitingForAction = null;
  resolveWin(g, playerId, last.fromPlayer, false, last.tile, {});
  room.nextRoundReady = new Set();
  snapshotSettlementBase(room);
  broadcastGameState(g.roomId);
  io.to(g.roomId).emit('round_end', { winner: playerId, scores: g.scores, late: true });
  return true;
}

function rollbackPendingAutoDraw(g) {
  const pending = g.pendingAutoDraw;
  if (!pending?.tile || !pending.playerId) return false;
  if (pending.discardSeq !== g.discardPile.length) return false;
  if (g.wallIdx !== pending.wallIdx) return false;
  if (g.wall[g.wallIdx - 1] !== pending.tile) return false;
  const hand = g.seats[pending.playerId]?.hand;
  if (!hand) return false;
  const idx = hand.lastIndexOf(pending.tile);
  if (idx === -1) return false;
  hand.splice(idx, 1);
  g.wallIdx -= 1;
  g.wallLeft = g.wall.length - g.wallIdx;
  g.isLastTile = g.wallIdx >= g.wall.length;
  g.phase = 'playing';
  g.currentTurn = g.playerIds.indexOf(g.lastDiscard.playerId);
  g.pendingAutoDraw = null;
  return true;
}

function tryLateAction(room, playerId, action, tiles) {
  if (!['chi', 'peng', 'gang'].includes(action)) return false;
  const g = room.game;
  const last = g?.lastActionWindow;
  if (!last || last.qiangGang || g.phase !== 'playing') return false;
  if (!last.actions?.[playerId]?.includes(action)) return false;
  if (Date.now() > (last.resolvedAt || last.deadline) + LATE_ACTION_GRACE_MS) return false;
  if (g.discardPile.length !== last.discardSeq) return false;
  if (!g.lastDiscard || g.lastDiscard.tile !== last.tile || g.lastDiscard.playerId !== last.fromPlayer) return false;
  if (!rollbackPendingAutoDraw(g)) return false;

  const actionId = (room.actionWindowSeq || 0) + 1;
  room.actionWindowSeq = actionId;
  g.waitingForAction = {
    ...last,
    id: actionId,
    responded: { ...(last.responded || {}), [playerId]: { action, tiles } },
  };
  resolveAndContinue(room, actionId);
  return true;
}

// ── Socket handlers ───────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('connected:', socket.id);

  socket.on('create_room', ({ name, playerToken, ruleset }) => {
    const roomId = Math.random().toString(36).slice(2, 7).toUpperCase();
    const token = playerToken || makePlayerToken();
    const roomRuleset = normalizeRuleset(ruleset);
    rooms[roomId] = { players: [{ id: socket.id, token, name: name || '玩家1' }], ruleset: roomRuleset, game: null, mediaActive: new Set(), pendingSeatSwaps: {} };
    socket.join(roomId);
    socket.emit('room_joined', { roomId, playerId: socket.id, playerToken: token });
    io.to(roomId).emit('room_update', roomUpdatePayload(rooms[roomId], roomId));
    queuePersistRooms();
  });

  socket.on('join_room', ({ roomId, name, playerToken }) => {
    const room = rooms[roomId];
    if (room?.game) return socket.emit('error', '补牌失败，请重试');
    if (!room) return socket.emit('error', '补牌失败，请重试');
    const humanCount = room.players.filter(p => !p.isBot).length;
    if (humanCount >= 4) return socket.emit('error', '补牌失败，请重试');
    if (room.players.some(p => p.id === socket.id)) return socket.emit('error', '补牌失败，请重试');
    const token = playerToken || makePlayerToken();
    room.players.push({ id: socket.id, token, name: name || `玩家${humanCount + 1}` });
    socket.join(roomId);
    socket.emit('room_joined', { roomId, playerId: socket.id, playerToken: token });
    io.to(roomId).emit('room_update', roomUpdatePayload(room, roomId));
    queuePersistRooms();
  });

  socket.on('start_game', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (room.players[0].id !== socket.id) return socket.emit('error', '补牌失败，请重试');
    if (room.players.length < 1) return socket.emit('error', '补牌失败，请重试');

    // Fill remaining slots with bots
    let botIdx = 0;
    while (room.players.length < 4) {
      room.players.push({ id: `bot_${Date.now()}_${botIdx}`, name: BOT_NAMES[botIdx] || `机器人${botIdx+1}`, isBot: true });
      botIdx++;
    }

    const game = createGame(roomId, room.players.map(p => p.id));
    game.ruleset = room.ruleset || 'ruian';
    initRound(game);
    room.game = game;
    room.eventLog = [];
    if (game.openingRedeal?.playerId) {
      logRoom(room, `${playerLabel(room, game.openingRedeal.playerId)} 起手东南西北中发白，整副牌重洗并重新翻财神`);
    }
    logRoom(room, `游戏开始，财神 ${formatCaijinLog(game.caijinTiles || [game.caijinTile])}`);

    io.to(roomId).emit('game_started', {
      caijinTile: game.caijinTile,
      caijinTiles: game.caijinTiles || [game.caijinTile],
      diceRoll: game.diceRoll,
      openingRedeal: game.openingRedeal,
      ruleset: game.ruleset,
      rulesetName: RULESETS[game.ruleset]?.name || '瑞安麻将',
    });

    if (!maybeStartOpeningFlowerStage(room)) {
      const dealerPid = currentPlayer(game);
      const firstTile = game.ruleset === 'pingyang_taipao' ? null : drawTile(game, dealerPid);
      beginTurnForPlayer(room, dealerPid, firstTile, { canTianhu: true });
    } else {
      promptFlowerReplacement(room, room.game.pendingFlower.currentPlayer);
    }
  });

  socket.on('discard', ({ tile }) => {
    const room = getRoomForPlayer(socket.id);
    if (!room?.game) return;
    if (ensurePlayerFlowerStage(room, socket.id)) return;
    if (!handleDiscard(room, socket.id, tile)) socket.emit('error', '????');
  });

  socket.on('flower_replace', ({ tiles }) => {
    const room = getRoomForPlayer(socket.id);
    if (!room?.game) return;
    if (room.game.phase !== 'flowering' && ensurePlayerFlowerStage(room, socket.id)) {
      if (handleFlowerReplace(room, socket.id, tiles || [])) return;
    }
    if (!handleFlowerReplace(room, socket.id, tiles || [])) socket.emit('error', '????????');
  });

  socket.on('action_response', ({ action, tiles }) => {
    const room = getRoomForPlayer(socket.id);
    if (!room?.game) return;
    if (!room.game.waitingForAction) {
      if (tryLateAction(room, socket.id, action, tiles)) return;
      if (action === 'hu' && tryLateHu(room, socket.id)) return;
      return;
    }
    const g = room.game;
    const allowed = g.waitingForAction.actions?.[socket.id] || [];
    if (action !== 'pass' && !allowed.includes(action)) return;
    if (action === 'pass' && allowed.length === 0) return;
    g.waitingForAction.responded[socket.id] = { action, tiles };
    logRoom(room, `${playerLabel(room, socket.id)} 选择${action === 'pass' ? '过' : action}`);
    if (canResolveWaitingAction(g)) resolveAndContinue(room, g.waitingForAction.id);
  });

  socket.on('game_log_request', () => {
    const room = getRoomForPlayer(socket.id);
    if (!room) return;
    socket.emit('game_log_snapshot', { entries: room.eventLog || [] });
  });

  socket.on('media_ready', () => {
    const room = getRoomForPlayer(socket.id);
    if (!room) return;
    const rid = Object.keys(rooms).find(k => rooms[k] === room);
    if (!rid) return;
    room.mediaActive ||= new Set();
    const existingPeers = [...room.mediaActive].filter(id => id !== socket.id);
    room.mediaActive.add(socket.id);
    socket.emit('media_peers', { peers: existingPeers, peerInfos: existingPeers.map(id => ({ id, initiator: true })) });
    socket.to(rid).emit('media_ready', { from: socket.id, initiator: false });
  });

  socket.on('media_left', () => {
    const room = getRoomForPlayer(socket.id);
    if (!room) return;
    const rid = Object.keys(rooms).find(k => rooms[k] === room);
    if (!rid) return;
    room.mediaActive?.delete(socket.id);
    socket.to(rid).emit('media_left', { from: socket.id });
    const peers = [...(room.mediaActive || new Set())].filter(id => id !== socket.id);
    socket.emit('media_peers', { peers, peerInfos: peers.map(id => ({ id, initiator: true })) });
  });

  socket.on('media_peers_request', () => {
    const room = getRoomForPlayer(socket.id);
    if (!room) return;
    const peers = [...(room.mediaActive || new Set())].filter(id => id !== socket.id);
    socket.emit('media_peers', { peers, peerInfos: peers.map(id => ({ id, initiator: true })) });
  });

  socket.on('media_signal', ({ to, signal }) => {
    if (!to || !signal) return;
    io.to(to).emit('media_signal', { from: socket.id, signal });
  });

  socket.on('media_resync', () => {
    const room = getRoomForPlayer(socket.id);
    if (!room) return;
    const rid = Object.keys(rooms).find(k => rooms[k] === room);
    if (!rid) return;
    room.mediaActive ||= new Set();
    room.mediaActive.add(socket.id);
    socket.to(rid).emit('media_peer_resync', { from: socket.id, initiator: false });
    const peers = [...(room.mediaActive || new Set())].filter(id => id !== socket.id);
    socket.emit('media_peers', { peers, peerInfos: peers.map(id => ({ id, initiator: true })) });
  });

  socket.on('hu_self', () => {
    const room = getRoomForPlayer(socket.id);
    if (!room?.game) return;
    const g = room.game;
    if (currentPlayer(g) !== socket.id || g.phase !== 'playing') return;
    if (ensurePlayerFlowerStage(room, socket.id)) return;
    const wc = checkPlayerWin(g, socket.id, null, true);
    if (!wc.win) return socket.emit('error', '补牌失败，请重试');
    g.pendingAutoDraw = null;
    resolveWin(g, socket.id, null, true, null, {});
    room.nextRoundReady = new Set();
    snapshotSettlementBase(room);
    broadcastGameState(g.roomId);
    io.to(g.roomId).emit('round_end', { winner: socket.id, scores: g.scores });
  });

  socket.on('gang', ({ tile, type }) => {
    const room = getRoomForPlayer(socket.id);
    if (!room?.game) return;
    const g = room.game;
    if (currentPlayer(g) !== socket.id || g.phase !== 'playing') return;
    if (ensurePlayerFlowerStage(room, socket.id)) return;
    g.pendingAutoDraw = null;
    const gangType = type === 'concealed' ? 'concealed_gang' : 'open_gang';

    if (type === 'open') {
      const seat = g.seats[socket.id];
      const canSupplementGang = seat.openMelds.some(m => m.type === 'peng' && m.tiles[0] === tile)
        && seat.hand.includes(tile);
      if (!canSupplementGang) return socket.emit('error', '补牌失败，请重试');
      if (maybeStartQiangGangWindow(room, socket.id, tile)) return;
      completeOpenGangAfterQiangGang(room, socket.id, tile);
      return;
    }

    const ok = type === 'concealed' ? doConcealedGang(g, socket.id, tile)
      : false;
    if (!ok) return socket.emit('error', '补牌失败，请重试');
    announce(room, { type: 'gang', playerId: socket.id, tile });
    // Immediate gang payment: all 3 others pay the ganger right now
    const gangPayment = resolveGangPayment(g, socket.id, gangType);
    io.to(g.roomId).emit('gang_payment', {
      gangerId: socket.id,
      gangType,
      pts: gangPayment.pts,
      transfers: gangPayment.transfers,
    });
    const drawn = drawTileAfterGang(g, socket.id);
    if (!drawn) { io.to(g.roomId).emit('liuju'); return; }
    beginTurnForPlayer(room, socket.id, drawn, { afterGang: true });
  });

  socket.on('new_round', ({ roomId, payments }) => {
    const room = rooms[roomId];
    if (!room?.game) return;
    if (!['ended', 'liuju'].includes(room.game.phase)) return;
    updateSettlementPayments(room, socket.id, payments || {});
    room.nextRoundReady ||= new Set();
    room.nextRoundReady.add(socket.id);
    emitNextRoundReady(room);
    const humanCount = room.players.filter(p => !p.isBot).length;
    if (room.nextRoundReady.size >= humanCount) beginNewRound(room);
  });

  socket.on('settlement_update', ({ payments }) => {
    const room = getRoomForPlayer(socket.id);
    if (!room?.game || !['ended', 'liuju'].includes(room.game.phase)) return;
    updateSettlementPayments(room, socket.id, payments || {});
  });

  socket.on('red_packet', ({ to, amount }) => {
    const room = getRoomForPlayer(socket.id);
    if (!room?.game || !to || to === socket.id) return;
    if (!room.game.playerIds.includes(to)) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return;
    const rounded = Math.round(value * 100) / 100;
    if (room.settlementBaseScores) {
      room.settlementBaseScores[socket.id] = (room.settlementBaseScores[socket.id] ?? room.game.seats[socket.id].score) - rounded;
      room.settlementBaseScores[to] = (room.settlementBaseScores[to] ?? room.game.seats[to].score) + rounded;
      applySettlementPayments(room);
    } else {
      room.game.seats[socket.id].score -= rounded;
      room.game.seats[to].score += rounded;
    }
    broadcastGameState(room.game.roomId);
    io.to(room.game.roomId).emit('red_packet_sent', { from: socket.id, to, amount: rounded });
  });

  socket.on('seat_swap_request', ({ to }) => {
    const room = getRoomForPlayer(socket.id);
    if (!room || !to || to === socket.id) return;
    if (!room.players.some(p => p.id === to && !p.isBot)) return socket.emit('error', '补牌失败，请重试');
    if (!canSwapSeats(room)) return socket.emit('error', '补牌失败，请重试');
    room.pendingSeatSwaps ||= {};
    room.pendingSeatSwaps[to] = { from: socket.id, at: Date.now() };
    io.to(to).emit('seat_swap_prompt', { from: socket.id, fromName: playerLabel(room, socket.id) });
    socket.emit('seat_swap_waiting', { to });
  });

  socket.on('seat_swap_response', ({ from, accept }) => {
    const room = getRoomForPlayer(socket.id);
    if (!room || !from || from === socket.id) return;
    const pending = room.pendingSeatSwaps?.[socket.id];
    if (!pending || pending.from !== from || Date.now() - pending.at > 60000) {
      return socket.emit('error', '补牌失败，请重试');
    }
    delete room.pendingSeatSwaps[socket.id];
    if (!accept) {
      io.to(from).emit('seat_swap_result', { ok: false, reason: `${playerLabel(room, socket.id)} 拒绝了换位` });
      return;
    }
    if (!canSwapSeats(room)) return socket.emit('error', '补牌失败，请重试');
    const ok = swapPlayerOrder(room, from, socket.id);
    if (!ok) return socket.emit('error', '补牌失败，请重试');
    const roomId = room.game?.roomId || Object.keys(rooms).find(k => rooms[k] === room);
    io.to(roomId).emit('seat_swap_result', { ok: true, from, to: socket.id });
    if (room.game) broadcastGameState(roomId);
    else io.to(roomId).emit('room_update', roomUpdatePayload(room, roomId));
  });

  socket.on('rejoin', ({ roomId, playerId: oldId, playerToken }) => {
    const room = rooms[roomId];
    if (!room) return socket.emit('rejoin_failed', { reason: '房间不存在或服务器已重启' });
    const player = room.players.find(p => (playerToken && p.token === playerToken) || p.id === oldId);
    if (!player) return socket.emit('rejoin_failed', { reason: '找不到原来的座位' });
    const previousId = player.id;
    player.id = socket.id;
    player.token ||= playerToken || makePlayerToken();
    player.disconnected = false;
    replacePlayerId(room, previousId, socket.id);
    socket.join(roomId);
    if (room.game) {
      const g = room.game;
      broadcastGameState(roomId);
      if (g.playerIds[g.currentTurn] === socket.id && hasFlowersInHand(g, socket.id)) {
        socket.emit('your_turn', { action: 'flower_replace', flowers: getFlowerTiles(g, socket.id), openingFlower: !!g.pendingFlower?.opening, reconnected: true });
      } else if (g.playerIds[g.currentTurn] === socket.id && g.phase === 'playing') {
        const wc = checkPlayerWin(g, socket.id, null, true);
        socket.emit('your_turn', { action: 'discard_or_hu', reconnected: true, canHu: wc.win });
      }
    } else {
      io.to(roomId).emit('room_update', roomUpdatePayload(room, roomId));
    }
    io.to(roomId).emit('player_rejoined', { id: socket.id, name: player.name });
    socket.emit('rejoin_ok', { roomId, playerId: socket.id, playerToken: player.token });
    queuePersistRooms();
  });

  socket.on('disconnect', () => {
    const room = getRoomForPlayer(socket.id);
    if (room) {
      if (room.game) {
        const player = room.players.find(p => p.id === socket.id);
        if (player) player.disconnected = true;
        room.mediaActive?.delete(socket.id);
        socket.to(room.game.roomId).emit('media_left', { from: socket.id });
        io.to(room.game.roomId).emit('player_left', { id: socket.id });
        queuePersistRooms();
        return;
      }

      room.players = room.players.filter(p => p.id !== socket.id);
      if (room.players.filter(p => !p.isBot).length === 0) {
        const rid = Object.keys(rooms).find(k => rooms[k] === room);
        if (rid) delete rooms[rid];
      } else {
        const rid = Object.keys(rooms).find(k => rooms[k] === room);
        if (rid) io.to(rid).emit('room_update', roomUpdatePayload(room, rid));
      }
      queuePersistRooms();
    }
  });
});

// ── Available actions after discard ──────────────────────────────
function computeAvailableActions(g, tile, fromPlayerId) {
  const actions = {};
  const fromIdx = g.playerIds.indexOf(fromPlayerId);
  const canMeldDiscard = canUseTileForMeld(g, tile);

  for (let i = 0; i < 4; i++) {
    const pid = g.playerIds[i];
    if (pid === fromPlayerId) continue;
    const acts = [];
    const hand = g.seats[pid].hand;

    if (checkPlayerWin(g, pid, tile, false).win) acts.push('hu');

    if (canMeldDiscard) {
      const realCount = countMeldMatches(g, hand, tile);
      if (realCount >= 2) acts.push('peng');
      if (realCount >= 3) acts.push('gang');
    }

    const nextIdx = (fromIdx + 1) % 4;
    if (i === nextIdx) {
      const opts = getChiOptions(g, hand, tile);
      if (opts.length) { acts.push('chi'); actions[pid + '_chi'] = opts; }
    }

    if (acts.length) actions[pid] = acts;
  }
  return actions;
}

const PORT = process.env.PORT || 3000;

async function bootstrap() {
  await restorePersistedRooms();
  server.listen(PORT, () => console.log('Server ready on http://localhost:' + PORT));
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await flushPersistRooms();
    process.exit(0);
  });
}

bootstrap().catch((err) => {
  console.error('bootstrap failed:', err);
  process.exit(1);
});

module.exports = server;

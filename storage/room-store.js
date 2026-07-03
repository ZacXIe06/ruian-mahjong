'use strict';

const fs = require('fs');
const path = require('path');

const STORE_MODE = (process.env.ROOM_STORE_MODE || process.env.VERCEL ? 'upstash' : 'file').toLowerCase();
const STORE_FILE = path.join(__dirname, '..', 'deploy', 'rooms.snapshot.json');
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const UPSTASH_KEY = process.env.ROOM_STORE_KEY || 'ruian-mahjong:rooms';

function isUsableUpstash() {
  return !!UPSTASH_URL && !!UPSTASH_TOKEN;
}

function normalizeSet(value) {
  if (value instanceof Set) return [...value];
  if (Array.isArray(value)) return value;
  return [];
}

function serializeRoom(room) {
  if (!room) return null;
  return {
    players: room.players || [],
    ruleset: room.ruleset || 'ruian',
    game: room.game || null,
    eventLog: room.eventLog || [],
    pendingSeatSwaps: room.pendingSeatSwaps || {},
    settlementBaseScores: room.settlementBaseScores || null,
    settlementPayments: room.settlementPayments || {},
    nextRoundReady: normalizeSet(room.nextRoundReady),
    actionWindowSeq: room.actionWindowSeq || 0,
    mediaActive: [],
  };
}

function deserializeRoom(raw) {
  if (!raw) return null;
  return {
    players: raw.players || [],
    ruleset: raw.ruleset || 'ruian',
    game: raw.game || null,
    eventLog: raw.eventLog || [],
    pendingSeatSwaps: raw.pendingSeatSwaps || {},
    settlementBaseScores: raw.settlementBaseScores || null,
    settlementPayments: raw.settlementPayments || {},
    nextRoundReady: new Set(raw.nextRoundReady || []),
    actionWindowSeq: raw.actionWindowSeq || 0,
    mediaActive: new Set(),
  };
}

function serializeRooms(rooms) {
  const out = {};
  for (const [roomId, room] of Object.entries(rooms || {})) {
    out[roomId] = serializeRoom(room);
  }
  return out;
}

function deserializeRooms(raw) {
  const out = {};
  for (const [roomId, room] of Object.entries(raw || {})) {
    const restored = deserializeRoom(room);
    if (restored) out[roomId] = restored;
  }
  return out;
}

async function fetchUpstash(command, body = null) {
  const url = `${UPSTASH_URL.replace(/\/$/, '')}/${command}`;
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    throw new Error(`Upstash ${command} failed: HTTP ${response.status}`);
  }
  return response.json();
}

async function loadFromUpstash() {
  const payload = await fetchUpstash(`get/${encodeURIComponent(UPSTASH_KEY)}`);
  if (!payload?.result) return {};
  const parsed = typeof payload.result === 'string' ? JSON.parse(payload.result) : payload.result;
  return deserializeRooms(parsed);
}

async function saveToUpstash(rooms) {
  const snapshot = serializeRooms(rooms);
  await fetchUpstash(`set/${encodeURIComponent(UPSTASH_KEY)}`, snapshot);
}

function loadFromFile() {
  if (!fs.existsSync(STORE_FILE)) return {};
  const raw = fs.readFileSync(STORE_FILE, 'utf8').replace(/^\uFEFF/, '');
  if (!raw.trim()) return {};
  return deserializeRooms(JSON.parse(raw));
}

function saveToFile(rooms) {
  fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
  fs.writeFileSync(STORE_FILE, JSON.stringify(serializeRooms(rooms), null, 2), 'utf8');
}

async function loadRooms() {
  if (STORE_MODE === 'upstash' && isUsableUpstash()) {
    return loadFromUpstash();
  }
  return loadFromFile();
}

async function saveRooms(rooms) {
  if (STORE_MODE === 'upstash' && isUsableUpstash()) {
    return saveToUpstash(rooms);
  }
  return saveToFile(rooms);
}

module.exports = {
  STORE_MODE,
  loadRooms,
  saveRooms,
  serializeRooms,
  deserializeRooms,
};

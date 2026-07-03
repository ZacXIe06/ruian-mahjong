'use strict';
const SOCKET_OPTIONS = {
  transports: location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? ['websocket', 'polling']
    : ['websocket'],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 500,
  reconnectionDelayMax: 2000,
  timeout: 20000,
};
const socket = io(SOCKET_OPTIONS);

let myRoomId = null;
let myId = null;

const $name = document.getElementById('player-name');
const $roomCode = document.getElementById('room-code');
const $rulesetSelect = document.getElementById('ruleset-select');
const $btnCreate = document.getElementById('btn-create');
const $btnJoin = document.getElementById('btn-join');
const $roomSection = document.getElementById('room-section');
const $actionSection = document.getElementById('action-section');
const $displayRoomId = document.getElementById('display-room-id');
const $displayRuleset = document.getElementById('display-ruleset');
const $playerList = document.getElementById('player-list');
const $btnStart = document.getElementById('btn-start');
const $waitingText = document.getElementById('waiting-text');
const $errorMsg = document.getElementById('error-msg');
const $btnCopy = document.getElementById('btn-copy');
const savedRoomId = sessionStorage.getItem('roomId');
const savedPlayerId = sessionStorage.getItem('playerId');
let playerToken = localStorage.getItem('playerToken');

function getName() { return $name.value.trim() || '玩家'; }

if (savedRoomId && savedPlayerId) {
  const box = document.createElement('div');
  box.className = 'card';
  box.innerHTML = `
    <strong>检测到上一局：${savedRoomId}</strong>
    <button class="btn btn-primary" type="button" id="btn-reconnect-last">返回上一局</button>
    <button class="btn btn-secondary" type="button" id="btn-clear-last">清除记录</button>
  `;
  document.querySelector('.lobby-container')?.insertBefore(box, document.getElementById('action-section'));
  box.querySelector('#btn-reconnect-last')?.addEventListener('click', () => { window.location.href = '/game.html'; });
  box.querySelector('#btn-clear-last')?.addEventListener('click', () => {
    sessionStorage.removeItem('roomId');
    sessionStorage.removeItem('playerId');
    sessionStorage.removeItem('pendingDealAnimation');
    box.remove();
  });
}

$btnCreate.addEventListener('click', () => {
  socket.emit('create_room', { name: getName(), playerToken, ruleset: $rulesetSelect?.value || 'ruian' });
});

$btnJoin.addEventListener('click', () => {
  const code = $roomCode.value.trim().toUpperCase();
  if (!code) return showError('请输入房间码');
  socket.emit('join_room', { roomId: code, name: getName(), playerToken });
});

$roomCode.addEventListener('keydown', e => { if (e.key === 'Enter') $btnJoin.click(); });

$btnStart.addEventListener('click', () => {
  socket.emit('start_game', { roomId: myRoomId });
});

$btnCopy.addEventListener('click', () => {
  navigator.clipboard.writeText(myRoomId).then(() => {
    $btnCopy.textContent = '已复制';
    setTimeout(() => $btnCopy.textContent = '复制', 1500);
  });
});

socket.on('room_joined', ({ roomId, playerId, playerToken: token }) => {
  myRoomId = roomId;
  myId = playerId;
  if (token) {
    playerToken = token;
    localStorage.setItem('playerToken', token);
  }
  $displayRoomId.textContent = roomId;
  $actionSection.classList.add('hidden');
  $roomSection.classList.remove('hidden');
  showError('');
});

socket.on('room_update', ({ players, rulesetName }) => {
  if ($displayRuleset) $displayRuleset.textContent = rulesetName || '瑞安麻将';
  $playerList.innerHTML = '';
  const seatWinds = ['东', '南', '西', '北'];
  players.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'player-item';
    const botTag = p.isBot ? ' <small class="bot-tag">机器人</small>' : '';
    const youTag = p.id === myId ? ' <small>（你）</small>' : '';
    div.innerHTML = `<span>${p.name}${botTag}${youTag}</span><span class="seat-wind">${seatWinds[i]}风</span>`;
    $playerList.appendChild(div);
  });

  const isHost = players[0]?.id === myId;
  const humanCount = players.filter(p => !p.isBot).length;
  if (isHost) {
    $btnStart.classList.remove('hidden');
    const botsNeeded = 4 - humanCount;
    $btnStart.textContent = botsNeeded > 0
      ? `开始游戏（${botsNeeded} 个机器人补位）`
      : '开始游戏';
    $waitingText.classList.add('hidden');
  } else {
    $btnStart.classList.add('hidden');
    $waitingText.classList.remove('hidden');
    $waitingText.textContent = humanCount < 4
      ? `等待其他玩家加入…（${humanCount}/4）`
      : '等待房主开始…';
  }
});

socket.on('game_started', () => {
  sessionStorage.setItem('roomId', myRoomId);
  sessionStorage.setItem('playerId', myId);
  if (playerToken) sessionStorage.setItem('playerToken', playerToken);
  sessionStorage.setItem('pendingDealAnimation', '1');
  window.location.href = '/game.html';
});

socket.on('error', msg => showError(msg));

function showError(msg) {
  $errorMsg.textContent = msg || '';
}

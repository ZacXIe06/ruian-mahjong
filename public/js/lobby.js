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
let playerToken = localStorage.getItem('playerToken');

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
const $ruleDocModal = document.getElementById('rule-doc-modal');
const $ruleDocTitle = document.getElementById('rule-doc-title');
const $ruleDocContent = document.getElementById('rule-doc-content');
const $ruleDocClose = document.getElementById('rule-doc-close');

const savedRoomId = sessionStorage.getItem('roomId');
const savedPlayerId = sessionStorage.getItem('playerId');

function getName() {
  return $name.value.trim() || '玩家';
}

const RULE_DOCS = {
  ruian: {
    title: '瑞安麻将规则概要',
    html: `
      <div class="rule-note">默认玩法。这里写的是当前网站已实现的主要逻辑，细节后续仍可继续补。</div>
      <h3>基础</h3>
      <ul>
        <li>四人游戏，初始分数 100 分。</li>
        <li>白板按财神面额参与吃碰杠，但白板本身不算财神。</li>
        <li>真财神不能参与吃、碰、杠。</li>
      </ul>
      <h3>行牌</h3>
      <ul>
        <li>出牌后开放胡、杠、碰、吃反应，优先级为胡 &gt; 杠 &gt; 碰 &gt; 吃。</li>
        <li>杠牌和胡牌会进入人工结算或分数变化流程。</li>
        <li>结算框括号显示每位玩家最后财神数量。</li>
      </ul>
      <h3>特殊</h3>
      <ul>
        <li>支持财神归位、无财神、硬八对、软八对、清一色、半清、天胡、地胡、抢杠胡等当前已接入牌型。</li>
        <li>四家连续跟同一个风时，第一家给后三家各 1 分。</li>
      </ul>
    `,
  },
  pingyang: {
    title: '平阳台炮规则概要',
    html: `
      <div class="rule-note">大炮玩法：13 台一翻，30 台双翻。台数用于倍率，不限制胡牌按钮出现。</div>
      <h3>基础</h3>
      <ul>
        <li>使用 144 张牌：136 张基础牌 + 8 张花牌。每位玩家初始 200 分。</li>
        <li>庄家起手直接 17 张，其他玩家 16 张。</li>
        <li>每局翻 2 张牌做财神，财神可以翻到花牌或白板；翻出相同牌时只有一种财神。</li>
        <li>若起手出现东南西北中发白，整副 144 张重新洗牌发牌，庄家不变，财神重新翻。</li>
      </ul>
      <h3>补花/白板</h3>
      <ul>
        <li>花牌和非财神白板进入补牌流程，从牌尾补。</li>
        <li>按庄家开始逆时针一轮一轮补。摸到的新牌仍是花牌或白板时，等本圈补完后再补。</li>
        <li>手上没有可补牌的人在补牌环节跳过。</li>
      </ul>
      <h3>台数</h3>
      <ul>
        <li>小牌财神：1 张 1 台，2 张相同 3 台，3 张相同 5 台。</li>
        <li>大牌财神：1 张 2 台，2 张相同 5 台，3 张相同 8 台。</li>
        <li>两张财神翻出相同：1 张该财神 5 台，2 张该财神 10 台，不自动视为起翻。</li>
        <li>对对胡/碰碰胡 +5 台，硬牌 +3 台。</li>
      </ul>
      <h3>杀猪</h3>
      <ul>
        <li>4 财神且至少 3 张相同：10 台；5 财神：12 台；6 财神：15 台。</li>
        <li>若翻出的两张财神相同，手里 2 张该财神也可触发杀猪。</li>
        <li>8 花补齐也视为杀猪，15 台。</li>
        <li>杀猪时其他三家台数归零，赢家通吃。</li>
      </ul>
      <h3>结算</h3>
      <ul>
        <li>当前网站采用人工结算：系统展示台数，玩家自行填写给其他玩家多少钱。</li>
        <li>结算框括号显示每位玩家牌面台数。</li>
      </ul>
    `,
  },
};

function openRuleDoc(kind) {
  const doc = RULE_DOCS[kind];
  if (!doc || !$ruleDocModal) return;
  $ruleDocTitle.textContent = doc.title;
  $ruleDocContent.innerHTML = doc.html;
  $ruleDocModal.classList.remove('hidden');
}

function closeRuleDoc() {
  $ruleDocModal?.classList.add('hidden');
}

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

document.querySelectorAll('[data-rules-doc]').forEach(btn => {
  btn.addEventListener('click', () => openRuleDoc(btn.dataset.rulesDoc));
});
$ruleDocClose?.addEventListener('click', closeRuleDoc);
$ruleDocModal?.addEventListener('click', e => {
  if (e.target === $ruleDocModal) closeRuleDoc();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeRuleDoc();
});

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
    setTimeout(() => { $btnCopy.textContent = '复制'; }, 1500);
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
      ? `等待其他玩家加入...（${humanCount}/4）`
      : '等待房主开始...';
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

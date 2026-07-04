'use strict';

// ── Tile rendering ──────────────────────────────────────────────
const HONOR_CN = { east: '东', south: '南', west: '西', north: '北', zhong: '中', fa: '发' };
const WIND_CN = { east: '东', south: '南', west: '西', north: '北' };
const WAN_CN = ['一','二','三','四','伍','六','七','八','九'];
const SUIT_LABEL = { m: '万', t: '筒', b: '条' };
const FLOWER_CN = { chun: '春', xia: '夏', qiu: '秋', dong: '冬', mei: '梅', lan: '兰', zhu: '竹', ju: '菊' };
const ACTION_TIMEOUT_SECS = 15;

// Pip colors for 筒 by tile number: array of colors per pip (g=green, b=blue, r=red)
const TONG_COLORS = {
  1: [],  // handled separately
  2: ['b','g'],
  3: ['b','r','g'],
  4: ['g','b','b','g'],
  5: ['b','g','r','g','b'],
  6: ['g','b','g','b','g','b'],
  7: ['b','g','b','r','b','g','b'],
  8: ['g','b','g','b','g','b','g','b'],
  9: ['b','g','b','g','r','g','b','g','b'],
};
// Grid columns for pip layout
const TONG_COLS = { 1:1, 2:1, 3:1, 4:2, 5:2, 6:2, 7:2, 8:3, 9:3 };

function renderTong(n, small, mini) {
  const sizeClass = small ? 'small' : mini ? 'mini' : '';
  if (n === 1) {
    return `<div class="tong-pips" style="grid-template-columns:1fr"><div class="pip pip-1t"></div></div>`;
  }
  const cols = TONG_COLS[n];
  const colors = TONG_COLORS[n] || [];
  const pips = colors.map(c => `<div class="pip ${c}"></div>`).join('');
  return `<div class="tong-pips" style="grid-template-columns:repeat(${cols},1fr)">${pips}</div>`;
}

function renderTiao(n, small, mini) {
  if (n === 1) {
    return `<div class="tiao-1"><span class="bird">🀦</span><div class="bamboo-1"></div></div>`;
  }
  const sticks = Array(n).fill('<div class="bamboo"></div>').join('');
  return `<div class="tiao-wrap">${sticks}</div>`;
}

function makeTile(tile, opts = {}) {
  const { small, mini, faceDown, clickable, selected, isCaijin } = opts;
  const div = document.createElement('div');
  div.className = 'tile';
  if (small) div.classList.add('small');
  if (mini) div.classList.add('mini');
  if (faceDown) { div.classList.add('face-down'); return div; }
  if (clickable) div.classList.add('clickable');
  if (selected) div.classList.add('selected');
  if (isCaijin) div.classList.add('tile-caijin');

  if (tile) {
    const img = document.createElement('img');
    img.className = 'tile-art';
    img.src = `/assets/tiles/${tile}.png`;
    img.alt = tileLabel(tile);
    img.draggable = false;
    img.onerror = () => {
      img.remove();
      renderFallbackTile(div, tile, small, mini);
    };
    div.appendChild(img);
  }

  div.dataset.tile = tile;
  div.draggable = false;
  div.addEventListener('contextmenu', (e) => e.preventDefault());
  return div;
}

function renderFallbackTile(div, tile, small, mini) {
  if (tile === 'bai') {
    div.innerHTML = '<div class="bai-tile"></div>';
  } else if (FLOWER_CN[tile]) {
    div.innerHTML = `<div class="honor-tile honor-fa">${FLOWER_CN[tile]}</div>`;
  } else if (HONOR_CN[tile]) {
    div.innerHTML = `<div class="honor-tile honor-${tile}">${HONOR_CN[tile]}</div>`;
  } else {
    const suit = tile.slice(-1), num = parseInt(tile);
    if (suit === 'm') {
      div.innerHTML = `<div class="tile-wan"><span class="wan-num">${WAN_CN[num-1]}</span><span class="wan-char">萬</span></div>`;
    } else if (suit === 't') {
      div.innerHTML = renderTong(num, small, mini);
    } else if (suit === 'b') {
      div.innerHTML = renderTiao(num, small, mini);
    }
  }
}

// ── Socket & State ───────────────────────────────────────────────
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
let myId = sessionStorage.getItem('playerId');
let myRoomId = sessionStorage.getItem('roomId');
let playerToken = sessionStorage.getItem('playerToken') || localStorage.getItem('playerToken');
let state = null; // latest game_state
let selectedHandIndex = null; // exact hand position I want to discard
let myTurn = false;
let pendingAction = null; // {action, tiles} from server prompt
let actionAllowed = null; // 'discard_or_hu' | 'discard_only'
let drawnTile = null;
let canHuSelfNow = false;
let discardInFlight = false;
let manualHandOrder = [];
let flowerPromptTiles = [];
let openingFlowerPhase = false;
let rearrangeMode = false;
let rearrangeFromIndex = null;
let rearrangeHoverIndex = null;
let activePointerId = null;
let longPressTimer = null;
let suppressTileClickUntil = 0;
let cameraStream = null;
let micStream = null;
let requestedMediaPeers = false;
let speechUnlocked = false;
let roundEndDialogTimer = null;
let nextRoundReady = 0;
let nextRoundTotal = 4;
let nextRoundRequested = false;
let nameLongPressTimer = null;
let mediaPeerRefreshTimer = null;
let gameLogEntries = [];
const mediaPeerStatus = new Map();

if (!myId || !myRoomId) {
  window.location.href = '/';
}

// Reconnect with stored id (the socket.id will be new, but we handle this gracefully)
socket.on('connect', () => {
  // Re-join room with same name
  socket.emit('rejoin', { roomId: myRoomId, playerId: myId, playerToken });
  requestedMediaPeers = false;
  socket.emit('media_peers_request');
  iceServersReady.then(() => socket.emit('media_peers_request')).catch(() => {});
  if (cameraStream || micStream) socket.emit('media_ready');
});

socket.on('rejoin_ok', ({ roomId, playerId, playerToken: token }) => {
  if (roomId) sessionStorage.setItem('roomId', roomId);
  if (playerId) {
    myId = playerId;
    sessionStorage.setItem('playerId', playerId);
  }
  if (token) {
    playerToken = token;
    sessionStorage.setItem('playerToken', token);
    localStorage.setItem('playerToken', token);
  }
  showToast('已返回对局');
});

socket.on('rejoin_failed', ({ reason }) => {
  sessionStorage.removeItem('roomId');
  sessionStorage.removeItem('playerId');
  sessionStorage.removeItem('pendingDealAnimation');
  alert(reason || '无法返回上一局，请重新进入房间');
  window.location.href = '/';
});

socket.on('disconnect', () => {
  showToast('连接断开，正在重连…');
});

function startMediaPeerRefresh() {
  if (mediaPeerRefreshTimer) return;
  mediaPeerRefreshTimer = setInterval(() => {
    if (state?.playerOrder?.length) socket.emit('media_peers_request');
  }, 6000);
}

const $btnCamera = document.getElementById('btn-camera');
const $btnMic = document.getElementById('btn-mic');
const $btnLog = document.getElementById('btn-log');
const peerConnections = new Map();
const remoteStreams = new Map();
const pendingIceCandidates = new Map();
const remoteAudioElements = new Map();
const mediaNegotiationTimers = new Map();

const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];
let iceServers = DEFAULT_ICE_SERVERS;
const iceServersReady = loadIceServers();

async function loadIceServers() {
  try {
    const res = await fetch('/api/ice-servers', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const servers = await res.json();
    if (Array.isArray(servers) && servers.length) iceServers = servers;
  } catch (err) {
    iceServers = DEFAULT_ICE_SERVERS;
  }
  if (socket.connected) socket.emit('media_peers_request');
}

$btnCamera?.addEventListener('click', toggleCamera);
$btnMic?.addEventListener('click', toggleMic);
$btnLog?.addEventListener('click', openGameLog);
$btnCamera?.addEventListener('contextmenu', (event) => { event.preventDefault(); forceMediaReconnect(); });
$btnMic?.addEventListener('contextmenu', (event) => { event.preventDefault(); forceMediaReconnect(); });
$btnCamera?.addEventListener('dblclick', forceMediaReconnect);
$btnMic?.addEventListener('dblclick', forceMediaReconnect);
window.addEventListener('pointerdown', unlockSpeech, { once: true });
window.addEventListener('keydown', unlockSpeech, { once: true });

document.addEventListener('contextmenu', (event) => {
  if (event.target.closest('.tile, .my-hand, .table, .action-bar')) event.preventDefault();
});
document.addEventListener('selectstart', (event) => {
  if (event.target.closest('.tile, .my-hand, .table')) event.preventDefault();
});

async function toggleCamera() {
  if (cameraStream) {
    stopStream(cameraStream);
    cameraStream = null;
    $btnCamera.classList.remove('active');
    $btnCamera.title = '开启摄像头';
    refreshLocalMediaSlot();
    await updateMediaPresence();
    return;
  }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 640, max: 960 },
        height: { ideal: 480, max: 720 },
        frameRate: { ideal: 24, max: 30 },
      },
      audio: false,
    });
    $btnCamera.classList.add('active');
    $btnCamera.title = '关闭摄像头';
    refreshLocalMediaSlot();
    await updateMediaPresence();
  } catch (err) {
    showToast('摄像头未开启');
  }
}

async function toggleMic() {
  if (micStream) {
    stopStream(micStream);
    micStream = null;
    $btnMic.classList.remove('active');
    $btnMic.title = '开启麦克风';
    refreshLocalMediaSlot();
    await updateMediaPresence();
    return;
  }
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      video: false,
      audio: {
        echoCancellation: { ideal: true },
        noiseSuppression: { ideal: true },
        autoGainControl: { ideal: true },
        channelCount: { ideal: 1 },
        sampleRate: { ideal: 48000 },
      },
    });
    await applyAudioCleanup(micStream);
    $btnMic.classList.add('active');
    $btnMic.title = '关闭麦克风';
    refreshLocalMediaSlot();
    await updateMediaPresence();
  } catch (err) {
    showToast('麦克风未开启');
  }
}

function stopStream(stream) {
  for (const track of stream.getTracks()) track.stop();
}

function getLocalMediaStream() {
  const tracks = [
    ...(cameraStream?.getTracks() || []),
    ...(micStream?.getTracks() || []),
  ];
  return tracks.length ? new MediaStream(tracks) : null;
}

async function applyAudioCleanup(stream) {
  for (const track of stream?.getAudioTracks?.() || []) {
    try {
      await track.applyConstraints({
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      });
    } catch (err) {}
  }
}

async function updateMediaPresence() {
  if (cameraStream || micStream) socket.emit('media_ready');
  else socket.emit('media_left');
  socket.emit('media_peers_request');
  await syncLocalTracksToPeers();
}

async function syncLocalTracksToPeers() {
  await Promise.all([...peerConnections.entries()].map(([pid, pc]) => syncLocalTracksToPeer(pid, pc)));
}

function getLocalTrack(kind) {
  const stream = kind === 'video' ? cameraStream : micStream;
  return stream?.getTracks().find(track => track.kind === kind && track.readyState === 'live') || null;
}

async function syncLocalTracksToPeer(pid, pc) {
  if (!pc || pc.connectionState === 'closed') return;
  let changed = false;
  const localStream = getLocalMediaStream();
  for (const kind of ['video', 'audio']) {
    const track = getLocalTrack(kind);
    let transceiver = pc.getTransceivers().find(t =>
      t.sender?.track?.kind === kind || t.receiver?.track?.kind === kind
    );
    if (track) {
      if (transceiver) {
        if (transceiver.sender.track !== track) {
          await transceiver.sender.replaceTrack(track);
          changed = true;
        }
        if (transceiver.direction !== 'sendrecv') {
          transceiver.direction = 'sendrecv';
          changed = true;
        }
      } else {
        pc.addTrack(track, localStream || new MediaStream([track]));
        changed = true;
      }
    } else if (transceiver?.sender) {
      if (transceiver.sender.track) {
        await transceiver.sender.replaceTrack(null);
        changed = true;
      }
      if (transceiver.direction !== 'recvonly') {
        transceiver.direction = 'recvonly';
        changed = true;
      }
    }
  }
  if (changed) schedulePeerNegotiation(pid, pc);
}

function schedulePeerNegotiation(pid, pc) {
  clearTimeout(mediaNegotiationTimers.get(pid));
  mediaNegotiationTimers.set(pid, setTimeout(async () => {
    mediaNegotiationTimers.delete(pid);
    if (peerConnections.get(pid) !== pc || pc.signalingState !== 'stable') return;
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('media_signal', { to: pid, signal: pc.localDescription });
    } catch (err) {
      closePeer(pid);
    }
  }, 120));
}

function forceMediaReconnect() {
  closeAllPeers();
  if (cameraStream || micStream) socket.emit('media_ready');
  socket.emit('media_peers_request');
  showToast('正在重连连麦');
}

function closeAllPeers() {
  for (const pc of peerConnections.values()) pc.close();
  for (const timer of mediaNegotiationTimers.values()) clearTimeout(timer);
  mediaNegotiationTimers.clear();
  peerConnections.clear();
  remoteStreams.clear();
  pendingIceCandidates.clear();
  for (const audio of remoteAudioElements.values()) audio.remove();
  remoteAudioElements.clear();
  refreshAllMediaSlots();
}

function closePeer(pid) {
  clearTimeout(mediaNegotiationTimers.get(pid));
  mediaNegotiationTimers.delete(pid);
  const pc = peerConnections.get(pid);
  if (pc) pc.close();
  peerConnections.delete(pid);
  mediaPeerStatus.delete(pid);
  remoteStreams.delete(pid);
  pendingIceCandidates.delete(pid);
  removeRemoteAudio(pid);
  refreshAllMediaSlots();
}

function setPeerStatus(pid, status) {
  if (!pid) return;
  if (status) mediaPeerStatus.set(pid, status);
  else mediaPeerStatus.delete(pid);
  refreshAllMediaSlots();
}

function removeRemoteAudio(pid) {
  const audio = remoteAudioElements.get(pid);
  if (audio) audio.remove();
  remoteAudioElements.delete(pid);
}

function getOrCreateRemoteStream(pid) {
  let stream = remoteStreams.get(pid);
  if (!stream) {
    stream = new MediaStream();
    remoteStreams.set(pid, stream);
  }
  return stream;
}

function bindRemoteTrack(pid, track) {
  const stream = getOrCreateRemoteStream(pid);
  for (const existing of stream.getTracks()) {
    if (existing.kind === track.kind) stream.removeTrack(existing);
  }
  stream.addTrack(track);
  track.onunmute = () => refreshAllMediaSlots();
  track.onmute = () => refreshAllMediaSlots();
  track.onended = () => refreshAllMediaSlots();
  refreshAllMediaSlots();
}

async function flushPendingCandidates(pc, pid) {
  const queued = pendingIceCandidates.get(pid) || [];
  pendingIceCandidates.delete(pid);
  for (const candidate of queued) {
    try { await pc.addIceCandidate(candidate); } catch (err) {}
  }
}

async function queueIceCandidate(pid, candidate) {
  const pc = peerConnections.get(pid);
  if (pc?.remoteDescription) {
    try { await pc.addIceCandidate(candidate); } catch (err) {}
    return;
  }
  if (!pendingIceCandidates.has(pid)) pendingIceCandidates.set(pid, []);
  pendingIceCandidates.get(pid).push(candidate);
}

async function createPeer(pid, initiator) {
  if (!pid || pid === myId || pid.startsWith('bot_')) return null;
  const existing = peerConnections.get(pid);
  if (existing) {
    if (['failed', 'closed', 'disconnected'].includes(existing.connectionState)) {
      closePeer(pid);
    } else {
      return existing;
    }
  }

  await iceServersReady;
  const pc = new RTCPeerConnection({ iceServers });
  peerConnections.set(pid, pc);
  setPeerStatus(pid, 'connecting');
  const localStream = getLocalMediaStream();
  const localKinds = new Set();
  if (localStream) {
    for (const track of localStream.getTracks()) {
      localKinds.add(track.kind);
      pc.addTrack(track, localStream);
    }
  }
  if (!localKinds.has('video')) pc.addTransceiver('video', { direction: 'recvonly' });
  if (!localKinds.has('audio')) pc.addTransceiver('audio', { direction: 'recvonly' });
  pc.onicecandidate = (event) => {
    if (event.candidate) socket.emit('media_signal', { to: pid, signal: { type: 'candidate', candidate: event.candidate } });
  };
  pc.ontrack = (event) => {
    if (event.track) bindRemoteTrack(pid, event.track);
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') setPeerStatus(pid, 'connected');
    if (pc.connectionState === 'connecting' || pc.connectionState === 'new') setPeerStatus(pid, 'connecting');
    if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
      setPeerStatus(pid, 'failed');
      setTimeout(() => {
        if (peerConnections.get(pid) === pc && ['failed', 'disconnected'].includes(pc.connectionState)) closePeer(pid);
      }, 2500);
      return;
    }
    if (pc.connectionState === 'closed') closePeer(pid);
  };

  if (initiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('media_signal', { to: pid, signal: pc.localDescription });
  }
  return pc;
}

socket.on('media_ready', async ({ from, initiator }) => {
  await createPeer(from, !!initiator);
});

socket.on('media_peers', async ({ peers, peerInfos }) => {
  const infos = peerInfos || (peers || []).map(id => ({ id, initiator: true }));
  for (const info of infos) {
    await createPeer(info.id, !!info.initiator);
  }
});

socket.on('media_left', ({ from }) => closePeer(from));

socket.on('media_peer_resync', async ({ from, initiator }) => {
  closePeer(from);
  await createPeer(from, !!initiator);
});

socket.on('media_signal', async ({ from, signal }) => {
  if (!from || !signal) return;
  const pc = await createPeer(from, false);
  if (!pc) return;
  if (signal.type === 'offer') {
    if (pc.signalingState === 'have-local-offer') {
      try {
        await pc.setLocalDescription({ type: 'rollback' });
      } catch (err) {
        closePeer(from);
        return;
      }
    }
    await pc.setRemoteDescription(new RTCSessionDescription(signal));
    await flushPendingCandidates(pc, from);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('media_signal', { to: from, signal: pc.localDescription });
  } else if (signal.type === 'answer') {
    if (pc.signalingState === 'have-local-offer') {
      await pc.setRemoteDescription(new RTCSessionDescription(signal));
      await flushPendingCandidates(pc, from);
    }
  } else if (signal.type === 'candidate' && signal.candidate) {
    await queueIceCandidate(from, new RTCIceCandidate(signal.candidate));
  }
});

function refreshLocalMediaSlot() {
  refreshAllMediaSlots();
}

function refreshAllMediaSlots() {
  if (!state) return;
  const myIdx = state.playerOrder.indexOf(myId);
  const positions = ['bottom', 'right', 'top', 'left'];
  for (let i = 0; i < 4; i++) {
    const pid = state.playerOrder[(myIdx + i) % 4];
    const pos = positions[i];
    const stream = pid === myId ? getLocalMediaStream() : remoteStreams.get(pid);
    updateSeatVideo(pos, pid, stream);
  }
}

function attachVideoElement(video, stream, isLocal) {
  if (!video) return;
  if (video.srcObject !== stream) video.srcObject = stream || null;
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.disablePictureInPicture = true;
  if (!stream) return;
  const tryPlay = () => { video.play?.().catch(() => {}); };
  video.onloadedmetadata = tryPlay;
  tryPlay();
}

function attachAudioElement(pid, stream, isLocal) {
  if (!pid || isLocal) return;
  const hasAudio = !!stream?.getAudioTracks().some(t => t.readyState === 'live' && t.enabled);
  if (!stream || !hasAudio) {
    removeRemoteAudio(pid);
    return;
  }
  let audio = remoteAudioElements.get(pid);
  if (!audio) {
    audio = document.createElement('audio');
    audio.className = 'remote-seat-audio';
    audio.autoplay = true;
    audio.playsInline = true;
    audio.style.display = 'none';
    document.body.appendChild(audio);
    remoteAudioElements.set(pid, audio);
  }
  if (audio.srcObject !== stream) audio.srcObject = stream;
  audio.muted = false;
  audio.play?.().catch(() => {});
}

function updateSeatVideo(pos, pid, stream) {
  const box = document.getElementById(`video-${pos}`);
  if (!box) return;
  const video = box.querySelector('video');
  const label = box.querySelector('span');
  const name = playerDisplayName(state, pid) || (pos === 'bottom' ? '我' : '');
  const hasVideo = !!stream?.getVideoTracks().some(t => t.readyState === 'live' && t.enabled && !t.muted);
  const hasAudio = !!stream?.getAudioTracks().some(t => t.readyState === 'live' && t.enabled && !t.muted);
  const visible = !!stream && (hasVideo || hasAudio);
  box.classList.toggle('hidden', !visible);
  box.classList.toggle('audio-only', visible && !hasVideo && hasAudio);
  const status = pid === myId ? (visible ? 'connected' : '') : (mediaPeerStatus.get(pid) || (visible ? 'connected' : ''));
  if (status) box.dataset.status = status;
  else delete box.dataset.status;
  attachVideoElement(video, stream, pid === myId);
  attachAudioElement(pid, stream, pid === myId);
  if (label) {
    if (!visible) label.textContent = '';
    else if (hasVideo) label.textContent = name;
    else label.textContent = `${name} · 语音中`;
  }
}

// ── Deal animation ───────────────────────────────────────────────
let dealAnimating = sessionStorage.getItem('pendingDealAnimation') === '1';

socket.on('game_started', ({ caijinTile, caijinTiles, diceRoll, openingRedeal, rulesetName }) => {
  const ruleEl = document.getElementById('rule-display');
  if (ruleEl && rulesetName) ruleEl.textContent = rulesetName;
  manualHandOrder = [];
  rearrangeMode = false;
  rearrangeFromIndex = null;
  canHuSelfNow = false;
  nextRoundRequested = false;
  nextRoundReady = 0;
  hideOverlay();
  dealAnimating = true;
  if (openingRedeal?.playerId) {
    showToast(`${playerDisplayName(state, openingRedeal.playerId) || '玩家'} 起手东南西北中发白，重新洗牌`);
  }
  showDealOverlay(caijinTiles?.length ? caijinTiles : [caijinTile], diceRoll);
});

function showDealOverlay(caijinTiles, diceRoll) {
  if (document.getElementById('deal-overlay')) return;

  const ov = document.createElement('div');
  ov.className = 'deal-overlay';
  ov.id = 'deal-overlay';
  ov.innerHTML = `
    <h2>🎲 骰子: ${diceRoll || '?'}  财神: <span id="deal-caijin"></span></h2>
    <p style="color:#a8d5b5;font-size:.9rem">发牌中…</p>
    <div class="deal-stage" id="deal-stage"></div>
  `;
  document.body.appendChild(ov);

  const caijinEl = ov.querySelector('#deal-caijin');
  if (caijinEl) {
    (caijinTiles || []).forEach(tile => caijinEl.appendChild(makeTile(tile, { small: true, isCaijin: true })));
  }
}

// ── Game state update ────────────────────────────────────────────
socket.on('game_state', (gs) => {
  state = gs;
  myId = gs.myId;
  if (gs.phase !== 'playing' || gs.currentTurn !== myId) canHuSelfNow = false;
  sessionStorage.setItem('playerId', myId);
  syncManualHandOrder(gs.seats?.[myId]?.hand || [], gs.caijinTiles?.length ? gs.caijinTiles : gs.caijinTile);
  if (!requestedMediaPeers) {
    requestedMediaPeers = true;
    socket.emit('media_peers_request');
  }
  startMediaPeerRefresh();

  if (dealAnimating) {
    dealAnimating = false;
    sessionStorage.removeItem('pendingDealAnimation');
    showDealOverlay(gs.caijinTiles?.length ? gs.caijinTiles : [gs.caijinTile], gs.diceRoll);
    runDealAnimation(gs);
    return;
  }
  renderAll(gs);
});

function runDealAnimation(gs) {
  const stage = document.getElementById('deal-stage');
  if (!stage) { renderAll(gs); return; }

  // Animate my 16 tiles flying in one by one
  const myHand = gs.seats[gs.myId]?.hand || [];
  const sorted = sortHand(myHand, gs.caijinTiles?.length ? gs.caijinTiles : gs.caijinTile);
  let idx = 0;

  function dealNext() {
    if (idx >= sorted.length) {
      // Done — remove overlay and render
      setTimeout(() => {
        const ov = document.getElementById('deal-overlay');
        if (ov) ov.remove();
        renderAll(gs);
      }, 400);
      return;
    }
    const t = sorted[idx++];
    const el = makeTile(t, { isCaijin: t === gs.caijinTile });
    el.classList.add('deal-tile-fly');
    el.style.animationDelay = '0ms';
    stage.appendChild(el);
    setTimeout(dealNext, 70);
  }

  dealNext();
}

socket.on('your_turn', ({ action, drawnTile: dt, afterGang, canTianhu, canHu, flowers, openingFlower }) => {
  myTurn = true;
  actionAllowed = action;
  drawnTile = dt || null;
  canHuSelfNow = !!canHu;
  flowerPromptTiles = flowers || [];
  openingFlowerPhase = !!openingFlower;
  discardInFlight = false;
  rearrangeMode = false;
  rearrangeFromIndex = null;
  selectedHandIndex = null;
  renderActionBar();
  if (action === 'flower_replace') showToast(openingFlower ? '开局补花' : '请先补花');
  if (dt) showToast(`摸牌：${tileLabel(dt)}`);
});

let countdownTimer = null;

socket.on('action_prompt', ({ tile, acts, fromPlayer, deadline, timeoutMs }) => {
  myTurn = false;
  rearrangeMode = false;
  rearrangeFromIndex = null;
  pendingAction = { tile, acts, fromPlayer };
  renderPromptBar(tile, acts);
  startCountdown(deadline, timeoutMs);
});

socket.on('voice_announcement', (msg) => {
  speakAnnouncement(msg);
});

function startCountdown(deadline, timeoutMs) {
  clearCountdown();
  let badge = document.getElementById('countdown-badge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'countdown-badge';
    badge.className = 'countdown-badge';
    document.body.appendChild(badge);
  }
  badge.style.display = 'flex';
  const fallbackDeadline = Date.now() + (timeoutMs || ACTION_TIMEOUT_SECS * 1000);
  const endAt = deadline || fallbackDeadline;
  const update = () => {
    const n = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
    badge.textContent = n;
    badge.classList.toggle('urgent', n <= 3);
    if (n <= 0) clearCountdown();
  };
  update();
  countdownTimer = setInterval(update, 250);
}

function clearCountdown() {
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  const badge = document.getElementById('countdown-badge');
  if (badge) badge.style.display = 'none';
}

socket.on('can_hu_self', () => {
  canHuSelfNow = true;
  renderActionBar();
});

socket.on('can_hu_gang', () => {
  canHuSelfNow = true;
  renderActionBar();
});

socket.on('liuju', () => {
  nextRoundRequested = false;
  nextRoundReady = 0;
  showOverlay(`<div class="result-card">
    <h2>流局</h2>
    <p style="color:#888;margin:12px 0">牌摸完了，本局无输赢</p>
    <div class="btn-row">
      <button id="btn-next-round" class="btn btn-primary btn-next-round" onclick="newRound()">下一局（0/4）</button>
    </div>
  </div>`);
});

socket.on('gang_payment', ({ gangerId, gangType, pts, transfers }) => {
  if (!state) return;
  const gangerName = playerDisplayName(state, gangerId) || '玩家';
  const typeLabel = gangType === 'concealed_gang' ? '暗杠' : '明杠';
  const myDelta = transfers[myId];
  if (myDelta) showToast(`${gangerName} ${typeLabel}，你付 ${Math.abs(myDelta)} 分`);
  else showToast(`${gangerName} ${typeLabel} +${pts * 3} 分`);
});

socket.on('round_end', ({ winner, scores }) => {
  if (!state) return;
  canHuSelfNow = false;
  nextRoundRequested = false;
  nextRoundReady = 0;
  speakChinese('胡');
  renderAll(state);
  clearTimeout(roundEndDialogTimer);
  roundEndDialogTimer = setTimeout(() => showManualSettlement(winner, scores), 3500);
});

socket.on('new_round_ready', ({ ready, total }) => {
  nextRoundReady = ready || 0;
  nextRoundTotal = total || 4;
  updateNextRoundButton();
});

socket.on('red_packet_sent', ({ from, to, amount }) => {
  if (!state) return;
  showToast(`${playerDisplayName(state, from)} 给 ${playerDisplayName(state, to)} 发了 ${amount}`);
});

socket.on('seat_swap_waiting', ({ to }) => {
  showToast(`已向 ${playerDisplayName(state, to)} 发送换位请求`);
});

socket.on('seat_swap_prompt', ({ from, fromName }) => {
  const name = fromName || playerDisplayName(state, from) || '玩家';
  showOverlay(`<div class="result-card">
    <h2>换位置？</h2>
    <p class="score-line">${escapeHtml(name)} 想和你换位置</p>
    <div class="btn-row">
      <button class="btn btn-secondary" id="seat-swap-no">拒绝</button>
      <button class="btn btn-primary" id="seat-swap-yes">同意</button>
    </div>
  </div>`);
  document.getElementById('seat-swap-no')?.addEventListener('click', () => {
    socket.emit('seat_swap_response', { from, accept: false });
    hideOverlay();
  });
  document.getElementById('seat-swap-yes')?.addEventListener('click', () => {
    socket.emit('seat_swap_response', { from, accept: true });
    hideOverlay();
  });
});

socket.on('seat_swap_result', ({ ok, reason }) => {
  showToast(ok ? '换位成功' : (reason || '对方拒绝了换位'));
});

socket.on('player_rejoined', ({ name }) => {
  showToast(`${name || '玩家'} 已回到对局`);
});

socket.on('game_log_snapshot', ({ entries }) => {
  gameLogEntries = Array.isArray(entries) ? entries : [];
  if (isGameLogOpen()) renderGameLogPanel();
});

socket.on('game_log_entry', (entry) => {
  if (!entry) return;
  gameLogEntries.push(entry);
  if (gameLogEntries.length > 80) gameLogEntries.splice(0, gameLogEntries.length - 80);
  if (isGameLogOpen()) renderGameLogPanel();
});

function playerDisplayName(gs, pid) {
  const name = gs?.playerNames?.[pid] || '';
  const seat = getSeatTitle(gs, pid) || '玩家';
  return name ? `${name} ${seat}` : seat;
}

function showManualSettlement(winner, scores) {
  if (!state) return;
  const winnerName = playerDisplayName(state, winner);
  const sr = scores.scoreResult;
  if (sr?.ruleset === 'pingyang_taipao') return showPingyangSettlement(winnerName, scores, sr);
  const type = scores.type || sr?.type || '';
  const mult = sr?.mult ?? 0;
  const caijinFen = sr?.caijinFen ?? 0;
  const base = sr?.base ?? 2;
  const dealerMultiplier = sr?.dealerMultiplier ?? 1;
  const hasDealerRate = (scores.payDetails || []).some(item => item.effectiveMult && item.effectiveMult !== mult);
  const others = (state.playerOrder || []).filter(pid => pid !== myId);

  let html = `<div class="result-card">
    <h2>${winnerName} 胡牌！</h2>
    <p class="score-line winner" style="font-size:1.1em">${type}</p>
    <p class="score-line" style="color:#aaa">倍数${mult} × 底数${base}${hasDealerRate ? `，庄家倍${dealerMultiplier}` : ''}${caijinFen > 0 ? `，财神${caijinFen}分` : ''}</p>
    <div class="manual-settlement">`;

  for (const pid of others) {
    html += `<label class="settlement-row">
      <span class="settlement-name" title="${playerDisplayName(state, pid)}"><em>${playerDisplayName(state, pid)}</em><b>（${countSeatCaijin(state, pid)}）</b></span>
      <input class="settlement-input" data-pid="${pid}" type="number" inputmode="numeric" placeholder="默认0" />
    </label>`;
  }
  html += `</div>
    <div class="btn-row">
      <button id="btn-next-round" class="btn btn-primary btn-next-round" onclick="newRound()">下一局（0/4）</button>
    </div>
  </div>`;
  showOverlay(html);
  bindSettlementInputs();
  updateNextRoundButton();
}

function showPingyangSettlement(winnerName, scores, sr) {
  const others = (state.playerOrder || []).filter(pid => pid !== myId);
  const detailRows = (sr.taiDetails || []).map(item =>
    `<div class="score-line"><span>${item.label}</span><strong>${item.tai}台</strong></div>`
  ).join('');
  let html = `<div class="result-card">
    <h2>${winnerName} 胡牌！</h2>
    <p class="score-line winner" style="font-size:1.1em">${sr.type || '平阳台炮'}</p>
    <p class="score-line" style="color:#aaa">总台数 ${sr.totalTai || 0} 台${sr.qifan ? `，已达 ${sr.qifanTai || 13} 台起翻` : `，未达 ${sr.qifanTai || 13} 台起翻`}${sr.double ? '，30台双翻' : ''}</p>
    <div class="manual-settlement">${detailRows || '<div class="score-line">暂无台数明细</div>'}</div>
    <div class="manual-settlement">`;
  for (const pid of others) {
    html += `<label class="settlement-row">
      <span class="settlement-name" title="${playerDisplayName(state, pid)}"><em>${playerDisplayName(state, pid)}</em><b>（${countSeatCaijin(state, pid)}）</b></span>
      <input class="settlement-input" data-pid="${pid}" type="number" inputmode="numeric" placeholder="默认0" />
    </label>`;
  }
  html += `</div>
    <div class="btn-row">
      <button id="btn-next-round" class="btn btn-primary btn-next-round" onclick="newRound()">下一局 (0/4)</button>
    </div>
  </div>`;
  showOverlay(html);
  bindSettlementInputs();
  updateNextRoundButton();
}

function bindSettlementInputs() {
  document.querySelectorAll('.settlement-input').forEach(input => {
    input.addEventListener('change', sendSettlementUpdate);
    input.addEventListener('blur', sendSettlementUpdate);
  });
}

function collectSettlementPayments() {
  const payments = {};
  document.querySelectorAll('.settlement-input').forEach(input => {
    const pid = input.dataset.pid;
    const amount = Number(input.value || 0);
    if (pid && Number.isFinite(amount) && amount > 0) payments[pid] = amount;
  });
  return payments;
}

function sendSettlementUpdate() {
  if (state?.phase === 'ended') {
    socket.emit('settlement_update', { payments: collectSettlementPayments() });
  }
}

function countSeatCaijin(gs, pid) {
  const seat = gs?.seats?.[pid];
  if (!seat || !gs.caijinTile) return 0;
  if (Number.isFinite(seat.caijinCount)) return seat.caijinCount;
  const hand = seat.hand || [];
  const meldTiles = (seat.openMelds || []).flatMap(m => m.tiles || []);
  const caijinTiles = gs.caijinTiles?.length ? gs.caijinTiles : [gs.caijinTile].filter(Boolean);
  return [...hand, ...meldTiles].filter(t => caijinTiles.includes(t)).length;
}

function countSeatTai(gs, pid) {
  const seat = gs?.seats?.[pid];
  if (!seat) return 0;
  return Number.isFinite(seat.taiCount) ? seat.taiCount : 0;
}

function getSettlementMetric(gs, pid) {
  if ((gs?.ruleset || '') === 'pingyang_taipao') return `${countSeatTai(gs, pid)}台`;
  return `${countSeatCaijin(gs, pid)}财`;
}

function setupNameRedPacket(el, pid) {
  if (!el || pid === myId) return;
  el.onpointerdown = (event) => {
    clearTimeout(nameLongPressTimer);
    nameLongPressTimer = setTimeout(() => openPlayerMenu(pid, event.clientX, event.clientY), 650);
  };
  el.onpointerup = () => clearTimeout(nameLongPressTimer);
  el.onpointerleave = () => clearTimeout(nameLongPressTimer);
  el.onpointercancel = () => clearTimeout(nameLongPressTimer);
}

function closeRedPacketPanel() {
  document.getElementById('red-packet-popover')?.remove();
}

function placePlayerPopover(box, x, y) {
  const rect = box.getBoundingClientRect();
  box.style.left = `${Math.min(window.innerWidth - rect.width - 10, Math.max(10, x || window.innerWidth / 2))}px`;
  box.style.top = `${Math.min(window.innerHeight - rect.height - 10, Math.max(10, y || window.innerHeight / 2))}px`;
}

function openPlayerMenu(pid, x, y) {
  closeRedPacketPanel();
  const box = document.createElement('div');
  box.id = 'red-packet-popover';
  box.className = 'red-packet-popover';
  box.innerHTML = `
    <div class="red-packet-title">${playerDisplayName(state, pid)}</div>
    <div class="red-packet-actions menu-actions">
      <button type="button" id="player-menu-red">发红包</button>
      <button type="button" id="player-menu-swap">换位置</button>
    </div>
    <div class="red-packet-actions">
      <button type="button" id="red-packet-cancel">取消</button>
    </div>`;
  document.body.appendChild(box);
  placePlayerPopover(box, x, y);
  box.querySelector('#player-menu-red')?.addEventListener('click', () => openRedPacketPanel(pid, x, y));
  box.querySelector('#player-menu-swap')?.addEventListener('click', () => {
    socket.emit('seat_swap_request', { to: pid });
    closeRedPacketPanel();
  });
  box.querySelector('#red-packet-cancel')?.addEventListener('click', closeRedPacketPanel);
  setTimeout(() => {
    document.addEventListener('pointerdown', closeRedPacketOnOutside, { once: true });
  }, 0);
}

function openRedPacketPanel(pid, x, y) {
  closeRedPacketPanel();
  const box = document.createElement('div');
  box.id = 'red-packet-popover';
  box.className = 'red-packet-popover';
  box.innerHTML = `
    <div class="red-packet-title">给 ${playerDisplayName(state, pid)} 发红包</div>
    <input id="red-packet-amount" type="number" inputmode="decimal" min="0" placeholder="金额" />
    <div class="red-packet-actions">
      <button type="button" id="red-packet-cancel">取消</button>
      <button type="button" id="red-packet-send">发送</button>
    </div>`;
  document.body.appendChild(box);
  const rect = box.getBoundingClientRect();
  box.style.left = `${Math.min(window.innerWidth - rect.width - 10, Math.max(10, x || window.innerWidth / 2))}px`;
  box.style.top = `${Math.min(window.innerHeight - rect.height - 10, Math.max(10, y || window.innerHeight / 2))}px`;
  const amountEl = box.querySelector('#red-packet-amount');
  amountEl?.focus();
  box.querySelector('#red-packet-cancel')?.addEventListener('click', closeRedPacketPanel);
  box.querySelector('#red-packet-send')?.addEventListener('click', () => {
    const amount = Number(amountEl?.value || 0);
    if (amount > 0) socket.emit('red_packet', { to: pid, amount });
    closeRedPacketPanel();
  });
  setTimeout(() => {
    document.addEventListener('pointerdown', closeRedPacketOnOutside, { once: true });
  }, 0);
}

function closeRedPacketOnOutside(event) {
  const box = document.getElementById('red-packet-popover');
  if (box && !box.contains(event.target)) closeRedPacketPanel();
  else document.addEventListener('pointerdown', closeRedPacketOnOutside, { once: true });
}

socket.on('player_left', ({ id }) => {
  if (state) showToast(`${playerDisplayName(state, id) || '玩家'} 断开连接`);
});

socket.on('error', (msg) => {
  showToast(msg || '操作失败');
  discardInFlight = false;
  if (state?.currentTurn === myId && state.phase === 'playing') {
    myTurn = true;
    actionAllowed = actionAllowed || 'discard_or_hu';
    renderActionBar();
  }
});

// ── Render ───────────────────────────────────────────────────────
function renderAll(gs) {
  if (!gs) return;
  const { seats, caijinTile, wallLeft, playerOrder, currentTurn, myId: mid } = gs;
  const caijinTiles = gs.caijinTiles?.length ? gs.caijinTiles : [caijinTile];
  const ruleEl = document.getElementById('rule-display');
  if (ruleEl) ruleEl.textContent = gs.rulesetName || '瑞安麻将';
  const myIdx = playerOrder.indexOf(mid);

  // Player layout: bottom=me, left=prev, top=opposite, right=next
  const positions = ['bottom', 'right', 'top', 'left'];

  for (let i = 0; i < 4; i++) {
    const pid = playerOrder[(myIdx + i) % 4];
    const pos = positions[i];
    const seat = seats[pid];
    if (!seat) continue;

    const isMe = i === 0;
    const isActive = pid === currentTurn;
    const nameEl = document.getElementById(`name-${pos}`);
    const handEl = document.getElementById(`hand-${pos}`);
    const discEl = document.getElementById(`discards-${pos}`);
    const meldsEl = document.getElementById(`melds-${pos}`);
    if (!nameEl || !handEl || !discEl || !meldsEl) continue;

    // Seat tag
    nameEl.textContent = playerDisplayName(gs, pid);
    nameEl.className = `player-name-tag${isActive ? ' active' : ''}`;
    setupNameRedPacket(nameEl, pid);

    // Discards
    discEl.innerHTML = '';
    const discards = seat.discards || [];
    discards.forEach((t, discardIndex) => {
      const tileEl = makeTile(t, { mini: true });
      tileEl.title = `${playerDisplayName(gs, pid)} 第 ${discardIndex + 1} 张：${tileLabel(t)}`;
      if (gs.lastDiscard?.playerId === pid && gs.lastDiscard?.tile === t && discardIndex === discards.length - 1) {
        tileEl.classList.add('latest-discard');
      }
      discEl.appendChild(tileEl);
    });
    if (discards.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'discard-empty';
      empty.textContent = '未出牌';
      discEl.appendChild(empty);
    }

    // Open melds
    meldsEl.innerHTML = '';
    for (const meld of (seat.openMelds || [])) {
      const grp = document.createElement('div');
      grp.className = 'meld-group';
      const isGang = meld.type === 'gang' || meld.type === 'concealed_gang';
      for (const t of meld.tiles) {
        const fd = meld.type === 'concealed_gang' && meld.tiles.indexOf(t) === 0;
        grp.appendChild(makeTile(t, { small: true, faceDown: fd, isCaijin: caijinTiles.includes(t) }));
      }
      meldsEl.appendChild(grp);
    }
    if (seat.flowers?.length) {
      const flowerGrp = document.createElement('div');
      flowerGrp.className = 'meld-group flower-group';
      seat.flowers.forEach(t => flowerGrp.appendChild(makeTile(t, { small: true })));
      meldsEl.appendChild(flowerGrp);
    }
    if (seat.baiTiles?.length) {
      const baiGrp = document.createElement('div');
      baiGrp.className = 'meld-group flower-group';
      seat.baiTiles.forEach(t => baiGrp.appendChild(makeTile(t, { small: true })));
      meldsEl.appendChild(baiGrp);
    }

    // Hand tiles
    handEl.innerHTML = '';
    const revealWinner = gs.phase === 'ended' && pid === gs.winner && seat.hand;
    if (isMe && seat.hand) {
      const sorted = getDisplayHand(seat.hand, caijinTiles);
      handEl.classList.toggle('rearrange-mode', rearrangeMode);
      sorted.forEach((t, handIndex) => {
        const isCaijin = caijinTiles.includes(t);
        const el = makeTile(t, { clickable: myTurn && !!actionAllowed, isCaijin });
        if (selectedHandIndex === handIndex) el.classList.add('selected');
        if (rearrangeMode && handIndex === rearrangeFromIndex) el.classList.add('reorder-source');
        if (rearrangeMode && handIndex === rearrangeHoverIndex && handIndex !== rearrangeFromIndex) el.classList.add('reorder-target');
        setupMyTileInteractions(el, t, handIndex, sorted);
        handEl.appendChild(el);
      });
    } else if (revealWinner) {
      handEl.classList.remove('rearrange-mode');
      const sorted = sortHand(seat.hand, caijinTiles);
      sorted.forEach(t => handEl.appendChild(makeTile(t, { small: i === 1 || i === 3, isCaijin: caijinTiles.includes(t) })));
    } else {
      handEl.classList.remove('rearrange-mode');
      const count = seat.handCount || 0;
      for (let k = 0; k < count; k++) {
        handEl.appendChild(makeTile(null, { faceDown: true, small: i === 1 || i === 3 }));
      }
    }
  }

  // HUD
  updateTopScores(gs, mid);
  updateTurnPointer(gs, myIdx);
  setText('wall-count', wallLeft);
  setText('wall-count-center', wallLeft);
  const statusText = gs.phase === 'flowering'
    ? (currentTurn === mid ? '请补花' : `等待 ${playerDisplayName(gs, currentTurn) || '...'} 补花`)
    : canHuSelfNow && currentTurn === mid
      ? '可以胡牌'
      : currentTurn === mid
        ? '轮到你了'
        : `等待 ${playerDisplayName(gs, currentTurn) || '...'}`;
  setText('hud-status', statusText);

  // Center caijin tile
  const caijinEl = document.getElementById('center-caijin');
  caijinEl.innerHTML = '';
  (caijinTiles.length ? caijinTiles : [caijinTile || 'bai']).forEach(tile => {
    caijinEl.appendChild(makeTile(tile || 'bai', { isCaijin: true }));
  });
  caijinEl.className = '';

  // Dice
  const diceEl = document.getElementById('dice-display');
  if (gs.diceRoll) diceEl.textContent = '🎲'.repeat(gs.diceRoll > 3 ? 2 : 1) + ` ${gs.diceRoll}`;
  refreshAllMediaSlots();
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function getSeatTitle(gs, pid) {
  if (!gs || !pid || !gs.seats?.[pid]) return '';
  const isDealer = gs.playerOrder?.[gs.dealerSeat] === pid;
  const wind = WIND_CN[gs.seats[pid].wind] || '';
  const streak = isDealer && gs.dealerStreak > 1 ? ` ${gs.dealerStreak}连` : '';
  return `${isDealer ? '庄家' : '闲家'} ${wind}${streak}`;
}

function updateTopScores(gs, mid) {
  const { seats, playerOrder, currentTurn } = gs;
  for (let i = 0; i < 4; i++) {
    const pid = playerOrder[i];
    const chip = document.getElementById(`chip-${i}`);
    if (!chip || !pid) continue;
    chip.classList.toggle('active-turn', pid === currentTurn);
    chip.classList.toggle('is-me', pid === mid);
    const nameEl = chip.querySelector('.chip-name');
    const metaEl = chip.querySelector('.chip-meta');
    const scoreEl = chip.querySelector('.chip-score');
    if (nameEl) nameEl.textContent = `${playerDisplayName(gs, pid)}${pid === mid ? '（我）' : ''}`;
    if (scoreEl) scoreEl.textContent = `${seats[pid]?.score ?? ''}分`;
  }
}

function updateTurnPointer(gs, myIdx) {
  const pointer = document.getElementById('turn-pointer');
  if (!pointer) return;

  const currentIdx = gs.playerOrder.indexOf(gs.currentTurn);
  const relativeIdx = (currentIdx - myIdx + 4) % 4;
  const byRelativeSeat = [
    { pos: 'bottom', arrow: '▼', label: '我' },
    { pos: 'right', arrow: '▶', label: '下家' },
    { pos: 'top', arrow: '▲', label: '对家' },
    { pos: 'left', arrow: '◀', label: '上家' },
  ];
  const info = byRelativeSeat[relativeIdx] || byRelativeSeat[0];
  pointer.className = `turn-pointer turn-${info.pos}`;
  const arrow = pointer.querySelector('.turn-arrow');
  const name = pointer.querySelector('.turn-name');
  if (arrow) arrow.textContent = info.arrow;
  if (name) name.textContent = gs.currentTurn === gs.myId ? '轮到我' : (playerDisplayName(gs, gs.currentTurn) || info.label);
}

// Sort hand: numbered by suit/value, then honors, caijin last
function sortHand(hand, caijinTile) {
  return hand
    .map((tile, index) => ({ tile, index }))
    .sort((a, b) => tileSortValue(a.tile, caijinTile) - tileSortValue(b.tile, caijinTile) || a.index - b.index)
    .map(item => item.tile);
}

function getDisplayHand(hand, caijinTile) {
  if (!manualHandOrder.length) return sortHand(hand, caijinTile);
  syncManualHandOrder(hand, caijinTile);
  return [...manualHandOrder];
}

function syncManualHandOrder(hand, caijinTile) {
  const counts = countTiles(hand);
  const next = [];
  for (const tile of manualHandOrder) {
    if (counts[tile] > 0) {
      next.push(tile);
      counts[tile]--;
    }
  }
  const additions = [];
  for (const [tile, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i++) additions.push(tile);
  }
  manualHandOrder = [...next, ...sortHand(additions, caijinTile)];
}

function countTiles(tiles) {
  const counts = {};
  for (const tile of tiles) counts[tile] = (counts[tile] || 0) + 1;
  return counts;
}

function tileSortValue(tile, caijinTile) {
  if (tile === caijinTile) return 900;
  if (tile === 'bai') return 1000;
  if (FLOWER_CN[tile]) return 1100 + Object.keys(FLOWER_CN).indexOf(tile);
  if (/^\d[m]$/.test(tile)) return parseInt(tile, 10);
  if (/^\d[t]$/.test(tile)) return 100 + parseInt(tile, 10);
  if (/^\d[b]$/.test(tile)) return 200 + parseInt(tile, 10);
  const honorOrder = ['east','south','west','north','zhong','fa'];
  const honorIdx = honorOrder.indexOf(tile);
  return honorIdx >= 0 ? 500 + honorIdx : 1200;
}

function getSeatTitle(gs, pid) {
  if (!gs || !pid) return '';
  const dealerSeat = Number.isInteger(gs.dealerSeat) ? gs.dealerSeat : 0;
  const isDealer = gs.playerOrder?.[dealerSeat] === pid;
  const wind = { east: '东', south: '南', west: '西', north: '北' }[gs.seats?.[pid]?.wind] || '';
  const streak = isDealer && gs.dealerStreak > 1 ? ` ${gs.dealerStreak}连` : '';
  return `${isDealer ? '庄家' : '闲家'} ${wind}${streak}`;
}

function tileLabel(tile) {
  if (!tile) return '?';
  if (tile === 'bai') return '白板';
  if (HONOR_CN[tile]) return HONOR_CN[tile];
  const s = tile.slice(-1), n = tile.slice(0, -1);
  return `${n}${SUIT_LABEL[s] || s}`;
}

function tileSpeechLabel(tile) {
  if (!tile) return '';
  if (tile === 'bai') return '白板';
  if (tile === 'zhong') return '红中';
  if (tile === 'fa') return '发财';
  if (HONOR_CN[tile]) return HONOR_CN[tile] + '风';
  const s = tile.slice(-1);
  const n = tile.slice(0, -1);
  const num = ['零','一','二','三','四','五','六','七','八','九'][Number(n)] || n;
  const suit = s === 'm' ? '万' : s === 't' ? '筒' : s === 'b' ? '条' : s;
  return `${num}${suit}`;
}

function tileLabel(tile) {
  if (!tile) return '?';
  const honor = { east: '东', south: '南', west: '西', north: '北', zhong: '中', fa: '发', bai: '白板' };
  if (honor[tile]) return honor[tile];
  const s = tile.slice(-1), n = tile.slice(0, -1);
  const suit = { m: '万', t: '筒', b: '条' }[s] || s;
  return `${n}${suit}`;
}

function tileSpeechLabel(tile) {
  if (!tile) return '';
  if (tile === 'bai') return '白板';
  if (tile === 'zhong') return '红中';
  if (tile === 'fa') return '发财';
  const honor = { east: '东风', south: '南风', west: '西风', north: '北风' };
  if (honor[tile]) return honor[tile];
  const s = tile.slice(-1);
  const n = tile.slice(0, -1);
  const num = ['零','一','二','三','四','五','六','七','八','九'][Number(n)] || n;
  const suit = s === 'm' ? '万' : s === 't' ? '筒' : s === 'b' ? '条' : s;
  return `${num}${suit}`;
}

function unlockSpeech() {
  speechUnlocked = true;
  document.querySelectorAll('.seat-video video, audio.remote-seat-audio').forEach(media => media.play?.().catch(() => {}));
}

function speakChinese(text) {
  if (!text || !('speechSynthesis' in window)) return;
  if (!speechUnlocked) speechUnlocked = true;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-CN';
  utterance.rate = 1.05;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}

function speakAnnouncement(msg) {
  if (!msg) return;
  const tile = tileSpeechLabel(msg.tile);
  if (msg.type === 'discard') {
    speakChinese(tile);
  } else if (msg.type === 'peng') {
    speakChinese('碰');
  } else if (msg.type === 'gang') {
    speakChinese('杠');
  } else if (msg.type === 'chi') {
    speakChinese('吃');
  }
}

// ── Tile click ───────────────────────────────────────────────────
function setupMyTileInteractions(el, tile, handIndex, hand) {
  el.dataset.handIndex = String(handIndex);
  el.addEventListener('pointerdown', (event) => {
    if (!canRearrangeHand()) return;
    clearLongPressTimer();
    activePointerId = event.pointerId;
    event.preventDefault();
    longPressTimer = setTimeout(() => {
      rearrangeMode = true;
      rearrangeFromIndex = handIndex;
      rearrangeHoverIndex = handIndex;
      selectedHandIndex = null;
      suppressTileClickUntil = Date.now() + 350;
      document.addEventListener('pointermove', handleRearrangeMove);
      document.addEventListener('pointerup', finishRearrangeDrag, { once: true });
      document.addEventListener('pointercancel', cancelRearrangeDrag, { once: true });
      showToast('整理手牌：拖到目标位置后松开');
      if (state) renderAll(state);
    }, 450);
  }, { passive: false });
  el.addEventListener('pointerup', () => clearLongPressTimer());
  el.addEventListener('pointerleave', () => clearLongPressTimer());
  el.addEventListener('pointercancel', () => clearLongPressTimer());

  el.addEventListener('click', () => {
    if (Date.now() < suppressTileClickUntil) return;
    if (rearrangeMode) {
      moveManualHandTile(handIndex);
      return;
    }
    onTileClick(tile, handIndex, hand);
  });
}

function clearLongPressTimer() {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

function canRearrangeHand() {
  return state?.seats?.[myId]?.hand?.length > 0;
}

function moveManualHandTile(toIndex) {
  if (rearrangeFromIndex == null || rearrangeFromIndex === toIndex) {
    rearrangeMode = false;
    rearrangeFromIndex = null;
    if (state) renderAll(state);
    return;
  }
  const next = [...manualHandOrder];
  const [tile] = next.splice(rearrangeFromIndex, 1);
  next.splice(toIndex, 0, tile);
  manualHandOrder = next;
  rearrangeMode = false;
  rearrangeFromIndex = null;
  rearrangeHoverIndex = null;
  if (state) renderAll(state);
}

function handleRearrangeMove(event) {
  if (!rearrangeMode || event.pointerId !== activePointerId) return;
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('#hand-bottom .tile');
  if (!target?.dataset.handIndex) return;
  const nextIndex = Number(target.dataset.handIndex);
  if (Number.isInteger(nextIndex) && nextIndex !== rearrangeHoverIndex) {
    rearrangeHoverIndex = nextIndex;
    if (state) renderAll(state);
  }
}

function finishRearrangeDrag(event) {
  document.removeEventListener('pointermove', handleRearrangeMove);
  if (rearrangeMode && event.pointerId === activePointerId) {
    moveManualHandTile(rearrangeHoverIndex ?? rearrangeFromIndex);
  }
  activePointerId = null;
}

function cancelRearrangeDrag() {
  document.removeEventListener('pointermove', handleRearrangeMove);
  rearrangeMode = false;
  rearrangeFromIndex = null;
  rearrangeHoverIndex = null;
  activePointerId = null;
  if (state) renderAll(state);
}

function onTileClick(tile, handIndex, hand) {
  if (!myTurn || !actionAllowed) return;

  if (selectedHandIndex === handIndex) {
    // Click same tile again = deselect
    selectedHandIndex = null;
  } else {
    selectedHandIndex = handIndex;
  }

  // Re-render hand to update highlights
  if (state) renderAll(state);
  renderActionBar();
}

// ── Action bar ───────────────────────────────────────────────────
function renderActionBar() {
  const bar = document.getElementById('action-bar');
  bar.innerHTML = '';
  bar.classList.remove('hidden');

  if (!myTurn && !pendingAction) { bar.classList.add('hidden'); return; }

  if (myTurn) {
    if (actionAllowed === 'flower_replace') {
      const flowers = flowerPromptTiles.length ? flowerPromptTiles : getMyFlowerTiles();
      const prompt = document.createElement('div');
      prompt.className = 'action-context';
      prompt.textContent = openingFlowerPhase ? `开局补花：${flowers.map(tileLabel).join(' ')}` : `请补花：${flowers.map(tileLabel).join(' ')}`;
      bar.appendChild(prompt);
      bar.appendChild(btn(`补花 ${flowers.length} 张`, 'gang', () => doFlowerReplace(flowers)));
    }
    // Check if we can gang from hand
    if (actionAllowed === 'discard_or_hu' || actionAllowed === 'discard_only') {
      if (selectedHandIndex != null) {
        const discardBtn = btn('出牌', 'discard', () => doDiscard());
        bar.appendChild(discardBtn);
      }

      if (actionAllowed === 'discard_or_hu') {
        // Check gang options
        addGangButtons(bar);
        if (canHuSelfNow) {
          const prompt = document.createElement('div');
          prompt.className = 'action-context';
          prompt.textContent = '当前可以胡牌';
          bar.appendChild(prompt);
          bar.appendChild(btn('胡', 'hu', () => doHuSelf()));
        }
      }
    }
  }

  if (pendingAction) {
    const { tile, acts } = pendingAction;
    if (acts.includes('hu')) bar.appendChild(btn('胡', 'hu', () => respond('hu')));
    if (acts.includes('gang')) bar.appendChild(btn('杠', 'gang', () => respond('gang')));
    if (acts.includes('peng')) bar.appendChild(btn('碰', 'peng', () => respond('peng')));
    if (acts.includes('chi')) bar.appendChild(btn('吃', 'chi', () => promptChi()));
    bar.appendChild(btn('过', 'pass', () => respond('pass')));
  }

  if (bar.children.length === 0) bar.classList.add('hidden');
}

function addGangButtons(bar) {
  if (!state) return;
  const hand = state.seats[myId]?.hand || [];
  const melds = state.seats[myId]?.openMelds || [];
  const caijin = state.caijinTile;
  const isRuian = state.ruleset !== 'pingyang_taipao';
  const faceOf = (tile) => (isRuian && tile === 'bai' ? caijin : tile);
  const usableForMeld = (tile) => !isRuian || tile !== caijin;

  // Concealed gang: 4 of same tile in hand
  const counts = {};
  for (const t of hand) {
    if (!usableForMeld(t)) continue;
    const face = faceOf(t);
    counts[face] = (counts[face] || 0) + 1;
  }
  for (const [t, c] of Object.entries(counts)) {
    if (c >= 4) {
      bar.appendChild(btn(`暗杠${tileLabel(t)}`, 'gang', () => doConcealedGang(t)));
    }
  }

  // Open gang (补杠): peng meld + same tile in hand
  for (const m of melds) {
    if (m.type !== 'peng') continue;
    const meldFace = faceOf(m.tiles[0]);
    if (hand.some(t => usableForMeld(t) && faceOf(t) === meldFace)) {
      bar.appendChild(btn(`补杠${tileLabel(meldFace)}`, 'gang', () => doOpenGang(meldFace)));
    }
  }
}

function btn(label, cls, onClick) {
  const b = document.createElement('button');
  b.className = `action-btn ${cls}`;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

// ── Actions ──────────────────────────────────────────────────────
function doDiscard() {
  if (discardInFlight) return;
  if (selectedHandIndex == null) return showToast('请先选择要出的牌');
  const hand = state?.seats?.[myId]?.hand || [];
  const displayHand = getDisplayHand(hand, state?.caijinTiles?.length ? state.caijinTiles : state?.caijinTile);
  const tile = displayHand[selectedHandIndex];
  if (!tile) return showToast('请先选择要出的牌');
  discardInFlight = true;
  socket.emit('discard', { tile });
  selectedHandIndex = null;
  myTurn = false;
  actionAllowed = null;
  document.getElementById('action-bar').classList.add('hidden');
}

function doHuSelf() {
  socket.emit('hu_self');
  myTurn = false;
  document.getElementById('action-bar').classList.add('hidden');
}

function doConcealedGang(tile) {
  socket.emit('gang', { tile, type: 'concealed' });
  myTurn = false;
  document.getElementById('action-bar').classList.add('hidden');
}

function doOpenGang(tile) {
  socket.emit('gang', { tile, type: 'open' });
  myTurn = false;
  document.getElementById('action-bar').classList.add('hidden');
}

function getMyFlowerTiles() {
  return (state?.seats?.[myId]?.hand || []).filter(tile => FLOWER_CN[tile] || tile === 'bai');
}

function doFlowerReplace(flowers) {
  socket.emit('flower_replace', { tiles: flowers || getMyFlowerTiles() });
  myTurn = false;
  actionAllowed = null;
  flowerPromptTiles = [];
  document.getElementById('action-bar').classList.add('hidden');
}

function respond(action, tiles) {
  socket.emit('action_response', { action, tiles });
  if (action === 'hu') showToast('已发送胡牌请求');
  pendingAction = null;
  clearCountdown();
  document.getElementById('action-bar').classList.add('hidden');
}

function promptChi() {
  if (!pendingAction) return;
  const { tile } = pendingAction;
  const hand = state?.seats[myId]?.hand || [];

  // Compute chi options locally
  const options = getChiOptions(hand, tile);
  if (options.length === 0) return respond('chi', []);
  if (options.length === 1) return respond('chi', options[0]);

  // Show picker
  let html = `<div class="chi-picker"><h3>选择吃的顺子</h3><div class="chi-options">`;
  for (const opt of options) {
    const labels = [...opt, tile].sort((a,b) => parseInt(a)-parseInt(b)).map(tileLabel).join(' ');
    html += `<div class="chi-option" data-tiles='${JSON.stringify(opt)}'>${labels}</div>`;
  }
  html += `</div></div>`;
  showOverlay(html);

  document.querySelectorAll('.chi-option').forEach(el => {
    el.addEventListener('click', () => {
      const tiles = JSON.parse(el.dataset.tiles);
      hideOverlay();
      respond('chi', tiles);
    });
  });
}

function getChiOptions(hand, tile) {
  if (!tile.endsWith('m') && !tile.endsWith('t') && !tile.endsWith('b')) return [];
  const suit = tile.slice(-1), val = parseInt(tile);
  const options = [];
  const seqs = [[val-2, val-1], [val-1, val+1], [val+1, val+2]];
  for (const pair of seqs) {
    if (pair.some(v => v < 1 || v > 9)) continue;
    const t1 = `${pair[0]}${suit}`, t2 = `${pair[1]}${suit}`;
    const h = [...hand];
    const i1 = h.indexOf(t1); if (i1 < 0) continue; h.splice(i1,1);
    const i2 = h.indexOf(t2); if (i2 < 0) continue;
    options.push([t1, t2]);
  }
  return options;
}

// Prompt bar for incoming action requests
function renderPromptBar(tile, acts) {
  const bar = document.getElementById('action-bar');
  bar.innerHTML = '';
  bar.classList.remove('hidden');

  const prompt = document.createElement('div');
  prompt.className = 'action-context';
  prompt.textContent = `有人打出 ${tileLabel(tile)}`;
  bar.appendChild(prompt);
  if (acts.includes('hu')) bar.appendChild(btn('胡', 'hu', () => respond('hu')));
  if (acts.includes('gang')) bar.appendChild(btn('杠', 'gang', () => respond('gang')));
  if (acts.includes('peng')) bar.appendChild(btn('碰', 'peng', () => respond('peng')));
  if (acts.includes('chi')) bar.appendChild(btn('吃', 'chi', () => promptChi()));
  bar.appendChild(btn('过', 'pass', () => respond('pass')));
}

// ── Overlay helpers ───────────────────────────────────────────────
function showOverlay(html) {
  document.getElementById('overlay-content').innerHTML = html;
  document.getElementById('overlay').classList.remove('hidden');
}
function hideOverlay() {
  document.getElementById('overlay').classList.add('hidden');
  document.getElementById('overlay-content').innerHTML = '';
}
window.hideOverlay = hideOverlay;

function isGameLogOpen() {
  const overlay = document.getElementById('overlay');
  return !!document.getElementById('game-log-panel') && !overlay?.classList.contains('hidden');
}

function openGameLog() {
  socket.emit('game_log_request');
  renderGameLogPanel();
}

function renderGameLogPanel() {
  const rows = gameLogEntries.length
    ? gameLogEntries.slice().reverse().map(entry => {
        const time = new Date(entry.at || Date.now()).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        return `<div class="log-item"><span class="log-time">${time}</span><span>${escapeHtml(entry.text || '')}</span></div>`;
      }).join('')
    : '<div class="log-empty">还没有回合日志</div>';
  showOverlay(`<div class="result-card log-panel" id="game-log-panel">
    <h3>回合日志</h3>
    <div class="log-list">${rows}</div>
    <div class="btn-row"><button class="btn btn-primary" onclick="hideOverlay()">关闭</button></div>
  </div>`);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function updateNextRoundButton() {
  const btnEl = document.getElementById('btn-next-round');
  if (!btnEl) return;
  btnEl.textContent = `下一局（${nextRoundReady}/${nextRoundTotal}）`;
  btnEl.classList.toggle('waiting', nextRoundRequested);
  if (nextRoundRequested && nextRoundReady < nextRoundTotal) {
    btnEl.textContent = `等待中（${nextRoundReady}/${nextRoundTotal}）`;
  }
}

function newRound() {
  const payments = collectSettlementPayments();
  socket.emit('settlement_update', { payments });
  nextRoundRequested = true;
  updateNextRoundButton();
  manualHandOrder = [];
  rearrangeMode = false;
  rearrangeFromIndex = null;
  socket.emit('new_round', { roomId: myRoomId, payments });
}
window.newRound = newRound;

// ── Toast ────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

// Override label helpers so newly added flower tiles behave like first-class tiles.
function renderFallbackTile(div, tile, small, mini) {
  if (tile === 'bai') {
    div.innerHTML = '<div class="bai-tile"></div>';
  } else if (FLOWER_CN[tile]) {
    div.innerHTML = `<div class="honor-tile honor-fa">${FLOWER_CN[tile]}</div>`;
  } else if (HONOR_CN[tile]) {
    div.innerHTML = `<div class="honor-tile honor-${tile}">${HONOR_CN[tile]}</div>`;
  } else {
    const suit = tile.slice(-1);
    const num = parseInt(tile, 10);
    if (suit === 'm') {
      div.innerHTML = `<div class="tile-wan"><span class="wan-num">${WAN_CN[num - 1]}</span><span class="wan-char">万</span></div>`;
    } else if (suit === 't') {
      div.innerHTML = renderTong(num, small, mini);
    } else if (suit === 'b') {
      div.innerHTML = renderTiao(num, small, mini);
    }
  }
}

function hasCaijinTile(tile, caijinRef) {
  if (Array.isArray(caijinRef)) return caijinRef.includes(tile);
  return tile === caijinRef;
}

function tileSortValue(tile, caijinTile) {
  if (hasCaijinTile(tile, caijinTile)) return 900;
  if (tile === 'bai') return 1000;
  if (FLOWER_CN[tile]) return 1100 + Object.keys(FLOWER_CN).indexOf(tile);
  if (/^\d[m]$/.test(tile)) return parseInt(tile, 10);
  if (/^\d[t]$/.test(tile)) return 100 + parseInt(tile, 10);
  if (/^\d[b]$/.test(tile)) return 200 + parseInt(tile, 10);
  const honorOrder = ['east', 'south', 'west', 'north', 'zhong', 'fa'];
  const honorIdx = honorOrder.indexOf(tile);
  return honorIdx >= 0 ? 500 + honorIdx : 1200;
}

function tileLabel(tile) {
  if (!tile) return '?';
  const honor = { east: '东', south: '南', west: '西', north: '北', zhong: '中', fa: '发', bai: '白板', ...FLOWER_CN };
  if (honor[tile]) return honor[tile];
  const suit = { m: '万', t: '筒', b: '条' }[tile.slice(-1)] || tile.slice(-1);
  return `${tile.slice(0, -1)}${suit}`;
}

function tileSpeechLabel(tile) {
  if (!tile) return '';
  if (FLOWER_CN[tile]) return FLOWER_CN[tile];
  if (tile === 'bai') return '白板';
  if (tile === 'zhong') return '红中';
  if (tile === 'fa') return '发财';
  const honor = { east: '东风', south: '南风', west: '西风', north: '北风' };
  if (honor[tile]) return honor[tile];
  const num = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'][Number(tile.slice(0, -1))] || tile.slice(0, -1);
  const suit = tile.endsWith('m') ? '万' : tile.endsWith('t') ? '筒' : tile.endsWith('b') ? '条' : '';
  return `${num}${suit}`;
}
function formatSelfMetric(gs, pid) {
  if (!gs || !pid) return '';
  if ((gs.ruleset || '') === 'pingyang_taipao') return `${countSeatTai(gs, pid)}\u53f0`;
  return `${countSeatCaijin(gs, pid)}\u8d22`;
}

function settlementSelfCorner(gs) {
  if (!gs || !myId) return '';
  const label = (gs.ruleset || '') === 'pingyang_taipao' ? '\u6211\u7684\u53f0\u6570' : '\u6211\u7684\u8d22\u795e';
  return `<div class="result-corner">${label}\uff1a${formatSelfMetric(gs, myId)}</div>`;
}

function compactPlayerLabel(gs, pid) {
  const full = playerDisplayName(gs, pid) || '';
  return full.length > 10 ? `${full.slice(0, 8)}...` : full;
}

updateTopScores = function updateTopScoresPatched(gs, mid) {
  const { seats, playerOrder, currentTurn } = gs;
  for (let i = 0; i < 4; i++) {
    const pid = playerOrder[i];
    const chip = document.getElementById(`chip-${i}`);
    if (!chip || !pid) continue;
    chip.classList.toggle('active-turn', pid === currentTurn);
    chip.classList.toggle('is-me', pid === mid);
    const nameEl = chip.querySelector('.chip-name');
    const metaEl = chip.querySelector('.chip-meta');
    const scoreEl = chip.querySelector('.chip-score');
    if (nameEl) nameEl.textContent = `${playerDisplayName(gs, pid)}${pid === mid ? '\uff08\u6211\uff09' : ''}`;
    if (metaEl) metaEl.textContent = pid === mid ? formatSelfMetric(gs, pid) : '';
    if (scoreEl) scoreEl.textContent = `${seats[pid]?.score ?? ''}\u5206`;
  }
};

showManualSettlement = function showManualSettlementPatched(winner, scores) {
  if (!state) return;
  const winnerName = playerDisplayName(state, winner);
  const sr = scores.scoreResult;
  if (sr?.ruleset === 'pingyang_taipao') return showPingyangSettlement(winnerName, scores, sr);
  const type = scores.type || sr?.type || '';
  const mult = sr?.mult ?? 0;
  const caijinFen = sr?.caijinFen ?? 0;
  const base = sr?.base ?? 2;
  const dealerMultiplier = sr?.dealerMultiplier ?? 1;
  const hasDealerRate = (scores.payDetails || []).some(item => item.effectiveMult && item.effectiveMult !== mult);
  const others = (state.playerOrder || []).filter(pid => pid !== myId);

  let html = `<div class="result-card result-card-wide">
    ${settlementSelfCorner(state)}
    <h2>${winnerName} \u80e1\u724c\uff01</h2>
    <p class="score-line winner" style="font-size:1.1em">${type}</p>
    <p class="score-line" style="color:#888">\u500d\u6570${mult} \u00d7 \u5e95\u6570${base}${hasDealerRate ? `\uff0c\u5e84\u5bb6\u500d\u7387${dealerMultiplier}` : ''}${caijinFen > 0 ? `\uff0c\u8d22\u795e${caijinFen}\u5206` : ''}</p>
    <div class="manual-settlement">`;
  for (const pid of others) {
    html += `<label class="settlement-row">
      <span class="settlement-name" title="${playerDisplayName(state, pid)}"><em>${compactPlayerLabel(state, pid)}</em><b>\uff08${countSeatCaijin(state, pid)}\u8d22\uff09</b></span>
      <input class="settlement-input" data-pid="${pid}" type="number" inputmode="numeric" placeholder="\u9ed8\u8ba40" />
    </label>`;
  }
  html += `</div>
    <div class="btn-row">
      <button id="btn-next-round" class="btn btn-primary btn-next-round" onclick="newRound()">\u4e0b\u4e00\u5c40 (0/4)</button>
    </div>
  </div>`;
  showOverlay(html);
  bindSettlementInputs();
  updateNextRoundButton();
};

showPingyangSettlement = function showPingyangSettlementPatched(winnerName, scores, sr) {
  const others = (state.playerOrder || []).filter(pid => pid !== myId);
  const detailRows = (sr.taiDetails || []).map(item =>
    `<div class="score-line"><span>${item.label}</span><strong>${item.tai}\u53f0</strong></div>`
  ).join('');
  let html = `<div class="result-card result-card-wide">
    ${settlementSelfCorner(state)}
    <h2>${winnerName} \u80e1\u724c\uff01</h2>
    <p class="score-line winner" style="font-size:1.1em">${sr.type || '\u5e73\u9633\u53f0\u70ae'}</p>
    <p class="score-line" style="color:#888">\u603b\u53f0\u6570 ${sr.totalTai || 0} \u53f0${sr.qifan ? `\uff0c\u5df2\u8fbe ${sr.qifanTai || 13} \u53f0\u8d77\u7ffb` : `\uff0c\u672a\u8fbe ${sr.qifanTai || 13} \u53f0\u8d77\u7ffb`}${sr.double ? '\uff0c30\u53f0\u53cc\u7ffb' : ''}</p>
    <div class="manual-settlement settlement-detail-grid">${detailRows || '<div class="score-line">\u6682\u65e0\u53f0\u6570\u660e\u7ec6</div>'}</div>
    <div class="manual-settlement">`;
  for (const pid of others) {
    html += `<label class="settlement-row">
      <span class="settlement-name" title="${playerDisplayName(state, pid)}"><em>${compactPlayerLabel(state, pid)}</em><b>\uff08${countSeatTai(state, pid)}\u53f0\uff09</b></span>
      <input class="settlement-input" data-pid="${pid}" type="number" inputmode="numeric" placeholder="\u9ed8\u8ba40" />
    </label>`;
  }
  html += `</div>
    <div class="btn-row">
      <button id="btn-next-round" class="btn btn-primary btn-next-round" onclick="newRound()">\u4e0b\u4e00\u5c40 (0/4)</button>
    </div>
  </div>`;
  showOverlay(html);
  bindSettlementInputs();
  updateNextRoundButton();
};

// Stable overrides for flower/bai replacement interaction.
getMyFlowerTiles = function getMyFlowerTilesPatched() {
  return (state?.seats?.[myId]?.hand || []).filter(tile => FLOWER_CN[tile] || tile === 'bai');
};

doFlowerReplace = function doFlowerReplacePatched(flowers) {
  const replaceTiles = Array.isArray(flowers) && flowers.length ? flowers : getMyFlowerTiles();
  if (!replaceTiles.length) {
    showToast('没有可补的牌');
    return;
  }
  socket.emit('flower_replace', { tiles: replaceTiles });
  showToast(`补牌：${replaceTiles.map(tileLabel).join(' ')}`);
};

renderActionBar = function renderActionBarPatched() {
  const bar = document.getElementById('action-bar');
  bar.innerHTML = '';
  bar.classList.remove('hidden');

  if (!myTurn && !pendingAction) {
    bar.classList.add('hidden');
    return;
  }

  if (myTurn) {
    if (actionAllowed === 'flower_replace') {
      const flowers = flowerPromptTiles.length ? flowerPromptTiles : getMyFlowerTiles();
      const prompt = document.createElement('div');
      prompt.className = 'action-context';
      prompt.textContent = openingFlowerPhase ? `开局补牌：${flowers.map(tileLabel).join(' ')}` : `请补牌：${flowers.map(tileLabel).join(' ')}`;
      bar.appendChild(prompt);
      bar.appendChild(btn(`补牌 ${flowers.length} 张`, 'gang', () => doFlowerReplace(flowers)));
      return;
    }

    if (actionAllowed === 'discard_or_hu' || actionAllowed === 'discard_only') {
      if (selectedHandIndex != null) {
        bar.appendChild(btn('出牌', 'discard', () => doDiscard()));
      }
      if (actionAllowed === 'discard_or_hu') {
        addGangButtons(bar);
        if (canHuSelfNow) {
          const prompt = document.createElement('div');
          prompt.className = 'action-context';
          prompt.textContent = '当前可以胡牌';
          bar.appendChild(prompt);
          bar.appendChild(btn('胡', 'hu', () => doHuSelf()));
        }
      }
    }
  }

  if (pendingAction) {
    const { tile, acts } = pendingAction;
    const prompt = document.createElement('div');
    prompt.className = 'action-context';
    prompt.textContent = `有人打出 ${tileLabel(tile)}`;
    bar.appendChild(prompt);
    if (acts.includes('hu')) bar.appendChild(btn('胡', 'hu', () => respond('hu')));
    if (acts.includes('gang')) bar.appendChild(btn('杠', 'gang', () => respond('gang')));
    if (acts.includes('peng')) bar.appendChild(btn('碰', 'peng', () => respond('peng')));
    if (acts.includes('chi')) bar.appendChild(btn('吃', 'chi', () => promptChi()));
    bar.appendChild(btn('过', 'pass', () => respond('pass')));
  }

  if (bar.children.length === 0) bar.classList.add('hidden');
};

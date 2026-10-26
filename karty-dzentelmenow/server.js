'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { BLACK, WHITE } = require('./cards');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 6;
const MIN_PLAYERS = 3;
const HAND_SIZE = 5;
const GRACE_LOBBY = 20000;
const GRACE_GAME = 90000;
const TARGETS = [5, 7, 10];

const MAX_ROOMS = 200;
const MSG_LIMIT = 30; // wiadomości na sekundę z jednego połączenia
const rooms = new Map();

// ---------- helpers ----------
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
const uid = () => crypto.randomBytes(4).toString('hex');
const makeToken = () => crypto.randomBytes(16).toString('hex');
function makeCode() {
  const L = 'ABCDEFGHJKLMNPRSTUWXYZ';
  let c;
  do {
    c = '';
    for (let i = 0; i < 4; i++) c += L[crypto.randomInt(L.length)];
  } while (rooms.has(c));
  return c;
}
function cleanName(n) {
  return String(n || '').replace(/\s+/g, ' ').trim().slice(0, 16);
}
function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}
function judgeOf(room) {
  return room.players[room.judgeIdx];
}

// ---------- room / game logic ----------
function createRoom() {
  const room = {
    code: makeCode(),
    hostId: null,
    players: [],
    phase: 'lobby', // lobby | submitting | judging | result | ended
    target: 7,
    round: 0,
    judgeIdx: 0,
    black: null,
    submissions: [], // {playerId, name, card}
    winnerIdx: null,
    blackDeck: [],
    whiteDeck: [],
    whiteDiscard: [],
  };
  rooms.set(room.code, room);
  return room;
}

function drawWhite(room) {
  if (!room.whiteDeck.length) {
    room.whiteDeck = shuffle(room.whiteDiscard.splice(0));
  }
  return room.whiteDeck.pop();
}
function fillHands(room) {
  for (const p of room.players) {
    while (p.hand.length < HAND_SIZE) {
      const c = drawWhite(room);
      if (!c) break;
      p.hand.push(c);
    }
  }
}

function addPlayer(room, name, ws) {
  const p = {
    id: uid(),
    token: makeToken(),
    name,
    score: 0,
    hand: [],
    ws,
    connected: true,
    played: false,
    timer: null,
  };
  room.players.push(p);
  if (!room.hostId) room.hostId = p.id;
  if (room.phase !== 'lobby') fillHands(room);
  return p;
}

function startGame(room) {
  room.blackDeck = shuffle(BLACK.slice());
  room.whiteDeck = shuffle(WHITE.slice());
  room.whiteDiscard = [];
  room.round = 0;
  room.judgeIdx = crypto.randomInt(room.players.length);
  for (const p of room.players) {
    p.score = 0;
    p.hand = [];
  }
  startRound(room);
}

function startRound(room) {
  room.round++;
  room.phase = 'submitting';
  if (!room.blackDeck.length) room.blackDeck = shuffle(BLACK.slice());
  room.black = room.blackDeck.pop();
  room.submissions = [];
  room.winnerIdx = null;
  for (const p of room.players) p.played = false;
  fillHands(room);
  checkAllPlayed(room);
}

function checkAllPlayed(room) {
  if (room.phase !== 'submitting') return;
  const judge = judgeOf(room);
  const pending = room.players.filter(
    (q) => q.id !== judge.id && q.connected && !q.played
  );
  if (pending.length === 0 && room.submissions.length > 0) {
    room.phase = 'judging';
    room.submissions = shuffle(room.submissions);
  }
}

function backToLobby(room) {
  room.phase = 'lobby';
  room.round = 0;
  room.black = null;
  room.submissions = [];
  room.winnerIdx = null;
  for (const p of room.players) {
    p.score = 0;
    p.hand = [];
    p.played = false;
  }
}

function toast(room, message) {
  for (const p of room.players) if (p.connected) send(p.ws, { type: 'notice', message });
}

function removePlayer(room, id) {
  const idx = room.players.findIndex((p) => p.id === id);
  if (idx < 0) return;
  const p = room.players[idx];
  clearTimeout(p.timer);
  const inGame = room.phase !== 'lobby';
  const wasJudge = inGame && idx === room.judgeIdx;
  if (inGame) room.whiteDiscard.push(...p.hand);
  if (p.ws) {
    p.ws.ctx = null;
  }
  room.players.splice(idx, 1);

  if (!room.players.length) {
    rooms.delete(room.code);
    return;
  }
  if (idx < room.judgeIdx) room.judgeIdx--;
  if (room.judgeIdx >= room.players.length) room.judgeIdx = 0;
  if (room.hostId === id) {
    room.hostId = (room.players.find((q) => q.connected) || room.players[0]).id;
  }

  if (inGame) {
    if (room.players.length < MIN_PLAYERS) {
      backToLobby(room);
      toast(room, 'Za mało graczy — wracamy do poczekalni.');
    } else if (wasJudge && (room.phase === 'submitting' || room.phase === 'judging')) {
      for (const s of room.submissions) room.whiteDiscard.push(s.card);
      startRound(room);
      toast(room, 'Sędzia wyszedł — nowa runda z nowym sędzią.');
    } else if (room.phase === 'submitting') {
      checkAllPlayed(room);
    }
  }
  broadcast(room);
}

// ---------- views ----------
function viewFor(room, p) {
  const judge = room.phase === 'lobby' ? null : judgeOf(room);
  const v = {
    type: 'state',
    code: room.code,
    you: p.id,
    hostId: room.hostId,
    phase: room.phase,
    target: room.target,
    round: room.round,
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    judgeId: judge ? judge.id : null,
    players: room.players.map((q) => ({
      id: q.id,
      name: q.name,
      score: q.score,
      connected: q.connected,
      played: q.played,
    })),
    black: room.phase === 'lobby' ? null : room.black,
    hand: room.phase === 'lobby' ? [] : p.hand,
  };
  if (room.phase === 'judging') {
    v.submissions = room.submissions.map((s) => s.card);
  } else if (room.phase === 'result' || room.phase === 'ended') {
    v.submissions = room.submissions.map((s) => s.card);
    v.authors = room.submissions.map((s) => s.name);
    v.winnerIdx = room.winnerIdx;
  }
  return v;
}
function broadcast(room) {
  for (const p of room.players) if (p.connected) send(p.ws, viewFor(room, p));
}

// ---------- actions ----------
function play(room, p, m) {
  if (room.phase !== 'submitting') return;
  if (p.id === judgeOf(room).id || p.played) return;
  const i = Number(m.index);
  if (!Number.isInteger(i) || i < 0 || i >= p.hand.length) return;
  const card = p.hand.splice(i, 1)[0];
  room.submissions.push({ playerId: p.id, name: p.name, card });
  p.played = true;
  checkAllPlayed(room);
  broadcast(room);
}

function pick(room, p, m) {
  if (room.phase !== 'judging' || p.id !== judgeOf(room).id) return;
  const i = Number(m.index);
  if (!Number.isInteger(i) || i < 0 || i >= room.submissions.length) return;
  room.winnerIdx = i;
  const w = room.players.find((q) => q.id === room.submissions[i].playerId);
  if (w) w.score++;
  for (const s of room.submissions) room.whiteDiscard.push(s.card);
  room.phase = w && w.score >= room.target ? 'ended' : 'result';
  broadcast(room);
}

function next(room, p) {
  if (room.phase !== 'result') return;
  if (p.id !== judgeOf(room).id && p.id !== room.hostId) return;
  room.judgeIdx = (room.judgeIdx + 1) % room.players.length;
  startRound(room);
  broadcast(room);
}

function gameAction(ws, room, p, m) {
  switch (m.type) {
    case 'start': {
      if (p.id !== room.hostId || room.phase !== 'lobby') return;
      const connected = room.players.filter((q) => q.connected).length;
      if (connected < MIN_PLAYERS) return send(ws, { type: 'error', message: `Potrzeba co najmniej ${MIN_PLAYERS} graczy.` });
      room.target = TARGETS.includes(Number(m.target)) ? Number(m.target) : 7;
      startGame(room);
      broadcast(room);
      break;
    }
    case 'play':
      play(room, p, m);
      break;
    case 'pick':
      pick(room, p, m);
      break;
    case 'next':
      next(room, p);
      break;
    case 'restart':
      if (p.id !== room.hostId || room.phase !== 'ended') return;
      backToLobby(room);
      broadcast(room);
      break;
    case 'leave':
      ws.ctx = null;
      removePlayer(room, p.id);
      send(ws, { type: 'left' });
      break;
  }
}

// ---------- connection handling ----------
function handle(ws, m) {
  switch (m.type) {
    case 'create': {
      if (ws.ctx) return;
      const name = cleanName(m.name);
      if (!name) return send(ws, { type: 'error', message: 'Podaj imię.' });
      if (rooms.size >= MAX_ROOMS) return send(ws, { type: 'error', message: 'Serwer jest przepełniony, spróbuj później.' });
      const room = createRoom();
      const p = addPlayer(room, name, ws);
      ws.ctx = { room, player: p };
      send(ws, { type: 'joined', code: room.code, token: p.token });
      broadcast(room);
      break;
    }
    case 'join': {
      if (ws.ctx) return;
      const name = cleanName(m.name);
      if (!name) return send(ws, { type: 'error', message: 'Podaj imię.' });
      const room = rooms.get(String(m.code || '').toUpperCase().trim());
      if (!room) return send(ws, { type: 'error', message: 'Nie ma takiego pokoju.' });
      if (room.players.length >= MAX_PLAYERS) return send(ws, { type: 'error', message: 'Pokój jest pełny (max 6 osób).' });
      if (room.phase === 'ended') return send(ws, { type: 'error', message: 'Ta gra właśnie się skończyła.' });
      if (room.players.some((q) => q.name.toLowerCase() === name.toLowerCase())) {
        return send(ws, { type: 'error', message: 'Takie imię już jest w pokoju.' });
      }
      const p = addPlayer(room, name, ws);
      ws.ctx = { room, player: p };
      send(ws, { type: 'joined', code: room.code, token: p.token });
      broadcast(room);
      break;
    }
    case 'resume': {
      if (ws.ctx) return;
      const room = rooms.get(String(m.code || '').toUpperCase());
      const p = room && room.players.find((q) => q.token === m.token);
      if (!p) return send(ws, { type: 'error', message: 'Sesja wygasła.', fatal: true });
      clearTimeout(p.timer);
      if (p.ws && p.ws !== ws) {
        p.ws.ctx = null;
        try { p.ws.close(); } catch (e) { /* ignore */ }
      }
      p.ws = ws;
      p.connected = true;
      ws.ctx = { room, player: p };
      send(ws, { type: 'joined', code: room.code, token: p.token });
      broadcast(room);
      break;
    }
    default: {
      const ctx = ws.ctx;
      if (!ctx) return;
      gameAction(ws, ctx.room, ctx.player, m);
    }
  }
}

function onClose(ws) {
  const ctx = ws.ctx;
  if (!ctx) return;
  const { room, player } = ctx;
  if (player.ws !== ws) return;
  player.connected = false;
  player.ws = null;
  clearTimeout(player.timer);
  player.timer = setTimeout(
    () => removePlayer(room, player.id),
    room.phase === 'lobby' ? GRACE_LOBBY : GRACE_GAME
  );
  checkAllPlayed(room);
  broadcast(room);
}

// ---------- http + ws ----------
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/' || url === '/index.html') {
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) {
        res.writeHead(500);
        return res.end('Brak index.html');
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  } else if (url === '/health') {
    res.writeHead(200);
    res.end('ok');
  } else {
    res.writeHead(404);
    res.end('404');
  }
});

const wss = new WebSocketServer({ server, maxPayload: 4096 });
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.ctx = null;
  ws.on('pong', () => (ws.isAlive = true));
  ws.rate = { t: Date.now(), n: 0 };
  ws.on('message', (raw) => {
    const now = Date.now();
    if (now - ws.rate.t > 1000) ws.rate = { t: now, n: 0 };
    if (++ws.rate.n > MSG_LIMIT) return;
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.type !== 'string') return;
    try {
      handle(ws, m);
    } catch (e) {
      console.error(e);
      send(ws, { type: 'error', message: 'Błąd serwera.' });
    }
  });
  ws.on('close', () => onClose(ws));
  ws.on('error', () => {});
});

setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    try { ws.ping(); } catch (e) { /* ignore */ }
  });
}, 30000);

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => console.log(`Karty Dżentelmenów 18+ działa na porcie ${PORT}`));
}
module.exports = { server };

// Quiz Live — serveur MVP (une seule partie à la fois)
const express = require('express');
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// ---------- État de la partie (en mémoire, une seule room) ----------
let game = null;
/*
game = {
  pin: '123456',
  hostId: socketId,
  quiz: { title, questions: [{ text, answers: [a,b,c,d], correct: 0-3, duration: s }] },
  players: Map<socketId, { name, score, streak, answered, lastPoints, lastCorrect }>,
  phase: 'lobby' | 'question' | 'reveal' | 'podium',
  qIndex: -1,
  qStart: timestamp ms,
  qTimer: timeout handle,
  answersCount: [0,0,0,0]
}
*/

function makePin() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// ---------- Banque de quiz (fichier JSON) ----------
const DATA_DIR = path.join(__dirname, 'data');
const BANK_FILE = path.join(DATA_DIR, 'quizzes.json');
const BANK_MAX = 300;
let bank = [];
try { bank = JSON.parse(fs.readFileSync(BANK_FILE, 'utf8')); } catch { bank = []; }

function saveBank() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(BANK_FILE, JSON.stringify(bank));
  } catch (e) { console.error('Banque : échec de sauvegarde', e.message); }
}

function validateQuiz(quiz) {
  if (!quiz || !Array.isArray(quiz.questions) || quiz.questions.length === 0) {
    return 'Quiz vide ou invalide.';
  }
  for (const q of quiz.questions) {
    if (!q.text || !Array.isArray(q.answers) || q.answers.length !== 4 ||
        typeof q.correct !== 'number' || q.correct < 0 || q.correct > 3) {
      return 'Question mal formée (texte, 4 réponses, bonne réponse requis).';
    }
    q.duration = Math.min(120, Math.max(5, Number(q.duration) || 20));
  }
  return null;
}

function lanIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

function leaderboard(limit) {
  if (!game) return [];
  const arr = [...game.players.values()]
    .map(p => ({ name: p.name, score: p.score }))
    .sort((a, b) => b.score - a.score);
  return limit ? arr.slice(0, limit) : arr;
}

function playerRank(socketId) {
  const sorted = [...game.players.entries()].sort((a, b) => b[1].score - a[1].score);
  return sorted.findIndex(([id]) => id === socketId) + 1;
}

function publicQuestion() {
  const q = game.quiz.questions[game.qIndex];
  return {
    index: game.qIndex,
    total: game.quiz.questions.length,
    text: q.text,
    answers: q.answers,
    duration: q.duration
  };
}

function beginCountdown() {
  const nextIndex = game.qIndex + 1;
  if (nextIndex >= game.quiz.questions.length) return endGame();

  game.phase = 'countdown';
  // mémoriser le rang avant la question (pour les flèches de progression)
  const sorted = [...game.players.entries()].sort((a, b) => b[1].score - a[1].score);
  sorted.forEach(([, p], i) => { p.prevRank = i + 1; });

  const isFinal = nextIndex === game.quiz.questions.length - 1;
  io.to(game.pin).emit('get_ready', {
    index: nextIndex,
    total: game.quiz.questions.length,
    isFinal
  });
  clearTimeout(game.qTimer);
  game.qTimer = setTimeout(startQuestion, 3200);
}

function startQuestion() {
  game.qIndex++;
  if (game.qIndex >= game.quiz.questions.length) return endGame();

  game.phase = 'question';
  game.answersCount = [0, 0, 0, 0];
  game.fastest = null;
  for (const p of game.players.values()) {
    p.answered = false;
    p.lastPoints = 0;
    p.lastCorrect = false;
  }
  game.qStart = Date.now();
  const q = game.quiz.questions[game.qIndex];

  io.to(game.pin).emit('question_start', publicQuestion());

  clearTimeout(game.qTimer);
  game.qTimer = setTimeout(endQuestion, q.duration * 1000 + 300);
}

function endQuestion() {
  if (!game || game.phase !== 'question') return;
  clearTimeout(game.qTimer);
  game.phase = 'reveal';
  const q = game.quiz.questions[game.qIndex];

  // feedback individuel
  for (const [id, p] of game.players.entries()) {
    const rank = playerRank(id);
    io.to(id).emit('player_feedback', {
      correct: p.lastCorrect,
      points: p.lastPoints,
      score: p.score,
      rank,
      rankDelta: p.prevRank ? p.prevRank - rank : 0,
      streak: p.streak,
      totalPlayers: game.players.size,
      correctIndex: q.correct
    });
  }

  io.to(game.hostId).emit('question_end', {
    correctIndex: q.correct,
    answersCount: game.answersCount,
    leaderboard: leaderboard(5),
    fastest: game.fastest,
    isLast: game.qIndex === game.quiz.questions.length - 1
  });
}

function endGame() {
  game.phase = 'podium';
  const board = leaderboard();
  io.to(game.pin).emit('game_over', { podium: board.slice(0, 3), leaderboard: board });
  // feedback rang final individuel
  for (const [id] of game.players.entries()) {
    io.to(id).emit('final_rank', { rank: playerRank(id), totalPlayers: game.players.size });
  }
}

// ---------- Socket.io ----------
io.on('connection', (socket) => {

  // --- Hôte ---
  socket.on('host_create', (quiz, cb) => {
    const err = validateQuiz(quiz);
    if (err) return cb({ error: err });
    // une seule room : la nouvelle partie remplace l'ancienne
    if (game) {
      io.to(game.pin).emit('game_closed');
      clearTimeout(game.qTimer);
    }
    game = {
      pin: makePin(),
      hostId: socket.id,
      quiz,
      players: new Map(),
      phase: 'lobby',
      qIndex: -1,
      qStart: 0,
      qTimer: null,
      answersCount: [0, 0, 0, 0],
      fastest: null
    };
    socket.join(game.pin);
    cb({ pin: game.pin, ip: lanIP(), port: PORT });
  });

  socket.on('host_start', () => {
    if (!game || socket.id !== game.hostId || game.phase !== 'lobby') return;
    if (game.players.size === 0) {
      return socket.emit('host_error', 'Aucun joueur connecté.');
    }
    beginCountdown();
  });

  socket.on('host_next', () => {
    if (!game || socket.id !== game.hostId || game.phase !== 'reveal') return;
    beginCountdown();
  });

  socket.on('host_skip', () => {
    if (!game || socket.id !== game.hostId || game.phase !== 'question') return;
    endQuestion();
  });

  // --- Banque de quiz ---
  socket.on('bank_list', (ownerId, cb) => {
    const list = bank
      .filter(e => !e.isPrivate || e.ownerId === ownerId)
      .map(e => ({
        id: e.id,
        title: e.title || 'Sans titre',
        count: e.questions.length,
        isPrivate: !!e.isPrivate,
        mine: e.ownerId === ownerId,
        createdAt: e.createdAt
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
    cb(list);
  });

  socket.on('bank_save', ({ quiz, isPrivate, ownerId }, cb) => {
    const err = validateQuiz(quiz);
    if (err) return cb({ error: err });
    if (!ownerId) return cb({ error: 'Identifiant appareil manquant.' });
    if (bank.length >= BANK_MAX) return cb({ error: 'Banque pleine.' });
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      title: String(quiz.title || '').slice(0, 80),
      questions: quiz.questions,
      isPrivate: !!isPrivate,
      ownerId,
      createdAt: Date.now()
    };
    bank.push(entry);
    saveBank();
    cb({ ok: true, id: entry.id });
  });

  socket.on('bank_get', ({ id, ownerId }, cb) => {
    const e = bank.find(x => x.id === id);
    if (!e || (e.isPrivate && e.ownerId !== ownerId)) return cb({ error: 'Quiz introuvable.' });
    cb({ title: e.title, questions: e.questions });
  });

  socket.on('bank_delete', ({ id, ownerId }, cb) => {
    const i = bank.findIndex(x => x.id === id);
    if (i === -1 || bank[i].ownerId !== ownerId) return cb({ error: 'Suppression non autorisée.' });
    bank.splice(i, 1);
    saveBank();
    cb({ ok: true });
  });

  // --- Joueur ---
  const AVATARS = ['🦊','🐼','🐸','🦁','🐙','🦄','🐧','🐝','🐺','🐨','🦉','🦎'];

  socket.on('player_join', ({ pin, name, avatar }, cb) => {
    if (!game || game.pin !== String(pin).trim()) {
      return cb({ error: 'PIN invalide ou aucune partie en cours.' });
    }
    if (game.phase !== 'lobby') {
      return cb({ error: 'La partie a déjà commencé.' });
    }
    name = String(name || '').trim().slice(0, 20);
    if (!name) return cb({ error: 'Pseudo requis.' });
    const taken = [...game.players.values()].some(p => p.name.toLowerCase() === name.toLowerCase());
    if (taken) return cb({ error: 'Pseudo déjà pris.' });
    if (!AVATARS.includes(avatar)) avatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];

    game.players.set(socket.id, { name, avatar, score: 0, streak: 0, answered: false, lastPoints: 0, lastCorrect: false, prevRank: 0, lastReact: 0, lastMsg: 0 });
    socket.join(game.pin);
    cb({ ok: true, name, avatar, quizTitle: game.quiz.title || 'Quiz' });
    io.to(game.hostId).emit('lobby_update', [...game.players.values()].map(p => ({ name: p.name, avatar: p.avatar })));
  });

  // Réactions emoji (lobby, révélation, podium)
  const REACTIONS = ['🔥','😂','❤️','👏','🍸','🎉','😱','💪'];
  socket.on('lobby_react', emoji => {
    if (!game || !['lobby', 'reveal', 'podium'].includes(game.phase)) return;
    const p = game.players.get(socket.id);
    if (!p) return;
    const now = Date.now();
    if (now - p.lastReact < 400) return; // anti-spam
    if (!REACTIONS.includes(emoji)) return;
    p.lastReact = now;
    io.to(game.pin).emit('react', { emoji, name: p.name, avatar: p.avatar });
  });

  // Petits messages (lobby uniquement)
  socket.on('lobby_msg', text => {
    if (!game || game.phase !== 'lobby') return;
    const p = game.players.get(socket.id);
    if (!p) return;
    const now = Date.now();
    if (now - p.lastMsg < 2500) return; // anti-spam
    text = String(text || '').trim().slice(0, 60);
    if (!text) return;
    p.lastMsg = now;
    io.to(game.pin).emit('chat', { text, name: p.name, avatar: p.avatar });
  });

  socket.on('player_answer', (answerIndex) => {
    if (!game || game.phase !== 'question') return;
    const p = game.players.get(socket.id);
    if (!p || p.answered) return;
    answerIndex = Number(answerIndex);
    if (!(answerIndex >= 0 && answerIndex <= 3)) return;

    p.answered = true;
    game.answersCount[answerIndex]++;

    const q = game.quiz.questions[game.qIndex];
    const elapsed = (Date.now() - game.qStart) / 1000;
    const t = Math.min(elapsed, q.duration);

    if (answerIndex === q.correct) {
      // formule Kahoot : points dégressifs selon le temps de réponse
      const base = Math.round(1000 * (1 - (t / q.duration) / 2));
      p.streak++;
      // bonus de série : +100 par bonne réponse consécutive au-delà de la 1re (plafonné à +500)
      const streakBonus = 100 * Math.min(Math.max(p.streak - 1, 0), 5);
      let points = base + streakBonus;
      // dernière question : points doublés
      if (game.qIndex === game.quiz.questions.length - 1) points *= 2;
      p.score += points;
      p.lastPoints = points;
      p.lastCorrect = true;
      if (!game.fastest) game.fastest = { name: p.name, avatar: p.avatar, time: Math.round(t * 10) / 10 };
    } else {
      p.lastCorrect = false;
      p.streak = 0;
    }

    io.to(game.hostId).emit('answer_progress', {
      answered: [...game.players.values()].filter(x => x.answered).length,
      total: game.players.size
    });

    // tout le monde a répondu → fin anticipée
    if ([...game.players.values()].every(x => x.answered)) endQuestion();
  });

  // --- Déconnexions ---
  socket.on('disconnect', () => {
    if (!game) return;
    if (socket.id === game.hostId) {
      // l'hôte part : on ferme la partie
      clearTimeout(game.qTimer);
      io.to(game.pin).emit('game_closed');
      game = null;
      return;
    }
    if (game.players.has(socket.id)) {
      game.players.delete(socket.id);
      if (game.phase === 'lobby') {
        io.to(game.hostId).emit('lobby_update', [...game.players.values()].map(p => ({ name: p.name, avatar: p.avatar })));
      } else if (game.phase === 'question' && game.players.size > 0 &&
                 [...game.players.values()].every(x => x.answered)) {
        endQuestion();
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n  Quiz Live lancé.`);
  console.log(`  Hôte    : http://localhost:${PORT}/host.html`);
  console.log(`  Joueurs : http://${lanIP()}:${PORT}  (même wifi)\n`);
});

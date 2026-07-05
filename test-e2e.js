// Test e2e v3 : hôte + 3 joueurs, réactions lobby, countdown, séries, points doublés
const { io } = require('socket.io-client');
const URL = 'http://localhost:3000';

const quiz = {
  title: 'Test v3',
  questions: [
    { text: 'Q1 ?', answers: ['A', 'B', 'C', 'D'], correct: 1, duration: 5 },
    { text: 'Q2 ?', answers: ['A', 'B', 'C', 'D'], correct: 3, duration: 5 }
  ]
};

const host = io(URL);
const players = ['Max', 'Etienne', 'Nico'].map(name => ({ name, sock: io(URL), feedbacks: [], reacts: 0, chats: 0 }));
let pin = null, readyCount = 0;
const log = (...a) => console.log(...a);

host.on('connect', () => {
  host.emit('host_create', quiz, res => {
    if (res.error) { console.error('FAIL create:', res.error); process.exit(1); }
    pin = res.pin;
    log('PIN:', pin);
    players.forEach((p, idx) => {
      p.sock.emit('player_join', { pin, name: p.name, avatar: '🦊' }, r => {
        if (r.error) { console.error('FAIL join:', r.error); process.exit(1); }
        log('join OK:', r.avatar, r.name);
        if (idx === players.length - 1) setTimeout(testLobbyFun, 300);
      });
    });
  });
});

function testLobbyFun() {
  // réactions + message + test anti-spam (2 réactions rapprochées → 1 seule doit passer)
  players[0].sock.emit('lobby_react', '🔥');
  players[0].sock.emit('lobby_react', '🎉'); // < 400ms → bloquée
  players[1].sock.emit('lobby_msg', 'Salut la team !');
  players[2].sock.emit('lobby_react', '🍸');
  setTimeout(() => {
    const totalReacts = players.reduce((s, p) => s + p.reacts, 0);
    const totalChats = players.reduce((s, p) => s + p.chats, 0);
    log('réactions reçues par joueur:', players[0].reacts, '| attendu 2 (anti-spam OK)');
    log('messages reçus par joueur:', players[0].chats, '| attendu 1');
    if (players[0].reacts !== 2 || players[0].chats !== 1) { console.error('LOBBY_FAIL'); process.exit(1); }
    log('LOBBY_PASS');
    host.emit('host_start');
  }, 600);
}

host.on('get_ready', g => log(`get_ready Q${g.index + 1}/${g.total}${g.isFinal ? ' [FINALE x2]' : ''}`));
host.on('question_end', d => {
  log('fin — correct:', d.correctIndex, '| plus rapide:', d.fastest ? `${d.fastest.name} ${d.fastest.time}s` : 'aucun',
      '| top:', d.leaderboard.map(p => `${p.name}:${p.score}`).join(' '));
  setTimeout(() => host.emit('host_next'), 300);
});

host.on('game_over', d => {
  log('PODIUM:', d.podium.map((p, i) => `#${i + 1} ${p.name} ${p.score}pts`).join(' | '));
  const fb = players[0].feedbacks;
  // Max : Q1 correct (streak 1, pas de bonus), Q2 correct (streak 2, +100, x2 car finale)
  const q2 = fb[1];
  const streakOK = q2.streak === 2;
  const doubledOK = q2.points > 1000; // base ~970 +100 bonus, x2 ≈ 2140
  const fbCount = players.reduce((s, p) => s + p.feedbacks.length, 0);
  log(`Max Q2: +${q2.points} pts, streak ${q2.streak}, delta ${q2.rankDelta} | doublé: ${doubledOK} | série: ${streakOK}`);
  log('feedbacks:', fbCount, '/6');
  const ok = fbCount === 6 && streakOK && doubledOK;
  console.log(ok ? 'E2E_PASS' : 'E2E_FAIL');
  process.exit(ok ? 0 : 1);
});

players.forEach((p, idx) => {
  p.sock.on('react', () => p.reacts++);
  p.sock.on('chat', () => p.chats++);
  p.sock.on('question_start', q => {
    const delay = idx === 0 ? 300 : idx === 1 ? 2500 : 1000;
    const correct = quiz.questions[q.index].correct;
    const ans = idx === 2 ? (correct === 0 ? 2 : 0) : correct;
    setTimeout(() => p.sock.emit('player_answer', ans), delay);
  });
  p.sock.on('player_feedback', fb => {
    p.feedbacks.push(fb);
    log(`  ${p.name}: ${fb.correct ? '✓' : '✗'} +${fb.points} → ${fb.score} pts (rang ${fb.rank}, Δ${fb.rankDelta}, 🔥${fb.streak})`);
  });
});

setTimeout(() => { console.error('E2E_TIMEOUT'); process.exit(1); }, 40000);

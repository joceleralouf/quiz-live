// Test e2e : 1 hôte + 3 joueurs, partie complète de 2 questions
const { io } = require('socket.io-client');
const URL = 'http://localhost:3000';

const quiz = {
  title: 'Test',
  questions: [
    { text: 'Q1 ?', answers: ['A', 'B', 'C', 'D'], correct: 1, duration: 5 },
    { text: 'Q2 ?', answers: ['A', 'B', 'C', 'D'], correct: 3, duration: 5 }
  ]
};

const host = io(URL);
const players = ['Max', 'Etienne', 'Nico'].map(name => ({ name, sock: io(URL), feedbacks: [] }));
let pin = null;
const log = (...a) => console.log(...a);

host.on('connect', () => {
  host.emit('host_create', quiz, res => {
    if (res.error) { console.error('FAIL create:', res.error); process.exit(1); }
    pin = res.pin;
    log('PIN:', pin, '| IP:', res.ip);
    players.forEach((p, idx) => {
      p.sock.emit('player_join', { pin, name: p.name }, r => {
        if (r.error) { console.error('FAIL join:', r.error); process.exit(1); }
        log('join OK:', p.name);
        if (idx === players.length - 1) setTimeout(() => host.emit('host_start'), 300);
      });
    });
  });
});

host.on('lobby_update', names => log('lobby:', names.join(', ')));
host.on('answer_progress', p => log('progress:', p.answered + '/' + p.total));

host.on('question_end', d => {
  log('question_end — correct:', d.correctIndex, '| répartition:', d.answersCount,
      '| top:', d.leaderboard.map(p => `${p.name}:${p.score}`).join(' '));
  setTimeout(() => host.emit('host_next'), 300); // dernier next → podium
});

host.on('game_over', d => {
  log('PODIUM:', d.podium.map((p, i) => `#${i + 1} ${p.name} ${p.score}pts`).join(' | '));
  const feedbackCount = players.reduce((s, p) => s + p.feedbacks.length, 0);
  log('feedbacks reçus:', feedbackCount, '(attendu 6)');
  const sorted = d.leaderboard;
  const ok = feedbackCount === 6 && sorted[0].score >= sorted[1].score;
  console.log(ok ? 'E2E_PASS' : 'E2E_FAIL');
  process.exit(ok ? 0 : 1);
});

players.forEach((p, idx) => {
  p.sock.on('question_start', q => {
    // Max répond vite et juste, Etienne lentement et juste, Nico faux
    const delay = idx === 0 ? 300 : idx === 1 ? 2500 : 1000;
    const answer = idx === 2 ? (q.answers.length - 1 - 0) % 4 === 0 ? 0 : 0 : quiz.questions[q.index].correct;
    setTimeout(() => p.sock.emit('player_answer', idx === 2 ? 0 === quiz.questions[q.index].correct ? 2 : 0 : answer), delay);
  });
  p.sock.on('player_feedback', fb => {
    p.feedbacks.push(fb);
    log(`  ${p.name}: ${fb.correct ? '✓' : '✗'} +${fb.points} → ${fb.score} pts (rang ${fb.rank}/${fb.totalPlayers})`);
  });
  p.sock.on('final_rank', fr => log(`  ${p.name} rang final: ${fr.rank}`));
});

setTimeout(() => { console.error('E2E_TIMEOUT'); process.exit(1); }, 30000);

// Test banque : save public + privé, list depuis 2 appareils, get, delete
const { io } = require('socket.io-client');
const URL = 'http://localhost:3000';
const quiz = { title: 'Banque test', questions: [{ text: 'Q?', answers: ['A','B','C','D'], correct: 0, duration: 10 }] };

const a = io(URL), b = io(URL);
let done = 0;
function step() {
  a.emit('bank_save', { quiz, isPrivate: false, ownerId: 'device-A' }, r1 => {
    console.log('save public:', r1.ok ? 'OK' : r1.error);
    a.emit('bank_save', { quiz: { ...quiz, title: 'Secret A' }, isPrivate: true, ownerId: 'device-A' }, r2 => {
      console.log('save privé:', r2.ok ? 'OK' : r2.error);
      a.emit('bank_list', 'device-A', listA => {
        console.log('liste device-A:', listA.map(e => e.title + (e.isPrivate ? ' [privé]' : '')).join(', '));
        b.emit('bank_list', 'device-B', listB => {
          console.log('liste device-B:', listB.map(e => e.title + (e.isPrivate ? ' [privé]' : '')).join(', '));
          const privateHidden = !listB.some(e => e.title === 'Secret A');
          b.emit('bank_get', { id: r2.id, ownerId: 'device-B' }, g => {
            const getBlocked = !!g.error;
            b.emit('bank_delete', { id: r1.id, ownerId: 'device-B' }, d => {
              const delBlocked = !!d.error;
              a.emit('bank_delete', { id: r1.id, ownerId: 'device-A' }, d2 => {
                a.emit('bank_delete', { id: r2.id, ownerId: 'device-A' }, d3 => {
                  console.log('privé caché aux autres:', privateHidden, '| get privé bloqué:', getBlocked, '| delete non-proprio bloqué:', delBlocked, '| delete proprio:', d2.ok && d3.ok);
                  console.log(privateHidden && getBlocked && delBlocked && d2.ok && d3.ok ? 'BANK_PASS' : 'BANK_FAIL');
                  process.exit(privateHidden && getBlocked && delBlocked && d2.ok && d3.ok ? 0 : 1);
                });
              });
            });
          });
        });
      });
    });
  });
}
a.on('connect', () => { done++; if (done === 2) step(); });
b.on('connect', () => { done++; if (done === 2) step(); });
setTimeout(() => { console.error('BANK_TIMEOUT'); process.exit(1); }, 15000);

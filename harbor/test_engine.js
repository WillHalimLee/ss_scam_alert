// node harbor/test_engine.js  -> prints how the engine does on all 118 synthetic members
const vm = require('vm'), fs = require('fs'), path = require('path');
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8'), ctx);
const data = ctx.window.HARBOR_DATA;
const { scoreAll } = require('./engine.js');
const rows = scoreAll(data);
const scams = rows.filter((r) => r.isScam), legit = rows.filter((r) => !r.isScam);
console.log('Scam/ATO members caught (hold before a scam payment):', scams.filter((r) => r.caught).length, '/', scams.length);
const by = {};
for (const r of scams) { by[r.scenario] ??= [0, 0]; by[r.scenario][1]++; if (r.caught) by[r.scenario][0]++; }
console.log(by);
console.log('Legit members held:', legit.filter((r) => r.hold).length, '/', legit.length, '(look-alikes held:', legit.filter((r) => r.lookalike && r.hold).length + '/20)');
console.log('Legit members light-confirm only:', legit.filter((r) => r.confirm).length);
console.log('Missed:', scams.filter((r) => !r.caught).map((r) => r.id + ' ' + r.subtype).join('\n        '));
console.log('Held legit:', legit.filter((r) => r.hold).map((r) => r.id + ' ' + (r.subtype || 'routine') + ' [' + r.holds.map((h) => h.rules.map((x) => x.id)).join('|') + ']').join('\n           '));
const m = (id) => rows.find((r) => r.id === id);
for (const id of ['M1001', 'M1002', 'M1003', 'M1004', 'M1039', 'M1057']) {
  const r = m(id); console.log(id, 'hold:', r.holds.map((h) => h.rules.map((x) => x.id).join('+') + ' $' + Math.round(h.amt)).join(', '), '| confirm:', r.confirms.length, '| prevented $' + r.prevented, 'sentBeforeFlag $' + r.sentBeforeFlag);
}
console.log('Total scam $ intercepted by trigger timing:', Math.round(scams.reduce((a, r) => a + r.prevented, 0)), 'sent before first flag:', Math.round(scams.reduce((a, r) => a + r.sentBeforeFlag, 0)));

// node harbor/test_ui.js [--live] [--only sarah,linda]   (task test:ui)
// Loads the real app.js in a stand-in browser (no DOM library needed), renders every tab and plays every story to its end.
// Offline (default): no server, so the app uses the browser engine and the guided script: fast and deterministic.
// --live: the same flows against the running gateway (task run) with the real models: Live AI chat, the pipeline, feedback, FTC.
// Fails (exit 1) on any exception or broken expectation, so a blank page can never pass unnoticed.
const fs = require('fs'), vm = require('vm'), path = require('path');
const LIVE = process.argv.includes('--live'), BASE = process.env.HARBOR_URL || 'http://localhost:8787';
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), strip = (h) => String(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
let fails = 0; const check = (ok, what) => { if (!ok) { fails++; console.log('      ✗ ' + what); } return ok; };

/** A stand-in element: accepts any property, method or child lookup the app uses. */
const el = () => new Proxy({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, dataset: {}, hidden: false, value: '', files: [] }, {
  get: (t, k) => (k in t ? t[k] : typeof k !== 'string' ? undefined : k === 'querySelectorAll' ? () => [] : k === 'querySelector' || k === 'closest' ? () => null
    : /^(set|remove|focus|blur|select|scroll|add|append|click|getAttribute|requestSubmit|getContext|toDataURL)/.test(k) ? () => null : undefined),
  set: (t, k, v) => ((t[k] = v), true) });
function boot() {
  const errors = [], ctx = { console: { log() {}, error: (...a) => errors.push(a.join(' ')), warn() {} }, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
    Promise, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Set, Map, URL, URLSearchParams, AbortController,
    location: { protocol: LIVE ? 'file:' : 'http:' }, navigator: { language: 'en-US' }, localStorage: { getItem: () => null, setItem() {} },
    fetch: LIVE ? (u, o) => fetch(u.startsWith('http') ? u : BASE + u, o) : () => Promise.reject(new Error('offline')) };
  ctx.window = ctx; ctx.self = ctx; ctx.top = ctx; ctx.matchMedia = () => ({ matches: true });           // reduced motion: Harbor's messages arrive at once
  ctx.document = { querySelector: () => el(), querySelectorAll: () => [], getElementById: () => el(), createElement: () => el(), addEventListener() {}, body: el(), documentElement: el(), activeElement: null };
  vm.createContext(ctx);
  for (const f of ['data.js', 'engine.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx);
  const src = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  const hook = 'window.__t = { S, R, scen, render, memberHTML, consoleHTML, simHTML, archHTML, pipeHTML, notesHTML, startChat, choose, sendLive, sendPayment, beginStory, finish, syncCase, node, scenarioDecision, takeOver, employeeSay, memberMfa, startMemberFtc, memberFtcChoose, memberFtcAnswer, ftcHTML, joinReason, checkLive };\n})();';
  if (!/\}\)\(\);\s*$/.test(src)) throw new Error('app.js no longer ends with its IIFE: update test_ui.js');
  vm.runInContext(src.replace(/\}\)\(\);\s*$/, hook), ctx);
  return { T: ctx.__t, errors };
}
const until = async (f, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (f()) return true; await sleep(150); } return false; };
const SAY = { sarah: "No, that wasn't me. I got a text from Sound asking me to log in.", linda: "It's for my grandson. His lawyer called and said not to tell anyone.", michael: 'An investment my partner set up. We met on a dating app.',
  james: 'A federal agent called and said I have to take out cash.', closing: 'My house closing. I called the title company on the number from my paperwork.', grand: 'Paying my roofing contractor. I have a signed contract.', mover: 'Paying my new landlord.' };

async function story(T, id) {
  const S = T.S, sc = T.scen(id), dec = T.scenarioDecision(sc);
  S.sc = id; S.tab = 'member'; const rec = T.R();
  if (LIVE) { T.beginStory(rec); check(await until(() => rec.be.phase === 'ready', 30000), 'history streamed into the pipeline'); await T.sendPayment(); }
  else { rec.phone = { step: dec.level === 'none' ? 'sent' : dec.level === 'hold' ? 'paused' : 'chat' }; if (rec.phone.step === 'chat') T.startChat(rec); }
  T.render(); const p = rec.phone.step;
  check(p === (dec.level === 'none' ? 'sent' : dec.level === 'hold' ? 'paused' : 'chat'), `phone shows the ${dec.level} result (got ${p})`);
  if (p === 'sent') { check(/Payment sent/.test(T.memberHTML()), 'pass-through says Payment sent'); return 'payment went through, no chat'; }
  if (p === 'paused') { rec.phone = { step: 'lock' }; T.render(); check(/Open Sound app/.test(T.memberHTML()), 'lock screen with the notification');
    if (LIVE) await until(() => !/Harbor is writing/.test(T.memberHTML()), 20000); rec.phone = { step: 'chat' }; T.startChat(rec); }
  const ch = rec.chat; await until(() => !ch.queue.length && !ch.typing, 8000);
  check(ch.msgs.some((m) => m.f === 'bot'), 'Harbor opened the chat');
  const S0 = strip(T.memberHTML()); check(!/undefined|NaN|\[object/.test(S0), 'no undefined, NaN or [object] on screen');
  if (ch.live) {
    await T.sendLive(SAY[id]); check(ch.live.hist.length >= 2, 'Live AI replied');
    const why = T.joinReason(ch); if (why) check(!!ch.joinReq, 'join request raised when code says a person should step in');
  } else {
    let n = 0; while (!ch.outcome && n++ < 8) { const node = T.node(ch.cur, ch.c); if (!node || !node.choices.length) break; T.choose(0); await until(() => !ch.queue.length, 4000); }
    check(!!ch.outcome, 'guided script reaches an outcome by always taking the first option');
  }
  T.syncCase(); S.tab = 'console'; S.sel = sc.mid; T.render();
  const C = strip(T.consoleHTML()); check(/What happened/.test(C) || /No case/.test(C), 'console shows the case or why there is none');
  if (ch.live && !ch.outcome) { T.takeOver(true); T.employeeSay('Hi, this is Dana at Sound.'); check(ch.msgs.some((m) => m.f === 'emp'), 'employee message reaches the member'); T.takeOver(false); T.finish('human'); }
  if (!ch.outcome) T.finish('human');
  S.tab = 'member'; T.render(); check(/2-step sign-in/.test(T.memberHTML()), 'MFA tip shows when the chat ends');
  T.memberMfa(ch, 'passkey'); T.render(); check(/How helpful was Harbor/.test(T.memberHTML()), 'feedback card after the MFA tip');
  const k = S.cases[sc.mid];
  if (k && dec.level === 'hold') {                                                 // a confirmed scam: the member's FTC follow-up
    k.vfb = { score: 1, sent: true, loss: 0 }; T.startMemberFtc(k); await until(() => !ch.queue.length, 6000);
    check(/Help me report it/.test(T.memberHTML()), 'FTC follow-up offers help / self / not now');
    T.memberFtcChoose(ch, LIVE ? 'assisted' : 'later'); await until(() => ch.ftc.step === 'done' || ch.ftc.step === 'ask', LIVE ? 20000 : 3000);
    if (LIVE) { let q = 0; while (ch.ftc.step === 'ask' && q++ < 8) { T.memberFtcAnswer(ch, ch.ftc.qs[ch.ftc.i].chips[0]); await until(() => ch.ftc.step !== 'ask' || !ch.queue.length, 30000); }
      check(await until(() => ch.ftc.step === 'done', 60000) && !!ch.ftc.draft, 'the agent drafted the FTC report'); }
    S.tab = 'console'; T.render(); check(/Report to the FTC/.test(T.consoleHTML()), 'console FTC card');
  }
  return ch.outcome + (ch.live ? ' (Live AI)' : ' (guided)');
}

(async () => {
  console.log(`UI test: real app.js in a stand-in browser, ${LIVE ? 'live against ' + BASE : 'offline (browser engine + guided script)'}\n`);
  const { T, errors } = boot();
  if (LIVE) { await T.checkLive(); check(T.S.live.backend, 'gateway reachable');
    await until(() => (T.S.rec[T.S.sc] || {}).be && T.S.rec[T.S.sc].be.phase !== 'loading', 30000); }   // the app starts its current story on load: let that finish first
  for (const [tab, f] of [['member', 'memberHTML'], ['console', 'consoleHTML'], ['sim', 'simHTML'], ['arch', 'archHTML'], ['pipe', 'pipeHTML'], ['notes', 'notesHTML']]) {
    try { T.S.tab = tab; T.render(); const h = T[f](); check(h.length > 200, `${tab} tab renders`); } catch (e) { check(false, `${tab} tab throws: ${e.message}`); }
  }
  console.log(`tabs           ${fails ? 'FAIL' : 'ok'}`);
  for (const id of ['sarah', 'linda', 'michael', 'james', 'mover', 'closing', 'grand'].filter((x) => !only || only.includes(x))) {
    const before = fails;
    try { const r = await story(T, id); console.log(`${(fails > before ? 'FAIL' : 'ok').padEnd(5)}${id.padEnd(10)}${r}`); }
    catch (e) { fails++; console.log(`FAIL ${id.padEnd(10)}threw: ${e.stack.split('\n').slice(0, 3).join(' | ')}`); }
  }
  if (!LIVE && !only) {                                                          // staff work done during a chat must survive its end
    const before = fails, S = T.S; S.tab = 'console'; S.sc = 'james'; const rec = T.R(); rec.phone = { step: 'paused' }; T.render(); rec.phone = { step: 'chat' }; T.startChat(rec); await until(() => !rec.chat.queue.length, 4000);
    T.syncCase(); S.sel = 'M1004'; const k = S.cases.M1004; T.takeOver(true); T.employeeSay('Hi James, this is Dana at Sound.'); (k.acts ||= []).push('Called member');
    k.efb = { score: 4, sent: true }; k.vfb = { score: 1, sent: true, loss: 0 }; T.startMemberFtc(k);
    check(!rec.chat.ftc && !!rec.chat.ftcPending, 'a verdict saved mid-chat waits for the chat to end');
    T.takeOver(false); T.finish('human'); await sleep(50); const k2 = S.cases.M1004;
    check(!!(k2.vfb && k2.efb && (k2.acts || []).includes('Called member')), 'verdict, rating and actions survive the end of the chat');
    check(k2.msgs.some((m) => m.f === 'emp'), "the employee's messages stay in the ended conversation");
    check(!!rec.chat.ftc, 'the FTC follow-up starts once the chat ends');
    console.log(`${(fails > before ? 'FAIL' : 'ok').padEnd(5)}staff work survives the end of the chat`);
  }
  if (errors.length) { fails++; console.log('\nconsole.error during the run:\n  ' + errors.slice(0, 5).join('\n  ')); }
  console.log(fails ? `\n${fails} problem(s)` : '\nall good'); process.exit(fails ? 1 : 0);
})();

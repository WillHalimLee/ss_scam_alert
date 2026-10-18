// End-to-end smoke test of the running stack (task run), driven through the same API calls the app makes.
// Every demo story: stream history -> send the payment -> decision, case and first message -> a member reply -> console,
// takeover (agent must stop replying), employee message, hand back, employee action. Exits 1 if anything is off.
//   node scripts/smoke.js [M1003,M1001]      (resets each story's rows, like pressing Reset in the app)
const B = process.env.HARBOR_URL || 'http://localhost:' + (process.env.AGENT_PORT || 8787);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = async (u, b) => { const r = await fetch(B + u, b === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return { status: r.status, j: await r.json().catch(() => null) }; };
const PLANNED = [{ rail: 'Wire', amount: 51587, label: 'Home closing wire, declared Oct 12' }];
const STORIES = [   // [member, expected level, what the member says, planned payment]
  ['M1003', 'hold', "No, that wasn't me. I got a text from Sound yesterday asking me to log in."],
  ['M1001', 'hold', "It's for my grandson. His lawyer called and said he needs bail money today."],
  ['M1002', 'hold', "It's an investment my partner set up. We met on a dating app and haven't met in person yet."],
  ['M1004', 'hold', 'A federal agent called and said I have to take out cash to protect my identity.'],
  ['M1039', 'none'],
  ['M1057', 'hold', 'This is my house closing. I called the title company on the number from my paperwork.'],
  ['M1057', 'confirm', 'Yes, I confirmed with the title company.', PLANNED],
  ['M1049', 'confirm', 'Paying my roofing contractor. I have a signed contract.'],
];

async function story([mid, want, text, planned]) {
  const bad = [], t0 = Date.now(), st = await call('/api/demo/start', { member: mid, planned });
  if (st.status !== 200) return ['start ' + st.status];
  let v; for (let i = 0; i < 150; i++) { v = (await call('/api/demo/state?member=' + mid)).j; if (v.processed >= st.j.historyTotal) break; await sleep(400); }
  if (v.processed < st.j.historyTotal) bad.push(`history ${v.processed}/${st.j.historyTotal}`);
  await call('/api/demo/send', { member: mid, event: st.j.triggerEventId });
  for (let i = 0; i < 80; i++) { await sleep(350); v = (await call(`/api/demo/state?member=${mid}&event=${st.j.triggerEventId}`)).j; const l = v.decision && v.decision.level; if (l === 'none' || (l && v.messages.some((m) => m.direction === 'out'))) break; }
  const level = v.decision && v.decision.level, first = (v.messages.find((m) => m.direction === 'out') || {}).body || '';
  if (level !== want) bad.push(`decision ${level}, expected ${want}`);
  const line = `${mid}${planned ? '+plan' : ''}`.padEnd(11) + `${level || '-'}`.padEnd(8) + `${((Date.now() - t0) / 1000).toFixed(1)} s`.padEnd(8);
  if (want === 'none') { if (v.case) bad.push('a case was opened for a payment that went through'); return [line + 'no case', bad]; }
  const cid = v.case && v.case.case_id; if (!cid) return [line, bad.concat('no case')];
  if (!/never ask/i.test(first) || !/\?/.test(first)) bad.push('first message lacks "never ask" or a question');
  const r = await call(`/api/cases/${cid}/reply`, { text });
  if (r.status !== 200 || !r.j.reply) bad.push('member reply ' + r.status); else if (/\[[^\]]*\]/.test(r.j.reply) || (r.j.reply.match(/\?/g) || []).length > 1) bad.push('reply has a placeholder or several questions');
  if (!(await call('/api/console')).j.some((x) => x.case && x.case.case_id === cid)) bad.push('case missing from the console');
  for (const [u, b, code] of [[`/api/cases/${cid}/join`, { reason: 'smoke test' }, 200], [`/api/cases/${cid}/takeover`, { on: true }, 200], [`/api/cases/${cid}/reply`, { text: 'hello?' }, 409], [`/api/cases/${cid}/log`, { direction: 'out', text: 'Hi, this is Dana at Sound.', source: 'employee' }, 200],
    [`/api/cases/${cid}/takeover`, { on: false }, 200], [`/api/cases/${cid}/action`, { text: 'Employee called member' }, 200]]) {
    const x = await call(u, b); if (x.status !== code) bad.push(`${u.split('/').pop()} ${x.status}, expected ${code}`);
  }
  const fb = await call('/api/feedback', { source: 'employee', score: 4, comment: 'smoke test', case_id: cid, member_id: mid, mode: 'live' });   // stored with a snapshot of the case
  if (fb.status !== 200) bad.push('feedback ' + fb.status);
  const vd = await call('/api/feedback', { source: 'employee', kind: 'verdict', score: want === 'hold' ? 1 : -1, case_id: cid, member_id: mid, context: { loss: 0, recovered: 0 } });
  if (vd.status !== 200) bad.push('verdict ' + vd.status);
  if (want === 'hold') {                                                          // a confirmed scam: questions and the agent's FTC draft
    const facts = { member_id: mid, ato: mid === 'M1003', amount: '$1,000', method: 'wire', date: 'Oct 1, 9:00 AM', paid_to: 'R-1', recipient_new: true, member_said: [text || ''] };
    const qs = await call('/api/ftc/questions', { facts }), dr = await call('/api/ftc/draft', { case_id: cid, member_id: mid, choice: 'assisted', facts, answers: { share: 'Keep me anonymous' } });
    if (qs.status !== 200 || !Array.isArray(qs.j.questions)) bad.push('ftc questions ' + qs.status);
    if (dr.status !== 200 || !(dr.j.sections || []).length || !/\$1,000/.test(dr.j.story || '')) bad.push('ftc draft ' + dr.status + ' ' + (dr.j.reason || ''));
  }
  const ev = await call('/api/interactions', { events: [{ kind: 'chose', case_id: cid, member_id: mid, ms: 1200, detail: { label: 'smoke test', how: 'tap' } }] });
  if (ev.status !== 200 || ev.j.n !== 1) bad.push('interactions ' + ev.status);
  await call(`/api/cases/${cid}/log`, { direction: 'in', text: 'They told me to read the code: 482913', source: 'script' });          // a typed code must never be stored
  if (JSON.stringify((await call('/api/cases/' + cid)).j.messages).includes('482913')) bad.push('a one-time code was stored unmasked');
  return [line + `first message: ${v.timings.compose_source}, reply ${r.j && r.j.reply ? 'ok' : '-'}`, bad];
}

(async () => {
  const only = process.argv[2] && process.argv[2].split(','), s = await call('/api/status').catch(() => null);
  if (!s || !s.j || !s.j.backend) { console.error(`No Harbor gateway at ${B}. Start it with: task run`); process.exit(1); }
  const gw = (await call('/api/gateway/health')).j || {};
  console.log(`Smoke test against ${B} (provider: ${s.j.provider || 'none'}; agent ${gw.agent ? 'up' : 'DOWN'}, screenshot ${gw.screenshot ? 'up' : 'DOWN'})\n`);
  let fails = 0;
  for (const st of STORIES.filter((x) => !only || only.includes(x[0]))) {
    const [line, bad] = await story(st); fails += bad.length;
    console.log(`${bad.length ? 'FAIL' : 'ok  '}  ${line}`); for (const b of bad) console.log('        - ' + b);
  }
  for (const [u, b, code] of [['/api/pipeline', undefined, 200], ['/api/cases', undefined, 200], ['/api/review', undefined, 200], ['/api/retro', undefined, 200], ['/api/traces?limit=1', undefined, 200],
    ['/api/demo/start', { member: 'M9999' }, 404], ['/api/cases/C-NONE/resolve', { outcome: 'x' }, 404], ['/api/chat', {}, 400], ['/api/feedback', { source: 'member', score: 7 }, 400], ['/api/feedback', undefined, 200], ['/api/interactions', undefined, 200], ['/api/gateway/health', undefined, 200], ['/api/screenshot/health', undefined, 200], ['/api/screenshot/analyze', { image: 'data:application/pdf;base64,AA' }, 415], ['/api/feedback', { source: 'employee', kind: 'verdict', score: 4 }, 400], ['/agent.js', undefined, 404]]) {
    const x = await fetch(B + u, b === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
    if (x.status !== code) { fails++; console.log(`FAIL  ${u} -> ${x.status}, expected ${code}`); }
  }
  console.log(fails ? `\n${fails} problem(s)` : '\nall good'); process.exit(fails ? 1 : 0);
})();

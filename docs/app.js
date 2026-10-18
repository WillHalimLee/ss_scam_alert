/* Harbor prototype UI. Vanilla JS, no backend. Synthetic data only. */
(() => {
const D = window.HARBOR_DATA, E = window.HarborEngine;
const mem = Object.fromEntries(D.members.map((m) => [m.id, m]));
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
const fmt = (t) => new Date(t).toLocaleString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const railWord = (r) => ({ P2P: 'P2P payment', Wire: 'wire', Cash: 'cash withdrawal', 'External Transfer': 'external transfer' }[r] || r.toLowerCase());

const SCENARIOS = [
  { id: 'sarah', mid: 'M1003', name: 'Sarah', tag: 'Account takeover', blurb: 'Fake Sound text, then reset + email/phone change + new recipient within minutes.' },
  { id: 'linda', mid: 'M1001', name: 'Linda', tag: 'Authorized scam', blurb: 'Fake attorney: grandson needs bail. $8,500 wire.' },
  { id: 'michael', mid: 'M1002', name: 'Michael', tag: 'Slow-burn romance', blurb: 'Small P2P payments grow, then wires to an online partner.' },
  { id: 'james', mid: 'M1004', name: 'James', tag: 'Federal impersonation', blurb: 'Told his identity is tied to a federal case. $7,000 cash at the branch.' },
  { id: 'mover', mid: 'M1039', name: 'M1039', tag: 'Look-alike: real move', blurb: 'Real password reset and address change, then pays a new landlord.' },
  { id: 'closing', mid: 'M1057', name: 'M1057', tag: 'Look-alike: home closing', blurb: '$51,587 down-payment wire. Try the Planned Big Payment toggle.' },
  { id: 'grand', mid: 'M1049', name: 'M1049', tag: 'Look-alike: new contractor', blurb: 'Staged payments to a new contractor. The data\'s overnight hold becomes a light check.' },
];
const PLANS = { M1057: [{ rail: 'Wire', amount: 51587, label: 'Home closing wire, declared Oct 12' }] };

const S = { tab: 'member', sc: 'sarah', planned: false, phone: { step: 'review' }, chat: null, cases: {}, sel: null,
  sim: { cfg: Object.assign({}, E.DEFAULTS), plannedAll: false, filter: 'all', selId: null }, unread: 0,
  live: { mode: 'scripted', avail: false, provider: '', model: '', timeout: 9000 }, trig: { id: 'sarah' } };
const API = location.protocol === 'file:' ? 'http://localhost:8787' : '';
const RED = ['authority_pressure', 'secrecy_or_isolation', 'unmet_online_contact', 'growing_amounts', 'unusual_method', 'member_denies_changes', 'relative_pressure', 'credential_shared'];
const SIGNAL_LABEL = { authority_pressure: 'Someone claiming authority', secrecy_or_isolation: 'Told to keep it secret', urgency: 'Urgency', unverified_contact: 'Not independently verified',
  unmet_online_contact: 'Met online, not in person', growing_amounts: 'Growing amounts', unusual_method: 'Unusual payment method', member_verified: 'Member verified details', own_initiative: 'Member\'s own decision',
  member_denies_changes: 'Denies profile changes', member_confirms_changes: 'Confirms profile changes', wants_person: 'Wants a person', member_distressed: 'Distressed', relative_pressure: 'Pressure from someone close', credential_shared: 'Shared a password or code' };
async function checkLive() {
  try { const j = await (await fetch(API + '/api/status')).json(); S.live.avail = !!j.live; S.live.provider = j.provider || ''; S.live.model = j.model || ''; S.live.timeout = j.timeoutMs || 9000; }
  catch { S.live.avail = false; }
  if (!S.live.avail) S.live.mode = 'scripted';
  render();
}

/* ---------- scenario decision ---------- */
function scenarioDecision(sc) {
  const evs = D.events[sc.mid];
  const cfg = { planned: S.planned ? PLANS[sc.mid] : undefined };
  const decs = E.evaluate(evs, cfg);
  let dec = decs.find((d) => d.level !== 'none');
  if (!dec) { // e.g. the real mover: show the payment Harbor looked at and let through
    const reset = evs.find((e) => e.type === 'Password Reset');
    dec = decs.find((d) => d.rs === 'New' && (!reset || d.t > reset.t));
  }
  return dec;
}
const KEY = ['Password Reset', 'Email Change', 'Phone Change', 'Address Change', 'Profile Change Alert Sent', 'Recipient Added', 'Payment Initiated', 'Branch Visit', 'Contact Center Call'];
function keyEvents(mid, untilT, n) {
  return D.events[mid].filter((e) => KEY.includes(e.type) && e.t <= untilT && !(e.type === 'Payment Initiated' && e.dir !== 'Outgoing')).slice(-n);
}
function evLabel(e) {
  if (e.type === 'Payment Initiated') return `Payment started: ${money(e.amt)} ${railWord(e.rail)}${e.rs === 'New' ? ' to a NEW recipient' : ''}${e.vs && e.vs.includes('Above') ? ' (' + e.vs.toLowerCase() + ')' : ''}`;
  if (e.type === 'Profile Change Alert Sent') return 'Alert sent' + (e.note ? ': ' + e.note.toLowerCase() : '');
  if (e.type === 'Password Reset') return 'Password reset via ' + e.ch;
  return e.type + (e.ch ? ' (' + e.ch + ')' : '');
}
/** Which events fed the rule(s) that fired. Highlighted in the timeline so staff can see why, for every kind of case. */
function isEvidence(e, dec) {
  const ids = dec.rules.map((r) => r.id);
  if (!ids.length || e.id === dec.eventId) return false;
  const MIN = 60000;
  if (ids.includes('ATO') && ['Password Reset', 'Email Change', 'Phone Change', 'Recipient Added'].includes(e.type)) return true;
  if (ids.includes('CONTACT') && ['Branch Visit', 'Contact Center Call'].includes(e.type) && dec.t - e.t <= 90 * MIN) return true;
  if (e.type === 'Recipient Added' && (!dec.rid || e.rid === dec.rid)) return true;
  if (ids.includes('RAMP') && e.type === 'Payment Initiated' && e.dir === 'Outgoing' && e.rail === 'P2P' && (e.rs === 'New' || (e.rage != null && e.rage <= 30))) return true;
  return false;
}
function timelineHTML(mid, dec, n = 12) {
  const evs = keyEvents(mid, dec.t, n);
  const any = evs.some((e) => isEvidence(e, dec));
  return (any ? '<p class="small muted" style="margin:0 0 6px">Orange events fed the rule that fired.</p>' : '') + '<ul class="tl">' + evs.map((e) => {
    const cls = e.id === dec.eventId ? 'trigger' : isEvidence(e, dec) ? 'hit' : '';
    return `<li class="${cls}"><time>${fmt(e.t)}</time><span>${esc(evLabel(e))}${e.id === dec.eventId ? ' ← <b>Decide</b> stage runs here' : ''}</span></li>`;
  }).join('') + '</ul>';
}
function levelChip(l) { return l === 'hold' ? '<span class="chip red">Pause &amp; ask</span>' : l === 'confirm' ? '<span class="chip amber">Light check</span>' : '<span class="chip green">No friction</span>'; }
function noFlagExplain(mid, dec) {
  const evs = D.events[mid].filter((e) => e.t <= dec.t);
  const reset = evs.filter((e) => e.type === 'Password Reset').pop();
  const kinds = ['Email Change', 'Phone Change', 'Address Change'].filter((k) => evs.some((e) => e.type === k)).map((k) => k.replace(' Change', '').toLowerCase());
  if (reset) return `A password reset and a change to <b>${kinds.join(' + ') || 'profile'}</b> were seen, but no email <i>and</i> phone change, and the payment came <b>${Math.round((dec.t - reset.t) / 3600000)} hours</b> after the reset (takeovers pay within about 20 minutes). No rule fired, so the member pays with no friction.`;
  return 'No rule fired.';
}

/* ---------- chat script ---------- */
function ctxOf(sc, dec) {
  const m = mem[sc.mid];
  const ato = dec.rules.some((r) => r.id === 'ATO');
  const planned = dec.level === 'confirm' && dec.suppress.some((s) => /Planned/.test(s));
  const amt = money(dec.amt), rail = railWord(dec.rail);
  const recip = dec.rail === 'Cash' ? '' : dec.rs === 'New' ? 'someone new' : dec.rs === 'Existing' ? 'an existing recipient' : '';
  return { sc, dec, m, ato, planned, name: sc.name.startsWith('M1') ? 'you' : sc.name, amt, rail, recip, pay: amt + ' ' + rail + (recip ? ' to ' + recip : '') };
}
/** Why Harbor paused it, in words for the member (the staff-facing reasons stay in the side panel). */
function memberReason(c) {
  const id = c.dec.rules[0] && c.dec.rules[0].id, verb = c.dec.rail === 'Cash' ? 'take out' : 'send';
  const hard = c.dec.rail === 'Cash' || c.dec.rail === 'Wire' ? ' Cash and wires are hard to get back, so I wanted to check in first.' : ' So I wanted to check in first.';
  return ({
    ATO: 'Your password, email and phone number were all changed just before this payment started, so I wanted to make sure it\'s really you.',
    RAMP: 'You\'ve sent a few payments to new people lately, and this one is bigger. So I wanted to check in first.',
    HIGHSTAKES: 'This is much more than you usually ' + verb + '.' + hard,
    CONTACT: 'This came right after you spoke with us, and it\'s a big one. So I wanted to check in first.',
    FRESH: 'This is more than you usually send to someone new. So I wanted to check in first.',
  })[id] || 'This looks different from your usual activity. So I wanted to check in first.';
}
function warn(intro) {
  return { bot: [intro, 'I can\'t tell if this is a scam, and I\'m not judging. A person at Sound can talk it through with you, or you can take a pause.'],
    choices: [{ t: 'Talk to a Sound employee', end: 'human' }, { t: 'Keep it paused while I check', end: 'paused_self' }, { t: 'Let my trusted contact know', go: 'trusted' }, { t: 'Cancel the payment', end: 'cancelled' }, { t: 'I understand the risk. Send it anyway', end: 'override' }] };
}
const PURPOSE = [{ t: 'Buying a home or vehicle', go: 'home' }, { t: 'Helping a family member', go: 'family' }, { t: 'Paying someone I met online', go: 'online' },
  { t: 'Someone told me to move money (bank, police, government)', go: 'authority' }, { t: 'Paying a contractor, landlord or business', go: 'business' },
  { t: 'Moving money to my own account', go: 'own' }, { t: 'Something else / not sure', go: 'unsure' }];
function node(id, c) {
  const first = c.dec.rules[0];
  const N = {
    ato0: { bot: [`Hi, this is Harbor, Sound's security analyst. Sorry to interrupt.`, `A few minutes ago the password, email address and phone number on your account were changed, and a ${c.amt} payment to a new recipient was started. I've paused it. <b>Nothing has left your account.</b>`, 'Was that you?'],
      choices: [{ t: 'Yes, that was me', go: 'ato_yes' }, { t: 'No, that wasn\'t me', end: 'ato_stop' }, { t: 'I\'m not sure', end: 'ato_stop' }] },
    ato_yes: { bot: ['Thanks for telling me. Because contact details changed at the same time, I\'d like a Sound employee to call you back on the number we had <i>before</i> today. It takes about 5 minutes.'],
      choices: [{ t: 'OK, call me', end: 'callback' }, { t: 'Cancel the payment', end: 'cancelled' }] },
    planned: { bot: [`Hi, I'm Harbor. This ${c.amt} ${c.rail} matches the <b>Planned Big Payment</b> you set up (${PLANS[c.sc.mid]?.[0].label ?? 'declared earlier'}). Because it's large, one quick step.`, 'Did you confirm the account details with your title company by phone, using a number you already had?'],
      choices: [{ t: 'Yes, I verified them', end: 'callback_fast' }, { t: 'Not yet', go: 'verify_warn' }] },
    light: { bot: [`Hi, I'm Harbor. Quick check: this payment goes to someone fairly new on your account and it's more than you usually send. Do you know them well?`],
      choices: [{ t: 'Yes, I know them', go: 'light_yes' }, { t: 'Let me check first', go: 'family' }] },
    light_yes: { bot: ['Thanks! Have you spoken to them directly, on a phone number you already had?'],
      choices: [{ t: 'Yes, I spoke with them', end: 'ok' }, { t: 'Not exactly', go: 'family_warn' }] },
    start: { bot: [`Hi, I'm Harbor, Sound's security analyst. I paused your ${c.pay} for a quick check. <b>Nothing has gone out, and you're in control.</b>`,
      memberReason(c),
      'One thing worth knowing: Sound, the police and government agencies never ask anyone to move money to keep it safe. So, what\'s this payment for?'],
      choices: PURPOSE },
    fallback: { bot: ['Let me guide you with a few quick questions instead.', 'What is this payment for?'], choices: PURPOSE },
    fallback_ato: { bot: ['Let me ask a couple of quick questions instead.', 'Were the password, email and phone changes made by you?'], choices: [{ t: 'Yes, that was me', go: 'ato_yes' }, { t: 'No, that wasn\'t me', end: 'ato_stop' }, { t: 'I\'m not sure', end: 'ato_stop' }] },
    home: { bot: ['Big purchases are exactly when criminals slip in fake payment instructions.', 'Did you get these payment details straight from the title company, lender or seller and confirm them by phone using a number you already had?'],
      choices: [{ t: 'Yes, I verified them', end: 'ok' }, { t: 'I\'m not sure', go: 'verify_warn' }] },
    verify_warn: { bot: ['No problem, let\'s check together. Closing and purchase fraud often changes the account number by email at the last minute.'],
      choices: [{ t: 'Talk to a Sound employee now', end: 'human' }, { t: 'I\'ll verify and come back (stay paused)', end: 'paused_self' }, { t: 'Cancel the payment', end: 'cancelled' }] },
    family: { bot: ['That\'s generous. Scammers sometimes pretend to be family in a hurry, so one question:', 'Have you spoken with them directly, on a number you already had?'],
      choices: [{ t: 'Yes, I spoke with them', end: 'ok' }, { t: 'No, they contacted me / I couldn\'t reach them', go: 'family_warn' }, { t: 'Not sure', go: 'family_warn' }] },
    family_warn: warn('Thank you for being honest. An urgent request from a "family member" or "lawyer", especially with "keep it secret", matches a common scam. That doesn\'t mean it is one.'),
    online: { bot: ['Online relationships can be real. I\'m not judging.', 'Have you met this person in person or on a live video call?'],
      choices: [{ t: 'Yes, we\'ve met', go: 'online_met' }, { t: 'No, not yet', go: 'online_warn' }] },
    online_met: { bot: ['Thanks. Is this the first time they\'ve asked for money, or has the amount been growing?'],
      choices: [{ t: 'First time', end: 'ok' }, { t: 'It\'s been growing', go: 'online_warn' }] },
    online_warn: { bot: ['Payments that grow over time to someone not met in person, especially for an "investment", are a pattern we see often. You\'re not foolish. These are built to feel real.', 'Real opportunities are still there tomorrow, so a pause costs nothing.'],
      choices: [{ t: 'Talk to a Sound employee (no pressure)', end: 'human' }, { t: 'Pause 24 hours', end: 'paused_24' }, { t: 'Let my trusted contact know', go: 'trusted' }, { t: 'Cancel the payment', end: 'cancelled' }, { t: 'I understand the risk. Send it anyway', end: 'override' }] },
    authority: { bot: ['Thank you for telling me. I want to be direct: <b>Sound, the police, the FBI and the IRS will never ask you to move or hand over money to protect it.</b> Anyone who does is not who they say they are.', 'Are they asking you to stay on the phone, or to keep this secret?'],
      choices: [{ t: 'Yes', go: 'authority_warn' }, { t: 'No', go: 'authority_warn' }, { t: 'I\'m not sure', go: 'authority_warn' }] },
    authority_warn: warn('You can hang up at any time. Real officials won\'t mind if you call back on a number you look up yourself.'),
    business: { bot: ['Thanks. Is this a new person or business, and do you have a written quote, contract or lease?'],
      choices: [{ t: 'Yes, I have paperwork', end: 'ok' }, { t: 'Not yet', go: 'business_warn' }] },
    business_warn: warn('Paying a lot up front without paperwork is a common contractor pattern. Staged payments are normal and often safer.'),
    own: { bot: ['Moving money to your own account is common. Did you open that account yourself and set up the login yourself?'],
      choices: [{ t: 'Yes, I set it up myself', end: 'ok' }, { t: 'Someone helped or told me to', go: 'authority_warn' }] },
    unsure: { bot: ['That\'s okay. Being unsure is reason enough to pause. Who asked you to make this payment, and how did they reach you?'],
      choices: [{ t: 'Someone called or texted me', go: 'authority' }, { t: 'Someone I know in person', go: 'family' }, { t: 'I decided on my own', end: 'ok' }, { t: 'I\'d rather talk to a person', end: 'human' }] },
    trusted: { bot: [`I'll send your trusted contact this message: <i>"${esc(c.name === 'you' ? 'Your friend' : c.name)} asked Sound to let you know about a large payment they're about to make. You may want to give them a call."</i>`, 'They are told, <b>never given access</b> to your account, and you can remove them any time. They won\'t see account details.'],
      choices: [{ t: 'Send that message', end: 'trusted_sent' }, { t: 'No, don\'t contact anyone', back: true }] },
  };
  return N[id];
}
const OUTCOMES = {
  release_light: { tone: 'green', title: 'Payment sent', text: 'Thanks for checking. Your payment is on its way.', status: 'Released after light confirmation', hold: 'about 1 minute' },
  callback: { tone: 'teal', title: 'A person will call you shortly', text: 'A Sound employee will call you within about 15 minutes, confirm a few details, then release the payment. They already have what you told me.', status: 'Callback queued; likely legitimate', hold: 'target under 30 minutes' },
  callback_fast: { tone: 'teal', title: 'Quick callback, then release', text: 'Because you planned this payment, a Sound employee will call within minutes to confirm, then release it. No long hold.', status: 'Planned Big Payment: fast callback', hold: 'target under 30 minutes (baseline in data: 3-4 hours)' },
  cancelled: { tone: 'green', title: 'Payment cancelled', text: 'Nothing left your account. You made a safe choice. If you want to talk it through, a person is one tap away.', status: 'Cancelled by member', hold: '-' },
  human: { tone: 'teal', title: 'Connecting you to a person', text: 'A Sound employee is calling you now. They can see what you told me, so you won\'t have to repeat yourself.', status: 'Handoff: member asked for a person', hold: 'until call' },
  paused_self: { tone: 'amber', title: 'Paused for now', text: 'The payment stays paused for 24 hours. Call them back using a number you already have. If anything feels off, tap "Talk to a person". I\'ll check in tomorrow.', status: 'Paused by member; check-in in 24h', hold: '24 hours' },
  paused_24: { tone: 'amber', title: 'Paused for 24 hours', text: 'Take your time. A real opportunity will still be there tomorrow. I\'ll check in then, and you can talk to a person any time.', status: 'Paused 24h by member; check-in scheduled', hold: '24 hours' },
  override: { tone: 'amber', title: 'Your money, your decision', text: 'I\'ll send it. One honest note: payments you authorize are much harder to recover. I\'ll check in tomorrow, and here is a recall checklist if you change your mind.', status: 'Member override (logged). Follow-up check-in and recall checklist', hold: 'released by member' },
  trusted_sent: { tone: 'teal', title: 'Trusted contact notified', text: 'I let them know, and they cannot see your account. The payment stays paused while you decide. A Sound employee will check in too.', status: 'Trusted contact notified at member request', hold: 'until member decides' },
  ato_stop: { tone: 'red', title: 'Payment stopped, account protected', text: 'You did nothing wrong and you\'re not in trouble. I cancelled the payment, froze new-recipient payments, and a specialist is calling your previous number now. Reminder: Sound never asks for your password or a one-time code.', status: 'ATO suspected: payment stopped, account restricted, call to pre-change number', hold: 'cancelled' },
  timeout: { tone: 'amber', title: 'No reply: a person will reach out', text: 'No response after 10 minutes, so a Sound employee starts outreach. Wires and cash stay held. P2P stays held until staff have tried to reach the member.', status: 'No response: employee outreach started', hold: 'held pending outreach' },
};

function startChat() {
  const sc = SCENARIOS.find((s) => s.id === S.sc), dec = scenarioDecision(sc), c = ctxOf(sc, dec);
  const first = c.ato ? 'ato0' : c.planned ? 'planned' : dec.level === 'confirm' ? 'light' : 'start';
  S.chat = { c, msgs: [], queue: [], typing: false, draining: false, answers: [], path: [], outcome: null, startedAt: Date.now() };
  S.log.rows = [];
  if (S.live.mode === 'live' && S.live.avail) S.chat.live = { hist: [], signals: {}, state: 'calm', note: '', pending: false, trusted: false, provider: S.live.provider };
  pushNode(first);
}
function pushNode(id) {
  const ch = S.chat, n = node(id, ch.c);
  ch.path.push(id); ch.cur = id;
  for (const b of n.bot) ch.queue.push(typeof b === 'string' ? { f: 'bot', h: b } : { f: 'sys', h: b.sys });
  drain(ch);
}
/** Harbor's messages arrive one at a time: a typing indicator, then the message, then a beat before the next. */
function drain(ch) {
  if (ch.draining) return;
  ch.draining = true;
  const calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const step = () => {
    if (S.chat !== ch) return;                                            // the scenario was restarted
    if (!ch.queue.length) { ch.typing = false; ch.draining = false; render(); return; }
    ch.typing = true; render();
    const wait = calm ? 150 : 700 + Math.min(1200, ch.queue[0].h.replace(/<[^>]+>/g, '').length * 12);   // about 1-2 s per message
    setTimeout(() => {
      if (S.chat !== ch || !ch.queue.length) return;                      // member took over meanwhile
      ch.msgs.push(ch.queue.shift()); ch.typing = false; render();
      setTimeout(step, calm ? 0 : 650);                                         // a beat; longer than the ease-in, so it is never cut short
    }, wait);
  };
  step();
}
function liveChips(ch) {
  const L = ch.live, c = ch.c, sg = L.signals;
  if (L.trusted) return [{ t: 'Send that message', end: 'trusted_sent' }, { t: 'No, don\'t contact anyone', back: true }];
  if (!L.hist.length) return node(ch.path[ch.path.length - 1], c).choices.map((x) => ({ t: x.t, text: true }));
  const red = RED.some((k) => sg[k]), out = [];
  if (c.ato) {
    out.push({ t: 'It wasn\'t me. Stop the payment and protect my account', end: 'ato_stop' });
    if (sg.member_confirms_changes && !red) out.push({ t: 'It was me. Have someone call me to confirm', end: 'callback' });
    out.push({ t: 'Talk to a Sound employee', end: 'human' });
    return out;
  }
  if (!red && (sg.member_verified || sg.own_initiative)) out.push({ t: 'This looks fine. Please continue', end: 'ok' });
  const human = { t: 'Talk to a Sound employee', end: 'human' };
  if (sg.wants_person || sg.member_distressed || red) out.push(human);
  if (!(sg.wants_person || sg.member_distressed || red)) out.push(human);
  out.push({ t: 'Keep it paused while I check', end: 'paused_self' });
  if (!sg.relative_pressure) out.push({ t: 'Let my trusted contact know', go: 'trusted' });
  out.push({ t: 'Cancel the payment', end: 'cancelled' }, { t: 'I understand the risk. Send it anyway', end: 'override' });
  return out;
}
function liveCtx(c) {
  return { amount: c.amt, rail: c.rail, recipient: c.recip, reasons: c.dec.rules.map((r) => r.reason), ato: c.ato, level: c.dec.level,
    trustedContact: D.events[c.sc.mid].some((e) => e.t <= c.dec.t && e.tc) };
}
async function sendLive(text) {
  const ch = S.chat, L = ch && ch.live; text = (text || '').trim().slice(0, 600);
  if (!L || !text || L.pending || ch.outcome) return;
  ch.msgs.push({ f: 'me', h: esc(text) }); ch.answers.push({ q: 'live', a: text }); L.hist.push({ role: 'user', content: text }); L.pending = true; render();
  try {
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), S.live.timeout);
    const r = await fetch(API + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ctx: liveCtx(ch.c), messages: L.hist }), signal: ctl.signal });
    clearTimeout(to); if (!r.ok) throw new Error('http ' + r.status);
    const j = await r.json(); if (S.chat !== ch || ch.outcome) return;
    L.hist.push({ role: 'assistant', content: j.reply }); ch.msgs.push({ f: 'bot', h: esc(j.reply) });
    for (const k in j.signals) if (j.signals[k]) L.signals[k] = true;
    Object.assign(L, { state: j.member_state, note: j.handoff_note, guarded: j.guarded, provider: j.provider, pending: false });
  } catch (e) {
    if (S.chat !== ch || ch.outcome) return;
    ch.msgs.push({ f: 'sys', h: 'The live assistant is unavailable, so I\'m switching to a few guided questions.' });
    ch.live = null; pushNode(ch.c.ato ? 'fallback_ato' : 'fallback');
  }
  render();
  refreshLog();
}
function liveChoose(i) {
  const ch = S.chat, L = ch.live, pick = liveChips(ch)[i]; if (!pick || L.pending) return;
  if (pick.text) return sendLive(pick.t);
  ch.msgs.push({ f: 'me', h: esc(pick.t) }); ch.answers.push({ q: 'live-choice', a: pick.t });
  if (pick.back) L.trusted = false;
  else if (pick.go === 'trusted') { L.trusted = true; const n = node('trusted', ch.c); for (const b of n.bot) ch.queue.push({ f: 'bot', h: b }); drain(ch); }
  else finish(pick.end === 'ok' ? (ch.c.dec.level === 'confirm' ? 'release_light' : 'callback') : pick.end);
  render();
}
function choose(i) {
  if (S.chat.live) return liveChoose(i);
  const ch = S.chat, n = node(ch.cur, ch.c), pick = n.choices[i];
  ch.msgs.push({ f: 'me', h: esc(pick.t) });
  ch.answers.push({ q: ch.cur, a: pick.t });
  if (pick.back) { ch.path.pop(); pushNode(ch.path.pop() || 'start'); }
  else if (pick.go) pushNode(pick.go);
  else finish(pick.end === 'ok' ? (ch.c.dec.level === 'confirm' ? 'release_light' : 'callback') : pick.end);
  render();
}
function finish(key) {
  const ch = S.chat; ch.outcome = key; ch.queue = []; ch.typing = false; ch.draining = false; const o = OUTCOMES[key];
  const summary = {
    mid: ch.c.sc.mid, who: ch.c.sc.name, tag: ch.c.sc.tag, dec: ch.c.dec, status: o.status, answers: ch.answers.slice(), key, updated: 'Just now',
    log: [`Harbor paused ${ch.c.amt} ${ch.c.rail}`, ...(ch.answers.length ? ['Member chat: ' + ch.answers.map((a) => '"' + a.a + '"').join(' → ')] : ['No member reply']), 'Outcome: ' + o.status],
  };
  const L = ch.live;
  if (L) { summary.live = true; summary.signals = Object.keys(L.signals).filter((k) => L.signals[k]); summary.note = L.note; summary.state = L.state;
    summary.log.splice(1, 0, 'Harbor\'s read (' + L.provider + '): ' + (summary.signals.map((k) => SIGNAL_LABEL[k]).join(', ') || 'no risk signals') + (L.note ? '. Note: ' + L.note : '')); }
  S.cases[ch.c.sc.mid] = summary; S.unread++;
}

/* ---------- member view ---------- */
function phoneHTML() {
  const sc = SCENARIOS.find((s) => s.id === S.sc), dec = scenarioDecision(sc), c = ctxOf(sc, dec), p = S.phone;
  const bar = (t) => `<div class="bar"><b>${t}</b><span>9:41</span></div>`;
  const recip = dec.rs === 'New' ? 'New recipient (added recently)' : 'Existing recipient';
  if (p.step === 'review') {
    return { html: `${bar(c.ato ? 'Sound (criminal\'s session)' : 'Sound Credit Union')}<div class="body">
      ${c.ato ? '<div class="outcome red small">Demo view: this is the <b>criminal</b> using Sarah\'s stolen login. Sarah doesn\'t know yet.</div>' : ''}
      <div class="card"><h2>Review payment</h2>
      <div class="row"><span>From</span><b>Checking</b></div><div class="row"><span>To</span><b>${recip}</b></div>
      <div class="row"><span>Method</span><b>${esc(dec.rail)}</b></div><div class="row"><span>Amount</span><b>${money(dec.amt)}</b></div></div></div>
      <div class="foot"><button class="btn block" data-act="send">Send payment</button></div>` };
  }
  if (p.step === 'sent') return { html: `${bar('Sound Credit Union')}<div class="body"><div class="outcome green"><h2>Payment sent</h2>No friction. Harbor looked and let it through.</div></div><div class="foot"><button class="btn alt block" data-act="reset">Replay</button></div>` };
  if (p.step === 'paused') {
    const why = c.ato ? '' : `<div class="pcap">Why Harbor paused it</div><div class="pwhy">${esc(dec.rules[0] ? dec.rules[0].reason : 'Unusual activity.')} This is a safety check, not an accusation.</div>`;
    return { html: `${bar(c.ato ? 'Sound (criminal\'s session)' : 'Sound Credit Union')}<div class="body">
      <span class="pill">Paused. Nothing has been sent.</span>
      <h2 class="ptitle">${c.ato ? 'This payment is under review' : 'Your ' + esc(railWord(dec.rail)) + ' is paused for a quick look'}</h2>
      <div class="pcard"><div class="pamt">${money(dec.amt)}</div><div class="row"><span>Sent by</span><b>${esc(dec.rail)}</b></div><div class="row"><span>To</span><b>${esc(recip)}</b></div></div>
      ${c.ato ? '<p class="pwhy">For your security, we\'ve contacted the number and email we had on file.</p>' : why}
      ${c.ato ? '' : '<p class="pvoice">You\'re in control. Nothing moves without you.</p>'}</div>
      <div class="foot"><button class="btn block" data-act="notify">${c.ato ? 'Switch to Sarah\'s real phone' : 'Next: Harbor\'s message arrives'}</button></div>` };
  }
  if (p.step === 'lock') {
    const text = c.ato ? 'Sound: A payment was paused on your account. Open your Sound app to review. We will never ask for your password or a code.' : 'Sound Harbor: Your payment is paused for a quick check. Nothing was sent. Open the Sound app to review.';
    const title = c.ato ? 'A payment was paused on your account' : `Your ${money(dec.amt)} ${railWord(dec.rail)} is paused`;
    return { html: `<div class="lock"><p class="ldate">Saturday, October 17</p><div class="time" style="text-align:center">9:41</div><p class="lwho">${c.ato ? 'Sarah\'s phone (number on file before today)' : 'Your phone'}</p>
      <div class="notif"><div class="nmark" aria-hidden="true">⚓</div><div style="flex:1;min-width:0"><div class="nhead"><b>Harbor${c.ato ? ' · SMS to the old number' : ''}</b><span>now</span></div><div class="nt">${esc(title)}</div><div class="nb">${esc(text)}</div>
      <div class="small" style="margin-top:6px">Link opens only the authenticated Sound app. Harbor never asks for credentials or codes.</div>
      <button class="btn sm" style="margin-top:8px" data-act="open">Open Sound app</button></div></div>
      <p class="lnote">Sound will never ask for your password or a code, or ask you to move money.</p></div>` };
  }
  // chat
  const ch = S.chat, n = ch.outcome ? null : node(ch.cur, ch.c), o = ch.outcome && OUTCOMES[ch.outcome], L = ch.live;
  const busy = ch.typing || ch.queue.length > 0 || !!(L && L.pending);
  const msgs = ch.msgs.map((m) => { const cls = m.seen ? '' : ' fresh'; m.seen = true; return `<div class="msg ${m.f}${cls}">${m.h}</div>`; }).join('')
    + (ch.typing || (L && L.pending) ? '<div class="msg bot typing" role="status" aria-label="Harbor is typing"><span></span><span></span><span></span></div>' : '');
  const chips = busy ? '' : (L ? liveChips(ch) : n ? n.choices : []).map((x, i) => `<button class="choice" data-act="choose" data-i="${i}">${esc(x.t)}</button>`).join('');
  const box = L && !L.trusted ? `<form class="livebox" data-act="liveform"><textarea id="livein" rows="2" maxlength="600" placeholder="Type what's going on, in your own words" aria-label="Message to Harbor" ${busy ? 'disabled' : ''}></textarea><button class="btn sm" type="submit" ${busy ? 'disabled' : ''}>Send</button></form>` : '';
  const footKey = [ch.cur, ch.msgs.length, ch.outcome || '', busy ? 'b' : 'r', L ? L.hist.length : ''].join('|');
  const footCls = ch.footKey === footKey ? '' : ' fresh'; ch.footKey = footKey;
  const foot = o ? `<button class="btn alt block" data-act="reset">Replay this scenario</button>` : box + chips + `<button class="btn ghost sm" data-act="person">Talk to a person</button>`;
  const oc = o ? `<div class="outcome ${o.tone}${ch.outcomeSeen ? '' : ' fresh'}"><b>${o.title}</b><br>${o.text}</div>` : ''; if (o) ch.outcomeSeen = true;
  return { html: `${bar('Harbor · security analyst')}<div class="body" id="chatbody">${msgs}${oc}</div><div class="foot${footCls}">${foot}</div>` };
}
function understandingHTML(L) {
  const on = Object.keys(L.signals).filter((k) => L.signals[k]);
  const red = on.some((k) => RED.includes(k));
  return `<h3>What Harbor understood (AI) vs what the code allows</h3>
    <div class="card" style="box-shadow:none"><p class="small" style="margin:0 0 6px">Member state: <span class="chip ${L.state === 'calm' ? 'green' : 'amber'}">${esc(L.state)}</span> ${L.guarded ? '<span class="chip red">reply replaced by guardrail</span>' : ''}</p>
    <p style="margin:6px 0">${on.length ? on.map((k) => `<span class="chip ${RED.includes(k) ? 'red' : 'grey'}">${esc(SIGNAL_LABEL[k])}</span>`).join('') : '<span class="muted small">No risk signals yet</span>'}</p>
    <p class="small" style="margin:6px 0"><b>Handoff note:</b> ${esc(L.note || '(after the first reply)')}</p>
    <p class="small muted" style="margin:0">The model reads the words and extracts signals. <b>Code</b> decides the buttons: ${L.signals.relative_pressure ? 'someone close may be pressuring the member, so the trusted-contact button is hidden and a private conversation with Sound is offered first.' : red ? 'a red-flag signal is present, so "This looks fine, continue" is hidden.' : 'with no red flags, "continue" appears only after the member says they verified or decided on their own.'} The model can never release, cancel or hold a payment.</p></div>`;
}
/* ---------- collapsible panels + model log dashboards ---------- */
S.ui = { saw: true, log: true, raw: {} };
S.log = { rows: [], err: null };
function coll(k, title, body, badge) {
  const open = S.ui[k];
  return `<div class="card coll"><button type="button" class="coll-h" data-act="coll" data-k="${k}" aria-expanded="${open}"><span class="coll-t">${title}${badge || ''}</span>
    <svg class="chev ${open ? 'open' : ''}" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"></path></svg></button>${open ? `<div class="coll-b">${body}</div>` : ''}</div>`;
}
async function refreshLog() {
  const ch = S.chat; if (!ch || !ch.live) { S.log.rows = []; return; }
  try {
    const j = await (await fetch(API + '/api/traces?limit=300')).json();
    S.log.err = null;
    S.log.rows = j.traces.filter((t) => t.kind === 'chat' && Date.parse(t.ts) >= ch.startedAt - 1500).sort((a, b) => (a.ts < b.ts ? -1 : 1));
  } catch (e) { S.log.err = 'unreachable'; }
  if (S.tab === 'member') render();
}
const SIGNAL_ORDER = ['authority_pressure', 'secrecy_or_isolation', 'urgency', 'unverified_contact', 'unmet_online_contact', 'growing_amounts', 'unusual_method', 'relative_pressure', 'credential_shared', 'member_denies_changes', 'member_confirms_changes', 'member_verified', 'own_initiative', 'wants_person', 'member_distressed'];
function logBadge() {
  const n = S.log.rows.length;
  return n ? ` <span class="chip grey">${n} call${n > 1 ? 's' : ''}</span>` : '';
}
function barsSVG(vals, color, unit) {
  const w = 300, h = 54, max = Math.max(...vals, 1), bw = Math.min(40, (w - 6 * (vals.length - 1)) / vals.length);
  return `<svg viewBox="0 0 ${w} ${h + 16}" class="spark" role="img" aria-label="${unit} per turn: ${vals.join(', ')}">` + vals.map((v, i) => {
    const bh = Math.max(3, (v / max) * h), x = i * (bw + 6);
    return `<rect x="${x}" y="${h - bh}" width="${bw}" height="${bh}" rx="4" fill="${color}"></rect><text x="${x + bw / 2}" y="${h + 13}" text-anchor="middle" class="spark-t">${v}</text>`;
  }).join('') + '</svg>';
}
function logHTML() {
  const ch = S.chat;
  if (!S.live.avail) return '<p class="muted">Model logs need the local server. Run <code>task run</code>, open <b>localhost:8787</b>, and switch to Live AI.</p>';
  if (S.live.mode !== 'live') return '<p class="muted">The guided script makes no model calls, so there is nothing to log. Switch to <b>Live AI</b> in Demo controls and talk to Harbor. Each reply appears here with what the model understood and what the code did about it.</p>';
  if (!ch || !ch.live) return '<p class="muted">Press <b>Send payment</b> on the phone and open the chat. The model\'s reasoning for this conversation appears here.</p>';
  const rows = S.log.rows;
  if (S.log.err) return '<p class="muted">Could not reach the trace log. Is the server running?</p>';
  if (!rows.length) return '<p class="muted">No model calls yet. Send Harbor a message and its reasoning shows up here.</p>';
  const fin = (r) => (r.output && r.output.final) || {};
  const lat = rows.map((r) => r.latencyMs || 0), tin = rows.reduce((a, r) => a + ((r.usage || {}).prompt_tokens || 0), 0), tout = rows.reduce((a, r) => a + ((r.usage || {}).output_tokens || 0), 0);
  const tps = rows.map((r) => (r.usage || {}).tokens_per_sec).filter(Boolean), avgTps = tps.length ? (tps.reduce((a, b) => a + b, 0) / tps.length).toFixed(0) : '–';
  const seen = new Set(), redSeen = new Set();
  for (const r of rows) for (const s of fin(r).signals || []) { seen.add(s); if (RED.includes(s)) redSeen.add(s); }
  const level = redSeen.size === 0 ? 0 : redSeen.size === 1 ? 1 : 2, names = ['Calm', 'Elevated', 'High'], tone = ['green', 'warn', 'red'];
  const guards = rows.flatMap((r, i) => (r.guardrails || []).map((g) => ({ ...g, turn: i + 1 })));
  const sigRows = SIGNAL_ORDER.filter((s) => seen.has(s));
  const heat = sigRows.length ? `<div class="heat" style="--n:${rows.length}"><span></span>${rows.map((_, i) => `<span class="hh">turn ${i + 1}</span>`).join('')}` +
    sigRows.map((s) => `<span class="hl">${esc(SIGNAL_LABEL[s] || s)}</span>` + rows.map((r) => `<span class="hc ${(fin(r).signals || []).includes(s) ? 'on' : ''} ${RED.includes(s) ? 'red' : ''}" title="${esc(SIGNAL_LABEL[s] || s)}"></span>`).join('')).join('') + '</div>' : '<p class="muted small">The model has not flagged any risk signal yet.</p>';
  const turns = rows.map((r, i) => {
    const f = fin(r), you = ((r.input.messages || []).filter((m) => m.role === 'user').pop() || {}).content || '', model = (r.output || {}).model_reply, changed = model != null && model !== f.reply;
    const open = S.ui.raw[r.id];
    return `<div class="turn"><div class="turn-h"><b>Turn ${i + 1}</b><span class="chip grey">${r.latencyMs ?? '?'} ms</span><span class="chip ${f.member_state === 'calm' ? 'green' : 'warn'}">${esc(f.member_state || '?')}</span>${(r.guardrails || []).length ? `<span class="chip warn">${r.guardrails.length} guardrail${r.guardrails.length > 1 ? 's' : ''}</span>` : ''}</div>
      <div class="tq"><span>Member said</span>${esc(you)}</div>
      <div class="tq"><span>Model understood</span>${(f.signals || []).length ? f.signals.map((s) => `<span class="chip ${RED.includes(s) ? 'red' : 'grey'}">${esc(SIGNAL_LABEL[s] || s)}</span>`).join(' ') : '<span class="muted">no risk signals</span>'}</div>
      ${f.handoff_note ? `<div class="tq"><span>Note for the employee</span>${esc(f.handoff_note)}</div>` : ''}
      <div class="tq"><span>${changed ? 'Model first said' : 'Member saw'}</span>${changed ? `<s class="muted">${esc(model)}</s>` : esc(f.reply)}</div>
      ${changed ? `<div class="tq"><span>After guardrails</span><b>${esc(f.reply)}</b></div>` : ''}
      <button type="button" class="linkbtn" data-act="rawt" data-id="${r.id}">${open ? 'Hide' : 'Show'} raw model output</button>${open ? `<pre class="rawpre">${esc((r.output && r.output.raw) || '')}</pre>` : ''}</div>`;
  }).join('');
  const meter = [0, 1, 2].map((i) => `<span class="seg ${i <= level ? 'on ' + tone[level] : ''}"></span>`).join('');
  return `<p class="small muted" style="margin-top:0">This model has no hidden chain of thought. What it exposes, and what our code does with it, is below. All of it comes from the real calls for this conversation.</p>
    <div class="tiles dash"><div class="tile"><b>${rows.length}</b>model calls</div><div class="tile"><b>${Math.round(lat.reduce((a, b) => a + b, 0) / rows.length)} ms</b>avg response</div><div class="tile"><b>${tin.toLocaleString()} / ${tout}</b>tokens in / out</div><div class="tile"><b>${avgTps}</b>tokens per second</div></div>
    <div class="dash2"><div><h3>Risk read so far</h3><div class="meter" role="img" aria-label="Risk read ${names[level]}">${meter}</div><p class="small" style="margin:6px 0 0"><span class="chip ${tone[level]}">${names[level]}</span> ${redSeen.size ? `${redSeen.size} red-flag signal${redSeen.size > 1 ? 's' : ''}: ${[...redSeen].map((s) => esc(SIGNAL_LABEL[s] || s)).join(', ')}` : 'no red-flag signals'}</p>
      <p class="small muted" style="margin:6px 0 0">${redSeen.size ? 'Code response: "This looks fine, continue" is hidden and a person is offered first.' : 'Code response: "continue" only appears after the member says they verified or decided on their own.'}</p></div>
      <div><h3>Response time per turn (ms)</h3>${barsSVG(lat, 'var(--accent)', 'ms')}</div></div>
    <h3>When each signal appeared</h3>${heat}
    <h3>Guardrails that changed its output</h3>${guards.length ? guards.map((g) => `<div class="why"><b>Turn ${g.turn}: ${esc(g.type)}</b><br>${esc(g.detail || '')}${g.blocked ? `<br><s class="muted">${esc(g.blocked)}</s>` : ''}</div>`).join('') : '<p class="muted small">None so far. Every reply passed the checks unchanged.</p>'}
    <h3>Turn by turn</h3>${turns}
    <p class="small"><a class="navlink2" href="inspector.html#kind=chat" target="_blank" rel="noopener">Open the full inspector ↗</a></p>`;
}

function memberHTML() {
  const sc = SCENARIOS.find((s) => s.id === S.sc), dec = scenarioDecision(sc), m = mem[sc.mid], c = ctxOf(sc, dec);
  const list = SCENARIOS.map((s) => `<button class="scn" data-act="scn" data-id="${s.id}" aria-pressed="${s.id === S.sc}"><b>${s.name === s.mid ? s.mid : s.name + ' · ' + s.mid}</b><span class="chip ${s.tag.startsWith('Look') ? 'green' : 'red'}">${s.tag}</span><br><span>${s.blurb}</span></button>`).join('');
  const rules = dec.rules.length ? dec.rules.map((r) => `<div class="why"><b>${esc(r.label)}</b><br>${esc(r.reason)}</div>`).join('') : `<div class="why" style="border-color:var(--green);background:var(--green-soft)">${noFlagExplain(sc.mid, dec)}</div>`;
  const sup = dec.suppress.length ? dec.suppress.map((s) => `<div class="why" style="border-color:var(--green);background:var(--green-soft)"><b>Why this is probably you:</b> ${esc(s)}</div>`).join('') : '';
  const ph = phoneHTML();
  return `<div class="grid-member"><section aria-label="Scenarios"><h2>Pick a story</h2><p class="muted small">Anchor personas and legitimate look-alikes from the synthetic data.</p>${list}</section>
    <section aria-label="Member phone"><div class="phone">${ph.html}</div></section>
    <section aria-label="What Harbor saw">
      ${coll('saw', esc(sc.name) + ' · ' + esc(sc.tag), `<p class="muted small"><b>Ground truth, hidden from Harbor:</b> ${esc(m.summary)}<br>Outcome in the data: <b>${esc(m.outcome)}</b>${m.loss ? ' · net loss ' + money(m.loss) : ''}</p>
      <h3>What Harbor saw (event stream)</h3>${timelineHTML(sc.mid, dec, sc.id === 'michael' ? 14 : 9)}
      <h3>Harbor's decision at payment start ${levelChip(dec.level)}</h3>${rules}${sup}
      ${S.chat && S.chat.live ? understandingHTML(S.chat.live) : ''}
      <h3>Demo controls</h3>
      <div class="small" role="radiogroup" aria-label="Harbor agent mode"><label><input type="radio" name="mode" data-act="mode" value="scripted" ${S.live.mode === 'scripted' ? 'checked' : ''}> Guided script</label>
        &nbsp; <label><input type="radio" name="mode" data-act="mode" value="live" ${S.live.mode === 'live' ? 'checked' : ''} ${S.live.avail ? '' : 'disabled'}> Live AI ${S.live.avail ? '<span class="chip ' + (S.live.provider === 'mock' ? 'amber' : 'green') + '">' + esc(S.live.provider === 'mock' ? 'mock test double' : S.live.provider + ' · ' + S.live.model) + '</span>' : '<span class="muted">(run <code>node harbor/server.js</code> with an API key)</span>'}</label></div>
      <div class="actions">
        <button class="btn alt sm" data-act="reset">Restart</button>
        ${S.chat && !S.chat.outcome && S.phone.step === 'chat' ? '<button class="btn alt sm" data-act="timeout">Simulate no response (10 min)</button>' : ''}
        ${sc.id === 'closing' ? `<label class="small"><input type="checkbox" data-act="planned" ${S.planned ? 'checked' : ''}> Member declared a Planned Big Payment in advance</label>` : ''}
      </div>
      ${c.ato ? '<p class="small muted">Takeover path: Harbor texts the number on file <b>before</b> the change, never the attacker\'s session, and never asks for credentials or codes.</p>' : ''}`)}
      ${coll('log', 'Model log for this conversation', logHTML(), logBadge())}
    </section></div>`;
}

/* ---------- employee console ---------- */
const COACH = {
  ATO: ['Did you change your password, email or phone today?', 'Did you tap a link in a text or enter a code on a website?', 'Verify identity with details on file from before the change, not details given today.'],
  RAMP: ['How did you meet this person? Have you spoken on live video or met in person?', 'Has the amount they ask for been growing?', 'Have you been able to withdraw money from that platform?'],
  GENERAL: ['Who asked you to send this, and how did they contact you?', 'Has anyone told you to keep this secret or stay on the phone?', 'Can you reach the person directly on a number you already had?', 'What would happen if this waited until tomorrow?'],
};
function seedCases() {
  for (const sc of SCENARIOS) {
    const dec = scenarioDecision(sc);
    if (dec.level === 'hold' && !S.cases[sc.mid]) S.cases[sc.mid] = { mid: sc.mid, who: sc.name, tag: sc.tag, dec, status: 'Awaiting member response', answers: [], key: null, updated: 'Waiting', log: [`Harbor paused ${money(dec.amt)} ${railWord(dec.rail)}`, 'Check-in sent. Awaiting reply (timeout 10 min)'] };
  }
}
function consoleHTML() {
  seedCases();
  const ids = Object.keys(S.cases);
  if (!S.sel || !S.cases[S.sel]) S.sel = ids[0];
  const list = ids.map((id) => { const k = S.cases[id]; return `<button class="case" data-act="case" data-id="${id}" aria-pressed="${id === S.sel}"><b>${esc(k.who)} · ${money(k.dec.amt)} ${esc(k.dec.rail)}<span class="small muted">${esc(k.updated)}</span></b><span class="chip ${k.key && ['cancelled', 'release_light'].includes(k.key) ? 'green' : 'warn'}">${esc(k.status)}</span></button>`; }).join('');
  const k = S.cases[S.sel], isRamp = k.dec.rules.some((r) => r.id === 'RAMP'), isAto = k.dec.rules.some((r) => r.id === 'ATO');
  const coach = (isAto ? COACH.ATO : isRamp ? COACH.RAMP : COACH.GENERAL).map((q) => `<li>${esc(q)}</li>`).join('');
  const chat = k.answers.length ? k.answers.map((a) => `<li>${esc(a.a)}</li>`).join('') : '<li class="muted">No reply yet</li>';
  return `<div class="console"><section><h2>Held payments</h2><p class="muted small">Cases appear when Harbor pauses a payment. Finish a story in the Member app to see its case update here.</p>${list}</section>
    <section class="card"><h2>${esc(k.who)} · ${esc(k.tag)} <span class="chip grey">${esc(k.mid)}</span></h2>
      <p><b>${money(k.dec.amt)}</b> ${esc(railWord(k.dec.rail))} · ${esc(k.dec.rs === 'New' ? 'new recipient' : 'existing recipient')} · status: <b>${esc(k.status)}</b></p>
      <h3>Why Harbor paused</h3>${k.dec.rules.map((r) => `<div class="why"><b>${esc(r.label)}</b><br>${esc(r.reason)}</div>`).join('')}
      <h3>What the member told Harbor (so they don't repeat themselves)</h3><ul class="coach">${chat}</ul>
      ${k.live ? `<p>${(k.signals || []).map((x) => `<span class="chip ${RED.includes(x) ? 'red' : 'grey'}">${esc(SIGNAL_LABEL[x])}</span>`).join('') || '<span class="muted small">No risk signals</span>'}</p><p class="small"><b>AI handoff note:</b> ${esc(k.note || '-')}</p>` : ''}
      <h3>Event timeline</h3>${timelineHTML(k.mid, k.dec, 8)}
      <h3>Conversation coach: open questions, no blame</h3><ul class="coach">${coach}</ul>
      <p class="small muted">Say: "I'm checking because it's your money." Avoid: "suspicious", "you've been scammed".</p>
      <div class="actions">
        <button class="btn sm" data-act="cact" data-v="Employee called member on pre-change number">Call member (pre-change number)</button>
        <button class="btn alt sm" data-act="cact" data-v="Payment released by employee after verification">Release payment</button>
        <button class="btn alt sm" data-act="cact" data-v="Kept on hold by employee">Keep on hold</button>
        <button class="btn alt sm" data-act="cact" data-v="Offered trusted contact (member's choice)">Offer trusted contact</button>
        <button class="btn alt sm" data-act="cact" data-v="Escalated to fraud team; case created">Escalate to fraud team</button>
        <button class="btn danger sm" data-act="cact" data-v="Recovery started: wire recall / dispute checklist opened">Start recovery</button></div>
      <h3>Case log</h3><div class="log">${k.log.map((l) => '• ' + esc(l)).join('<br>')}</div></section></div>`;
}

/* ---------- simulator ---------- */
function plannedAll() {
  const out = {};
  for (const m of D.members) if (/Home purchase|Vehicle purchase/.test(m.subtype)) {
    const p = D.events[m.id].filter((e) => e.type === 'Payment Initiated' && (e.rail === 'Wire' || e.rail === 'Cash')).sort((a, b) => b.amt - a.amt)[0];
    if (p) out[m.id] = [{ rail: p.rail, amount: p.amt, label: m.subtype + ' (declared in advance)' }];
  }
  return out;
}
function simData() {
  const cfg = Object.assign({}, S.sim.cfg, S.sim.plannedAll ? { plannedByMember: plannedAll() } : {});
  return E.scoreAll(D, cfg);
}
const SLIDERS = [['highStakesRatio', 'Wire/cash: x baseline', 1, 6, 0.5], ['freshRecipientRatio', 'New-person P2P: x baseline', 1, 4, 0.5], ['atoWindowMin', 'ATO window (min)', 15, 240, 15], ['realMoverGapHours', 'Real-mover gap (hours)', 1, 48, 1], ['rampMinPriorP2P', 'Ramp: prior P2P count', 1, 5, 1]];
function simHTML() {
  const rows = simData(), scams = rows.filter((r) => r.isScam), legit = rows.filter((r) => !r.isScam);
  const caught = scams.filter((r) => r.caught).length, held = legit.filter((r) => r.hold), light = legit.filter((r) => r.confirm);
  const reach = scams.reduce((a, r) => a + r.prevented, 0), before = scams.reduce((a, r) => a + r.sentBeforeFlag, 0);
  const f = S.sim.filter;
  const shown = rows.filter((r) => f === 'all' || (f === 'scam' && r.isScam) || (f === 'legit' && !r.isScam) || (f === 'look' && r.lookalike) || (f === 'missed' && r.isScam && !r.caught) || (f === 'fp' && r.hold));
  const tr = shown.map((r) => { const m = mem[r.id], res = r.isScam ? (r.caught ? '<span class="chip green">Paused</span>' : '<span class="chip red">Missed</span>') : r.hold ? '<span class="chip red">Held (false positive)</span>' : r.confirm ? '<span class="chip amber">Light check</span>' : '<span class="chip green">No friction</span>';
    return `<tr data-act="sim" data-id="${r.id}" aria-selected="${r.id === S.sim.selId}"><td>${r.id}</td><td>${esc(m.persona || m.subtype || 'Routine')}</td><td>${r.isScam ? esc(m.scenario.split(' ')[0]) : r.lookalike ? 'Look-alike' : 'Routine'}</td><td>${res}</td></tr>`; }).join('');
  const sl = SLIDERS.map(([k, l, mn, mx, st]) => `<label class="ctl"><span>${l}</span><input type="range" data-act="slider" data-k="${k}" min="${mn}" max="${mx}" step="${st}" value="${S.sim.cfg[k]}"><b>${S.sim.cfg[k]}</b></label>`).join('');
  let detail = '<p class="muted">Select a member to replay their events and see where Harbor acts.</p>';
  if (S.sim.selId) {
    const r = rows.find((x) => x.id === S.sim.selId), m = mem[r.id];
    const evs = D.events[r.id].filter((e) => KEY.includes(e.type) && !(e.type === 'Payment Initiated' && e.dir !== 'Outgoing'));
    const dmap = Object.fromEntries(E.evaluate(D.events[r.id], Object.assign({}, S.sim.cfg, S.sim.plannedAll ? { planned: (plannedAll()[r.id]) } : {})).map((d) => [d.eventId, d]));
    detail = `<p><b>${r.id}</b> ${esc(m.persona || '')} · ${esc(m.scenario)} · ${esc(m.subtype || 'routine')}<br><span class="muted small">${esc(m.summary)}</span></p><ul class="tl">${evs.slice(-40).map((e) => { const d = dmap[e.id]; const cls = d && d.level === 'hold' ? 'trigger' : d && d.level === 'confirm' ? 'hit' : '';
      return `<li class="${cls}"><time>${fmt(e.t)}</time><span>${esc(evLabel(e))}${d && d.rules.length ? ' ← ' + d.rules.map((x) => x.id).join('+') + ' → <b>' + (d.level === 'hold' ? 'pause' : 'light check') + '</b>' : ''}${d && d.suppress.length ? ' (suppressed: ' + esc(d.suppress[0]) + ')' : ''}</span></li>`; }).join('')}</ul>`;
  }
  return `<div class="banner"><b>Read this honestly.</b> This is the <b>same synthetic data the rules were tuned on</b> (in-sample), so a high catch rate proves the logic works on these stories, not that it works on real members. "Flagged" means Harbor paused the payment; members can still override after a human conversation. Do not read dollars here as real fraud rates. The 90-day pilot starts in shadow mode to measure real precision.</div>
    <div class="tiles">
      <div class="tile"><b>${caught}/${scams.length}</b>scam &amp; takeover members paused before a scam payment</div>
      <div class="tile"><b>${scams.length - caught}</b>missed</div>
      <div class="tile"><b>${held.length}/${legit.length}</b>legitimate members held (${held.filter((r) => r.lookalike).length} look-alikes)</div>
      <div class="tile"><b>${light.length}</b>legitimate members light-check only</div>
      <div class="tile"><b>${money(reach)}</b>scam payments started at/after first pause <span class="small muted">(a pause can interrupt)</span></div>
      <div class="tile"><b>${money(before)}</b>scam payments before the first pause (not protected)</div></div>
    <div class="sim"><section class="card"><h2>Tune the trigger</h2>${sl}
      <label class="small"><input type="checkbox" data-act="plannedAll" ${S.sim.plannedAll ? 'checked' : ''}> Members use "Planned Big Payment" for home and vehicle purchases</label>
      <h3>Members</h3><div class="actions"><select data-act="filter" aria-label="Filter members">${[['all', 'All 118'], ['scam', 'Scam / takeover (48)'], ['legit', 'Legitimate (70)'], ['look', 'Look-alikes (20)'], ['missed', 'Missed'], ['fp', 'False-positive holds']].map(([v, l]) => `<option value="${v}" ${f === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="tablewrap"><table><thead><tr><th>ID</th><th>Who</th><th>Type</th><th>Harbor</th></tr></thead><tbody>${tr}</tbody></table></div></section>
      <section class="card"><h2>Replay</h2>${detail}</section></div>`;
}

/* ---------- trigger chart ---------- */
function svgBox(x, y, w, h, cls, title, lines) {
  return `<g><rect class="dg-box ${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="12"/><text class="dg-t" x="${x + 14}" y="${y + 26}">${esc(title)}</text>` +
    lines.map((l, i) => `<text class="dg-s" x="${x + 14}" y="${y + 50 + i * 19}">${esc(l)}</text>`).join('') + '</g>';
}
function arrow(d) { return `<path class="dg-arrow" d="${d}" marker-end="url(#ah)"/>`; }
function pipelineSVG() {
  const c = S.sim.cfg;
  const rules = [
    ['ATO', `reset ≤${c.atoWindowMin} min ago + email AND phone changed + new recipient`, 'PAUSE', 'red'],
    ['RAMP', `≥${c.rampMinPriorP2P} P2P to new people, then wire/transfer to a new recipient`, 'PAUSE', 'red'],
    ['HIGHSTAKES', `wire or cash ≥${c.highStakesRatio}× usual amount, new recipient (or cash)`, 'PAUSE', 'red'],
    ['CONTACT', 'branch visit / call ≤90 min before a large non-P2P payment', 'PAUSE', 'red'],
    ['FRESH', `P2P to a new person ≥${c.freshRecipientRatio}× usual amount`, 'LIGHT CHECK', 'amber'],
  ];
  const rows = rules.map((r, i) => `<text class="dg-t" x="40" y="${272 + i * 26}">${r[0]}</text><text class="dg-s" x="140" y="${272 + i * 26}">${esc(r[1])}</text><text class="dg-t ${r[3]}" x="572" y="${272 + i * 26}">${r[2]}</text>`).join('');
  return `<svg viewBox="0 0 1180 580" role="img" aria-label="How a Harbor trigger fires: event stream, member state, arm, decide, rule bank, look-alike check, level, check-in, human" class="dg">
  <defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L10 5L0 10z" class="dg-head"/></marker></defs>
  ${svgBox(20, 30, 210, 140, '', '1  Event stream', ['Login · password reset', 'Email / phone / address change', 'Recipient added', 'Payment initiated', 'Branch visit · call center'])}
  ${arrow('M230 100H262')}
  ${svgBox(262, 30, 220, 140, '', '2  Member state (rolling)', ['last password reset', 'email / phone changed?', 'age of each recipient', 'payments to new people', 'last contact with Sound'])}
  ${arrow('M482 100H514')}
  ${svgBox(514, 30, 250, 140, 'dg-arm', '3  ARM  (silent)', ['reset + email or phone change', 'within 24 hours', '→ account marked "elevated"', 'nothing shown to the member'])}
  ${arrow('M764 100H796')}
  ${svgBox(796, 30, 364, 140, 'dg-decide', '4  DECIDE  (the trigger moment)', ['Runs only when an OUTGOING payment starts', '(event: Payment Initiated).', 'The payment is still Pending: that is our', 'window to act (1 to 14 minutes in the data).'])}
  ${arrow('M978 170V196H355V218')}
  <g><rect class="dg-box" x="20" y="218" width="670" height="168" rx="12"/><text class="dg-t" x="34" y="244">Rule bank: a trigger = at least one rule matches</text>${rows}</g>
  <g><rect class="dg-box" x="710" y="218" width="450" height="168" rx="12"/><text class="dg-t" x="724" y="244">What does NOT start a trigger</text>
    ${['Logins, deposits, card purchases, ATM withdrawals', 'Bill pay or auto-pay to existing payees', 'Usual-size payments to existing recipients', 'A password reset or an address change on its own', 'Any single signal. A trigger needs a rule to match.'].map((l, i) => `<text class="dg-s" x="724" y="${272 + i * 22}">• ${esc(l)}</text>`).join('')}</g>
  ${arrow('M165 386V430')}
  ${svgBox(20, 430, 290, 126, 'dg-ok', '5  Look-alike check', ['address-only change, long gap = real move', 'Planned Big Payment declared in advance', '→ lowers PAUSE to LIGHT CHECK', '(a takeover pattern is never suppressed)'])}
  ${arrow('M310 493H342')}
  ${svgBox(342, 430, 260, 126, '', '6  Level', ['none → payment goes through', 'light check → 1-2 questions', 'pause & ask → held, Harbor reaches', 'the member'])}
  ${arrow('M602 493H634')}
  ${svgBox(634, 430, 270, 126, 'dg-teal', '7  Harbor check-in', ['out-of-band: pre-change phone for', 'takeover, authenticated app otherwise.', 'Chat gathers context, member decides'])}
  ${arrow('M904 493H936')}
  ${svgBox(936, 430, 224, 126, 'dg-teal', '8  Human, if needed', ['member asks, unclear, or no reply', 'in 10 min → employee outreach', 'with the chat summary'])}
  </svg>`;
}
function ruleTable() {
  const c = S.sim.cfg;
  const R = [
    ['ATO', 'Takeover pattern', 'password_reset_recent, email/phone change events, recipient_status, time since reset', `reset ≤ ${c.atoWindowMin} min before payment; email AND phone changed; recipient new`, 'Pause', 'Sarah M1003', 'Address-only change with a gap over ' + c.realMoverGapHours + ' h (M1039, M1041)'],
    ['RAMP', 'Slow-burn escalation', 'payment_rail, recipient_status, recipient_age_days, history of P2P to new people', `≥ ${c.rampMinPriorP2P} earlier P2P to new/young recipients, then wire or external transfer to a new recipient`, 'Pause', 'Michael M1002', 'Member\'s own new brokerage account (not flagged: no P2P ramp)'],
    ['HIGHSTAKES', 'Large payment, hard to reverse', 'payment_rail, amount_to_baseline_ratio, recipient_status', `wire or cash; new recipient (or cash); ≥ ${c.highStakesRatio}× usual amount`, 'Pause', 'Linda M1001, James M1004', 'Planned Big Payment (M1057 closing wire)'],
    ['CONTACT', 'Pay right after contacting Sound', 'Branch Visit / Contact Center Call events, amount_to_baseline_ratio, rail', 'visit or call ≤ 90 min before a large non-P2P payment', 'Pause', 'James M1004', 'Planned Big Payment'],
    ['FRESH', 'Bigger-than-usual payment to a new person', 'payment_rail = P2P, recipient_status, amount_to_baseline_ratio', `P2P, new recipient, ≥ ${c.freshRecipientRatio}× usual amount`, 'Light check', 'Contractor M1049', 'n/a (already light)'],
  ];
  return `<div class="tablewrap"><table><thead><tr><th>Rule</th><th>Signals (data fields)</th><th>Condition (live thresholds)</th><th>Level</th><th>Catches</th><th>Lowered when</th></tr></thead><tbody>` +
    R.map((r) => `<tr><td><b>${r[0]}</b><br><span class="small muted">${r[1]}</span></td><td class="small">${r[2]}</td><td>${r[3]}</td><td><span class="chip ${r[4] === 'Pause' ? 'red' : 'amber'}">${r[4]}</span></td><td class="small">${r[5]}</td><td class="small">${r[6]}</td></tr>`).join('') + '</tbody></table></div>';
}
function swimlaneSVG(sc, dec) {
  const MIN = 60000, mid = sc.mid, evs = D.events[mid];
  const ruleIds = dec.rules.map((r) => r.id);
  const keyEv = keyEvents(mid, dec.t, 14);
  let start;
  if (dec.armed && dec.resetAt) start = dec.resetAt - 5 * MIN;
  else if (ruleIds.includes('CONTACT')) start = dec.t - 3 * 3600000;
  else if (ruleIds.includes('RAMP')) start = keyEv[0].t;
  else if (dec.resetAt) start = dec.resetAt - 30 * MIN;
  else start = keyEv[0].t;
  const span = dec.t - start, end = dec.t + Math.max(span * 0.06, 2 * MIN);
  const X0 = 170, X1 = 1100, x = (t) => X0 + ((t - start) / (end - start)) * (X1 - X0);
  const lanes = ['Password reset', 'Email / phone change', 'Address change', 'Recipient added', 'Contact with Sound', 'Payment started'];
  const laneOf = (e) => ({ 'Password Reset': 0, 'Email Change': 1, 'Phone Change': 1, 'Address Change': 2, 'Recipient Added': 3, 'Branch Visit': 4, 'Contact Center Call': 4, 'Payment Initiated': 5 }[e.type]);
  const Y = (i) => 50 + i * 46;
  const shown = evs.filter((e) => e.t >= start && e.t <= dec.t && laneOf(e) !== undefined && !(e.type === 'Payment Initiated' && e.dir !== 'Outgoing'));
  const grid = lanes.map((l, i) => `<line class="dg-grid" x1="${X0 - 10}" x2="${X1 + 20}" y1="${Y(i)}" y2="${Y(i)}"/><text class="dg-s" x="10" y="${Y(i) + 4}">${l}</text>`).join('');
  const ticks = [0, 1, 2, 3, 4, 5].map((k) => { const t = start + (k / 5) * (end - start); return `<text class="dg-s" x="${x(t)}" y="${Y(5) + 70}" text-anchor="middle">${fmt(t)}</text>`; }).join('');
  const dots = shown.map((e) => { const last = e.id === dec.eventId, lane = laneOf(e);
    const lbl = e.type === 'Email Change' ? 'email' : e.type === 'Phone Change' ? 'phone' : e.type === 'Payment Initiated' ? money(e.amt) : e.type === 'Branch Visit' ? 'branch' : e.type === 'Contact Center Call' ? 'call' : '';
    return `<circle class="dg-dot ${last ? 'last' : lane === 5 ? 'pay' : ''}" cx="${x(e.t)}" cy="${Y(lane)}" r="${last ? 9 : 7}"><title>${esc(evLabel(e))} · ${fmt(e.t)}</title></circle>${lbl ? `<text class="dg-s dg-lbl" x="${x(e.t)}" y="${Y(lane) - 13}" text-anchor="middle">${esc(lbl)}</text>` : ''}`; }).join('');
  const arm = dec.armedAt && dec.armedAt >= start && dec.armedAt <= dec.t ? `<line class="dg-arm-line" x1="${x(dec.armedAt)}" x2="${x(dec.armedAt)}" y1="26" y2="${Y(5) + 22}"/><text class="dg-t amber" x="${x(dec.armedAt)}" y="20" text-anchor="middle">ARM</text>` : '';
  const brk = dec.armed && dec.resetAt ? `<path class="dg-brk" d="M${x(dec.resetAt)} ${Y(5) + 30}V${Y(5) + 38}H${x(dec.t)}V${Y(5) + 30}"/><text class="dg-t" x="${(x(dec.resetAt) + x(dec.t)) / 2}" y="${Y(5) + 54}" text-anchor="middle" font-size="12.5">${Math.round((dec.t - dec.resetAt) / MIN)} min from reset to payment</text>` : '';
  return `<svg viewBox="0 0 1180 ${Y(5) + 84}" class="dg" role="img" aria-label="Timeline of events for ${esc(sc.name)} leading to the decide moment">${grid}${arm}<line class="dg-decide-line" x1="${x(dec.t)}" x2="${x(dec.t)}" y1="26" y2="${Y(5) + 22}"/><text class="dg-t red" x="${x(dec.t)}" y="20" text-anchor="middle">DECIDE</text>${dots}${brk}${ticks}</svg>`;
}
function checksHTML(dec) {
  return dec.trace.map((r) => `<div class="card" style="box-shadow:none;margin-bottom:8px;border-color:${r.fired ? 'var(--red)' : 'var(--line)'}"><b>${r.id}</b> ${r.fired ? '<span class="chip red">FIRED</span>' : '<span class="chip grey">did not fire</span>'}
    <ul class="checks">${r.checks.map((k) => `<li class="${k.pass ? 'ok' : 'no'}"><span aria-hidden="true">${k.pass ? '✔' : '✖'}</span> ${esc(k.label)} <span class="muted">· ${esc(String(k.value))}</span></li>`).join('')}</ul></div>`).join('');
}
function triggerHTML() {
  const sc = SCENARIOS.find((s) => s.id === S.trig.id) || SCENARIOS[0], dec = scenarioDecision(sc);
  const opts = SCENARIOS.map((s) => `<option value="${s.id}" ${s.id === sc.id ? 'selected' : ''}>${esc(s.name)} · ${esc(s.tag)}</option>`).join('');
  const sup = dec.suppress.length ? dec.suppress.map((x) => `<div class="why" style="border-color:var(--green);background:var(--green-soft)"><b>Look-alike check lowered it:</b> ${esc(x)}</div>`).join('') : '';
  return `<div class="card"><h2>How a trigger starts</h2>
    <p class="muted">A trigger is not a score and not a single signal. Events build up a silent picture of the account (<b>Arm</b>), and the moment an outgoing payment starts (<b>Decide</b>) one or more named rules either match or don't. A match gives a level; the level decides how much friction the member sees.</p>
    ${pipelineSVG()}</div>
  <div class="card" style="margin-top:16px"><h2>What defines each trigger</h2><p class="muted small">Thresholds update live from the Simulator sliders. All inputs are fields in the challenge data dictionary.</p>${ruleTable()}</div>
  <div class="card" style="margin-top:16px"><h2>Watch a trigger form</h2>
    <p class="muted small">Pick a story. Dots are the real events from the synthetic data; the red line is the moment Harbor decides.</p>
    <label class="small">Story <select data-act="trigmember">${opts}</select></label> ${levelChip(dec.level)}
    ${swimlaneSVG(sc, dec)}
    <h3>The checks run at the Decide moment</h3>${checksHTML(dec)}${sup}
    <p class="small muted">${dec.level === 'none' ? noFlagExplain(sc.mid, dec) : ''}</p></div>`;
}

/* ---------- architecture + live pipeline ---------- */
function archSVG() {
  const T = (x, y, s, cls = 'dg-s', anchor = 'start') => `<text class="${cls}" x="${x}" y="${y}" text-anchor="${anchor}">${esc(s)}</text>`;
  const box = (x, y, w, h, cls, title, lines, badge) => `<g><rect class="dg-box ${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="12"/>${T(x + 12, y + 24, title, 'dg-t')}` +
    lines.map((l, i) => T(x + 12, y + 46 + i * 18, l)).join('') + (badge ? `<rect x="${x + w - 62}" y="${y + 8}" width="50" height="20" rx="10" class="dg-badge ${badge === 'no LLM' ? 'no' : ''}"/>${T(x + w - 37, y + 22, badge, 'dg-badge-t', 'middle')}` : '') + '</g>';
  const topic = (x, y, w, h, name, sub) => `<g><rect class="dg-box dg-topic" x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2 > 22 ? 12 : h / 2}"/>${T(x + w / 2, y + 22, name, 'dg-t', 'middle')}${sub ? T(x + w / 2, y + 40, sub, 'dg-s', 'middle') : ''}</g>`;
  const a = (d, dash) => `<path class="dg-arrow${dash ? ' dash' : ''}" d="${d}" marker-end="url(#ah2)"/>`;
  return `<svg viewBox="0 0 1440 720" class="dg" role="img" aria-label="Harbor architecture: events flow through Kafka to a rules scorer and an LLM tagger, alerts go to a notification agent that messages the member, and a retro job re-enters findings">
  <defs><marker id="ah2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L10 5L0 10z" class="dg-head"/></marker></defs>
  ${box(20, 40, 170, 120, '', 'Event sources', ['core banking · mobile', 'online · branch · call', 'center. Demo: CSV', 'replayer'])}
  ${a('M190 95H230')}
  ${topic(230, 55, 160, 80, 'events.raw', 'key = member_id')}${T(310, 152, '6 partitions, ordered per member', 'dg-s', 'middle')}
  ${a('M390 95H430')}
  ${box(430, 40, 230, 120, 'dg-decide', 'Scorer  (fast path)', ['rules engine, per-member state', 'Arm then Decide at payment start', 'deterministic, explainable', 'p50 about 1 ms per event'], 'no LLM')}
  ${a('M660 112H690V198H710')}${T(700, 106, 'every event', 'dg-s')}
  ${a('M660 62H1000')}${T(830, 54, 'alerts (outbox pattern)', 'dg-s', 'middle')}
  ${a('M545 160V190')}
  ${topic(430, 190, 230, 56, 'events.scored', 'key events only')}
  ${a('M545 246V296')}
  ${box(430, 296, 230, 130, 'dg-teal', 'Tagger  (slow path)', ['LLM tags + analyst note', 'advisory only. Never messages', 'a member. Rules quiet + model', 'says high: human review queue'], 'LLM')}
  ${a('M660 360H710')}${T(685, 352, 'notes', 'dg-s', 'middle')}
  <g><rect class="dg-box" x="710" y="170" width="250" height="290" rx="12"/>${T(724, 196, 'Postgres', 'dg-t')}${T(724, 216, 'the full history, alerted or not')}
    ${['events  (idempotent on event_id)', 'decisions  (level, rules, latency)', 'member_state  (survives restarts)', 'alerts  (outbox)', 'event_notes  (LLM tags + notes)', 'review_queue  (gray zone)', 'cases · messages · case_alerts', 'retro_findings  (deduped)'].map((l, i) => T(724, 246 + i * 24, '• ' + l)).join('')}</g>
  ${topic(1000, 40, 34, 130, '', '')}${T(1017, 112, 'alerts.risk', 'dg-s', 'middle').replace('<text', '<text transform="rotate(-90 1017 112)"')}
  ${a('M1034 100H1080')}
  ${box(1080, 40, 300, 230, 'dg-teal', 'Agent service', ['consumes alerts.risk', 'merges alerts into ONE open case', 'rate limit (not for takeover)', 'picks channel: takeover goes to the', 'phone on file BEFORE the change', 'writes a personalized message (LLM)', 'conversation API + guardrails', 'no reply in 10 min: escalate'], 'LLM')}
  ${a('M1080 232H960', true)}${T(1020, 224, 'reads / writes', 'dg-s', 'middle')}
  ${a('M1230 270V300')}
  ${topic(1130, 300, 200, 50, 'notifications.out', '')}
  ${a('M1230 350V380')}
  ${box(1130, 380, 200, 70, '', 'Delivery adapter', ['SMS / push (swap here)'])}
  ${a('M1230 450V480')}
  ${box(1130, 480, 200, 70, 'dg-ok', 'Member', ['replies via chat API'])}
  ${a('M1130 515H1060V245H1080', true)}
  ${a('M1380 150H1410V620H1380')}${T(1425, 400, 'escalate', 'dg-s', 'middle').replace('<text', '<text transform="rotate(90 1425 400)"')}
  ${box(1080, 580, 300, 110, 'dg-ok', 'Employee console', ['held payments, case timeline, handoff', 'summary, AI notes, review queue,', 'coach questions'])}
  ${box(430, 500, 230, 130, 'dg-arm', 'Retro job  (cron, 24 h)', ['SQL detectors over the full', 'history: long windows, cumulative', 'amounts, silent cases. LLM writes', 'the insight sentence'], 'LLM')}
  ${a('M660 540H710V460')}${T(722, 500, 'reads history', 'dg-s')}
  ${a('M660 600H985V190H1017V170')}${T(800, 592, 'findings re-enter alerts.risk', 'dg-s', 'middle')}
  ${topic(230, 300, 160, 56, 'events.dlq', 'failed after 3 tries')}
  ${a('M310 300V155', true)}
  <g><rect class="dg-box" x="20" y="480" width="370" height="210" rx="12"/>${T(34, 506, 'Design rules', 'dg-t')}
    ${['An alert never waits on an LLM.', 'Key = member_id: one member, one ordered', '   partition, so stateful rules stay correct.', 'At-least-once delivery + idempotent keys', '   (event_id, alert_id): replays are safe.', 'LLMs are advisory. They write notes and', '   messages; rules and code decide actions.', 'Every failure lands in the DLQ with a redrive.'].map((l, i) => T(34, 532 + i * 20, l)).join('')}</g>
  </svg>`;
}
const BACKEND = 'http://localhost:8790';
S.pipe = { data: null, cases: [], sel: null, detail: null, err: null, draft: '', busy: false, timer: null };
async function pipeFetch() {
  try {
    const [d, c] = await Promise.all([fetch(BACKEND + '/api/pipeline').then((r) => r.json()), fetch(BACKEND + '/api/cases').then((r) => r.json())]);
    S.pipe.data = d; S.pipe.cases = c; S.pipe.err = null;
    if (!S.pipe.sel && c[0]) S.pipe.sel = c[0].case_id;
    if (S.pipe.sel) S.pipe.detail = await fetch(BACKEND + '/api/cases/' + S.pipe.sel).then((r) => r.json());
    S.pipe.snapshot = false;
  } catch (e) {
    const snap = window.HARBOR_SNAPSHOT;                 // hosted copy: show the recorded run of the real pipeline, read-only
    if (snap) {
      S.pipe.data = snap.pipeline; S.pipe.cases = snap.cases; S.pipe.err = null; S.pipe.snapshot = snap.recordedAt;
      if (!S.pipe.sel || !snap.details[S.pipe.sel]) S.pipe.sel = snap.cases[0] && snap.cases[0].case_id;
      S.pipe.detail = snap.details[S.pipe.sel] || null;
    } else S.pipe.err = 'Backend not reachable';
  }
  if (S.tab === 'pipe' && !S.pipe.busy && !(document.activeElement && document.activeElement.id === 'pipedraft')) render();
}
function pipeStart() {
  if (S.pipe.snapshot) { pipeFetch(); return; } if (!S.pipe.timer) S.pipe.timer = setInterval(() => { if (S.tab === 'pipe') pipeFetch(); }, 3000); pipeFetch(); }
async function pipeReply() {
  const ta = $('#pipedraft'); const text = (ta && ta.value || '').trim(); if (!text || !S.pipe.sel) return;
  S.pipe.busy = true; S.pipe.draft = ''; ta.value = ''; ta.disabled = true;
  try { await fetch(`${BACKEND}/api/cases/${S.pipe.sel}/reply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) }); } catch (e) { /* shown by next poll */ }
  S.pipe.busy = false; await pipeFetch(); render();
}
function pipeHTML() {
  const P = S.pipe, d = P.data;
  if (P.err || !d) return `<div class="card"><h2>Live pipeline</h2><p class="muted">${P.err ? 'The backend is not reachable at ' + BACKEND + '.' : 'Connecting…'}</p>
    <p class="small">Start it with:</p><pre class="code">cd backend && npm run up && npm run seed && ./scripts/start-all.sh
node services/replayer.js --members M1003,M1001,M1039,M1057 --rate 60</pre></div>`;
  const sum = (rows, f) => rows.filter(f).reduce((a, r) => a + r.n, 0), lvl = (l) => (d.decisions.find((x) => x.level === l) || { n: 0 }).n;
  const cs = (s) => (d.cases.find((x) => x.status === s) || { n: 0 }).n, risk = (r) => sum(d.notes, (x) => x.risk === r);
  const tile = (b, l) => `<div class="tile"><b>${b}</b>${l}</div>`;
  const list = P.cases.map((c) => `<button class="case" data-act="pcase" data-id="${c.case_id}" aria-pressed="${c.case_id === P.sel}"><b>${esc(c.member_id)} <span class="small muted">${esc(c.case_id)}</span></b><span class="chip ${c.status === 'resolved' ? 'green' : 'warn'}">${esc(c.status.replace('_', ' '))}</span> <span class="chip grey">${c.channel === 'sms_pre_change_phone' ? 'SMS to pre-change phone' : 'app push'}</span></button>`).join('') || '<p class="muted small">No cases yet. Replay some events.</p>';
  const D2 = P.detail, det = D2 && D2.case ? `<h2>${esc(D2.case.member_id)} · ${esc(D2.case.status.replace('_', ' '))}</h2>
    <p>${Object.keys(D2.case.signals || {}).filter((k) => D2.case.signals[k]).map((k) => `<span class="chip ${RED.includes(k) ? 'red' : 'grey'}">${esc(SIGNAL_LABEL[k] || k)}</span>`).join('') || '<span class="muted small">No signals yet</span>'}</p>
    ${D2.case.handoff_note ? `<p class="small"><b>AI handoff note:</b> ${esc(D2.case.handoff_note)}</p>` : ''}
    <h3>Alerts in this case</h3>${D2.alerts.map((a) => `<div class="why"><b>${esc(a.source)} · ${esc(a.kind)} · ${esc(a.level)}</b>${a.note ? `<br><span class="small">AI note (${esc(a.risk)}): ${esc(a.note)}</span>` : ''}</div>`).join('')}
    <h3>Conversation</h3><div class="convo">${D2.messages.map((m) => `<div class="msg ${m.direction === 'in' ? 'me' : m.direction === 'system' ? 'sys' : 'bot'}" style="animation:none">${esc(m.body)}<div class="small" style="opacity:.7">${m.direction === 'out' ? esc(m.source) + (m.delivered_at ? ' · delivered' : '') : ''}</div></div>`).join('')}</div>
    ${P.snapshot ? '<p class="small muted">Replies are disabled in the recorded view.</p>' : ['resolved', 'escalated_human'].includes(D2.case.status) ? `<p class="small muted">Case closed${D2.case.outcome ? ': ' + esc(D2.case.outcome) : ''}.</p>` : `<div class="livebox"><textarea id="pipedraft" rows="2" maxlength="600" placeholder="Reply as the member…" aria-label="Reply as the member">${esc(P.draft)}</textarea><button class="btn sm" data-act="preply">Send</button></div>
      <div class="actions"><button class="btn alt sm" data-act="presolve" data-v="human">Hand to a person</button><button class="btn alt sm" data-act="presolve" data-v="cancelled">Member cancelled payment</button><button class="btn alt sm" data-act="presolve" data-v="confirmed_intended">Member confirmed it's theirs</button></div>`}` : '<p class="muted">Select a case.</p>';
  const rows = d.recentAlerts.map((a) => `<tr><td>${esc(a.member_id)}</td><td>${esc(a.source)}</td><td>${esc(a.kind)}</td><td><span class="chip ${a.level === 'hold' ? 'red' : 'amber'}">${esc(a.level)}</span></td><td class="small">${a.risk ? esc(a.risk) + ': ' + esc(a.note) : '<span class="muted">tagging…</span>'}</td></tr>`).join('');
  const banner = P.snapshot ? `Recorded run of the real Kafka + Postgres pipeline (${new Date(P.snapshot).toLocaleString()}). Read-only here: run the backend locally for live replies. Synthetic data only.` : 'Live view of the Kafka + Postgres pipeline (refreshes every 3 s). Events come from the replayer; everything below is produced by the running services. Synthetic data only.';
  return `<div class="banner">${banner}</div>
  <div class="tiles">${tile(d.events.toLocaleString(), 'events scored')}${tile(`${lvl('none')} / ${lvl('confirm')} / ${lvl('hold')}`, 'payment decisions: none / light / pause')}${tile(d.latency.p50 + ' ms', `median decision time (max ${d.latency.max})`)}
    ${tile(cs('awaiting_member') + cs('in_conversation') + ' open', `cases (${cs('escalated_human')} escalated to a human, ${cs('resolved')} resolved)`)}${tile(`${risk('low')} / ${risk('medium')} / ${risk('high')}`, 'AI tags: low / medium / high')}${tile(d.review_open, 'in human review queue (gray zone)')}${tile(d.retro.reduce((a, r) => a + r.n, 0), 'retro findings')}</div>
  <div class="sim"><section class="card"><h2>Cases</h2>${list}<h3>Recent alerts with AI notes</h3><div class="tablewrap"><table><thead><tr><th>Member</th><th>Source</th><th>Rule</th><th>Level</th><th>AI note</th></tr></thead><tbody>${rows}</tbody></table></div></section>
  <section class="card">${det}</section></div>`;
}
function archHTML() {
  return `<div class="card"><h2>System architecture</h2><p class="muted">Two paths from the same event stream. The <b>fast path</b> decides alerts with deterministic rules in about a millisecond. The <b>slow path</b> uses an LLM to add tags and notes, and can only queue a human review. Alerts reach a notification agent that owns the conversation. A retro cron re-enters findings through the same topic.</p>${archSVG()}</div>`;
}

/* ---------- notes ---------- */
function notesHTML() {
  return `<div class="notes">
  <div class="card"><h2>Trigger: event-based, two stages</h2><p><b>Arm</b>: password reset, then email/phone change, then recipient added silently marks the account elevated. <b>Decide</b>: at <i>Payment Initiated</i>, rules look at account state, rail, recipient age and the member's baseline. Hold, then Harbor reaches the member. Payments sit in <i>Pending</i> for 1-14 minutes in the data, which is the window.</p>
  <p class="muted small">Uses only fields in the challenge data. No device, voice, carrier or message-content data. Harbor never claims certainty that something is fraud.</p></div>
  <div class="card"><h2>Wrong-flag path (legitimate member)</h2><p>Every pause explains itself ("Why this is probably you" / "What I noticed"). The member answers plain questions and can reach a person at any time. Look-alike suppression: address-only change with a long gap, Planned Big Payment, own-account transfers. A held look-alike gets a callback with a target under 30 minutes; the data's baseline is 3-4 hours.</p></div>
  <div class="card"><h2>Honest limits: the scam we miss</h2><p>Early small payments in a romance scam (Michael's first P2Ps) look routine. Harbor first acts at the wire escalation. Coached members may say "it's me", so questions are open and scenario-specific, and a human takes over when anything is unclear. A member who insists keeps the final say; Harbor logs it, explains recovery is harder, and checks in the next day.</p></div>
  <div class="card"><h2>Trusted contact: guardrails</h2><p>Voluntary, revocable, member-directed. The contact is informed, never given account access, and never sees details. "Talk to Sound first" is always available, in case the person exploiting the member is a relative or caregiver. No restriction by age or any demographic trait; triggers are behavioral only.</p></div>
  <div class="card"><h2>Channel safety</h2><p>Takeover check-ins go to the contact details from <b>before</b> the change, not the attacker's session. Harbor never asks for credentials or one-time codes, links open only the authenticated app, and every message says Sound will never ask you to move money. This counters the fake-Sound-text scenario. Members without a smartphone get a phone call or branch conversation for every step.</p></div>
  <div class="card"><h2>Chat agent design</h2><p>Scripted decision tree. An LLM, if used, only softens wording and summarizes for staff. It cannot release payments or change account state, which limits hallucination and prompt-injection risk. No-response path: timeout starts employee outreach with a per-rail safe default (wires and cash stay held). After hours: ATO-pattern payments stay held, and the case is first in the morning queue.</p></div>
  <div class="card"><h2>90-day pilot</h2><p><b>Days 1-30</b> shadow mode (rules run silently, staff review flags). <b>31-60</b> live for wires, cash and takeover patterns. <b>61-90</b> add Trusted Circle prompts and Planned Big Payment.</p>
  <p><b>Measures</b> (targets are assumptions to set against Sound's own baselines, not the synthetic data): share of triggers ending in a cancellation or human conversation; time from trigger to member reply and to human contact; hold time for verified-legitimate members; false-positive rate and friction minutes; trusted-contact enrollment before an incident; dollars intercepted vs flagged; recovery success; member trust survey; staff cases per day.</p></div>
  <div class="card"><h2>Accessibility and privacy</h2><p>Plain language (about 6th-grade), large touch targets, screen-reader labels, no countdown pressure, no scare words, phone and branch parity, translations for top languages. Minimal chat retention shared only with the handling employee. Audit log and periodic review of who gets flagged. Human review before any account restriction. Cap on nudges per member per week.</p></div></div>`;
}

/* ---------- render + events ---------- */
function render() {
  document.querySelectorAll('nav [role=tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === S.tab));
  const bd = $('#badge'); bd.hidden = !S.unread; bd.textContent = S.unread;
  $('#view').innerHTML = { member: memberHTML, console: consoleHTML, trigger: triggerHTML, sim: simHTML, arch: archHTML, pipe: pipeHTML, notes: notesHTML }[S.tab]();
  const cb = $('#chatbody'); if (cb) cb.scrollTop = cb.scrollHeight;
}
function reset() { S.phone = { step: 'review' }; S.chat = null; S.log.rows = []; }
document.addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-act],[data-tab]'); if (!t) return;
  if (t.dataset.tab) { S.tab = t.dataset.tab; if (S.tab === 'console') S.unread = 0; if (S.tab === 'pipe') pipeStart(); return render(); }
  const a = t.dataset.act;
  if (a === 'scn') { S.sc = t.dataset.id; reset(); }
  else if (a === 'send') { const d = scenarioDecision(SCENARIOS.find((s) => s.id === S.sc)); S.phone = { step: d.level === 'none' ? 'sent' : d.level === 'hold' ? 'paused' : 'chat' }; if (S.phone.step === 'chat') startChat(); }
  else if (a === 'notify') S.phone = { step: 'lock' };
  else if (a === 'open') { S.phone = { step: 'chat' }; startChat(); }
  else if (a === 'choose') choose(+t.dataset.i);
  else if (a === 'person') { S.chat.msgs.push({ f: 'me', h: 'Talk to a person' }); S.chat.answers.push({ q: 'person', a: 'Talk to a person' }); finish('human'); }
  else if (a === 'timeout') finish('timeout');
  else if (a === 'coll') { S.ui[t.dataset.k] = !S.ui[t.dataset.k]; if (t.dataset.k === 'log' && S.ui.log) refreshLog(); }
  else if (a === 'rawt') S.ui.raw[t.dataset.id] = !S.ui.raw[t.dataset.id];
  else if (a === 'reset') reset();
  else if (a === 'case') S.sel = t.dataset.id;
  else if (a === 'cact') { const k = S.cases[S.sel]; k.log.push(t.dataset.v); k.status = t.dataset.v.split(';')[0]; k.updated = 'Just now'; }
  else if (a === 'sim') S.sim.selId = t.dataset.id;
  else if (a === 'pcase') { S.pipe.sel = t.dataset.id; pipeFetch(); }
  else if (a === 'preply') { pipeReply(); return; }
  else if (a === 'presolve') { fetch(`${BACKEND}/api/cases/${S.pipe.sel}/resolve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ outcome: t.dataset.v }) }).then(pipeFetch); return; }
  else return;
  render();
});
document.addEventListener('change', (ev) => {
  const t = ev.target, a = t.dataset.act;
  if (a === 'planned') { S.planned = t.checked; reset(); }
  else if (a === 'plannedAll') S.sim.plannedAll = t.checked;
  else if (a === 'mode') { S.live.mode = t.value; reset(); }
  else if (a === 'trigmember') S.trig.id = t.value;
  else if (a === 'filter') S.sim.filter = t.value;
  else return;
  render();
});
document.addEventListener('input', (ev) => {
  const t = ev.target; if (t.dataset.act !== 'slider') return;
  S.sim.cfg[t.dataset.k] = +t.value; const pos = document.activeElement === t; render();
  if (pos) { const n = document.querySelector(`[data-k="${t.dataset.k}"]`); if (n) n.focus(); }
});
document.addEventListener('submit', (ev) => {
  if (ev.target.dataset.act !== 'liveform') return; ev.preventDefault();
  const ta = $('#livein'); if (ta && ta.value.trim()) sendLive(ta.value);
});
document.addEventListener('keydown', (ev) => {
  if (ev.target.id === 'livein' && ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); ev.target.form.requestSubmit(); }
});
render();
checkLive();
})();

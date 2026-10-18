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
const scen = (id) => SCENARIOS.find((s) => s.id === id), scenOf = (mid) => SCENARIOS.find((s) => s.mid === mid);
const PLANS = { M1057: [{ rail: 'Wire', amount: 51587, label: 'Home closing wire, declared Oct 12' }] };

const S = { tab: 'member', sc: 'sarah', planned: false, rec: {}, cases: {}, sel: null,
  sim: { cfg: Object.assign({}, E.DEFAULTS), plannedAll: false, filter: 'all', selId: null }, unread: 0,
  live: { mode: 'scripted', avail: false, provider: '', model: '', timeout: 9000, backend: false }
};
/** Each story keeps its own phone, chat and pipeline state, so switching stories never resets anyone: only Reset does. */
const recOf = (mid) => Object.values(S.rec).find((r) => r.mid === mid);
const R = (id = S.sc) => (S.rec[id] ||= { id, mid: scen(id).mid, phone: { step: 'review' }, chat: null, be: { phase: 'idle', total: 0, done: 0, trigger: null, view: null, err: '' } });
for (const k of ['phone', 'chat', 'be']) Object.defineProperty(S, k, { get: () => R()[k], set: (v) => { R()[k] = v; } });
const API = location.protocol === 'file:' ? 'http://localhost:8787' : '';
const RED = ['authority_pressure', 'secrecy_or_isolation', 'unmet_online_contact', 'growing_amounts', 'unusual_method', 'member_denies_changes', 'relative_pressure', 'credential_shared'];
const SIGNAL_LABEL = { authority_pressure: 'Someone claiming authority', secrecy_or_isolation: 'Told to keep it secret', urgency: 'Urgency', unverified_contact: 'Not independently verified',
  unmet_online_contact: 'Met online, not in person', growing_amounts: 'Growing amounts', unusual_method: 'Unusual payment method', member_verified: 'Member verified details', own_initiative: 'Member\'s own decision',
  member_denies_changes: 'Denies profile changes', member_confirms_changes: 'Confirms profile changes', wants_person: 'Wants a person', member_distressed: 'Distressed', relative_pressure: 'Pressure from someone close', credential_shared: 'Shared a password or code', member_insists: 'Insists on sending now' };
async function checkLive() {
  try { const j = await (await fetch(API + '/api/status')).json(); S.live.avail = !!j.live; S.live.provider = j.provider || ''; S.live.model = j.model || ''; S.live.timeout = j.timeoutMs || 9000; S.live.backend = !!j.backend; }
  catch { S.live.avail = false; }
  if (!S.live.avail) S.live.mode = 'scripted'; else if (!S.live.chosen) S.live.mode = 'live';   // Live AI is the default whenever a model is available
  render();
  if (S.live.backend) beginStory();
}

/* ---------- backend mode: the demo streams into the real pipeline (Kafka -> scorer -> Postgres -> agent) ---------- */
/** Every action on the member's side lights up the Employee console tab, so staff know something just happened. */
let pingTimer = null;
function empPing(msg, openMid, ms = 5200) {
  if (openMid) S.ui.pingSel = openMid;                                         // clicking the toast opens this member's case
  if (S.tab === 'console') return;
  S.unread++; const tab = document.querySelector('[data-tab=console]'), toast = $('#ping'); if (!tab || !toast) return;
  tab.classList.remove('lit'); void tab.offsetWidth; tab.classList.add('lit');
  const bd = $('#badge'); bd.hidden = false; bd.textContent = S.unread;
  toast.textContent = msg; toast.hidden = false; toast.classList.remove('show'); void toast.offsetWidth; toast.classList.add('show');
  clearTimeout(pingTimer); pingTimer = setTimeout(() => { toast.hidden = true; }, ms);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (u, b, signal) => fetch(API + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}), signal }).then((r) => { if (!r.ok) throw new Error('http ' + r.status); return r.json(); });
const getState = (mid, ev) => fetch(API + '/api/demo/state?member=' + mid + (ev ? '&event=' + ev : '')).then((r) => r.json());
const caseId = (ch = S.chat) => (S.live.backend && ch && ch.cid) || null;
const openingText = () => { const v = S.be.view; const m = v && v.messages && v.messages.find((x) => x.direction === 'out'); return m ? m.body : null; };
function mirror(dir, text, force, ch = S.chat, src = 'script') {                           // scripted chat -> the real case (stored, not delivered)
  const cid = caseId(ch); if (!cid || !text || (ch.live && !force)) return;
  post('/api/cases/' + cid + '/log', { direction: dir, text, source: src }).catch(() => {});
}
async function beginStory(rec = R()) {
  if (!S.live.backend) return;
  const be = rec.be = { phase: 'loading', total: 0, done: 0, trigger: null, view: null, err: '' };
  render();
  try {
    const j = await post('/api/demo/start', { member: rec.mid, planned: S.planned ? PLANS[rec.mid] : undefined });
    if (be.dead) return;
    be.total = j.historyTotal; be.trigger = j.triggerEventId;
    for (let i = 0; i < 100; i++) {
      const v = await getState(rec.mid); if (be.dead) return;
      be.done = Math.min(v.processed, j.historyTotal); be.tags = v.tags; render();
      if (v.processed >= j.historyTotal) break; await sleep(400);
    }
    be.phase = 'ready';
  } catch (e) { if (be.dead) return; be.phase = 'error'; be.err = e.message; }
  render();
}
async function sendPayment() {
  const rec = R(), be = rec.be, sc = scen(rec.id); rec.phone = { step: 'sending' }; render();
  let level = null;
  try {
    await post('/api/demo/send', { member: rec.mid, event: be.trigger });
    // The rules decide in milliseconds; the model needs seconds to write Harbor's first message. A paused payment shows at once
    // (the message arrives as a notification a moment later). A light check opens the chat, so it waits for that message.
    for (let i = 0; i < 70; i++) {
      await sleep(i < 10 ? 150 : 350); const v = await getState(rec.mid, be.trigger);
      if (be.dead || rec.phone.step !== 'sending') return;
      be.view = v; level = v.decision && v.decision.level;
      if (level === 'none' || level === 'hold' || (level && v.messages.some((m) => m.direction === 'out'))) break;
      if (level === 'confirm' && !rec.phone.decided) { rec.phone.decided = level; render(); }   // say why we are still waiting
    }
  } catch (e) { be.err = e.message; }
  if (be.dead) return;
  if (!level) { level = scenarioDecision(sc).level; be.view = null; }       // pipeline did not answer: fall back to the local engine
  be.phase = 'decided';
  empPing(level === 'none' ? 'Member sent the payment: it went through' : 'Member sent the payment: Harbor held it');
  rec.phone = { step: level === 'none' ? 'sent' : level === 'hold' ? 'paused' : 'chat' }; if (rec.phone.step === 'chat') startChat(rec);
  render();
}
setInterval(async () => {                                                    // keep every story's case, tags and analyst read in step with what the pipeline stored
  if (!S.live.backend) return;
  let changed = false;
  for (const rec of Object.values(S.rec)) {
    const be = rec.be; if (be.phase !== 'ready' && be.phase !== 'decided') continue;
    try {
      const v = await getState(rec.mid, be.phase === 'decided' ? be.trigger : null); if (be.dead) continue;
      const old = JSON.stringify([be.view, be.tags]); be.tags = v.tags; if (be.phase === 'decided') be.view = v; if (JSON.stringify([be.view, be.tags]) !== old) changed = true;
    } catch (e) { /* offline */ }
  }
  const waitingOnPhone = S.tab === 'member' && ['paused', 'lock'].includes(R().phone.step);    // the first message can land after the paused screen shows
  if (changed && (S.tab === 'console' || waitingOnPhone)) render();
}, 2000);

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
function timelineHTML(mid, dec, n = 12, upto = Infinity) {
  const evs = D.events[mid].filter((e, i) => i < upto && KEY.includes(e.type) && e.t <= dec.t && !(e.type === 'Payment Initiated' && e.dir !== 'Outgoing')).slice(-n);
  const any = evs.some((e) => isEvidence(e, dec));
  return (any ? '<p class="small muted" style="margin:0 0 6px">Orange events fed the rule that fired.</p>' : '') + '<ul class="tl">' + evs.map((e) => {
    const cls = e.id === dec.eventId ? 'trigger' : isEvidence(e, dec) ? 'hit' : '';
    return `<li class="${cls}"><time>${fmt(e.t)}</time><span>${esc(evLabel(e))}${e.id === dec.eventId ? ' ← <b>Harbor checks the payment here</b>' : ''}</span></li>`;
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
  { t: 'Someone contacted me and asked me to send it', go: 'contact' }, { t: 'Paying a contractor, landlord or business', go: 'business' },
  { t: 'Moving money to my own account', go: 'own' }, { t: 'Something else / not sure', go: 'unsure' }];
const NEVER = 'Sound will never ask for your password or a code, or ask you to move money.';
function node(id, c) {
  const N = {
    ato0: { bot: [`Hi, this is Harbor, your security analyst at Sound. I'm sorry to interrupt, and I hope this is an okay moment.`, `A few minutes ago the password, email address and phone number on your account were changed, and a ${c.amt} payment to a new recipient was started. I've paused it, so <b>nothing has left your account</b>, and you're in control.`, `${NEVER} Was that you? Either answer is okay.`],
      choices: [{ t: 'Yes, that was me', go: 'ato_yes' }, { t: 'No, that wasn\'t me', end: 'ato_stop' }, { t: 'I\'m not sure', end: 'ato_stop' }] },
    ato_yes: { bot: ['Thanks for telling me. Because contact details changed at the same time, I\'d like a Sound employee to call you back on the number we had <i>before</i> today. It takes about 5 minutes.'],
      choices: [{ t: 'OK, call me', end: 'callback' }, { t: 'Cancel the payment', end: 'cancelled' }] },
    planned: { bot: [`Hi, this is Harbor, your security analyst at Sound. This ${c.amt} ${c.rail} matches the <b>Planned Big Payment</b> you set up (${PLANS[c.sc.mid]?.[0].label ?? 'declared earlier'}). Because it's large, there's just one quick step.`, `${NEVER} Did you confirm the account details with your title company by phone, using a number you already had?`],
      choices: [{ t: 'Yes, I verified them', end: 'callback_fast' }, { t: 'Not yet', go: 'verify_warn' }] },
    light: { bot: [`Hi, this is Harbor, your security analyst at Sound. I wanted to check in: this payment goes to someone fairly new on your account, and it's more than you usually send. ${NEVER}`, 'Do you know them well?'],
      choices: [{ t: 'Yes, I know them', go: 'light_yes' }, { t: 'Let me check first', go: 'family' }] },
    light_yes: { bot: ['Thanks! Have you spoken to them directly, on a phone number you already had?'],
      choices: [{ t: 'Yes, I spoke with them', end: 'ok' }, { t: 'Not exactly', go: 'family_warn' }] },
    start: { bot: [`Hi, this is Harbor, your security analyst at Sound. I'm sorry to interrupt. I paused your ${c.pay} for a quick check, so <b>nothing has gone out, and you're in control.</b> There's no rush.`,
      memberReason(c) + ' ' + NEVER,
      'Could you tell me what this payment is for?'],
      choices: PURPOSE },
    fallback: { bot: ['Let me guide you with a few quick questions instead.', 'Could you tell me what this payment is for?'], choices: PURPOSE },
    fallback_ato: { bot: ['Let me ask a couple of quick questions instead.', 'Were the password, email and phone changes made by you?'], choices: [{ t: 'Yes, that was me', go: 'ato_yes' }, { t: 'No, that wasn\'t me', end: 'ato_stop' }, { t: 'I\'m not sure', end: 'ato_stop' }] },
    home: { bot: ['Big purchases are a good time to double-check payment details.', 'Did you get these payment details straight from the title company, lender or seller and confirm them by phone using a number you already had?'],
      choices: [{ t: 'Yes, I verified them', end: 'ok' }, { t: 'I\'m not sure', go: 'verify_warn' }] },
    verify_warn: { bot: ['No problem, let\'s check together. Closing and purchase fraud often changes the account number by email at the last minute.'],
      choices: [{ t: 'Talk to a Sound employee now', end: 'human' }, { t: 'I\'ll verify and come back (stay paused)', end: 'paused_self' }, { t: 'Cancel the payment', end: 'cancelled' }] },
    family: { bot: ['Thanks. One quick question:', 'Have you spoken with them directly, on a number you already had?'],
      choices: [{ t: 'Yes, I spoke with them', end: 'ok' }, { t: 'No, they contacted me / I couldn\'t reach them', go: 'family_warn' }, { t: 'Not sure', go: 'family_warn' }] },
    family_warn: warn('Thank you for being honest. An urgent request from a "family member" or "lawyer", especially with "keep it secret", matches a common scam. That doesn\'t mean it is one.'),
    online: { bot: ['Online relationships can be real. I\'m not judging.', 'Have you met this person in person or on a live video call?'],
      choices: [{ t: 'Yes, we\'ve met', go: 'online_met' }, { t: 'No, not yet', go: 'online_warn' }] },
    online_met: { bot: ['Thanks. Is this the first time they\'ve asked for money, or has the amount been growing?'],
      choices: [{ t: 'First time', end: 'ok' }, { t: 'It\'s been growing', go: 'online_warn' }] },
    online_warn: { bot: ['Payments that grow over time to someone not met in person, especially for an "investment", are a pattern we see often. You\'re not foolish. These are built to feel real.', 'Real opportunities are still there tomorrow, so a pause costs nothing.'],
      choices: [{ t: 'Talk to a Sound employee (no pressure)', end: 'human' }, { t: 'Pause 24 hours', end: 'paused_24' }, { t: 'Let my trusted contact know', go: 'trusted' }, { t: 'Cancel the payment', end: 'cancelled' }, { t: 'I understand the risk. Send it anyway', end: 'override' }] },
    contact: { bot: ['Thank you for telling me. Who contacted you, and how?'],
      choices: [{ t: 'Someone saying they are from a bank, police or government agency', go: 'authority' }, { t: 'Someone saying they are a lawyer, or a relative or friend in trouble', go: 'family' }, { t: 'A person or business I already deal with', go: 'business' }, { t: 'I\'m not sure', go: 'unsure' }] },
    authority: { bot: ['Thank you for telling me. I want to be direct: <b>Sound, the police, the FBI and the IRS will never ask you to move or hand over money to protect it.</b> Anyone who does is not who they say they are.', 'Are they asking you to stay on the phone, or to keep this secret?'],
      choices: [{ t: 'Yes', go: 'authority_warn' }, { t: 'No', go: 'authority_warn' }, { t: 'I\'m not sure', go: 'authority_warn' }] },
    authority_warn: warn('You can hang up at any time. Real officials won\'t mind if you call back on a number you look up yourself.'),
    business: { bot: ['Thanks. Is this a new person or business, and do you have a written quote, contract or lease?'],
      choices: [{ t: 'Yes, I have paperwork', end: 'ok' }, { t: 'Not yet', go: 'business_warn' }] },
    business_warn: warn('Paying a lot up front without paperwork is a common contractor pattern. Staged payments are normal and often safer.'),
    own: { bot: ['Moving money to your own account is common. Did you open that account yourself and set up the login yourself?'],
      choices: [{ t: 'Yes, I set it up myself', end: 'ok' }, { t: 'Someone helped or told me to', go: 'contact' }] },
    unsure: { bot: ['That\'s okay. Being unsure is reason enough to pause. Who asked you to make this payment, and how did they reach you?'],
      choices: [{ t: 'Someone called or texted me', go: 'contact' }, { t: 'Someone I know in person', go: 'family' }, { t: 'I decided on my own', end: 'ok' }, { t: 'I\'d rather talk to a person', end: 'human' }] },
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

function startChat(rec = R()) {
  const sc = scen(rec.id), dec = scenarioDecision(sc), c = ctxOf(sc, dec);
  const first = c.ato ? 'ato0' : c.planned ? 'planned' : dec.level === 'confirm' ? 'light' : 'start';
  S.ui.footMin = false;                                                     // every new conversation starts with the reply panel open
  const ch = rec.chat = { c, cid: rec.be.view && rec.be.view.case ? rec.be.view.case.case_id : null, msgs: [], queue: [], typing: false, draining: false, answers: [], path: [], outcome: null, startedAt: Date.now() };
  S.log.rows = [];
  if (S.live.mode === 'live' && S.live.avail) ch.wasLive = true;
  if (ch.wasLive) ch.live = { hist: [], signals: {}, state: 'calm', note: '', pending: false, trusted: false, provider: S.live.provider };
  const v = rec.be.view, om = v && v.messages && v.messages.find((x) => x.direction === 'out'), open = om ? om.body : null;
  if (open && ch.live) { ch.msgs.push({ f: 'bot', h: esc(open) }); ch.skipBots = true; }   // Live AI: the first message was written from the facts and ends with the question, so the script's own lines are skipped
  pushNode(first, ch);
}
function pushNode(id, ch = S.chat) {
  const n = node(id, ch.c);
  ch.path.push(id); ch.cur = id;
  const skip = ch.skipBots; ch.skipBots = false;
  for (const b of skip ? [] : n.bot) { ch.queue.push(typeof b === 'string' ? { f: 'bot', h: b } : { f: 'sys', h: b.sys }); }
  drain(ch);
}
/** Harbor's messages arrive one at a time: a typing indicator, then the message, then a beat before the next. */
function drain(ch) {
  if (ch.draining) return;
  ch.draining = true;
  const calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const step = () => {
    if (ch.dead || ch.human) return;                                      // the scenario was reset, or a person took over
    if (!ch.queue.length) { ch.typing = false; ch.draining = false; render(); return; }
    ch.typing = true; render();
    const wait = calm ? 150 : 700 + Math.min(1200, ch.queue[0].h.replace(/<[^>]+>/g, '').length * 12);   // about 1-2 s per message
    setTimeout(() => {
      if (ch.dead || ch.human || !ch.queue.length) return;                // member took over meanwhile
      const nm = ch.queue.shift(); ch.msgs.push(nm); if (nm.f === 'bot') mirror('out', stripHTML(nm.h), false, ch); ch.typing = false; render();
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
  out.push({ t: 'Talk to a Sound employee', end: 'human' });
  out.push({ t: 'Keep it paused while I check', end: 'paused_self' });
  if (!sg.relative_pressure) out.push({ t: 'Let my trusted contact know', go: 'trusted' });
  out.push({ t: 'Cancel the payment', end: 'cancelled' }, { t: 'I understand the risk. Send it anyway', end: 'override' });
  return out;
}
function liveCtx(c) {
  return { amount: c.amt, rail: c.rail, recipient: c.recip, reasons: [memberReason(c).replace(/\s*So I wanted to check in first\.?/, '').replace(/\s*I wanted to make sure it's really you\.?/, '')], ato: c.ato, level: c.dec.level,
    trustedContact: D.events[c.sc.mid].some((e) => e.t <= c.dec.t && e.tc), name: c.name === 'you' ? '' : c.name };
}
/* ---------- asking a person to join: code (not the model) decides when Harbor should not carry the conversation alone ---------- */
function joinReason(ch) {
  const L = ch.live, sg = L.signals, turns = L.hist.length / 2;
  if (sg.credential_shared) return 'shared a password or code';
  if (sg.member_denies_changes) return 'says the account changes were not theirs';
  if (sg.wants_person) return 'asked for a person';
  if (sg.member_insists) return 'pushing back and wants the payment sent now';
  if (sg.member_distressed || ['distressed', 'angry'].includes(L.state)) return L.state === 'angry' ? 'sounds upset' : 'sounds distressed';
  if (RED.filter((k) => sg[k]).length >= 2) return 'several red flags in what they said';
  if (turns >= 4) return 'long conversation without a decision';
  return null;
}
function requestJoin(ch, why) {
  ch.joinReq = { why, at: Date.now() };
  ch.msgs.push({ f: 'sys', h: 'I\'ve asked a Sound team member to join this chat. They\'ll be with you shortly. You can keep talking to me meanwhile.' });
  const cid = caseId(ch); if (cid) post('/api/cases/' + cid + '/join', { reason: why }).catch(() => {});
  track('join_request', ch, { why, turn: ch.live ? ch.live.hist.length / 2 : null });
  empPing('🙋 Harbor asked you to join ' + memberName(ch.c.sc.mid) + '\'s chat: ' + why, ch.c.sc.mid, 15000);
}
const waitingJoin = () => Object.values(S.rec).find((r) => r.chat && r.chat.joinReq && !r.chat.joinReq.answered && !r.chat.human && !r.chat.outcome);
async function sendLive(text, via = S.voice.fromVoice ? 'voice' : 'keyboard') {
  const ch = S.chat, L = ch && ch.live; text = (text || '').trim().slice(0, 600);
  if (!L || !text || L.pending || ch.outcome) return;
  track('typed', ch, { chars: text.length, via, turn: L.hist.length / 2 + 1 }); S.voice.fromVoice = false;
  S.voice.draft = ''; ch.msgs.push({ f: 'me', h: esc(text) }); ch.answers.push({ q: 'live', a: text }); empPing('Member wrote: "' + (text.length > 70 ? text.slice(0, 70) + '…' : text) + '"'); L.hist.push({ role: 'user', content: text }); L.pending = true; render();
  try {
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), S.live.timeout);
    const cid = caseId(ch);
    const j = await (cid ? post('/api/cases/' + cid + '/reply', { text }, ctl.signal) : post('/api/chat', { ctx: liveCtx(ch.c), messages: L.hist }, ctl.signal));
    clearTimeout(to); if (ch.dead || ch.outcome || ch.human) { if (L) L.pending = false; return; }
    L.hist.push({ role: 'assistant', content: j.reply }); ch.msgs.push({ f: 'bot', h: esc(j.reply) });
    for (const k in j.signals) if (j.signals[k]) L.signals[k] = true;
    Object.assign(L, { state: j.member_state, note: j.handoff_note, guarded: j.guarded, provider: j.provider, pending: false }); if (j.tone) ch.tone = j.tone;
    const why = !ch.joinReq && joinReason(ch); if (why) requestJoin(ch, why);
  } catch (e) {
    if (ch.dead || ch.outcome) return;
    track('fallback', ch, { error: e.name === 'AbortError' ? 'timeout after ' + S.live.timeout + ' ms' : String(e.message).slice(0, 80), after_turns: Math.floor(L.hist.length / 2) });
    ch.msgs.push({ f: 'sys', h: 'The live assistant is unavailable, so I\'m switching to a few guided questions.' });
    ch.live = null; pushNode(ch.c.ato ? 'fallback_ato' : 'fallback', ch);
  }
  render();
  refreshLog();
}
function liveChoose(i, how = 'tap') {
  const ch = S.chat, L = ch.live, opts = liveChips(ch), pick = opts[i]; if (!pick || L.pending) return;
  chosen(ch, pick.t, i, opts.length, how);
  if (pick.text) return sendLive(pick.t, 'option');
  ch.msgs.push({ f: 'me', h: esc(pick.t) }); ch.answers.push({ q: 'live-choice', a: pick.t }); mirror('in', pick.t, true); empPing('Member chose: "' + pick.t + '"');
  if (pick.back) L.trusted = false;
  else if (pick.go === 'trusted') { L.trusted = true; const n = node('trusted', ch.c); for (const b of n.bot) ch.queue.push({ f: 'bot', h: b }); drain(ch); }
  else finish(pick.end === 'ok' ? (ch.c.dec.level === 'confirm' ? 'release_light' : 'callback') : pick.end);
  render();
}
function choose(i, how = 'tap') {
  if (S.chat.live) return liveChoose(i, how);
  const ch = S.chat, n = node(ch.cur, ch.c), pick = n.choices[i];
  chosen(ch, pick.t, i, n.choices.length, how);
  ch.msgs.push({ f: 'me', h: esc(pick.t) });
  ch.answers.push({ q: ch.cur, a: pick.t }); mirror('in', pick.t); empPing('Member chose: "' + pick.t + '"');
  if (pick.back) { ch.path.pop(); pushNode(ch.path.pop() || 'start'); }
  else if (pick.go) pushNode(pick.go);
  else finish(pick.end === 'ok' ? (ch.c.dec.level === 'confirm' ? 'release_light' : 'callback') : pick.end);
  render();
}
function finish(key) {
  const ch = S.chat; ch.outcome = key; ch.queue = []; ch.typing = false; ch.draining = false; const o = OUTCOMES[key], prev = S.cases[ch.c.sc.mid];
  const summary = {
    mid: ch.c.sc.mid, who: ch.c.sc.name, tag: ch.c.sc.tag, dec: ch.c.dec, status: o.status, answers: ch.answers.slice(), key, updated: 'Just now', stage: 'done',
    msgs: ch.msgs.filter((m) => m.f === 'bot' || m.f === 'me').map((m) => ({ f: m.f, t: stripHTML(m.h) })),
    log: [...(prev ? prev.log : [`Harbor paused ${ch.c.amt} ${ch.c.rail}`]), ...(ch.answers.length ? ['Member chat: ' + ch.answers.map((a) => '"' + a.a + '"').join(' → ')] : ['No member reply']), 'Outcome: ' + o.status],
  };
  const L = ch.live;
  if (L) { summary.live = true; summary.signals = Object.keys(L.signals).filter((k) => L.signals[k]); summary.note = L.note; summary.state = L.state;
    summary.log.splice(summary.log.length - 1, 0, 'Harbor\'s read (' + L.provider + '): ' + (summary.signals.map((k) => SIGNAL_LABEL[k]).join(', ') || 'no risk signals') + (L.note ? '. Note: ' + L.note : '')); }
  S.cases[ch.c.sc.mid] = summary;
  empPing('Outcome: ' + o.status);
  const cid = caseId(ch); if (cid) post('/api/cases/' + cid + '/resolve', { outcome: key }).catch(() => {});
}

/* ---------- interaction log: what the member was offered and chose (and how fast), voice or typing, fallbacks, abandoned chats,
   employee replies after a takeover. Batched to /api/interactions; the server masks secrets before storing. ---------- */
const evq = []; let evTimer = null;
function track(kind, ch, detail, ms) {
  if (!ch || !(S.live.avail || S.live.backend)) return;                      // no server running: nothing is stored
  evq.push({ kind, case_id: caseId(ch), member_id: ch.c.sc.mid, story: ch.c.sc.id, mode: ch.live ? 'live' : 'guided', tone: ch.tone || 'warm', ms: ms == null ? null : ms, detail });
  clearTimeout(evTimer); evTimer = setTimeout(() => { const events = evq.splice(0, 50); if (events.length) post('/api/interactions', { events }).catch(() => {}); }, kind === 'offered' ? 1500 : 300);
}
function chosen(ch, label, index, of, how) {
  track('chose', ch, { label, index, of, node: ch.live ? 'live' : ch.cur, how }, ch.offAt ? Date.now() - ch.offAt : null); ch.offKey = null;
}

/* ---------- feedback: member and employee each rate 1-5, stored with the conversation for later analysis ---------- */
const transcript = (msgs) => msgs.filter((m) => m.f !== 'sys').map((m) => ({ who: m.f === 'me' ? 'member' : m.f === 'emp' ? 'employee' : 'harbor', text: m.t != null ? m.t : stripHTML(m.h) }));
function sendFeedback(fb, body) {
  fb.busy = true; fb.err = ''; render();
  post('/api/feedback', body).then(() => { fb.sent = true; }).catch((e) => { fb.err = /404/.test(e.message) ? 'Could not save: the server is running older code. Restart it (Ctrl+C, then task run) and try again.' : 'Could not save. Feedback needs the local server (task run or task chat).'; })
    .finally(() => { fb.busy = false; render(); });
}
function memberFeedback(ch) {
  const c = ch.c, L = ch.live, fb = ch.fb;
  sendFeedback(fb, { source: 'member', score: fb.score, comment: fb.text, case_id: caseId(ch), member_id: c.sc.mid, outcome: ch.outcome, mode: ch.wasLive ? 'live' : 'guided',
    context: { story: c.sc.id, level: c.dec.level, rules: c.dec.rules.map((r) => r.id), path: ch.path, answers: ch.answers, transcript: transcript(ch.msgs),
      signals: L ? Object.keys(L.signals).filter((k) => L.signals[k]) : [], member_state: L && L.state, handoff_note: L && L.note, provider: S.live.provider, model: S.live.model, text_size: S.textSize } });
}
function caseSnapshot(k) {
  const rec = recOf(k.mid);
  return { story: rec && rec.id, level: k.dec.level, rules: k.dec.rules.map((r) => r.id), status: k.status, actions: k.acts || [], transcript: transcript(k.msgs || []),
    signals: k.signals || [], handoff_note: k.note, analyst: k.real && k.real.analysis && k.real.analysis.verdict, provider: S.live.provider, model: S.live.model };
}
function employeeFeedback(k, kind) {
  const fb = kind === 'verdict' ? k.vfb : k.efb, rec = recOf(k.mid), real = k.real && k.real.case;
  sendFeedback(fb, { source: 'employee', kind, score: fb.score, comment: fb.text, case_id: (real && real.case_id) || (rec && rec.chat ? caseId(rec.chat) : null), member_id: k.mid, outcome: k.key,
    mode: k.live ? 'live' : 'guided', context: Object.assign(caseSnapshot(k), kind === 'verdict' ? { loss: +fb.loss || 0, recovered: +fb.recovered || 0 } : {}) });
}
function memberFbHTML(ch) {
  const fb = ch.fb ||= {};
  if (fb.sent) return '<p class="small muted fbdone">Thanks for your feedback. It helps us improve Harbor.</p>';
  const L = ['', 'Not helpful', 'A little helpful', 'Helpful', 'Very helpful', 'Extremely helpful'];
  return `<div class="fb" role="group" aria-label="Feedback on Harbor"><b>How helpful was Harbor?</b>
    <div class="rate" role="radiogroup" aria-label="Rate Harbor 1 to 5, 5 is extremely helpful" style="margin-top:8px">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="ratebtn" data-act="mfb" data-v="${n}" role="radio" aria-checked="${fb.score === n}" title="${L[n]}">${n}</button>`).join('')}</div>
    <div class="rateends small muted"><span>Not helpful</span><span>${fb.score ? `<b>${fb.score} · ${L[fb.score]}</b>` : ''}</span><span>Extremely helpful</span></div>
    ${fb.score ? `<textarea id="mfbtext" rows="2" maxlength="1000" placeholder="${fb.score >= 4 ? 'What helped? (optional)' : 'What should Harbor do better? (optional)'}" aria-label="Feedback comment">${esc(fb.text || '')}</textarea>
      <button type="button" class="btn sm block" data-act="mfbsend" ${fb.busy ? 'disabled' : ''}>Send feedback</button>` : ''}${fb.err ? `<p class="small" style="color:var(--red)">${esc(fb.err)}</p>` : ''}</div>`;
}
function employeeFbHTML(k) {
  if (!k) return '';
  const fb = k.efb ||= {}, L = ['', 'Very poor', 'Poor', 'OK', 'Good', 'Very good'];
  const body = fb.sent ? `<p class="small" style="margin:0">Saved: <b>${fb.score}/5 · ${L[fb.score]}</b>. Thank you.</p><button type="button" class="linkbtn" data-act="efbredo">Rate again</button>`
    : `<div class="rate" role="radiogroup" aria-label="Rate Harbor 1 to 5">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="ratebtn" data-act="efb" data-v="${n}" role="radio" aria-checked="${fb.score === n}" title="${L[n]}">${n}</button>`).join('')}</div>
      <p class="small muted" style="margin:4px 0 6px">${fb.score ? `${fb.score} · ${L[fb.score]}` : '1 = very poor, 5 = very good'}</p>
      ${fb.score ? `<textarea id="efbtext" rows="2" maxlength="1000" placeholder="What worked, or what should Harbor have said? (optional)" aria-label="Rating comment">${esc(fb.text || '')}</textarea>
      <button type="button" class="btn sm block" data-act="efbsend" ${fb.busy ? 'disabled' : ''}>Save rating</button>` : ''}${fb.err ? `<p class="small" style="color:var(--red)">${esc(fb.err)}</p>` : ''}`;
  return `<section class="card efb"><h2>Rate Harbor on this case</h2>${body}</section>${verdictHTML(k)}`;
}
const VERDICT = { 1: ['Confirmed scam', 'red'], '-1': ['Legitimate', 'green'], 0: ['Unsure', 'grey'] };
/** Close-out: was it really a scam? Feedback measures the experience; this labels whether Harbor was right. */
function verdictHTML(k) {
  const fb = k.vfb ||= {}, scam = fb.score === 1;
  const body = fb.sent ? `<p class="small" style="margin:0">Recorded: <span class="chip ${VERDICT[fb.score][1]}">${VERDICT[fb.score][0]}</span>${scam ? ` lost ${money(+fb.loss || 0)}, recovered ${money(+fb.recovered || 0)}` : ''}</p><button type="button" class="linkbtn" data-act="vfbredo">Change</button>`
    : `<div class="rate" role="radiogroup" aria-label="Final verdict">${[1, -1, 0].map((v) => `<button type="button" class="ratebtn" data-act="vfb" data-v="${v}" role="radio" aria-checked="${fb.score === v}">${VERDICT[v][0]}</button>`).join('')}</div>
      ${scam ? `<div class="vmoney"><label class="small">Money lost $<input id="vfbloss" type="number" min="0" step="1" value="${esc(fb.loss || '')}"></label><label class="small">Recovered $<input id="vfbrec" type="number" min="0" step="1" value="${esc(fb.recovered || '')}"></label></div>` : ''}
      ${fb.score != null ? `<textarea id="vfbtext" rows="2" maxlength="1000" placeholder="How did you confirm it? (optional)" aria-label="Verdict note">${esc(fb.text || '')}</textarea>
      <button type="button" class="btn sm block" data-act="vfbsend" ${fb.busy ? 'disabled' : ''}>Save verdict</button>` : '<p class="small muted" style="margin:6px 0 0">Set this when the case is closed and you know what really happened.</p>'}${fb.err ? `<p class="small" style="color:var(--red)">${esc(fb.err)}</p>` : ''}`;
  return `<section class="card efb"><h2>Close-out: was it a scam?</h2>${body}</section>${ftcHTML(k)}`;
}

/* ---------- FTC report: once the employee confirms a scam, Harbor drafts the report from what it learned. The employee files it
   with the member on reportfraud.ftc.gov (or IdentityTheft.gov for a takeover). Nothing is sent automatically: there is no official
   API, the report belongs to the member and needs their consent, and demo data is synthetic. ---------- */
function ftcReport(k) {
  const d = k.dec, sg = new Set(k.signals || []), ids = d.rules.map((r) => r.id), ev = txnEvent(k), said = (k.msgs || []).filter((m) => m.f === 'me').map((m) => m.t);
  const ato = ids.includes('ATO');
  const category = ato ? 'Identity theft: someone took over the account (file at IdentityTheft.gov)'
    : sg.has('authority_pressure') ? 'An impersonator (someone claiming to be a government agency, a business, a lawyer or a family member)'
    : sg.has('unmet_online_contact') || sg.has('growing_amounts') ? 'Romance or investment: someone met online asked for money'
    : sg.has('relative_pressure') ? 'Something else: pressure from someone close to the member'
    : 'Something else (describe below)';
  const contact = ato ? 'A text claiming to be from the credit union, then the account was taken over' : sg.has('authority_pressure') ? 'Phone call from someone claiming authority'
    : sg.has('unmet_online_contact') ? 'Online (dating site, app or social media)' : 'Not known yet: ask the member';
  const loss = +(k.vfb && k.vfb.loss) || 0, rec = +(k.vfb && k.vfb.recovered) || 0;
  const story = [ato ? `The password, email and phone number on the member's account were changed, then a ${money(d.amt)} ${railWord(d.rail)} to a new recipient was started.` : `The member started a ${money(d.amt)} ${railWord(d.rail)}${d.rs === 'New' ? ' to a new recipient' : ''}.`,
    `Sound Credit Union paused it for a safety check on ${fmt(d.t)}.`, said.length ? `In the member's words: "${said.slice(0, 3).join('" / "')}".` : '', k.note ? `Staff note: ${k.note}` : '',
    loss ? `Money lost: ${money(loss)}${rec ? `, recovered: ${money(rec)}` : ''}.` : 'No money was lost.'].filter(Boolean).join(' ');
  return { site: ato ? 'https://www.identitytheft.gov/' : 'https://reportfraud.ftc.gov/', siteName: ato ? 'IdentityTheft.gov' : 'reportfraud.ftc.gov', fields: [
    ['What happened (category)', category], ['How it started', contact], ['Payment method', railWord(d.rail).replace(/^./, (m) => m.toUpperCase())], ['Amount involved', money(d.amt)],
    ['Amount lost', money(loss)], ['Date', fmt(d.t)], ['Paid to', d.rail === 'Cash' ? 'Cash handed over in person' : (ev.rid || 'Recipient') + ' (account details on file at Sound)'],
    ['Description', story], ['Member contact details', 'Fill in with the member: name, address, phone, email'] ] };
}
function ftcHTML(k) {
  const v = k.vfb; if (!v || !v.sent || v.score !== 1) return '';                       // only after the employee confirms a scam
  const ui = (S.ui.ftc ||= {})[k.mid] ||= {}, r = ftcReport(k);
  if (!ui.open) return `<section class="card efb"><h2>Report to the FTC</h2><p class="small muted" style="margin:0 0 8px">Harbor drafts the report from this case. You file it with the member.</p><button type="button" class="btn sm block" data-act="ftc">📝 Prepare FTC report</button></section>`;
  const rows = r.fields.map(([label, val], i) => `<div class="ftcf"><div class="ftcl">${esc(label)}</div><div class="ftcv">${esc(val)}</div><button type="button" class="linkbtn" data-act="ftccopy" data-i="${i}" ${ui.consent ? '' : 'disabled'}>Copy</button></div>`).join('');
  return `<section class="card efb ftc"><h2>Report to the FTC</h2>
    <p class="ftcwarn">⚠️ Demo data is synthetic. Do not submit it.</p>
    <label class="small ftcok"><input type="checkbox" data-act="ftcconsent" ${ui.consent ? 'checked' : ''}> The member agreed to report this (file it with them, or give them this draft)</label>
    ${rows}
    <div class="ftcbtns"><button type="button" class="btn alt sm" data-act="ftccopy" data-i="all" ${ui.consent ? '' : 'disabled'}>Copy all</button>
      ${ui.consent ? `<a class="btn sm" href="${r.site}" target="_blank" rel="noopener noreferrer" data-act="ftcopen">Open ${esc(r.siteName)} ↗</a>` : `<span class="btn sm" aria-disabled="true">Open ${esc(r.siteName)} ↗</span>`}</div>
    ${ui.copied ? `<p class="small" style="margin:6px 0 0;color:var(--green)">${esc(ui.copied)}</p>` : ''}</section>`;
}
function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } finally { ta.remove(); } return Promise.resolve();
}

/* ---------- member view ---------- */
function phoneHTML() {
  const sc = scen(S.sc), dec = scenarioDecision(sc), c = ctxOf(sc, dec), p = S.phone;
  const bar = (t) => `<div class="bar"><b>${t}</b><span>9:41</span></div>`;
  const recip = dec.rs === 'New' ? 'New recipient (added recently)' : 'Existing recipient';
  if (p.step === 'review') {
    return { html: `${bar(c.ato ? 'Sound (criminal\'s session)' : 'Sound Credit Union')}<div class="body">
      ${c.ato ? '<div class="outcome red small">Demo view: this is the <b>criminal</b> using Sarah\'s stolen login. Sarah doesn\'t know yet.</div>' : ''}
      <div class="card"><h2>Review payment</h2>
      <div class="row"><span>From</span><b>Checking</b></div><div class="row"><span>To</span><b>${recip}</b></div>
      <div class="row"><span>Method</span><b>${esc(dec.rail)}</b></div><div class="row"><span>Amount</span><b>${money(dec.amt)}</b></div></div></div>
      <div class="foot"><button class="btn block" data-act="send" ${S.live.backend && S.be.phase !== 'ready' ? 'disabled' : ''}>Send payment</button>${S.live.backend ? `<div class="small muted" style="text-align:center;margin-top:6px">${S.be.phase === 'ready' ? 'Account history is in the pipeline' : S.be.phase === 'error' ? 'Pipeline error: ' + esc(S.be.err) : 'Streaming account history… ' + S.be.done + '/' + (S.be.total || '?')}</div>` : ''}</div>` };
  }
  if (p.step === 'sending') return { html: `${bar(c.ato ? 'Sound (criminal\'s session)' : 'Sound Credit Union')}<div class="body"><div class="card">${p.decided === 'confirm' ? '<h2>One quick question</h2><p class="muted">Harbor is writing it now.</p>' : '<h2>Checking this payment…</h2><p class="muted">Harbor is looking at it now. This takes a moment.</p>'}<div class="msg bot typing" role="status" aria-label="Checking"><span></span><span></span><span></span></div></div></div>` };
  if (p.step === 'sent') return { html: `${bar('Sound Credit Union')}<div class="body"><div class="outcome green"><h2>Payment sent</h2>No friction. Harbor looked and let it through.</div></div><div class="foot"><button class="btn alt block" data-act="reset">Replay</button></div>` };
  if (p.step === 'paused') {
    const why = c.ato ? '' : `<div class="pcap">Why Harbor paused it</div><div class="pwhy">${esc(memberReason(c))} This is a safety check, not an accusation.</div>`;
    return { html: `${bar(c.ato ? 'Sound (criminal\'s session)' : 'Sound Credit Union')}<div class="body">
      <span class="pill">Paused. Nothing has been sent.</span>
      <h2 class="ptitle">${c.ato ? 'This payment is under review' : 'Your ' + esc(railWord(dec.rail)) + ' is paused for a quick look'}</h2>
      <div class="pcard"><div class="pamt">${money(dec.amt)}</div><div class="row"><span>Sent by</span><b>${esc(dec.rail)}</b></div><div class="row"><span>To</span><b>${esc(recip)}</b></div></div>
      ${c.ato ? '<p class="pwhy">For your security, we\'ve contacted the number and email we had on file.</p>' : why}
      ${c.ato ? '' : '<p class="pvoice">You\'re in control. Nothing moves without you.</p>'}</div>
      <div class="foot"><button class="btn block" data-act="notify">${c.ato ? 'Switch to Sarah\'s real phone' : 'Next: Harbor\'s message arrives'}</button></div>` };
  }
  if (p.step === 'lock') {
    const real = S.live.mode === 'live' ? openingText() : null;
    const writing = !real && S.live.mode === 'live' && S.live.backend;        // the model is still writing the first message: show that, then swap it in
    const text = real ? real : c.ato ? 'Sound: A payment was paused on your account. Open your Sound app to review. We will never ask for your password or a code.' : 'Harbor, your security analyst at Sound: your payment is paused for a quick check, and nothing was sent. Open the Sound app whenever you\'re ready.';
    const title = c.ato ? 'A payment was paused on your account' : `Your ${money(dec.amt)} ${railWord(dec.rail)} is paused`;
    return { html: `<div class="lock"><p class="ldate">Saturday, October 17</p><div class="time" style="text-align:center">9:41</div><p class="lwho">${c.ato ? 'Sarah\'s phone (number on file before today)' : 'Your phone'}</p>
      <div class="notif"><div class="nmark" aria-hidden="true">⚓</div><div style="flex:1;min-width:0"><div class="nhead"><b>Harbor${c.ato ? ' · SMS to the old number' : ''}</b><span>now</span></div><div class="nt">${esc(title)}</div><div class="nb"${writing ? '' : ` title="${esc(text)}"`}>${writing ? '<span class="writing">Harbor is writing your message<span class="dots" aria-hidden="true"><span></span><span></span><span></span></span></span>' : esc(text)}</div>
      <div class="small" style="margin-top:6px">Link opens only the authenticated Sound app. Harbor never asks for credentials or codes.</div>
      </div></div><div class="lockact"><button class="btn block" data-act="open" ${writing ? 'disabled' : ''}>Open Sound app</button></div>
      <p class="lnote">Sound will never ask for your password or a code, or ask you to move money.</p></div>` };
  }
  // chat
  const ch = S.chat, n = ch.outcome ? null : node(ch.cur, ch.c), o = ch.outcome && OUTCOMES[ch.outcome], L = ch.live;
  const busy = ch.typing || ch.queue.length > 0 || !!(L && L.pending);
  const msgs = ch.msgs.map((m) => { const cls = m.seen ? '' : ' fresh'; m.seen = true; return m.f === 'emp' ? `<div class="msg bot emp${cls}"><span class="who">Sound team member</span>${m.h}</div>` : `<div class="msg ${m.f}${cls}">${m.h}</div>`; }).join('')
    + (ch.typing || (L && L.pending) ? '<div class="msg bot typing" role="status" aria-label="Harbor is typing"><span></span><span></span><span></span></div>' : '');
  const opts = busy || ch.human ? [] : L ? liveChips(ch) : n ? n.choices : [];
  if (opts.length) { const key = opts.map((x) => x.t).join('|'); if (ch.offKey !== key) { ch.offKey = key; ch.offAt = Date.now(); track('offered', ch, { options: opts.map((x) => x.t), node: L ? 'live' : ch.cur }); } }
  const chips = opts.map((x, i) => `<button class="choice" data-act="choose" data-i="${i}">${esc(x.t)}</button>`).join('');
  const mic = o ? { btn: '', hint: '' } : micParts(busy), hasBox = ch.human || (L && !L.trusted);
  const box = hasBox ? `<form class="livebox" data-act="liveform"><textarea id="livein" rows="2" maxlength="600" placeholder="Or type here" aria-label="${ch.human ? 'Message to the Sound team member' : 'Message to Harbor'}" ${busy ? 'disabled' : ''}>${esc(S.voice.draft || '')}</textarea><button class="btn sm" type="submit" ${busy ? 'disabled' : ''}>Send</button>${mic.btn}</form>` : '';
  const footKey = [ch.cur, ch.human ? 'h' : '', ch.msgs.length, ch.outcome || '', busy ? 'b' : 'r', L ? L.hist.length : ''].join('|');
  const footCls = ch.footKey === footKey ? '' : ' fresh'; ch.footKey = footKey;
  // Like the Claude app: tapping the conversation collapses the reply panel to a slim bar at the bottom; tapping the bar brings it back up.
  const min = !!S.ui.footMin && !o;
  const reply = mic.hint + (hasBox ? box : busy ? '' : mic.btn) + chips + (ch.human || opts.some((x) => x.end === 'human') ? '' : `<button class="btn ghost sm" data-act="person">Talk to a person</button>`);
  const collapsed = `<div class="cmin"><button type="button" class="cmin-pill" data-act="expand" aria-expanded="false" aria-label="Show the reply panel"><span>${hasBox ? (ch.human ? 'Reply to the Sound team member…' : 'Reply to Harbor…') : 'Choose an answer…'}</span>${opts.length ? `<small>${opts.length} suggested ${opts.length === 1 ? 'answer' : 'answers'}</small>` : ''}</button>${S.voice.supported && !busy ? `<button type="button" class="mic" data-act="mic" aria-label="Tap to speak" title="Tap to speak"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"></rect><path d="M5 11a7 7 0 0 0 14 0"></path><path d="M12 18v3"></path></svg></button>` : ''}</div>`;
  const foot = o ? memberFbHTML(ch) + `<button class="btn alt block" data-act="reset">Replay this scenario</button>` : min ? collapsed : reply;
  const oc = o ? `<div class="outcome ${o.tone}${ch.outcomeSeen ? '' : ' fresh'}"><b>${o.title}</b><br>${o.text}</div>` : ''; if (o) ch.outcomeSeen = true;
  return { html: `${bar('Harbor · security analyst')}<div class="body" id="chatbody">${msgs}${oc}</div><div class="foot${footCls}${min ? ' min' : ''}">${foot}</div>` };
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
/* ---------- speech to text (Web Speech API) + text size for older members ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
S.voice = { supported: !!SR && window.self === window.top, framed: window.self !== window.top, on: false, interim: '', final: '', draft: '', err: null };
try { S.textSize = localStorage.getItem('harbor-textsize') === 'xl' ? 'xl' : 'large'; } catch (e) { S.textSize = 'large'; }
let rec = null;
const SYN = [   // spoken words -> the option they mean
  [/\b(house|home|car|vehicle|truck|closing|mortgage|down ?payment|title company|buying|bought|purchase)\b/, 'home or vehicle'],
  [/\b(family|grand ?(son|daughter|child|kids?)|son|daughter|nephew|niece|relative|jail|bail|accident|hospital)\b/, 'family member'],
  [/\b(online|internet|dating|boyfriend|girlfriend|crypto|invest\w*|never met)\b/, 'met online'],
  [/\b(police|fbi|irs|federal|government|bank|officer|agent|detective|investigat\w*|told me to)\b/, 'told me to move money'],
  [/\b(contractor|landlord|rent|roof|repair\w*|plumber|business|lease)\b/, 'contractor'],
  [/\b(own account|my account|brokerage|savings|myself)\b/, 'own account'],
  [/\b(something else|other|don'?t know|do not know|no idea)\b/, 'something else'],
];
/** Which option did the person mean? Returns an index into `labels`, or -1 when nothing fits well enough. */
function matchChip(text, labels) {
  const said = ' ' + text.toLowerCase().replace(/[^a-z' ]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  const L = labels.map((l) => l.toLowerCase());
  const score = L.map(() => 0);
  const yes = /^ (yes|yeah|yep|yup|correct|sure|that was me|i did|i have|i verified)\b/.test(said), no = /^ (no|nope|nah|not really|that wasn'?t me)\b/.test(said), unsure = /\b(not sure|don'?t know|do not know|no idea|dunno|unsure|maybe)\b/.test(said);
  L.forEach((l, i) => {
    if (unsure && /not sure|not exactly|something else/.test(l)) score[i] += 6;
    else if (yes && /^yes/.test(l)) score[i] += 6;
    else if (no && /^no\b/.test(l)) score[i] += 6;
    for (const [re, key] of SYN) if (re.test(said) && l.includes(key)) score[i] += 4;
    for (const w of said.split(' ')) if (w.length > 3 && l.includes(w)) score[i] += 1;
  });
  const best = Math.max(...score);
  const top = score.filter((x) => x === best).length;
  return best >= 3 && top === 1 ? score.indexOf(best) : -1;     // a tie means we are not sure: ask them to say it again
}
const VOICE_ERR = { 'not-allowed': 'Please allow the microphone in your browser, then tap again.', 'service-not-allowed': 'Please allow the microphone in your browser, then tap again.', 'no-speech': "I didn't hear anything. Tap and try again.", 'audio-capture': 'I could not find a microphone.', network: 'Voice needs an internet connection. You can type instead.' };
function startVoice() {
  if (!SR || !S.chat || S.chat.outcome) return;
  stopVoice();
  rec = new SR(); rec.lang = navigator.language || 'en-US'; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
  rec.onstart = () => { S.voice.on = true; S.voice.interim = ''; S.voice.final = ''; S.voice.err = null; render(); };
  rec.onresult = (e) => {
    let t = ''; for (const r of e.results) t += r[0].transcript;
    S.voice.interim = t; if (e.results[e.results.length - 1].isFinal) S.voice.final = t;
    const h = document.getElementById('hear'); if (h) h.textContent = t;          // no re-render while listening
  };
  rec.onerror = (e) => { S.voice.err = e.error; S.voice.on = false; render(); };
  rec.onend = () => { S.voice.on = false; const t = (S.voice.final || S.voice.interim || '').trim(); rec = null; if (t) onSpoken(t); else render(); };
  try { rec.start(); } catch (e) { S.voice.err = 'audio-capture'; render(); }
}
function stopVoice(finish) { try { if (rec) { finish ? rec.stop() : rec.abort(); } } catch (e) { /* already stopped */ } if (!finish) { rec = null; S.voice.on = false; } }
function onSpoken(text) {
  const ch = S.chat; if (!ch || ch.outcome) return render();
  if (/\b(talk to (a |an |some)?(person|human|someone|employee)|speak (to|with) (a |an |some)?(person|human|someone|employee)|real person|a human|call me)\b/i.test(text)) {
    ch.msgs.push({ f: 'me', h: 'Talk to a person' }); ch.answers.push({ q: 'person', a: 'Talk to a person' }); finish('human'); return render();
  }
  if (ch.live || ch.human) {                                                      // Live AI or a person in the chat: put the words in the box to check, then Send
    S.voice.draft = text; S.voice.err = null; S.voice.fromVoice = true; track('voice', ch, { live: !!ch.live, words: text.split(/\s+/).length }); render();
    setTimeout(() => { const ta = document.getElementById('livein'); if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } }, 0);
    return;
  }
  const n = node(ch.cur, ch.c), idx = matchChip(text, n.choices.map((x) => x.t));   // guided: pick the option they meant
  ch.msgs.push({ f: 'sys', h: 'I heard: “' + esc(text) + '”' });
  track('voice', ch, { live: false, matched: idx >= 0, words: text.split(/\s+/).length });
  if (idx < 0) { ch.msgs.push({ f: 'bot', h: 'Sorry, I didn\'t catch which one you meant. Please tap an option below, or say it again.' }); return render(); }
  choose(idx, 'voice'); render();
}
/** The mic as parts: the round button (placed right of Send when there is a reply box), the hint under it, or a note when voice is unavailable. */
function micParts(busy) {
  const ch = S.chat; if (!ch || ch.outcome) return { btn: '', hint: '' };
  if (!S.voice.supported) return { btn: '', hint: '<p class="small micnote">' + (SR && S.voice.framed ? 'The microphone is switched off inside this preview. Open the prototype in its own browser tab to talk to Harbor, or tap an option.' : 'Talking to Harbor works in Chrome and Safari. You can tap or type instead.') + '</p>' };
  const on = S.voice.on, label = on ? 'Listening. Tap to stop' : 'Tap to speak';
  const hint = S.voice.err ? (VOICE_ERR[S.voice.err] || 'Voice stopped. Tap to try again, or type instead.') : on ? (S.voice.interim || 'Go ahead, I\'m listening…') : (ch.live || ch.human ? '' : busy ? '' : 'Tap and say it in your own words.');
  return { btn: `<button type="button" class="mic${on ? ' on' : ''}" data-act="mic" aria-pressed="${on}" aria-label="${label}" title="${label}" ${busy ? 'disabled' : ''}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"></rect><path d="M5 11a7 7 0 0 0 14 0"></path><path d="M12 18v3"></path></svg></button>`,
    hint: hint ? `<div class="hear" id="hear" aria-live="polite">${esc(hint)}</div>` : '' };
}

/* ---------- collapsible panels + model log dashboards ---------- */
S.ui = { demoOpen: false, saw: true, log: true, raw: {}, d: {}, qOpen: false, qText: '' };
S.log = { rows: [], err: null, mid: null, at: 0 };
function coll(k, title, body, badge) {
  const open = S.ui[k];
  return `<div class="card coll"><button type="button" class="coll-h" data-act="coll" data-k="${k}" aria-expanded="${open}"><span class="coll-t">${title}${badge || ''}</span>
    <svg class="chev ${open ? 'open' : ''}" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"></path></svg></button>${open ? `<div class="coll-b">${body}</div>` : ''}</div>`;
}
const selRec = () => recOf(S.sel) || null;
const digits = (x) => String(x || '').replace(/\D/g, '');
async function refreshLog() {                                              // model calls for the conversation of the member selected in the console
  const rec = selRec(), ch = rec && rec.chat; S.log.mid = S.sel; S.log.at = Date.now();
  if (!ch || !ch.live) { S.log.rows = []; return; }
  try {
    const j = await (await fetch(API + '/api/traces?limit=300')).json(), amt = digits(liveCtx(ch.c).amount);
    S.log.err = null;
    S.log.rows = j.traces.filter((t) => t.kind === 'chat' && Date.parse(t.ts) >= ch.startedAt - 1500 && (!t.input || !t.input.ctx || digits(t.input.ctx.amount) === amt)).sort((a, b) => (a.ts < b.ts ? -1 : 1));
  } catch (e) { S.log.err = 'unreachable'; }
  if (S.tab === 'console') render();
}
const SIGNAL_ORDER = ['member_insists', 'authority_pressure', 'secrecy_or_isolation', 'urgency', 'unverified_contact', 'unmet_online_contact', 'growing_amounts', 'unusual_method', 'relative_pressure', 'credential_shared', 'member_denies_changes', 'member_confirms_changes', 'member_verified', 'own_initiative', 'wants_person', 'member_distressed'];
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
  const rec = selRec(), ch = rec && rec.chat;
  if (!S.live.avail) return '<p class="muted">Model logs need the local server. Run <code>task run</code> and open <b>localhost:8787</b>.</p>';
  if (!ch) return '<p class="muted">The member has not opened the chat yet. Once they talk to Harbor, each model call for this conversation appears here.</p>';
  if (!ch.live) return '<p class="muted">This conversation used the guided script, which makes no model calls, so there is nothing to log. Pick <b>Live AI</b> in Config and start the story again to see what the model understood and what the code did about it.</p>';
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
  return `${understandingHTML(ch.live)}<p class="small muted" style="margin-top:0">This model has no hidden chain of thought. What it exposes, and what our code does with it, is below. All of it comes from the real calls for this conversation.</p>
    <div class="tiles dash"><div class="tile"><b>${rows.length}</b>model calls</div><div class="tile"><b>${Math.round(lat.reduce((a, b) => a + b, 0) / rows.length)} ms</b>avg response</div><div class="tile"><b>${tin.toLocaleString()} / ${tout}</b>tokens in / out</div><div class="tile"><b>${avgTps}</b>tokens per second</div></div>
    <div class="dash2"><div><h3>Risk read so far</h3><div class="meter" role="img" aria-label="Risk read ${names[level]}">${meter}</div><p class="small" style="margin:6px 0 0"><span class="chip ${tone[level]}">${names[level]}</span> ${redSeen.size ? `${redSeen.size} red-flag signal${redSeen.size > 1 ? 's' : ''}: ${[...redSeen].map((s) => esc(SIGNAL_LABEL[s] || s)).join(', ')}` : 'no red-flag signals'}</p>
      <p class="small muted" style="margin:6px 0 0">${redSeen.size ? 'Code response: "This looks fine, continue" is hidden and a person is offered first.' : 'Code response: "continue" only appears after the member says they verified or decided on their own.'}</p></div>
      <div><h3>Response time per turn (ms)</h3>${barsSVG(lat, 'var(--accent)', 'ms')}</div></div>
    <h3>When each signal appeared</h3>${heat}
    <h3>Guardrails that changed its output</h3>${guards.length ? guards.map((g) => `<div class="why"><b>Turn ${g.turn}: ${esc(g.type)}</b><br>${esc(g.detail || '')}${g.blocked ? `<br><s class="muted">${esc(g.blocked)}</s>` : ''}</div>`).join('') : '<p class="muted small">None so far. Every reply passed the checks unchanged.</p>'}
    <h3>Turn by turn</h3>${turns}
    <p class="small"><a class="navlink2" href="inspector.html#kind=chat" target="_blank" rel="noopener">Open the full inspector ↗</a></p>`;
}

function configPopHTML() {
  const sc = scen(S.sc);
  const list = SCENARIOS.map((s) => `<button class="scn" data-act="scn" data-id="${s.id}" aria-pressed="${s.id === S.sc}"><b>${s.name === s.mid ? s.mid : s.name + ' · ' + s.mid}</b><span class="chip ${s.tag.startsWith('Look') ? 'green' : 'red'}">${s.tag}</span><br><span>${s.blurb}</span></button>`).join('');
  const demoBody = `<div class="pop-col">
      <h3 style="margin-top:0">Pick a story</h3><p class="muted small" style="margin:0 0 10px">Anchor personas and legitimate look-alikes from the synthetic data.</p><div class="story-grid">${list}</div></div>
      <div class="pop-col">
      <h3 style="margin-top:0">Settings</h3>
      <div class="small" role="radiogroup" aria-label="Harbor agent mode"><label><input type="radio" name="mode" data-act="mode" value="scripted" ${S.live.mode === 'scripted' ? 'checked' : ''}> Guided script</label>
        &nbsp; <label><input type="radio" name="mode" data-act="mode" value="live" ${S.live.mode === 'live' ? 'checked' : ''} ${S.live.avail ? '' : 'disabled'}> Live AI ${S.live.avail ? '<span class="chip ' + (S.live.provider === 'mock' ? 'amber' : 'green') + '">' + esc(S.live.provider === 'mock' ? 'mock test double' : S.live.provider + ' · ' + S.live.model) + '</span>' : '<span class="muted">(run <code>node harbor/server.js</code> with an API key)</span>'}</label></div>
      <div class="small" role="radiogroup" aria-label="Text size in the chat and notification" style="margin-top:8px">Text size in the chat and notification: <label><input type="radio" name="ts" data-act="tsize" value="large" ${S.textSize === 'large' ? 'checked' : ''}> Large</label>
        &nbsp; <label><input type="radio" name="ts" data-act="tsize" value="xl" ${S.textSize === 'xl' ? 'checked' : ''}> Extra large</label></div>
      ${S.live.backend ? `<p class="small" style="margin:10px 0 0"><span class="chip ${S.be.phase === 'error' ? 'red' : 'green'}">Live pipeline</span> ${S.be.phase === 'loading' ? 'streaming ' + S.be.done + '/' + (S.be.total || '?') + ' events into Kafka…' : S.be.phase === 'error' ? esc(S.be.err) : 'events go app → Kafka → scorer → Postgres → agent'}</p>` : ''}
      <div class="actions">
        <button class="btn alt sm" data-act="reset">Reset this story</button><button class="btn alt sm" data-act="resetall">Reset all</button>
        ${S.chat && !S.chat.outcome && S.phone.step === 'chat' ? '<button class="btn alt sm" data-act="timeout">Simulate no response (10 min)</button>' : ''}
        ${sc.id === 'closing' ? `<label class="small"><input type="checkbox" data-act="planned" ${S.planned ? 'checked' : ''}> Member declared a Planned Big Payment in advance</label>` : ''}
      </div></div>`;
  if (!S.ui.demoOpen) return '';
  return `<div class="pop-backdrop"><div class="pop" role="dialog" aria-modal="true" aria-label="Config"><div class="pop-h"><b>Config</b><span class="chip grey">${esc(sc.name)}</span><span class="chip ${S.live.mode === 'live' ? 'green' : 'grey'}">${S.live.mode === 'live' ? 'Live AI' : 'Guided'}</span><button type="button" class="pop-x" data-act="demo" aria-label="Close config">Close ×</button></div><div class="pop-b">${demoBody}</div></div></div>`;
}
function memberHTML() {
  const sc = scen(S.sc), dec = scenarioDecision(sc), m = mem[sc.mid], c = ctxOf(sc, dec);
  const rules = dec.rules.length ? dec.rules.map((r) => `<div class="why"><b>${esc(r.label)}</b><br>${esc(r.reason)}</div>`).join('') : `<div class="why" style="border-color:var(--green);background:var(--green-soft)">${noFlagExplain(sc.mid, dec)}</div>`;
  const sup = dec.suppress.length ? dec.suppress.map((s) => `<div class="why" style="border-color:var(--green);background:var(--green-soft)"><b>Why this is probably you:</b> ${esc(s)}</div>`).join('') : '';
  const ph = phoneHTML();
  const rec = R(), be = rec.be, total = D.events[sc.mid].findIndex((e) => e.id === dec.eventId);
  const seen = { sent: rec.phone.step !== 'review' && rec.phone.step !== 'sending', upto: rec.phone.step !== 'review' ? total + 1 : S.live.backend ? (be.phase === 'idle' ? 0 : be.phase === 'loading' ? Math.min(be.done, total) : total) : total,
    state: S.live.backend && be.phase === 'loading' ? `<span class="chip warn">Streaming ${be.done}/${be.total || '?'}…</span>` : '' };
  return `<div class="grid-member"><section aria-label="Member phone"><div class="phone${S.textSize === 'xl' ? ' xl' : ''}${S.phone.step === 'chat' ? ' is-chat' : S.phone.step === 'lock' ? ' is-lock' : ''}">${ph.html}</div></section>
    <section aria-label="What Harbor saw">
      ${coll('saw', esc(sc.name) + ' · ' + esc(sc.tag), `<p class="muted small"><b>Ground truth, hidden from Harbor:</b> ${esc(m.summary)}<br>Outcome in the data: <b>${esc(m.outcome)}</b>${m.loss ? ' · net loss ' + money(m.loss) : ''}</p>
      <h3>What Harbor saw (event stream) ${seen.state}</h3>${seen.upto ? timelineHTML(sc.mid, dec, sc.id === 'michael' ? 14 : 9, seen.upto) : '<p class="muted small">No events yet.</p>'}
      ${seen.sent ? `<h3>Harbor's decision at payment start ${levelChip(dec.level)}</h3>${rules}${sup}` : '<p class="muted small">Harbor decides the moment the payment starts. Press Send payment.</p>'}
      ${c.ato ? '<p class="small muted">Takeover path: Harbor texts the number on file <b>before</b> the change, never the attacker\'s session, and never asks for credentials or codes.</p>' : ''}`)}
    </section></div>`;
}

/* ---------- employee console ---------- */
const COACH = {
  ATO: ['Did you change your password, email or phone today?', 'Did you tap a link in a text or enter a code on a website?', 'Verify identity with details on file from before the change, not details given today.'],
  RAMP: ['How did you meet this person? Have you spoken on live video or met in person?', 'Has the amount they ask for been growing?', 'Have you been able to withdraw money from that platform?'],
  GENERAL: ['Who asked you to send this, and how did they contact you?', 'Has anyone told you to keep this secret or stay on the phone?', 'Can you reach the person directly on a number you already had?', 'What would happen if this waited until tomorrow?'],
};
const ACTIONS = [
  { t: 'Call member', log: 'Employee called member on pre-change number', status: 'Employee calling member', cls: '' },
  { t: 'Release payment', log: 'Payment released by employee after verification', status: 'Released by employee', cls: 'alt' },
  { t: 'Keep on hold', log: 'Kept on hold by employee', status: 'Kept on hold', cls: 'alt' },
  { t: 'Trusted contact', log: 'Offered trusted contact (member\'s choice)', status: 'Trusted contact offered', cls: 'alt' },
  { t: 'Escalate', log: 'Escalated to fraud team; case created', status: 'Escalated to fraud team', cls: 'alt' },
  { t: 'Start recovery', log: 'Recovery started: wire recall / dispute checklist opened', status: 'Recovery in progress', cls: 'danger' },
];
function analystBlock(k) {
  const an = k.real && k.real.analysis; if (!S.live.backend || !k.real) return '';
  if (!an) return '<div class="sum-k" style="margin-top:12px">Analyst</div><p class="small muted" style="margin:2px 0 0">Reviewing the account activity…</p>';
  const v = an.verdict || {}, act = { started_conversation: ['green', 'Started a conversation'], recorded_only: ['grey', 'Added as context'], blocked: ['warn', 'Blocked by a safety check'] }[an.action] || ['grey', an.action];
  return `<div class="sum-k" style="margin-top:12px">Analyst's read <span class="chip ${v.risk === 'high' ? 'red' : v.risk === 'medium' ? 'warn' : 'grey'}">${esc(v.risk || '')} risk</span> <span class="chip ${act[0]}">${act[1]}</span></div>
    <p class="sum-p" style="margin:4px 0 0">${esc(v.assessment || '')}</p>${(v.key_signals || []).length ? `<p class="small" style="margin:4px 0 0">${v.key_signals.map((x) => `<span class="chip grey">${esc(x)}</span>`).join(' ')}</p>` : ''}
    <p class="small muted" style="margin:4px 0 0">${esc(an.action_reason || '')}${v.capped ? ' · ' + esc(v.capped) : ''}</p>`;
}
function convoHTML(k) {
  if (!k) return '<p class="small muted">No conversation yet.</p>';
  const msgs = (k.msgs || []).length ? k.msgs : openingLines(k).map((t) => ({ f: 'bot', t }));
  const rec = recOf(k.mid), typing = rec && rec.chat && !rec.chat.outcome && (rec.chat.typing || (rec.chat.live && rec.chat.live.pending));
  return msgs.map((m) => `<div class="tl-msg ${m.f === 'emp' ? 'bot emp' : m.f}"><span>${m.f === 'me' ? 'Member' : m.f === 'emp' ? 'You' : 'Harbor'}</span>${esc(m.t)}</div>`).join('')
    + (typing ? '<div class="small muted">Harbor is typing…</div>' : '') + ((k.msgs || []).some((m) => m.f === 'me') ? '' : '<p class="small muted">Member has not replied yet.</p>');
}
function joinBanner(k) {
  const rec = recOf(k.mid), ch = rec && rec.chat, jr = ch && ch.joinReq;
  if (!jr || jr.answered || ch.human || ch.outcome) return '';
  return `<div class="joinreq" role="alert"><span class="jr-ic" aria-hidden="true">🙋</span><div class="jr-t"><b>Harbor asked you to join ${esc(memberName(k.mid))}'s chat</b><span class="small">${esc(jr.why)} · ${new Date(jr.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div><button type="button" class="btn sm" data-act="takeover">Join chat</button></div>`;
}
function composerHTML(k) {
  const rec = k && recOf(k.mid), ch = rec && rec.chat;
  if (!k || !ch) return k ? '<p class="small muted" style="margin:8px 0 0">The member has not opened the chat yet. You can take over once they do.</p>' : '';
  if (ch.outcome) return '<p class="small muted" style="margin:8px 0 0">This conversation has ended.</p>';
  if (!ch.human) return (ch.joinReq && !ch.joinReq.answered ? '<button class="btn sm block jr-pulse" data-act="takeover" style="margin-top:8px">🙋 Join chat (Harbor asked)</button>' : '<button class="btn sm block" data-act="takeover" style="margin-top:8px">Take over the chat</button>') + '<p class="small muted" style="margin:6px 0 0">Harbor stays in charge until you do. The member will see that a Sound team member joined.</p>';
  return `<form class="empbox" data-act="empform"><textarea id="empin" rows="2" maxlength="600" placeholder="Write to ${esc(memberName(k.mid))}…" aria-label="Message to the member">${esc(S.ui.empDraft || '')}</textarea>
    <div class="empbtns"><button class="btn sm" type="submit">Send</button><button type="button" class="btn alt sm" data-act="handback">Hand back to Harbor</button></div></form>`;
}
function takeOver(on) {
  const k = S.cases[S.sel], rec = k && recOf(k.mid), ch = rec && rec.chat; if (!ch || ch.outcome || ch.human === on) return;
  ch.human = on; ch.draining = false; ch.typing = false; if (on) { ch.queue = []; if (ch.live) ch.live.pending = false; }
  if (on && ch.joinReq && !ch.joinReq.answered) { ch.joinReq.answered = true; track('join_answered', ch, { why: ch.joinReq.why }, Date.now() - ch.joinReq.at); }
  ch.msgs.push({ f: 'sys', h: on ? 'A Sound team member has joined this chat.' : 'Harbor is back in the chat.' });
  const note = on ? 'Took over the chat from Harbor' : 'Handed the chat back to Harbor'; (k.acts ||= []).push(note); k.log.push(note); k.status = on ? 'Employee in the chat' : 'In conversation';
  const cid = caseId(ch); if (cid) post('/api/cases/' + cid + '/takeover', { on }).catch(() => {});
  if (!on) { S.ui.empFocus = false; if (ch.queue.length) drain(ch); }
}
function employeeSay(text) {
  const k = S.cases[S.sel], rec = k && recOf(k.mid), ch = rec && rec.chat; text = (text || '').trim().slice(0, 600);
  if (!ch || !ch.human || ch.outcome || !text) return;
  const last = (f) => { const m = [...ch.msgs].reverse().find((x) => x.f === f); return m ? stripHTML(m.h) : null; };
  track('employee_reply', ch, { text, member_said: last('me'), harbor_said: last('bot'), example: true });
  ch.msgs.push({ f: 'emp', h: esc(text) }); S.ui.empDraft = ''; mirror('out', text, true, ch, 'employee'); render();
}
function memberToHuman(text) {
  const ch = S.chat; text = (text || '').trim().slice(0, 600); if (!ch || !ch.human || !text) return;
  S.voice.draft = ''; ch.msgs.push({ f: 'me', h: esc(text) }); ch.answers.push({ q: 'to-employee', a: text }); mirror('in', text, true, ch); empPing('Member wrote to you: "' + (text.length > 70 ? text.slice(0, 70) + '…' : text) + '"'); render();
}
function actionsAside(k) {
  const [nt, nb] = k ? nextStep(k) : ['', ''];
  return `<aside class="cside" aria-label="Actions"><section class="card acts"><h2>Actions</h2>
    ${k ? `<div class="small" style="margin-bottom:8px"><b>${esc(memberName(k.mid))}</b> · ${esc(money(k.dec.amt))} ${esc(k.dec.rail)} ${statusChip(k)}</div><p class="small" style="margin:2px 0 10px" title="${esc(nb)}"><span class="sum-k">Next step</span> <b>${esc(nt)}</b></p>`
      : '<p class="small muted" style="margin:0 0 10px">Actions are available when Harbor holds a payment for review.</p>'}
    <div class="actcol">${ACTIONS.map((a, i) => `<button class="btn ${a.cls} sm" data-act="cact" data-i="${i}" ${k ? '' : 'disabled'}>${esc(a.t)}</button>`).join('')}</div>
    ${k && k.acts && k.acts.length ? `<div class="sum-k" style="margin-top:12px">Done so far</div><ul class="mini">${k.acts.slice(-3).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</section>
    <section class="card convo"><h2>Conversation ${k && stageOf(k) === 3 && !k.key ? '<span class="chip green">Live</span>' : ''}</h2><div class="cbody">${convoHTML(k)}</div>${composerHTML(k)}</section>${employeeFbHTML(k)}</aside>`;
}
const TRIGGER = { ATO: 'Takeover pattern', RAMP: 'Slow-burn ramp', HIGHSTAKES: 'Large wire or cash', CONTACT: 'Paid right after contacting Sound', FRESH: 'Bigger payment to someone new' };
const stripHTML = (h) => String(h).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const memberName = (mid) => (mem[mid] && mem[mid].persona) || 'Member ' + mid;
const txnEvent = (k) => D.events[k.mid].find((e) => e.id === k.dec.eventId) || {};
function headline(k) {
  const d = k.dec, ids = d.rules.map((r) => r.id), amt = money(d.amt), rail = railWord(d.rail), ev = txnEvent(k);
  if (ids.includes('ATO')) { const m = d.resetAt ? Math.round((d.t - d.resetAt) / 60000) : null; return `Possible account takeover. ${amt} ${rail} to a new recipient${m != null ? `, ${m} minutes after a password reset and a change of email and phone` : ''}.`; }
  if (ids.includes('RAMP')) return `Possible slow-burn scam. ${amt} ${rail} to a new recipient, after several smaller payments to people who are new to the account.`;
  if (ids.includes('HIGHSTAKES') || ids.includes('CONTACT')) return `Large ${rail}${ev.ratio ? ` (${ev.ratio.toFixed(1)}x this member's usual)` : ''}${d.rs === 'New' ? ' to a new recipient' : ''}${ids.includes('CONTACT') ? ', started right after the member contacted Sound' : ''}. Hard to reverse once sent.`;
  if (ids.includes('FRESH')) return `${amt} ${rail} to someone new, more than this member usually sends.`;
  return `${amt} ${rail} flagged for a quick check.`;
}
/* ---------- the console follows the demo: a case exists only once the payment is sent, and fills in as things happen ---------- */
const STAGE = { paused: 1, notified: 2, chat: 3, done: 4 };
const stageOf = (k) => STAGE[k.stage] || 1;
function statusChip(c) { const ok = (c.key && ['cancelled', 'release_light'].includes(c.key)) || /released|cancelled/i.test(c.status); return `<span class="chip ${ok ? 'green' : 'warn'}">${esc(c.status)}</span>`; }
function syncCase() { for (const rec of Object.values(S.rec)) syncOne(rec); }
function syncOne(rec) {
  const sc = scen(rec.id), mid = sc.mid, p = rec.phone.step, ch = rec.chat;
  if (p === 'review' || p === 'sending') { delete S.cases[mid]; return; }                         // the payment has not been sent in the demo yet: nothing is held
  const dec = scenarioDecision(sc);
  let k = S.cases[mid]; if (dec.level !== 'hold' && !k) return;           // pass-throughs and light checks only get a case when their chat ends
  if (!k) { k = S.cases[mid] = { mid, who: sc.name, tag: sc.tag, dec, status: 'Awaiting member response', answers: [], key: null, updated: 'Just now', msgs: [], stage: 'paused', log: [`Harbor paused ${money(dec.amt)} ${railWord(dec.rail)}`] }; }
  const v = S.live.backend && rec.be.view; if (v && v.member_id === mid) k.real = v;           // the real pipeline run (analyst, tags, timings) stays attached after the chat ends
  if (k.stage === 'done') return;
  if ((p === 'lock' || p === 'chat') && stageOf(k) < 2) { k.stage = 'notified'; k.log.push(`Check-in sent (${ctxOf(sc, dec).ato ? 'SMS to the phone on file before the change' : 'app notification'})`); }
  if (p === 'chat' && ch) {
    if (stageOf(k) < 3) { k.stage = 'chat'; k.log.push('Member opened the chat'); }
    if (!k.acts || !k.acts.length) k.status = 'In conversation'; k.msgs = ch.msgs.filter((m) => m.f === 'bot' || m.f === 'me' || m.f === 'emp').map((m) => ({ f: m.f, t: stripHTML(m.h) })); k.answers = ch.answers.slice();
    if (ch.live) { k.live = true; k.signals = Object.keys(ch.live.signals).filter((x) => ch.live.signals[x]); k.note = ch.live.note; k.state = ch.live.state; }
  }
  const o = k.real && k.real.messages.find((m) => m.direction === 'out'); if (o && stageOf(k) < 3) k.msgs = [{ f: 'bot', t: o.body }];
}
function stateLine(k) {
  if (k.key && OUTCOMES[k.key]) return OUTCOMES[k.key].status + '.';
  return ['', 'Payment is paused. Harbor is about to message the member.', 'Payment is paused. The check-in has gone out. With no reply in 10 minutes it comes to you.', 'Payment is paused. The member is talking with Harbor now.'][Math.min(stageOf(k), 3)] || 'Payment is paused.';
}
function openingLines(k) {
  const sc = scenOf(k.mid), c = ctxOf(sc, k.dec);
  const first = c.ato ? 'ato0' : c.planned ? 'planned' : k.dec.level === 'confirm' ? 'light' : 'start';
  return node(first, c).bot.map((b) => stripHTML(typeof b === 'string' ? b : b.sys));
}
function convoSummary(k) {
  const said = (k.msgs || []).filter((m) => m.f === 'me').map((m) => m.t);
  if (!said.length && !k.answers.length) return ['', "Harbor hasn't contacted the member yet.", "No conversation yet. Harbor's check-in has gone out and the member has not replied.", 'The member has opened the chat but has not replied yet.'][Math.min(stageOf(k), 3)] || 'No conversation yet.';
  const first = said[0] || (k.answers[0] && k.answers[0].a), bits = [`Member said: “${first}”`];
  if (k.live) bits.push((k.signals || []).length ? 'Harbor flagged ' + k.signals.map((s) => SIGNAL_LABEL[s].toLowerCase()).join(', ') + '.' : 'Harbor saw no risk signals.');
  if (k.note) bits.push(k.note);
  if (k.key && OUTCOMES[k.key]) { const st = OUTCOMES[k.key].status; bits.push('Outcome: ' + (/^[A-Z]{2}/.test(st) ? st : st.charAt(0).toLowerCase() + st.slice(1)) + '.'); }
  return bits.join(' ');
}
function nextStep(k) {
  const M = { cancelled: ['Nothing to do', 'The member cancelled. Optionally add a note.'], release_light: ['Nothing to do', 'Released after a light confirmation.'], callback: ['Call the member', 'They are expecting a call. Confirm the details, then release the payment.'],
    callback_fast: ['Call the member', 'They planned this payment. A quick callback, then release.'], human: ['Call the member now', 'They asked for a person. They already told Harbor their story, so do not make them repeat it.'],
    override: ['Offer the recall checklist', 'The member chose to send anyway. Explain recovery is harder, and check in tomorrow.'], paused_self: ['Check in tomorrow', 'The member is verifying. Keep the payment paused.'], paused_24: ['Check in tomorrow', 'Paused for 24 hours at the member\'s request.'],
    trusted_sent: ['Follow up', 'The trusted contact was told at the member\'s request. Offer a call.'], ato_stop: ['Secure the account', 'Call the number from before the changes, confirm recovery steps, and review the recipients.'], timeout: ['Reach out now', 'No reply. Wires and cash stay held. Call and use the open questions below.'] };
  return M[k.key] || (stageOf(k) <= 2 ? ['Wait for the member', 'Harbor is reaching out. If they ask for a person, or do not reply in 10 minutes, it comes to you.'] : ['Be ready to step in', 'The member is talking with Harbor right now. You can follow along below.']);
}
/* The case story at a glance: one line per step (icon by actor, short title, key facts as chips and symbols); the full text is one tap away. */
const STEP_ICON = {
  feed: '<path d="M4 6h16M4 12h11M4 18h7"/>', flag: '<path d="M5 21V4h11l-1.5 4L16 12H5"/>', rules: '<path d="M12 3l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
  pause: '<path d="M9 5v14M15 5v14"/>', tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="7.5" r="1.3"/>', search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  msg: '<path d="M4 5h16v11H9l-5 4z"/>', person: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>', spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/>',
  pin: '<path d="M12 21s-7-6-7-11a7 7 0 0114 0c0 5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>', next: '<path d="M5 12h14M13 6l6 6-6 6"/>',
};
const STEP_ACTOR = { 'Rules engine': 'rules', Pipeline: 'pipe', Model: 'model', Analyst: 'model', Harbor: 'harbor', Member: 'member', You: 'you' };
const SHORT_EVENT = { 'Password Reset': 'reset', 'Email Change': 'email', 'Phone Change': 'phone', 'Address Change': 'address', 'Recipient Added': 'new recipient', 'Branch Visit': 'branch visit', 'Contact Center Call': 'call' };
function stepsFor(k) {
  const d = k.dec, sc = scenOf(k.mid), c = ctxOf(sc, d), st = stageOf(k), steps = [];
  const clip = (t, n) => (t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t), chip = (cls, t, title) => `<span class="chip ${cls}"${title ? ` title="${esc(title)}"` : ''}>${esc(t)}</span>`;
  const riskCls = (r) => (r === 'high' ? 'red' : r === 'medium' ? 'warn' : 'grey'), quote = (t, n) => `<span class="gq">“${esc(clip(t, n))}”</span>`;
  const evid = keyEvents(k.mid, d.t, 14).filter((e) => isEvidence(e, d));
  steps.push({ id: 'feed', ic: 'feed', a: 'Pipeline', t: 'Activity', s: 'done', time: evid[0] ? fmt(evid[0].t) : '',
    g: evid.length ? evid.map((e) => chip('grey', SHORT_EVENT[e.type] || (e.type === 'Payment Initiated' ? money(e.amt) + ' ' + e.rail : e.type), fmt(e.t) + ': ' + evLabel(e))).join('<span class="arr" aria-hidden="true">→</span>') : '<span class="muted">routine activity</span>',
    b: evid.length ? `Events stream in as one ordered feed per member. These are the ones that mattered:<ul class="mini">${evid.map((e) => `<li><span class="muted">${fmt(e.t)}</span> ${esc(evLabel(e))}</li>`).join('')}</ul>` : 'Routine activity. Nothing unusual before the payment.' });
  if (d.armed && d.armedAt) steps.push({ id: 'flag', ic: 'flag', a: 'Rules engine', t: 'Account flagged', s: 'done', time: fmt(d.armedAt), g: chip('warn', 'at risk') + chip('grey', 'silent: member sees nothing'),
    b: 'A password reset followed by a new email or phone number, close together. The member sees nothing yet. Harbor just watches for the next payment.' });
  const fired = d.trace ? d.trace.filter((r) => r.fired) : [];
  const checks = fired.map((r) => `<div class="chk"><b>${esc(TRIGGER[r.id] || r.id)}</b>${r.checks.map((x) => `<span class="${x.pass ? 'ok' : 'no'}"><span aria-hidden="true">${x.pass ? '✔' : '✖'}</span> ${esc(x.label)} <i>${esc(String(x.value))}</i></span>`).join('')}</div>`).join('');
  steps.push({ id: 'rules', ic: 'rules', a: 'Rules engine', t: 'Rules decided', s: 'done', time: fmt(d.t),
    g: chip(d.level === 'hold' ? 'red' : 'amber', d.level === 'hold' ? '⏸ Pause' : '? Light check') + chip('grey', money(d.amt) + ' ' + d.rail + (d.rs === 'New' ? ' · new recipient' : '')) +
      fired.map((r) => `<span class="rulehit" title="${esc(r.checks.map((x) => (x.pass ? '✔ ' : '✖ ') + x.label).join('\n'))}">${esc(TRIGGER[r.id] || r.id)} <span class="ticks" aria-label="${r.checks.filter((x) => x.pass).length} of ${r.checks.length} checks passed">${r.checks.map((x) => (x.pass ? '✓' : '✗')).join('')}</span></span>`).join('') +
      (d.suppress.length ? chip('green', 'look-alike: lowered', d.suppress.join(' ')) : ''),
    b: `${money(d.amt)} ${esc(railWord(d.rail))}${d.rs === 'New' ? ' to a new recipient' : ''}. ${d.rules.length === 1 ? 'One rule' : d.rules.length + ' rules'} matched, so the result is <b>${d.level === 'hold' ? 'pause the payment' : 'a light check'}</b>.${checks}${d.suppress.length ? `<div class="small">Look-alike check: ${d.suppress.map(esc).join(' ')}</div>` : ''}` });
  const rl = k.real, tm = rl && rl.timings;
  steps.push({ id: 'held', ic: 'pause', a: 'Pipeline', t: 'Payment held', s: 'done', time: tm && tm.alerted ? new Date(tm.alerted).toLocaleTimeString() : '',
    g: (tm && tm.decide_ms != null ? chip('grey', `⚡ ${tm.decide_ms} ms`) : '') + chip('grey', 'pending, not sent') + chip('grey', 'alert → Kafka'),
    b: (tm ? `<div class="small"><b>Real run:</b> rules decided in ${tm.decide_ms} ms · alert <code>${esc(rl.alert ? rl.alert.alert_id : '')}</code> saved to Postgres and published to Kafka.</div>` : '') + 'The payment stays pending instead of completing, which buys a window of minutes. The alert is saved, then published for the agent. Each member gets one case, so a second alert joins this one instead of sending another message.' });
  if (rl && rl.note) steps.push({ id: 'tag', ic: 'tag', a: 'Model', t: 'Event tagged', s: 'done',
    g: chip(riskCls(rl.note.risk), rl.note.tag.replace(/_/g, ' ')) + chip(riskCls(rl.note.risk), rl.note.risk + ' risk') + `<span class="muted small">${esc(rl.note.source === 'llm' ? '3B model' : 'rule tag')}${rl.note.latency_ms == null ? '' : ' · ' + (rl.note.latency_ms / 1000).toFixed(1) + ' s'} · advisory</span>`,
    b: `<span class="chip ${riskCls(rl.note.risk)}">${esc(rl.note.tag)}</span> risk ${esc(rl.note.risk)}: ${esc(rl.note.note)}<div class="small muted">${esc(rl.note.source === 'llm' ? rl.note.model : 'rule tag')} · ${rl.note.latency_ms == null ? '' : rl.note.latency_ms + ' ms · '}advisory only: it never messages a member on its own.</div>` });
  const an = rl && rl.analysis;
  if (an) { const v = an.verdict || {}, act = { started_conversation: ['green', 'started a check-in'], recorded_only: ['grey', 'added as context'], blocked: ['warn', 'blocked by a check'] }[an.action] || ['grey', an.action];
    steps.push({ id: 'analyst', ic: 'search', a: 'Analyst', t: 'Analyst read', s: 'done', g: chip(riskCls(v.risk), (v.risk || '?') + ' risk') + chip(act[0], act[1]) + `<span class="gq">${esc(clip(String(v.assessment || '').split(/(?<=\.)\s/)[0], 64))}</span>`,
      b: `${esc(v.assessment || '')}<div class="small muted">${esc(an.action_reason || '')} · ${esc(an.model || 'no model')} · ${an.latency_ms} ms. It scanned ${an.events_seen} tagged events from Postgres. It can only recommend a light check-in; code applies the safety checks.</div>` }); }
  const first = k.msgs && k.msgs.find((m) => m.f === 'bot'), preview = (first ? [first.t] : openingLines(k).slice(0, 2)).map(esc).join('<br>');
  const way = c.ato ? 'By SMS to the phone number on file <b>before</b> the changes, never the attacker\'s session.' : 'As an app notification.';
  const wayChip = chip('grey', c.ato ? '📱 SMS → pre-change phone' : '🔔 app push');
  steps.push(st >= 2 ? { id: 'checkin', ic: 'msg', a: 'Harbor', t: 'Check-in sent', s: 'done',
    g: wayChip + (tm && tm.compose_source ? chip(tm.compose_source === 'llm' ? 'green' : 'warn', tm.compose_source === 'llm' ? `✍ model · ${(tm.compose_ms / 1000).toFixed(1)} s` : '✍ template', tm.compose_fallback || '') : '') + (first ? quote(first.t.replace(/^Hi[^.]*\.\s*/, ''), 70) : ''),
    b: `${way} It never asks for a password or code.<div class="quote">${preview}</div>${tm && tm.compose_source ? `<div class="small muted">Written by ${tm.compose_source === 'llm' ? esc(tm.compose_model || 'the model') : 'the safe template (' + esc(tm.compose_fallback || 'model too slow') + ')'} in ${tm.compose_ms} ms${tm.delivered ? ', delivered ' + new Date(tm.delivered).toLocaleTimeString() : ''}.</div>` : ''}` }
    : { id: 'checkin', ic: 'msg', a: 'Harbor', t: 'Check-in next', s: 'wait', g: wayChip, b: `Next, Harbor messages the member. ${way}<div class="quote">${preview}</div>` });
  const mine = (k.msgs || []).filter((m) => m.f === 'me'), said = mine.length ? mine.map((m) => m.t) : k.answers.map((x) => x.a);
  if (st < 2) steps.push({ id: 'member', ic: 'person', a: 'Member', t: 'Not contacted yet', s: 'todo', g: '', b: 'Waiting for the check-in to go out.' });
  else if (said.length) steps.push({ id: 'member', ic: 'person', a: 'Member', t: 'Member replied', s: 'done', g: said.slice(0, 2).map((t) => quote(t, 48)).join('') + (said.length > 2 ? `<span class="muted small">+${said.length - 2} more</span>` : ''),
    b: `<div class="quote">${said.slice(0, 4).map((t) => '“' + esc(t) + '”').join('<br>')}</div>` });
  else if (st >= 3) steps.push({ id: 'member', ic: 'person', a: 'Member', t: 'Reading the chat', s: 'wait', g: '<span class="muted small">no reply yet</span>', b: 'They are reading Harbor\'s messages and have not replied yet.' });
  else steps.push({ id: 'member', ic: 'person', a: 'Member', t: 'Waiting for the member', s: 'wait', g: chip('grey', '⏱ 10 min, then a person'), b: 'No reply yet. With no answer in 10 minutes the case comes to you, and wires and cash stay held.' });
  if (k.live && ((k.signals || []).length || k.note || mine.length)) steps.push({ id: 'read', ic: 'spark', a: 'Harbor', t: 'Harbor understood', s: 'done',
    g: ((k.signals || []).length ? k.signals.map((x) => chip(RED.includes(x) ? 'red' : 'grey', SIGNAL_LABEL[x])).join('') : '<span class="muted small">no risk signals</span>') + (k.state ? chip(k.state === 'calm' ? 'green' : 'warn', k.state) : ''),
    b: `${(k.signals || []).length ? k.signals.map((x) => `<span class="chip ${RED.includes(x) ? 'red' : 'grey'}">${esc(SIGNAL_LABEL[x])}</span>`).join(' ') : '<span class="muted">No risk signals.</span>'} ${k.state ? `<span class="chip ${k.state === 'calm' ? 'green' : 'warn'}">${esc(k.state)}</span>` : ''}${k.note ? `<div class="small" style="margin-top:6px"><b>Note for you:</b> ${esc(k.note)}</div>` : ''}<div class="small muted">The AI reads the words. Code decides which options the member is offered.</div>` });
  else if (!k.live && mine.length) steps.push({ id: 'read', ic: 'spark', a: 'Harbor', t: 'Guided script', s: 'done', g: chip('grey', 'fixed questions, no model'),
    b: 'It asked what the payment was for, then follow-up questions based on the answers, and offered a person, a pause, or cancelling at each step.' });
  const where = k.key && OUTCOMES[k.key] ? OUTCOMES[k.key].status : ['', 'Payment held. Check-in not sent yet', 'Awaiting member response', 'Member is talking with Harbor'][Math.min(st, 3)];
  const good = (k.key && ['cancelled', 'release_light'].includes(k.key)) || /released|cancelled/i.test(where);
  steps.push({ id: 'status', ic: 'pin', a: k.key ? 'Harbor' : 'Pipeline', t: 'Status', s: k.key ? 'done' : 'wait', g: chip(good ? 'green' : 'warn', where),
    b: `<b>${esc(where)}</b>${k.key && OUTCOMES[k.key] ? `<div class="small muted">${esc(OUTCOMES[k.key].text)}</div>` : ''}` });
  const [nt, nb] = nextStep(k);
  steps.push({ id: 'next', ic: 'next', a: 'You', t: 'Your next step', s: 'todo', g: `<b class="nextact">${esc(nt)}</b>`, b: esc(nb) });
  return steps;
}
function stepsHTML(k) {
  const seen = k.stepSeen ||= {}, open = S.ui.st ||= {}; let fresh = 0;
  return `<ol class="steps2">${stepsFor(k).map((s) => {
    const key = k.mid + ':' + s.id, isNew = !seen[s.id], o = !!open[key]; seen[s.id] = 1;
    return `<li class="st2 ${s.s}${isNew ? ' fresh' : ''}" data-a="${STEP_ACTOR[s.a] || 'pipe'}"${isNew ? ` style="animation-delay:${fresh++ * 90}ms"` : ''}>
      <span class="si" title="${esc(s.a)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${STEP_ICON[s.ic]}</svg><span class="sr">${esc(s.a)}, ${s.s === 'done' ? 'done' : s.s === 'wait' ? 'in progress' : 'to do'}</span></span>
      <div class="sm"><div class="st-h"><b>${esc(s.t)}</b>${s.time ? `<time>${esc(s.time)}</time>` : ''}</div>${s.g ? `<div class="sg">${s.g}</div>` : ''}${o ? `<div class="sbody">${s.b}</div>` : ''}</div>
      <button type="button" class="sx" data-act="stp" data-k="${esc(key)}" aria-expanded="${o}" aria-label="${o ? 'Hide' : 'Show'} details: ${esc(s.t)}" title="${o ? 'Hide' : 'Show'} details">${o ? '−' : '+'}</button></li>`;
  }).join('')}</ol>`;
}
function disc(k, title, body) {
  const o = !!S.ui.d[k];
  return `<div class="disc"><button type="button" class="disc-h" data-act="disc" data-k="${k}" aria-expanded="${o}"><span>${title}</span><svg class="chev ${o ? 'open' : ''}" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"></path></svg></button>${o ? `<div class="disc-b">${body}</div>` : ''}</div>`;
}
function txnHTML(k) {
  const d = k.dec, ev = txnEvent(k), cash = d.rail === 'Cash';
  const to = cash ? `<b>Cash withdrawal</b><div>Handed over at the branch</div><div class="small muted">No recipient account</div>` :
    `<b>${esc(ev.rid || 'Recipient')}</b><div>${d.rs === 'New' ? 'New recipient' : 'Existing recipient'}</div><div class="small muted">${ev.rage != null ? (ev.rage === 0 ? 'Added today' : 'Added ' + ev.rage + ' days ago') : ''}</div>`;
  const facts = [['Method', esc(railWord(d.rail).replace(/^./, (m) => m.toUpperCase())) + (ev.ch ? ' · ' + esc(ev.ch) : '')], ['Started', fmt(d.t)], ['Payment ID', esc(d.pid || ev.pid || '–')], ['Payment status', k.key === 'cancelled' ? 'Cancelled' : k.key === 'release_light' ? 'Released' : 'Held by Harbor'],
    ['Compared with usual', ev.ratio != null ? ev.ratio.toFixed(1) + 'x' + (ev.vs && ev.vs !== 'Not Applicable' ? ' · ' + esc(ev.vs.toLowerCase()) : '') : '–'], ['Payment speed', ev.vel && ev.vel !== 'Not Applicable' ? esc(ev.vel.toLowerCase()) : '–']];
  return `<div class="txn"><div class="txn-side"><div class="k">From</div><b>${esc(memberName(k.mid))}</b><div>Checking account</div><div class="small muted">Member ${esc(k.mid)}${ev.bal != null ? ' · balance ' + money(ev.bal) : ''}</div></div>
    <div class="txn-mid"><div class="amt">${money(d.amt)}</div><div class="arrow" aria-hidden="true">→</div></div>
    <div class="txn-side"><div class="k">To</div>${to}</div></div>
    <dl class="facts">${facts.map(([a, b]) => `<div><dt>${a}</dt><dd>${b}</dd></div>`).join('')}</dl>`;
}
const notSentYet = (sc) => { const r = S.rec[sc.id]; return !r || r.phone.step === 'review' || r.phone.step === 'sending'; };
const joinChip = (sc) => { const r = S.rec[sc.id], c = r && r.chat; return c && c.joinReq && !c.joinReq.answered && !c.human && !c.outcome ? '<span class="chip red">🙋 Join requested</span>' : ''; };
function qListHTML() {
  const q = (S.ui.qText || '').trim().toLowerCase();
  const rows = SCENARIOS.map((sc) => ({ sc, k: S.cases[sc.mid], dec: scenarioDecision(sc) })).filter(({ sc, k, dec }) => { const f = (k || { dec }).dec.rules[0];
    return !q || [memberName(sc.mid), sc.mid, sc.name, sc.tag, money(dec.amt), dec.rail, f && TRIGGER[f.id], k ? k.status : notSentYet(sc) ? 'not sent yet' : 'no held payment'].join(' ').toLowerCase().includes(q); });
  if (!rows.length) return `<p class="muted small" style="padding:12px 14px;margin:0">No member matches “${esc(S.ui.qText)}”.</p>`;
  return rows.map(({ sc, k, dec }) => { const f = (k || { dec }).dec.rules[0];
    return `<button type="button" class="qitem" role="option" data-act="qpick" data-id="${sc.mid}" aria-selected="${sc.mid === S.sel}"><b>${esc(memberName(sc.mid))}</b><span class="small muted">${esc(sc.mid)}</span><span>${money(dec.amt)} ${esc(dec.rail)}</span>${f && k ? `<span class="chip grey">${esc(TRIGGER[f.id] || f.id)}</span>` : ''}${joinChip(sc)}${k ? statusChip(k) : notSentYet(sc) ? '<span class="chip grey">Not sent yet</span>' : '<span class="chip green">No held payment</span>'}</button>`; }).join('');
}
function consoleHTML() {
  const selId = SCENARIOS.some((x) => x.mid === S.sel) ? S.sel : scen(S.sc).mid, sc = scenOf(selId), ids = Object.keys(S.cases), notSent = notSentYet(sc);
  const k = S.cases[selId];
  S.sel = selId;
  const first = (c) => c.dec.rules[0], trig = (c) => (first(c) ? `<span class="chip grey">${esc(TRIGGER[first(c).id] || first(c).id)}</span>` : '');
  const cur = S.cases[selId], at = ids.indexOf(selId);
  const label = cur ? `<b>${esc(memberName(selId))}</b> <span class="small muted">${esc(selId)}</span><span>${money(cur.dec.amt)} ${esc(cur.dec.rail)}</span>${trig(cur)}${joinChip(sc)}${statusChip(cur)}`
    : `<b>${esc(memberName(sc.mid))}</b> <span class="small muted">${esc(sc.mid)}</span>${notSent ? '<span class="chip grey">Not sent yet</span>' : '<span class="chip green">No held payment</span>'}`;
  const queue = `<section class="card qbox"><div class="qrowbar">
    <div class="qfield">${S.ui.qOpen ? `<input id="qsearch" type="search" autocomplete="off" aria-label="Search held payments" placeholder="Search by name, amount, method, rule or status…" value="${esc(S.ui.qText)}"><div class="qlist" id="qlist" role="listbox">${qListHTML()}</div>`
      : `<button type="button" class="qcur" data-act="qopen" aria-haspopup="listbox" aria-expanded="false">${label}<svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"></path></svg></button>`}</div>
    </div></section>`;
  if (!k) {
    const dec = scenarioDecision(sc);
    return `<div class="console2">${queue}<div class="cgrid"><div class="cmain"><section class="card"><h2>${esc(sc.name)} · ${esc(sc.tag)} <span class="chip grey">${esc(sc.mid)}</span></h2>
      ${notSent ? `<p><span class="chip grey">Not sent yet</span> The payment in this story has not been sent. Pick this story in Config and press <b>Send payment</b>: Harbor evaluates it and the held payment appears here, filling in as the demo goes.</p>` : ''}${notSent ? '' : `<p><span class="chip green">No case</span> ${dec.level === 'none' ? 'Harbor let this payment through, so there is nothing for staff to review.' : 'Harbor is asking the member a light question now. The payment waits for their answer, and it comes to you only if they ask for a person or something looks wrong.'}</p>
      ${dec.level === 'none' ? `<p class="small muted">${noFlagExplain(sc.mid, dec)}</p>` : ''}<p class="small muted">That is the point for this story: a legitimate member goes through without a hold or a phone call.</p>`}</section><section class="card"><h2>Live events</h2>${liveFeed(sc)}</section></div>${actionsAside(null)}</div></div>`;
  }
  S.sel = selId;
  const d = k.dec, isRamp = d.rules.some((r) => r.id === 'RAMP'), isAto = d.rules.some((r) => r.id === 'ATO');
  const coach = (isAto ? COACH.ATO : isRamp ? COACH.RAMP : COACH.GENERAL).map((q) => `<li>${esc(q)}</li>`).join('');
  const risk = d.rules.some((r) => ['ATO', 'RAMP', 'HIGHSTAKES', 'CONTACT'].includes(r.id)) ? ['High risk', 'red'] : ['Medium risk', 'warn'];
  return `<div class="console2">${queue}<div class="cgrid"><div class="cmain">
    ${joinBanner(k)}<section class="card op"><div class="op-h"><h2>${esc(memberName(k.mid))} · ${esc(k.tag)} <span class="chip grey">${esc(k.mid)}</span></h2>${statusChip(k)}</div>
      <div class="sum"><div class="sum-k">What this is about</div><p class="sum-h">${esc(headline(k))}</p>
        <div class="sum-chips"><span class="chip ${risk[1]}">${risk[0]}</span>${d.rules.map((r) => `<span class="chip grey">${esc(TRIGGER[r.id] || r.id)}</span>`).join('')}<span class="chip grey">${isAto ? 'SMS to the old phone' : 'App notification'}</span></div>
        ${analystBlock(k)}<div class="sum-k" style="margin-top:12px">Conversation so far</div><p class="sum-p">${esc(convoSummary(k))}</p><p class="small" style="margin:6px 0 0"><b>Status:</b> ${esc(stateLine(k))}</p></div>
      <h3>Live events</h3>${liveFeed(sc)}
      <h3>Transaction</h3>${txnHTML(k)}
      <h3>What happened</h3>${stepsHTML(k)}
      <div class="discs">
        ${disc('ev', 'Evidence timeline', timelineHTML(k.mid, d, 8))}
        ${disc('coach', 'Conversation coach: open questions, no blame', `<ul class="coach">${coach}</ul><p class="small muted">Say: "I'm checking because it's your money." Avoid: "suspicious", "you've been scammed".</p>`)}
        ${disc('log', 'Case log', `<div class="log">${k.log.map((l) => '• ' + esc(l)).join('<br>')}</div>`)}
      </div></section>${coll('log', 'Model log for this conversation', logHTML(), logBadge())}</div>${actionsAside(k)}</div></div>`;
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

/* ---------- live triggers: what each event does as it moves through the pipeline, following the demo ---------- */
const ARM_NOTE = 'Account flagged as at risk. The member sees nothing yet.';
function feedFor(sc, upto) {
  const evs = D.events[sc.mid], cfg = { planned: S.planned ? PLANS[sc.mid] : undefined }, st = E.createState(), out = [];
  for (const e of evs.slice(0, upto)) {
    const was = st.armedAt, d = E.step(st, e, cfg), armedNow = was === null && st.armedAt !== null;
    if (!KEY.includes(e.type) || (e.type === 'Payment Initiated' && e.dir !== 'Outgoing')) continue;
    const note = { 'Password Reset': 'Noted. A reset on its own does nothing.', 'Email Change': 'Noted: contact details changed.', 'Phone Change': 'Noted: contact details changed.', 'Address Change': 'Noted. An address change alone is a weak signal.',
      'Recipient Added': 'New recipient on file. Counts as "new" for 30 days.', 'Branch Visit': 'Contact with Sound noted. A large payment soon after would matter.', 'Contact Center Call': 'Contact with Sound noted. A large payment soon after would matter.',
      'Profile Change Alert Sent': 'The member was told about the change.' }[e.type];
    if (d) out.push({ e, cls: d.level === 'none' ? '' : 'hit', note: d.level === 'none' ? 'Checked all 5 rules: none matched. Let through.' : 'Rules matched: ' + d.rules.map((r) => TRIGGER[r.id] || r.id).join(', ') + '.' });
    else out.push({ e, cls: armedNow ? 'hit' : '', note: armedNow ? ARM_NOTE : note || '' });
  }
  return out;
}
function decideCard(dec, tm) {
  const fired = dec.trace.filter((r) => r.fired), missed = dec.trace.filter((r) => !r.fired);
  const why = (r) => { const f = r.checks.find((c) => !c.pass); return f ? `<span class="small muted">${esc(TRIGGER[r.id] || r.id)}: ${esc(f.label)} <i>(${esc(String(f.value))})</i></span>` : ''; };
  return `<p><b>${money(dec.amt)} ${esc(railWord(dec.rail))}</b>${dec.rs === 'New' ? ' to a new recipient' : ''} arrived. The rules ran ${tm && tm.decide_ms != null ? `in <b>${tm.decide_ms} ms</b>` : 'instantly'}, no model involved. Result: ${levelChip(dec.level)}</p>
    ${fired.map((r) => `<div class="chk"><b>${esc(TRIGGER[r.id] || r.id)}</b>${r.checks.map((x) => `<span class="${x.pass ? 'ok' : 'no'}"><span aria-hidden="true">${x.pass ? '✔' : '✖'}</span> ${esc(x.label)} <i>${esc(String(x.value))}</i></span>`).join('')}</div>`).join('')}
    ${dec.suppress.map((x) => `<div class="why" style="border-color:var(--green);background:var(--green-soft)"><b>Look-alike check lowered it:</b> ${esc(x)}</div>`).join('')}
    ${fired.length ? '' : `<p class="small muted">${noFlagExplain(dec.mid || '', dec)}</p>`}
    ${missed.length ? `<div class="small muted" style="margin-top:8px">Did not match:</div><div class="miss">${missed.map(why).join('<br>')}</div>` : ''}`;
}
const FEED_ROWS = 4;
/** Sizes the live-events box to its last 4 rows (rows differ in height) and keeps the reader's place across re-renders:
 *  at the bottom it follows new events, scrolled up it stays where it was. */
function fitFeed(keep) {
  const box = document.getElementById('feedbox'); if (!box) return;
  const lis = box.querySelectorAll('li'), n = lis.length;
  box.style.maxHeight = n > FEED_ROWS ? (lis[n - 1].offsetTop + lis[n - 1].offsetHeight - lis[n - FEED_ROWS].offsetTop + 2) + 'px' : '';
  box.scrollTop = !keep || keep.end ? box.scrollHeight : keep.top;
}
function liveFeed(sc) {
  const rec = S.rec[sc.id], be = rec ? rec.be : { phase: 'idle', done: 0, total: 0 }, dec = scenarioDecision(sc), total = D.events[sc.mid].findIndex((e) => e.id === dec.eventId), p = rec ? rec.phone.step : 'review';
  const decided = rec && p !== 'review' && p !== 'sending';
  const upto = !rec ? 0 : decided ? total + 1 : p === 'sending' ? total : S.live.backend ? (be.phase === 'idle' ? 0 : be.phase === 'loading' ? Math.min(be.done, total) : total) : total;
  const feed = feedFor(sc, upto);                                            // all of them: the box shows the latest 4 and scrolls for the rest
  const tg = (rec && ((rec.be.view && rec.be.view.tags) || rec.be.tags)) || {};
  const chips = (id) => { const t = tg[id]; return t ? `<br><span class="chip grey">${esc(t.category || '')}</span> <span class="chip tg ${t.risk}" title="${esc(t.note || '')}">${esc(t.tag.replace(/_/g, ' '))}${t.new_tag ? ' · new tag' : ''}</span>` : S.live.backend ? '<br><span class="small muted">tagging…</span>' : ''; };
  const li = (f) => `<li class="${f.cls}"><time>${fmt(f.e.t)}</time><span>${esc(evLabel(f.e))}${f.note ? `<br><span class="small ${f.cls ? '' : 'muted'}">${esc(f.note)}</span>` : ''}${chips(f.e.id)}</span></li>`;
  const state = S.live.backend && be.phase === 'loading' ? `<span class="chip warn">Streaming ${be.done}/${be.total || '?'} events…</span> ` : '';
  return `${state}${feed.length ? `<div class="feedbox" id="feedbox" tabindex="0" aria-label="Live events, newest at the bottom"><ul class="tl">${feed.map(li).join('')}</ul></div>${feed.length > FEED_ROWS ? `<p class="small muted feedcap">Latest ${FEED_ROWS} of ${feed.length} · scroll up for earlier</p>` : ''}` : `<p class="muted small">${rec ? 'No events yet.' : 'This story has not been started. Pick it in Config to stream its events.'}</p>`}
    ${p === 'sending' ? '<p class="small"><span class="chip warn">Rules running…</span> The payment just arrived.</p>' : decided ? '' : upto >= total && rec ? '<p class="small"><span class="chip grey">Waiting</span> The account picture is built. Nothing decides until an outgoing payment starts.</p>' : ''}`;
}

/* ---------- architecture + live pipeline ---------- */
const T = (x, y, s, cls = 'dg-s', anchor = 'start') => `<text class="${cls}" x="${x}" y="${y}" text-anchor="${anchor}">${esc(String(s).replace(/^ +/, (m) => '\u00a0'.repeat(m.length)))}</text>`;   // SVG collapses leading spaces; keep continuation indents
const box = (x, y, w, h, cls, title, lines, badge) => `<g><rect class="dg-box ${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="12"/>${T(x + 12, y + 24, title, 'dg-t')}` +
  lines.map((l, i) => T(x + 12, y + 46 + i * 18, l)).join('') + (badge ? `<rect x="${x + w - 62}" y="${y + 8}" width="50" height="20" rx="10" class="dg-badge ${badge === 'no LLM' ? 'no' : ''}"/>${T(x + w - 37, y + 22, badge, 'dg-badge-t', 'middle')}` : '') + '</g>';
function archSVG() {
  const topic = (x, y, w, h, name, sub) => `<g><rect class="dg-box dg-topic" x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2 > 22 ? 12 : h / 2}"/>${T(x + w / 2, y + 22, name, 'dg-t', 'middle')}${sub ? T(x + w / 2, y + 40, sub, 'dg-s', 'middle') : ''}</g>`;
  const a = (d, dash, head = true) => `<path class="dg-arrow${dash ? ' dash' : ''}" d="${d}"${head ? ' marker-end="url(#ah2)"' : ''}/>`;
  const rot = (x, y, s, deg) => T(x, y, s, 'dg-s', 'middle').replace('<text', `<text transform="rotate(${deg} ${x} ${y})"`);
  return `<svg viewBox="0 0 1440 1100" class="dg" role="img" aria-label="Harbor architecture: the browser app calls one API server, which streams a story into Kafka; the rules scorer decides alerts, a small-model tagger and an analyst add advisory context in Postgres, the agent opens one case per member and messages them, an employee can take over, and a retro job re-enters findings. Models run on Ollama.">
  <defs><marker id="ah2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L10 5L0 10z" class="dg-head"/></marker></defs>
  <g><rect class="dg-box dg-ok" x="20" y="10" width="1400" height="70" rx="12"/>${T(34, 36, 'Browser app  (localhost:8787, served by the API server)', 'dg-t')}
    ${T(34, 60, 'Member app: pick a story, Send payment, chat by voice or text   ·   Employee console: case, live events, take over the chat, actions   ·   Dev tools: simulator, architecture, live pipeline, model inspector')}</g>
  ${a('M310 80V123')}${T(322, 104, 'via the API server: story history, then the payment')}
  ${a('M1230 80V108')}${T(1242, 104, 'chat · take over · actions')}

  ${box(20, 110, 180, 130, '', 'Event sources', ['core banking · mobile', 'online · branch · call', 'center. Demo: the API', 'server or replayer.js'])}
  ${a('M200 165H228')}
  ${topic(230, 125, 160, 80, 'events.raw', 'key = member_id')}${T(310, 224, '6 partitions', 'dg-s', 'middle')}${T(310, 242, 'group harbor-scorer', 'dg-s', 'middle')}
  ${topic(230, 300, 160, 56, 'events.dlq', 'from any consumer')}${T(310, 376, 'after 3 failed tries;', 'dg-s', 'middle')}${T(310, 394, 'redrive-dlq.js re-sends', 'dg-s', 'middle')}
  ${a('M230 328H213V190H228', true)}
  ${a('M390 165H428')}

  ${box(430, 110, 230, 150, 'dg-decide', 'scorer.js  (fast path)', ['rules engine (harbor/engine.js)', 'flag account, then check payment', 'member_state cache + Postgres', 'decision + alert in one txn', 'outbox sweeper every 5 s', 'decides in about 1-7 ms'], 'no LLM')}
  ${a('M660 130H998')}${T(830, 122, 'alert (outbox): published after commit', 'dg-s', 'middle')}
  ${a('M660 200H690V270H708')}${T(666, 192, 'writes', 'dg-s')}
  ${a('M545 260V288')}
  ${topic(430, 290, 230, 56, 'events.scored', 'every event · group harbor-tagger')}
  ${a('M545 346V378')}
  ${box(430, 380, 230, 175, 'dg-teal', 'tagger.js  (every event)', ['qwen2.5:3b + tools: list_tags,', '   create_tag, tag_event', '3 workers, live events first', 'catch-up sweep every 20 s', 'data checks cap the risk', 'rules quiet + high: review queue', 'advisory: never messages anyone'], 'LLM')}
  ${a('M660 430H708')}${T(685, 422, 'notes', 'dg-s', 'middle')}
  ${a('M545 555V588')}
  ${topic(430, 590, 230, 56, 'analysis.requests', 'group harbor-analyst')}${T(545, 664, 'sent on a rules alert or a medium / high tag', 'dg-s', 'middle')}
  ${a('M660 618H700V740H708')}

  <g><rect class="dg-box" x="710" y="250" width="250" height="390" rx="12"/>${T(724, 274, 'Postgres 16   :5439', 'dg-t')}${T(724, 294, 'container harbor-postgres')}
    ${['events · decisions · member_state', '   ← scorer, idempotent', 'alerts (outbox) ← scorer', 'event_notes · tags · review_queue', '   ← tagger', 'analyses ← analyst', 'cases · case_alerts · messages', '   ← agent + API', 'retro_findings ← retro (deduped)', 'members · ground_truth ← seed.js', 'v_rule_outcomes (view, tuning)', 'feedback · interactions ← the app'].map((l, i) => T(724, 322 + i * 21, l)).join('')}
    ${T(724, 622, 'the full history, alerted or not')}</g>
  ${box(710, 700, 250, 150, 'dg-teal', 'analyst.js', ['qwen2.5:14b · one run per member', 'reads tagged history, rule', '   findings, look-alike context', 'may start a light check-in; code', '   gates it (cooldown 5 min)'], 'LLM')}
  ${a('M835 700V643', true)}${T(845, 676, 'scans', 'dg-s')}
  ${box(430, 700, 230, 130, 'dg-arm', 'retro.js  (cron, 24 h)', ['SQL detectors over Postgres:', 'slow ramps, late takeovers,', 'large unflagged payments,', 'quiet cases. LLM: one sentence'], 'LLM')}
  ${a('M960 760H985', false, false)}${a('M660 765H690V870H985V280H998')}${rot(997, 560, 'check-ins (gated) + retro findings', -90)}

  ${topic(1000, 110, 34, 190, '', '')}${rot(1017, 205, 'alerts.risk  ·  6 partitions', -90)}${T(1017, 100, 'group harbor-agent', 'dg-s', 'middle')}
  ${a('M1034 160H1078')}
  ${box(1080, 110, 300, 320, 'dg-teal', 'agent-service.js   :8787', ['app + API server; consumes alerts.risk', 'one open case per member; rate', '   limit (not for takeover)', 'takeover: SMS to the pre-change phone', 'first message: lib/compose.js,', '   LLM + code checks, else template', 'chat: harbor/agent.js; code adds', '   safety lines, picks the buttons', 'staff take over / hand back', 'case timer 5 s: no reply in 10 min', '   → escalate to a person', 'routes: /api/demo/*, /api/cases/*,', '   /api/console, /api/chat, /api/traces'], 'LLM')}
  ${a('M1080 380H962', true)}${T(1036, 372, 'reads / writes', 'dg-s', 'middle')}
  ${a('M1230 430V498')}
  ${topic(1130, 500, 200, 56, 'notifications.out', 'group harbor-delivery')}
  ${a('M1230 556V578')}
  ${box(1130, 580, 200, 70, '', 'Delivery adapter', ['stub; swap in SMS / push'])}
  ${a('M1230 650V678')}
  ${box(1130, 680, 200, 70, 'dg-ok', 'Member', ['replies in the chat'])}
  ${a('M1130 715H1065V415H1078', true)}
  ${a('M1380 300H1410V835H1382')}${rot(1425, 560, 'escalate: asked for a person, no reply, takeover', 90)}
  ${box(1080, 780, 300, 110, 'dg-ok', 'Employee console', ['case summary, live events, transaction', 'analyst read and model log', 'take over / hand back the chat'])}
  ${box(1080, 910, 300, 100, 'dg-arm', 'Ollama   :11434   (on the host)', ['qwen2.5:3b: tagger', 'qwen2.5:14b: analyst, first message,', '   chat, retro sentence'])}

  <g><rect class="dg-box" x="20" y="700" width="370" height="210" rx="12"/>${T(34, 726, 'Design rules', 'dg-t')}
    ${['An alert never waits on an LLM.', 'Key = member_id: one member, one ordered', '   partition, so stateful rules stay correct.', 'At-least-once delivery + idempotent keys', '   (event_id, alert_id): replays are safe.', 'LLMs are advisory. They write notes and', '   messages; rules and code decide actions.', 'Every failure lands in the DLQ with a redrive.'].map((l, i) => T(34, 752 + i * 20, l)).join('')}</g>

  <g><rect class="dg-box" x="20" y="1030" width="1400" height="62" rx="12"/>${T(34, 1054, 'Where it runs', 'dg-t')}${T(160, 1054, 'Teal pills: Kafka topics on harbor-redpanda (Docker, localhost:19092)   ·   Postgres: harbor-postgres (Docker, localhost:5439)')}
    ${T(160, 1076, 'Node processes: backend/scripts/start-all.sh, logs in backend/.logs   ·   Ollama on the host   ·   every model call is logged to harbor/.traces and shown in the Model inspector')}</g>
  </svg>`;
}
S.pipe = { data: null, cases: [], sel: null, detail: null, err: null, draft: '', busy: false, timer: null };
async function pipeFetch() {
  try {
    const [d, c, f, ev] = await Promise.all([fetch(API + '/api/pipeline').then((r) => r.json()), fetch(API + '/api/cases').then((r) => r.json()), fetch(API + '/api/feedback').then((r) => r.json()).catch(() => []), fetch(API + '/api/interactions').then((r) => r.json()).catch(() => [])]);
    S.pipe.feedback = f; S.pipe.interactions = ev;
    S.pipe.data = d; S.pipe.cases = c; S.pipe.err = null;
    if (!S.pipe.sel && c[0]) S.pipe.sel = c[0].case_id;
    if (S.pipe.sel) S.pipe.detail = await fetch(API + '/api/cases/' + S.pipe.sel).then((r) => r.json());
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
  try { await post(`/api/cases/${S.pipe.sel}/reply`, { text }); } catch (e) { /* shown by next poll */ }
  S.pipe.busy = false; await pipeFetch(); render();
}
function pipeHTML() {
  const P = S.pipe, d = P.data;
  if (P.err || !d) return `<div class="card"><h2>Live pipeline</h2><p class="muted">${P.err ? 'The backend is not reachable at ' + API + '.' : 'Connecting…'}</p>
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
  <section class="card">${det}</section></div>
  <div class="sim" style="margin-top:16px"><section class="card"><h2>Tag vocabulary</h2><p class="muted small" style="margin-top:0">The small model reads this table and may add a tag when none fits. Green tags were created by the model.</p>
    ${(d.tags || []).map((t) => `<span class="chip ${t.created_by === 'llm' ? 'green' : 'grey'}" title="${esc(t.description)}">${esc(t.name.replace(/_/g, ' '))} · ${t.uses}</span>`).join(' ') || '<span class="muted small">No tags yet.</span>'}</section>
  <section class="card"><h2>Analyst reviews</h2>${(d.analyses || []).length ? `<div class="tablewrap"><table><thead><tr><th>Member</th><th>Trigger</th><th>Read</th><th>Decision</th></tr></thead><tbody>${d.analyses.map((a) => `<tr><td>${esc(a.member_id)}</td><td class="small">${esc(a.trigger_reason || '')}</td><td class="small">${esc((a.verdict || {}).assessment || '')}</td><td><span class="chip ${a.action === 'started_conversation' ? 'green' : a.action === 'blocked' ? 'warn' : 'grey'}">${esc(a.action.replace('_', ' '))}</span><div class="small muted">${esc(a.action_reason || '')}</div></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">No reviews yet. The analyst runs when a rule alerts or an event is tagged medium or high.</p>'}</section></div>
  ${feedbackHTML(S.pipe.feedback || [], S.pipe.interactions || [])}`;
}
function feedbackHTML(rows, ev) {
  const rated = (src) => rows.filter((r) => r.source === src && r.kind === 'rating'), m = rated('member'), e = rated('employee'), v = rows.filter((r) => r.kind === 'verdict');
  const mean = (a) => (a.length ? (a.reduce((x, r) => x + r.score, 0) / a.length).toFixed(1) : '–'), nv = (x) => v.filter((r) => r.score === x).length;
  const rating = (r) => (r.kind === 'verdict' ? `<span class="chip ${VERDICT[r.score][1]}">${VERDICT[r.score][0]}</span>` : `<b>${r.score}/5</b> ${r.source}`);
  const list = rows.slice(0, 12).map((r) => `<tr><td>${esc(r.member_id || '')}</td><td>${rating(r)}</td><td class="small">${esc(r.outcome || '')}${r.mode ? ' · ' + esc(r.mode) : ''}</td><td class="small">${esc(r.comment || '')}</td><td class="small muted">${esc(r.agent_version || '')}</td></tr>`).join('');
  const k = (x) => ev.filter((r) => r.kind === x), ch = k('chose'), times = ch.map((r) => r.ms).filter((x) => x != null).sort((x, y) => x - y);
  const median = times.length ? (times[Math.floor(times.length / 2)] / 1000).toFixed(1) + ' s' : '–', voice = ch.filter((r) => r.detail && r.detail.how === 'voice').length + k('voice').length;
  const tile = (b, l) => `<div class="tile"><b>${b}</b>${l}</div>`;
  return `<section class="card" style="margin-top:16px"><h2>Feedback and interaction log</h2><p class="muted small" style="margin-top:0">Members rate Harbor 1-5 when a conversation ends; employees rate each case 1-5 and record the final verdict at close-out. The interaction log records what each member was offered and chose. Everything is stored with the agent version, and passwords or codes are masked first (<code>/api/feedback</code>, <code>/api/interactions</code>).</p>
    <div class="tiles">${tile(mean(m), `average member rating (${m.length})`)}${tile(mean(e), `average employee rating (${e.length})`)}${tile(v.length ? `${nv(1)} / ${nv(-1)} / ${nv(0)}` : '–', 'verdicts: scam / legitimate / unsure')}
      ${tile(ch.length, 'choices logged')}${tile(median, 'median time to choose')}${tile(voice, 'voice uses')}${tile(k('abandoned').length, 'chats abandoned')}${tile(k('fallback').length, 'Live AI fallbacks')}${tile(k('employee_reply').length, 'employee example replies')}</div>
    ${rows.length ? `<div class="tablewrap"><table><thead><tr><th>Member</th><th>Rating</th><th>Outcome</th><th>Comment</th><th>Agent version</th></tr></thead><tbody>${list}</tbody></table></div>` : '<p class="muted small">No feedback yet.</p>'}</section>`;
}
function archHTML() {
  return `<div class="card"><h2>System architecture</h2><p class="muted">The browser app talks to one API server. Choosing a story streams that member's events into Kafka; Send payment sends the trigger event. Two paths then process the same stream. The <b>fast path</b> decides alerts with deterministic rules in about a millisecond. The <b>slow path</b> tags every event with a small model that can read and extend a tag table; it can only queue a human review. When something notable is tagged, an <b>analyst agent</b> scans Postgres for the member's tagged history and may recommend a light check-in, behind safety checks in code. Alerts reach a notification agent that owns the conversation. A retro cron re-enters findings through the same topic. <b>Every model output passes code checks before it matters</b>: data checks cap the tagger's risk, the analyst can only recommend, the first message is repaired or replaced by a template, and each chat reply is shaped by code (safety lines, one question, buttons chosen from the signals). Staff wording never reaches the member. The hosted GitHub Pages copy has no backend: it runs the same rules in the browser.</p>${archSVG()}</div>`;
}

/* ---------- notes ---------- */
function notesHTML() {
  return `<div class="notes">
  <div class="card"><h2>Trigger: event-based, two stages</h2><p><b>Step 1, flag the account:</b> a password reset, then an email or phone change, quietly marks the account as at risk. The member sees nothing. <b>Step 2, check the payment:</b> when a payment starts, rules look at account state, rail, recipient age and the member's baseline. Hold, then Harbor reaches the member. Payments sit in <i>Pending</i> for 1-14 minutes in the data, which is the window.</p>
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
  syncCase();
  document.querySelectorAll('nav [role=tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === S.tab));
  { const dev = ['sim', 'arch', 'pipe', 'notes'].includes(S.tab), db = $('#devBtn'); db.setAttribute('aria-selected', dev); db.setAttribute('aria-expanded', !!S.ui.devOpen); $('#devMenu').hidden = !S.ui.devOpen;
    document.querySelectorAll('#devMenu [data-tab]').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === S.tab ? 'page' : 'false')); }
  const bd = $('#badge'); bd.hidden = !S.unread; bd.textContent = S.unread;
  const fb0 = document.getElementById('feedbox'), feedKeep = fb0 && { top: fb0.scrollTop, end: fb0.scrollHeight - fb0.scrollTop - fb0.clientHeight < 8 };
  $('#view').innerHTML = { member: memberHTML, console: consoleHTML, sim: simHTML, arch: archHTML, pipe: pipeHTML, notes: notesHTML }[S.tab]();
  const cb = $('#chatbody'); if (cb) cb.scrollTop = cb.scrollHeight;
  { const ei = document.getElementById('empin'); if (ei && S.ui.empFocus && document.activeElement !== ei) { ei.focus(); ei.setSelectionRange(ei.value.length, ei.value.length); } }
  if (S.tab === 'console' && S.ui.log && (S.log.mid !== S.sel || Date.now() - S.log.at > 4000)) refreshLog();
  const cv = document.querySelector('.convo .cbody'); if (cv) cv.scrollTop = cv.scrollHeight;
  fitFeed(feedKeep);
  const cb2 = $('#cfgBtn'); if (cb2) { cb2.setAttribute('aria-expanded', !!S.ui.demoOpen); $('#cfgInfo').textContent = scen(S.sc).name + ' · ' + (S.live.mode === 'live' ? 'Live AI' : 'Guided'); }
  const cp = $('#cfgpop'); if (cp) cp.innerHTML = configPopHTML();
  document.body.classList.toggle('modal-open', !!S.ui.demoOpen);
  if (S.ui.qOpen && S.tab === 'console') { const qi = document.getElementById('qsearch'); if (qi && document.activeElement !== qi) { qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length); } }
  if (S.ui.demoOpen && !S.ui.popFocused) { S.ui.popFocused = true; const x = document.querySelector('.pop-x'); if (x) x.focus(); }
  if (!S.ui.demoOpen) S.ui.popFocused = false;
}
function resetStory(id = S.sc) {                                           // only an explicit Reset (or a changed setting) starts a story over
  const rec = S.rec[id]; stopVoice(); S.voice.draft = ''; S.voice.err = null;
  if (rec && rec.chat && !rec.chat.outcome) track('abandoned', rec.chat, { node: rec.chat.live ? 'live' : rec.chat.cur, messages: rec.chat.msgs.length, member_replies: rec.chat.answers.length }, Date.now() - rec.chat.startedAt);
  if (rec) { rec.be.dead = true; if (rec.chat) rec.chat.dead = true; delete S.cases[rec.mid]; delete S.rec[id]; }
  S.log.rows = [];
}
function showStory(id) { stopVoice(); S.voice.draft = ''; S.sc = id; S.sel = scen(id).mid; S.log.rows = []; if (S.live.backend && !S.rec[id]) beginStory(R()); }
function resetAll() { for (const id of Object.keys(S.rec)) resetStory(id); S.cases = {}; S.unread = 0; if (S.live.backend) beginStory(R()); }
document.addEventListener('click', (ev) => {
  if (S.ui.demoOpen && !ev.target.closest('.pop, .cfgbtn')) { S.ui.demoOpen = false; render(); }
  if (S.ui.devOpen && (!ev.target.closest('.devmenu') || ev.target.closest('a[role=menuitem]'))) { S.ui.devOpen = false; render(); }
  if (S.ui.qOpen && !ev.target.closest('.qfield')) { S.ui.qOpen = false; render(); }
}, true);
document.addEventListener('keydown', (ev) => {
  if (ev.target.id === 'qsearch') {
    if (ev.key === 'Escape') { S.ui.qOpen = false; render(); }
    else if (ev.key === 'Enter') { const f = document.querySelector('#qlist .qitem'); if (f) { ev.preventDefault(); f.click(); } }
    else if (ev.key === 'ArrowDown') { const f = document.querySelector('#qlist .qitem'); if (f) { ev.preventDefault(); f.focus(); } }
    return;
  }
  if (ev.key === 'Escape' && S.ui.devOpen) { S.ui.devOpen = false; render(); const b = $('#devBtn'); if (b) b.focus(); return; }
  if (ev.key === 'Escape' && S.ui.demoOpen) { S.ui.demoOpen = false; render(); const b = document.querySelector('.cfgbtn'); if (b) b.focus(); } });
document.addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-act],[data-tab]');
  if (!t && ev.target.closest('#chatbody') && S.chat && !S.chat.outcome && !S.ui.footMin) { S.ui.footMin = true; render(); return; }   // tap the conversation: collapse the reply panel
  if (!t) return;
  if (t.dataset.tab) { S.ui.devOpen = false; S.tab = t.dataset.tab; if (S.tab === 'console') { const w = (S.ui.pingSel && recOf(S.ui.pingSel)) || waitingJoin(); if (w) S.sel = w.mid; S.ui.pingSel = null; S.unread = 0; const tb = document.querySelector('[data-tab=console]'); if (tb) tb.classList.remove('lit'); const pg = $('#ping'); if (pg) pg.hidden = true; } if (S.tab === 'pipe') pipeStart(); return render(); }
  const a = t.dataset.act;
  if (a === 'scn') { S.ui.demoOpen = false; showStory(t.dataset.id); }
  else if (a === 'send' && S.live.backend && S.be.phase === 'ready') { sendPayment(); return; }
  else if (a === 'send' && S.live.backend) return;
  else if (a === 'send') { const d0 = scenarioDecision(scen(S.sc)); empPing(d0.level === 'none' ? 'Member sent the payment: it went through' : 'Member sent the payment: Harbor held it'); const d = d0; S.phone = { step: d.level === 'none' ? 'sent' : d.level === 'hold' ? 'paused' : 'chat' }; if (S.phone.step === 'chat') startChat(); }
  else if (a === 'notify') S.phone = { step: 'lock' };
  else if (a === 'open') { S.phone = { step: 'chat' }; startChat(); empPing('Member opened the chat'); }
  else if (a === 'choose') choose(+t.dataset.i);
  else if (a === 'person') { chosen(S.chat, 'Talk to a person', -1, 0, 'tap'); empPing('Member asked to talk to a person'); mirror('in', 'Talk to a person', true); S.chat.msgs.push({ f: 'me', h: 'Talk to a person' }); S.chat.answers.push({ q: 'person', a: 'Talk to a person' }); finish('human'); }
  else if (a === 'timeout') finish('timeout');
  else if (a === 'takeover') takeOver(true);
  else if (a === 'handback') takeOver(false);
  else if (a === 'expand') { S.ui.footMin = false; render(); const ta = $('#livein'); if (ta) ta.focus(); return; }
  else if (a === 'mic') { if (S.ui.footMin) { S.ui.footMin = false; render(); } S.voice.on ? stopVoice(true) : startVoice(); return; }
  else if (a === 'demo') S.ui.demoOpen = !S.ui.demoOpen;
  else if (a === 'dev') S.ui.devOpen = !S.ui.devOpen;
  else if (a === 'disc') S.ui.d[t.dataset.k] = !S.ui.d[t.dataset.k];
  else if (a === 'stp') { const st = S.ui.st ||= {}; st[t.dataset.k] = !st[t.dataset.k]; }
  else if (a === 'qopen') { S.ui.qOpen = true; S.ui.qText = ''; }
  else if (a === 'qpick') { S.sel = t.dataset.id; S.ui.qOpen = false; S.ui.qText = ''; }
  else if (a === 'coll') { S.ui[t.dataset.k] = !S.ui[t.dataset.k]; if (t.dataset.k === 'log' && S.ui.log) refreshLog(); }
  else if (a === 'rawt') S.ui.raw[t.dataset.id] = !S.ui.raw[t.dataset.id];
  else if (a === 'mfb') S.chat.fb.score = +t.dataset.v;
  else if (a === 'mfbsend') { memberFeedback(S.chat); return; }
  else if (a === 'efb' || a === 'efbredo') { const k = S.cases[S.sel]; if (!k) return; k.efb = a === 'efb' ? Object.assign(k.efb, { score: +t.dataset.v }) : { text: k.efb.text }; }
  else if (a === 'efbsend') { const k = S.cases[S.sel]; if (k) employeeFeedback(k, 'rating'); return; }
  else if (a === 'vfb' || a === 'vfbredo') { const k = S.cases[S.sel]; if (!k) return; k.vfb = a === 'vfb' ? Object.assign(k.vfb, { score: +t.dataset.v }) : { text: k.vfb.text, loss: k.vfb.loss, recovered: k.vfb.recovered }; }
  else if (a === 'ftc' || a === 'ftccopy' || a === 'ftcopen') {
    const k = S.cases[S.sel]; if (!k) return; const ui = (S.ui.ftc ||= {})[k.mid] ||= {};
    if (a === 'ftc') { ui.open = true; }
    else if (a === 'ftcopen') { const note = 'Opened ' + ftcReport(k).siteName + ' to file the report with the member'; (k.acts ||= []).push(note); k.log.push(note); return; }   // the link itself opens the site
    else { const r = ftcReport(k), all = t.dataset.i === 'all', text = all ? r.fields.map(([l, v]) => l + ': ' + v).join('\n') : r.fields[+t.dataset.i][1];
      copyText(text).then(() => { ui.copied = all ? 'Report copied. Paste it into the form with the member.' : 'Copied: ' + r.fields[+t.dataset.i][0]; render(); }).catch(() => { ui.copied = 'Copy failed: select the text and copy it by hand.'; render(); });
      if (all && !ui.logged) { ui.logged = true; const note = 'Prepared an FTC report for the member to file'; (k.acts ||= []).push(note); k.log.push(note);
        const rr = recOf(k.mid), v = S.live.backend && rr && rr.be.view; if (v && v.case) post('/api/cases/' + v.case.case_id + '/action', { text: note }).catch(() => {}); }
      return; }
  }
  else if (a === 'vfbsend') { const k = S.cases[S.sel]; if (k) employeeFeedback(k, 'verdict'); return; }
  else if (a === 'reset') { S.ui.demoOpen = false; resetStory(); if (S.live.backend) beginStory(R()); }
  else if (a === 'resetall') { S.ui.demoOpen = false; resetAll(); }
  else if (a === 'cact') {
    const k = S.cases[S.sel], ac = ACTIONS[+t.dataset.i]; if (!k || !ac) return;
    (k.acts ||= []).push(ac.log); k.log.push(ac.log); k.status = ac.status; k.updated = 'Just now';
    const r = recOf(S.sel), v = S.live.backend && r && r.be.view; if (v && v.case) post('/api/cases/' + v.case.case_id + '/action', { text: ac.log }).catch(() => {});
  }
  else if (a === 'sim') S.sim.selId = t.dataset.id;
  else if (a === 'pcase') { S.pipe.sel = t.dataset.id; pipeFetch(); }
  else if (a === 'preply') { pipeReply(); return; }
  else if (a === 'presolve') { post(`/api/cases/${S.pipe.sel}/resolve`, { outcome: t.dataset.v }).catch(() => {}).then(pipeFetch); return; }
  else return;
  render();
});
document.addEventListener('change', (ev) => {
  const t = ev.target, a = t.dataset.act;
  if (a === 'planned') { S.planned = t.checked; resetStory(); if (S.live.backend) beginStory(R()); }
  else if (a === 'plannedAll') S.sim.plannedAll = t.checked;
  else if (a === 'ftcconsent') { const k = S.cases[S.sel]; if (k) ((S.ui.ftc ||= {})[k.mid] ||= {}).consent = t.checked; }
  else if (a === 'mode') { S.live.mode = t.value; S.live.chosen = true; }   // applies to the next chat; nothing is reset
  else if (a === 'tsize') { S.textSize = t.value === 'xl' ? 'xl' : 'large'; try { localStorage.setItem('harbor-textsize', S.textSize); } catch (e) { /* storage blocked */ } }
  else if (a === 'filter') S.sim.filter = t.value;
  else return;
  render();
});
document.addEventListener('input', (ev) => {
  const t = ev.target; if (t.id === 'livein') { S.voice.draft = t.value; return; }
  if (t.id === 'empin') { S.ui.empDraft = t.value; return; }
  if (t.id === 'mfbtext') { S.chat.fb.text = t.value; return; }
  if (t.id === 'efbtext') { const k = S.cases[S.sel]; if (k) k.efb.text = t.value; return; }
  if (['vfbtext', 'vfbloss', 'vfbrec'].includes(t.id)) { const k = S.cases[S.sel]; if (k) k.vfb[{ vfbtext: 'text', vfbloss: 'loss', vfbrec: 'recovered' }[t.id]] = t.value; return; }
  if (t.id === 'qsearch') { S.ui.qText = t.value; const l = document.getElementById('qlist'); if (l) l.innerHTML = qListHTML(); return; }
  if (t.dataset.act !== 'slider') return;
  S.sim.cfg[t.dataset.k] = +t.value; const pos = document.activeElement === t; render();
  if (pos) { const n = document.querySelector(`[data-k="${t.dataset.k}"]`); if (n) n.focus(); }
});
document.addEventListener('focusin', (ev) => { S.ui.empFocus = ev.target.id === 'empin'; });
document.addEventListener('submit', (ev) => {
  if (ev.target.dataset.act === 'empform') { ev.preventDefault(); const t = $('#empin'); if (t) employeeSay(t.value); return; }
  if (ev.target.dataset.act !== 'liveform') return; ev.preventDefault();
  const ta = $('#livein'); if (ta && ta.value.trim()) { if (S.chat && S.chat.human) memberToHuman(ta.value); else sendLive(ta.value); }
});
document.addEventListener('keydown', (ev) => {
  if ((ev.target.id === 'livein' || ev.target.id === 'empin') && ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); ev.target.form.requestSubmit(); }
});
render();
checkLive();
})();

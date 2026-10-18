// Harbor's FIRST message to a member about an alert: written by the model from the facts, checked by code, with a safe template as the fallback.
const cfg = require('./config'), llm = require('./llm');

const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
const railWord = (r) => ({ P2P: 'P2P payment', Wire: 'wire', Cash: 'cash withdrawal', 'External Transfer': 'external transfer', ACH: 'ACH payment' }[r] || String(r || 'payment').toLowerCase());
/** What the member may be told about why something was flagged: plain facts, no rule names, thresholds or staff wording. */
const MEMBER_WHY = { ATO: 'your password, email and phone number were all changed just before this payment started', RAMP: 'there have been a few payments to new people lately, and this one is bigger',
  HIGHSTAKES: 'this is much more than usual, and it is hard to get back once sent', CONTACT: 'this came right after contact with Sound, and it is a large payment', FRESH: 'this is more than you usually send to someone new',
  ANALYST: 'some recent activity on the account looks different from usual' };      // the analyst's own assessment is staff-facing and never reaches the member
const whyFor = (a) => (a.rules ? a.rules.map((r) => MEMBER_WHY[r.id] || 'this looks different from usual activity') : [a.summary]);
const planned = (a) => (a.suppress || []).some((s) => /Planned Big Payment/.test(s));
const NEVER = 'Sound will never ask for your password or a code, and never asks you to move money.';

function template(a, name) {
  const hi = name ? `Hi ${name}, this is Harbor, your security analyst at Sound.` : 'Hi, this is Harbor, your security analyst at Sound.';
  const amt = a.amount ? money(a.amount) : 'a payment';
  if (a.source === 'analyst') return `${hi} I noticed some recent activity on your account that looks different from usual, and I'd like to check it with you. Nothing has been paused, and nothing is wrong on your side. ${NEVER} Does anything on your account look unfamiliar to you?`;
  if (a.source === 'retro') return `${hi} I'm checking in on some recent activity: ${a.summary} Nothing is wrong on your side. If anything looks unfamiliar, you can talk to a Sound employee right away. ${NEVER} Does any of it look unfamiliar to you?`;
  if (a.ato) return `${hi} A few minutes ago the password, email and phone number on your account were changed, and a ${amt} ${railWord(a.rail)} to a new recipient was started. I've paused it, so nothing has left your account, and you're in control. ${NEVER} Did you make those changes? Either answer is okay.`;
  if (a.level === 'confirm' && planned(a)) return `${hi} Your ${amt} ${railWord(a.rail)} matches the Planned Big Payment you set up, so this is just one quick step. There's no rush. ${NEVER} Did you confirm the account details by phone, using a number you already had?`;
  if (a.level === 'confirm') return `${hi} I wanted to check in on your ${amt} ${railWord(a.rail)} to a newer recipient, since it's more than you usually send. There's no rush. ${NEVER} Could you tell me what this payment is for?`;
  return `${hi} I'm sorry to interrupt. I've paused your ${amt} ${railWord(a.rail)} for a quick check, so nothing has been sent, and you're in control. There's no rush. ${NEVER} Could you tell me what this payment is for?`;
}

const SYSTEM = `You write the FIRST outbound message from Harbor, the member's personal security analyst at Sound Credit Union, to a member about their account. Plain language, warm, calm and caring, like a kind person at the credit union who is looking out for them: 3-5 short sentences. Open with "Hi <first name>, this is Harbor, your security analyst at Sound." (without the name if none is given). The credit union is called "Sound", never anything else. Briefly acknowledge you may be interrupting, and reassure them there is no rush. Return ONLY JSON {"message": "..."}.
Rules: say only what Sound's systems know, in plain words, from the facts given; you do NOT yet know why the member is doing this, so do not mention scams, impersonation, police, banks or government, and give no warnings or advice about them; never say "scam", "fraud" or "criminal"; never ask for passwords, PINs or codes; do not promise safety or recovery; do not include links; say that Sound never asks for a password or code or to move money; END with exactly one gentle open question the member can answer in their own words. Write amounts like $1,574 (no cents). Use the member's first name only if given.
The input JSON has a must_say list (state every item in your own words) and a question to end with (you may reword it kindly). The input "check" says whether the payment is held or only being checked: for a light check never say paused, held or blocked.
Light check example: {"message": "Hi Dana, this is Harbor, your security analyst at Sound. I'm sorry to interrupt. I wanted to check in on your $3,000 P2P payment before it goes out, since it's more than you usually send. There's no rush. Sound never asks for your password or a code, or to move money. Could you tell me what this payment is for?"}
Held payment example: {"message": "Hi Dana, this is Harbor, your security analyst at Sound. I'm sorry to interrupt. I've paused your $4,000 wire for a quick check, so nothing has been sent, and you're in control. There's no rush. Sound never asks for your password or a code, or to move money. Could you tell me what this payment is for?"}`;

function brief(a, name) {
  // written as the member will read them ("you"): the model tends to copy these phrases word for word
  const must = a.source === 'analyst' ? ['some recent activity on your account looks different from usual', 'nothing has been paused or stopped']
    : a.completed ? ['your payment already went through']
    : a.level === 'hold' ? ['I paused your payment', 'nothing has been sent', "you're in control"]
    : ['this is just a quick check before your payment goes out' + (planned(a) ? ', because it matches the Planned Big Payment you set up' : '')];
  if (a.amount && a.source !== 'analyst') must.push('the amount and method: ' + money(a.amount) + ' ' + railWord(a.rail));
  if (a.ato) must.push('your password, email and phone number were changed just before this payment started');
  const question = a.source === 'analyst' ? 'Does anything on your account look unfamiliar to you?' : a.ato ? 'Did you make those changes? Either answer is okay.' : a.level === 'confirm' && planned(a) ? 'Did you confirm the account details by phone, using a number you already had?' : 'Could you tell me what this payment is for?';
  return { first_name: name || null, check: a.completed ? 'follow-up on a completed payment' : a.level === 'hold' ? 'held payment' : 'light check', source: a.source, takeover_suspected: !!a.ato, payment_already_completed: !!a.completed,
    amount: a.amount ? money(a.amount) : null, rail: railWord(a.rail), why: whyFor(a), must_say: must, end_with_question: question };
}

/** Code fixes what it safely can (the brand name, the "never asks" line) and rejects what it cannot.
 *  Returns { text } when the message passes, or { reason } naming the first failed check (stored with the template message for analysis). */
function check(a, text) {
  if (!text) return { reason: 'no message from the model' };
  text = text.replace(/\bSouth Sound\b/g, 'Sound').replace(/\bSound Credit Union\b/g, 'Sound');
  if (!/never ask/i.test(text)) { const q = text.lastIndexOf('. ') + 2; text = q > 1 ? text.slice(0, q) + NEVER + ' ' + text.slice(q) : text; }
  const paused = /\b(paused|on hold|held|blocked)\b/i;
  const CHECKS = [
    ['too long', () => text.length <= 700],
    ['an analyst check-in talked about a pending payment', () => a.source !== 'analyst' || !/going through|goes out|before (your|the) payment|been sent|paused your/i.test(text)],
    [a.level === 'hold' ? 'did not say paused and nothing sent' : 'called a light check paused or sent', () => a.completed || a.source === 'analyst' || (a.level === 'hold' ? paused.test(text) && /\bnothing\b/i.test(text) : !paused.test(text) && !/going through|been sent|on its way/i.test(text))],
    ['amount missing', () => !a.amount || text.includes(money(a.amount))],
    ['not exactly one closing question', () => (text.match(/\?/g) || []).length === 1 && /\?\s*(either answer is okay\.?)?$/i.test(text)],
    ['did not introduce Harbor as security analyst', () => /security analyst/i.test(text)],
    ['"never asks" line missing', () => /never ask/i.test(text)],
    ['takeover message without the password change', () => !(a.ato && !/password/i.test(text))],
    ['blocked wording', () => !llm.agent.BAD_REPLY.some((r) => r.test(text)) && !/\b(scam|fraud|criminal)\b/i.test(text)],
    ['third person ("the member")', () => !/\bthe member\b/i.test(text)],
  ];
  const failed = CHECKS.find(([, ok]) => !ok());
  return failed ? { reason: failed[0] } : { text };
}

async function compose(a, name) {
  const t0 = Date.now(), fallback = (reason) => ({ text: template(a, name), source: 'template', reason, ms: Date.now() - t0 });
  try {
    const out = await Promise.race([llm.completeJSON(SYSTEM, JSON.stringify(brief(a, name)), 'compose', a.member_id),
      new Promise((_, no) => setTimeout(() => no(new Error('timeout')), cfg.composeTimeoutMs))]);          // a slow model must not hold the member up
    if (!llm.provider() || llm.provider().name === 'mock') return fallback('no model configured');
    const r = check(a, out && String(out.message || '').replace(/\s+/g, ' ').trim());
    return r.text ? { text: r.text, source: 'llm', ms: Date.now() - t0, model: llm.provider().model } : fallback(r.reason);
  } catch (e) { return fallback(e.message === 'timeout' ? `model took longer than ${cfg.composeTimeoutMs} ms` : 'model error: ' + e.message.slice(0, 80)); }
}

module.exports = { compose, template, check, whyFor, money, railWord };

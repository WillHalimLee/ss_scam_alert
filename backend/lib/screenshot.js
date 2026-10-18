// Reads a screenshot the member sends (a text, email, chat, website, payment app...) with a local vision model, then code decides
// what it means: red flags, risk, the member's next steps, Harbor's signals and the FTC hints. The model only describes what it sees.
// The image is never stored: only masked findings and a SHA-256 fingerprint.
const crypto = require('crypto'), cfg = require('./config'), agent = require('../../harbor/agent.js'), { deep } = require('../../harbor/redact.js');

const KINDS = ['text_message', 'email', 'chat_or_dm', 'social_media_post', 'website', 'payment_app', 'call_log', 'bank_or_app_screen', 'other'];
const ASKS = ['send_money', 'gift_cards', 'crypto', 'wire_or_transfer', 'share_code_or_password', 'click_link', 'download_app', 'keep_secret', 'call_number', 'personal_details', 'none'];
const SCHEMA = { type: 'object', required: ['kind', 'claims_to_be', 'sender', 'phone_numbers', 'emails', 'links', 'money_requested', 'payment_method', 'asks_for', 'urgent', 'visible_text', 'summary'],
  properties: { kind: { type: 'string', enum: KINDS }, claims_to_be: { type: 'string' }, sender: { type: 'string' }, phone_numbers: { type: 'array', items: { type: 'string' } },
    emails: { type: 'array', items: { type: 'string' } }, links: { type: 'array', items: { type: 'string' } }, money_requested: { type: 'string' }, payment_method: { type: 'string' },
    asks_for: { type: 'array', items: { type: 'string', enum: ASKS } }, urgent: { type: 'boolean' }, visible_text: { type: 'string' }, summary: { type: 'string' } } };
const SYSTEM = `You read a screenshot that a credit union member sent while checking a payment. Describe only what is visible. Never guess or invent names, numbers, links or amounts; use "" or [] when something is not shown.
Return ONLY JSON: kind (${KINDS.join(', ')}); claims_to_be (who the message says it is from, e.g. "Sound Credit Union", "IRS", "Amazon", a person's name, or ""); sender (the name, number or address shown as the sender); phone_numbers, emails, links (exactly as shown); money_requested (amount asked for, as shown, or ""); payment_method (how they want to be paid, or ""); asks_for (what the message wants the reader to do, from: ${ASKS.join(', ')}); urgent (true if it pressures to act now); visible_text (the main text, up to 1200 characters); summary (one or two factual sentences).`;

const AUTHORITY = /\b(sound|credit union|bank|irs|fbi|police|sheriff|government|social security|medicare|customs|court|judge|law office|law firm|lawyer|attorney|federal)\b/i;
/** The vision model transcribes text well but classifies it unreliably, so code reads the transcript too. These can only ADD caution. */
const BACKSTOP = [
  ['gift_cards', /\bgift ?cards?\b/i], ['crypto', /\b(bitcoin|btc|crypto(currency)?|usdt|ethereum|coinbase)\b/i], ['wire_or_transfer', /\b(wire|western union|moneygram|zelle)\b/i],
  ['share_code_or_password', /\b(code|passcode|password|pin)\b[^.]{0,60}\b(reply|send|share|tell|give|read)\b|\b(reply|send|share|tell|give|read)\b[^.]{0,60}\b(code|passcode|password|pin)\b/i],
  ['keep_secret', /\b(do not|don'?t) tell\b|\bkeep (this|it) (a )?(secret|quiet|between)\b|\bgag order\b|\bconfidential\b/i],
  ['click_link', /https?:\/\/|\bwww\.|\b[a-z0-9-]+\.(com|net|org|biz|info|co|xyz|top)\b/i], ['call_number', /\bcall (us|me|this number|now|back)\b/i],
];
const MONEY_WORDS = /\$\s?\d|\b(pay|payment|send money|bail|fee|invoice|transfer|deposit)\b/i;
const BRANDS = /\b(amazon|microsoft|apple|paypal|venmo|zelle|cash app|netflix|ups|fedex|usps)\b/i;
/** Analyst habit: a link from a suspicious message is shown defanged, so nobody opens it by accident. */
const defang = (u) => String(u).replace(/^http/i, 'hxxp').replace(/\./g, '[.]');

/** Code turns the model's description into decisions. */
function decide(f) {
  const asks = new Set(f.asks_for || []), claims = f.claims_to_be || '', flags = [], steps = [], text = (f.visible_text || '') + ' ' + (f.summary || '');
  for (const [k, re] of BACKSTOP) if (re.test(text)) asks.add(k);
  if (asks.has('send_money') && !f.money_requested && !MONEY_WORDS.test(text)) asks.delete('send_money');
  if (/\bnumber on (the back of )?your (debit |credit )?card\b/i.test(text)) asks.delete('call_number');   // using the number on your own card is the safe advice, not a lure   // the model sometimes says "money" when none is asked
  const claimsSound = /\b(sound|credit union)\b/i.test(claims), claimsAuthority = AUTHORITY.test(claims) || /\bthis is (attorney|officer|agent|detective|judge)\b/i.test(text), claimsBrand = BRANDS.test(claims);
  if (!(claimsSound || claimsAuthority || claimsBrand || f.urgent)) asks.delete('call_number');   // "call us with questions" is normal; a call-back number is a warning only with a fake bank, authority or brand, or urgency
  const wantsMoney = ['send_money', 'gift_cards', 'crypto', 'wire_or_transfer'].some((x) => asks.has(x)) || !!f.money_requested;
  if (asks.has('share_code_or_password')) { flags.push('Asks for a code or password'); steps.push('Don\'t share the code or password with anyone. Sound will never ask for it.'); }
  if (asks.has('gift_cards') || asks.has('crypto')) { flags.push('Wants payment by ' + (asks.has('gift_cards') ? 'gift cards' : 'crypto')); steps.push('Real companies and agencies never ask to be paid in gift cards or crypto.'); }
  if (asks.has('keep_secret')) { flags.push('Told to keep it secret'); steps.push('Being told to keep it secret is a common pressure tactic. You can talk to someone you trust.'); }
  if (claimsSound) { flags.push('Claims to be Sound'); steps.push('Sound never sends links asking you to log in, and never asks you to move money.'); }
  else if (claimsAuthority) { flags.push('Claims to be ' + claims); steps.push('Banks, the government and the police never ask you to move money to protect it.'); }
  else if (claimsBrand) flags.push('Claims to be ' + claims);
  if (asks.has('click_link') || asks.has('download_app') || (f.links || []).length) { flags.push('Has a link' + (asks.has('download_app') ? ' or app to install' : '')); steps.push('Don\'t open the link or install anything from it.'); }
  if (asks.has('call_number')) { flags.push('Asks you to call a number'); steps.push('Don\'t call the number in the message. Use the number on your card or on Sound\'s website.'); }
  if (f.urgent) flags.push('Pressure to act now');
  const high = asks.has('share_code_or_password') || asks.has('gift_cards') || asks.has('crypto') || asks.has('keep_secret') || ((claimsSound || claimsAuthority) && (wantsMoney || asks.has('click_link')));
  const plainRequest = wantsMoney && !flags.length && !high;                   // e.g. an invoice from a business: nothing else stands out
  if (wantsMoney) { flags.push((plainRequest ? 'Payment request' : 'Asks for money') + (f.money_requested ? ' (' + f.money_requested + ')' : ''));
    steps.push(plainRequest ? 'If you were expecting this, check the details with them on a number you already have before paying.' : 'Please don\'t send money until you\'ve checked it with someone you trust, on a number you already have.'); }
  const quietNotice = claimsSound && flags.length === 1 && !wantsMoney && !asks.size;   // e.g. "your password was changed; if this wasn't you, call the number on your card": asks for nothing
  if (quietNotice) { flags[0] = 'Says it is from Sound and asks for nothing'; steps.length = 0; steps.push('This looks like a normal notice: it asks for nothing. If you didn\'t make that change, tell me and we\'ll protect your account.'); }
  const risk = high ? 'high' : flags.length && !plainRequest && !quietNotice ? 'medium' : 'low';
  if (!steps.length) steps.push('Thank you. Nothing in this looks risky on its own.');
  const signals = [...((claimsAuthority || claimsSound) && (wantsMoney || asks.has('share_code_or_password') || asks.has('click_link')) ? ['authority_pressure'] : []), ...(asks.has('keep_secret') ? ['secrecy_or_isolation'] : []),
    ...(f.urgent ? ['urgency'] : []), ...(asks.has('gift_cards') || asks.has('crypto') ? ['unusual_method'] : []), ...(wantsMoney ? ['unverified_contact'] : [])];
  const contact = { text_message: 'Text message', email: 'Email', chat_or_dm: 'Social media or a dating app', social_media_post: 'Social media or a dating app', website: 'A website or ad', call_log: 'Phone call' }[f.kind];
  const otherInfo = [...(f.phone_numbers || []), ...(f.emails || []), ...(f.links || []).map(defang)].join(', ');
  return { flags, risk, next_steps: steps, signals, ftc: { contact: contact || null, pretended: claims || null, other_info: otherInfo || null }, links_defanged: (f.links || []).map(defang) };
}

/** Analyse one screenshot. Returns masked findings plus code decisions, never the image. */
async function analyze({ image, mime }) {
  const t0 = Date.now(), bytes = Buffer.from(image, 'base64'), sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const p = agent.provider(); if (!p || p.name !== 'ollama') throw Object.assign(new Error('screenshot reading needs the local Ollama vision model'), { code: 503 });
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), cfg.screenshotTimeoutMs);
  let j, error = null, raw = null;
  try {
    const r = await fetch(agent.OLLAMA + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctl.signal,
      body: JSON.stringify({ model: cfg.visionModel, stream: false, keep_alive: '30m', format: SCHEMA, options: { temperature: 0, num_predict: 700 },
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: 'What does this screenshot show?', images: [image] }] }) });
    const out = await r.json(); if (!r.ok) throw new Error('vision model ' + r.status + ' ' + JSON.stringify(out).slice(0, 120));
    raw = out.message && out.message.content; j = agent.extractJSON(raw || '');
    if (!j) throw new Error('the vision model returned no JSON');
  } catch (e) { error = e.name === 'AbortError' ? 'the vision model took too long' : e.message; } finally { clearTimeout(to); }
  const ms = Date.now() - t0;
  agent.trace.record({ kind: 'screenshot', label: sha256.slice(0, 10), provider: 'ollama', model: cfg.visionModel, latencyMs: ms, input: { system: SYSTEM, messages: [{ role: 'user', content: `[image ${mime}, ${bytes.length} bytes, sha256 ${sha256.slice(0, 12)}]` }] },
    output: error ? undefined : { raw: deep(raw), parsed: deep(j) }, error: error || undefined, guardrails: [] });
  if (error) throw Object.assign(new Error(error), { code: 502 });
  const f = deep(Object.assign({ phone_numbers: [], emails: [], links: [], asks_for: [] }, j));        // codes, passwords and card numbers are masked
  f.visible_text = String(f.visible_text || '').slice(0, 1500); f.asks_for = (f.asks_for || []).filter((x) => ASKS.includes(x) && x !== 'none');
  return { sha256, mime, bytes: bytes.length, model: cfg.visionModel, ms, findings: f, decision: decide(f) };
}
module.exports = { analyze, decide };

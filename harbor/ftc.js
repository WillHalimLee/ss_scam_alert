/* FTC report draft, written once an employee confirms a scam. Code fills every checkable fact (amounts, dates, payment method,
   recipient, the member's answers); the model only writes the category and the story in the member's own voice, and code checks it
   before use (no amount it was not given, the payment amount present). The draft follows the sections of reportfraud.ftc.gov, or of
   IdentityTheft.gov for an account takeover. It is never submitted automatically: an employee files it with the member. Node only. */
const agent = require('./agent.js'), { redact, deep } = require('./redact.js');

/** The categories on reportfraud.ftc.gov's first page, word for word. */
const CATEGORIES = ['An impersonator (ex. fake government, business, love interest, grandchild)', 'Online shopping', 'Job, investment, money-making opportunity, franchise', 'Sweepstakes, prize, lottery',
  'Phone, internet, TV service', 'Auto sale, repair', 'Health', 'Credit, debt, loan', 'Just an annoying call', 'Something else'];
const IMPERSONATOR = CATEGORIES[0], INVESTMENT = CATEGORIES[2], ELSE = CATEGORIES[9];
/** Questions Harbor asks the member, only when the case does not already answer them. `when` shows a question only after a matching answer. */
const QUESTIONS = {
  contact: { q: 'How did they first get in touch with you?', chips: ['Phone call', 'Text message', 'Email', 'Social media or a dating app', 'A website or ad', 'In person', 'Not sure'] },
  platform: { q: 'Which app or website was it?', chips: ['Facebook', 'Instagram', 'WhatsApp', 'A dating app', 'Not sure'], when: { contact: 'Social media or a dating app' } },
  access: { q: 'Do you know how they got into your account?', chips: ['I clicked a link in a text or email', 'I shared a code or password', 'I don\'t know'] },
  when: { q: 'About what date did it start? You can type a date like 10/12/2026.', chips: ['Today', 'Yesterday', 'Not sure'] },
  pretended: { q: 'Who did they say they were? For example a company, a government agency, a lawyer or a family member.', chips: ['They didn\'t say', 'Not sure'] },
  name: { q: 'What name did the person use?', chips: ['They didn\'t give a name', 'I don\'t remember'] },
  other_info: { q: 'Do you have a phone number, email or website they used? Type it, or tap No.', chips: ['No'] },
  paid_before: { q: 'Had you sent them money before this payment?', chips: ['No, this was the first', 'Yes'] },
  share: { q: 'May we use your name and contact details from your Sound profile for the report? The FTC uses them only to follow up. You can stay anonymous.', chips: ['Yes, use my details', 'Keep me anonymous'] },
};
/** What the member's own words already tell us, so Harbor does not ask again. */
function known(facts) {
  const said = (facts.member_said || []).join(' ').toLowerCase(), k = {};
  if (facts.ato) k.contact = 'Text message';
  else if (/\b(called|calling|phone|rang)\b/.test(said)) k.contact = 'Phone call';
  else if (/\btext(ed)?\b|\bsms\b/.test(said)) k.contact = 'Text message';
  else if (/\bemail/.test(said)) k.contact = 'Email';
  else if (/\b(dating|online|instagram|facebook|whatsapp|met on)\b/.test(said)) k.contact = 'Social media or a dating app';
  if (/\bdating app\b/.test(said)) k.platform = 'A dating app';
  if (/\b(today|this morning|tonight)\b/.test(said)) k.when = 'Today';
  const shot = facts.screenshot || {};                                         // what the member's screenshot showed (screenshot service)
  if (shot.contact && !k.contact) k.contact = shot.contact;
  if (shot.pretended && !facts.ato) k.pretended = shot.pretended;
  if (shot.other_info) k.other_info = shot.other_info;
  const who = said.match(/\b(lawyer|attorney|federal agent|fbi|irs|police|sheriff|social security|medicare|amazon|microsoft|apple|sound)\b/);
  if (who && !facts.ato) k.pretended = who[1].replace(/\b\w/g, (c) => c.toUpperCase());
  return k;
}
/** The questions to ask, in order: only those the case cannot answer. */
const questionsFor = (facts) => { const k = known(facts);
  return (facts.ato ? ['access', 'when', 'share'] : ['contact', 'platform', 'when', 'pretended', 'name', 'other_info', 'paid_before', 'share']).filter((id) => !k[id]).map((id) => Object.assign({ id }, QUESTIONS[id])); };
const mmddyyyy = (d) => `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;
/** The form wants mm/dd/yyyy: "Today" and "Yesterday" are counted from the payment date; a typed date is kept as written. */
function startDate(answer, paymentIso) {
  const pay = paymentIso ? new Date(paymentIso) : null, a = String(answer || '');
  if (pay && /^today$/i.test(a)) return mmddyyyy(pay);
  if (pay && /^yesterday$/i.test(a)) return mmddyyyy(new Date(pay.getTime() - 864e5));
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(a.trim())) return a.trim();
  return pay ? `Not sure (the payment was on ${mmddyyyy(pay)})` : 'Not sure';
}
/** "Anna Lee" -> Anna / Lee. With a title, a single name is a last name: "Mr. Daniels" -> (not known) / Daniels. */
const splitName = (n) => {
  if (/didn|remember|^\s*$/i.test(n || '')) return ['Not known', ''];
  const titled = /^(mr|mrs|ms|miss|dr|officer|agent|detective)\.?\s+/i.test(n), parts = String(n).replace(/^(mr|mrs|ms|miss|dr|officer|agent|detective)\.?\s+/i, '').trim().split(/\s+/);
  return titled && parts.length === 1 ? ['Not known', parts[0]] : [parts[0], parts.slice(1).join(' ')];
};

const SYSTEM = `You help a credit union member prepare a fraud report for the U.S. Federal Trade Commission. You get the facts of the case and the member's answers.
Write ONLY JSON: {"category": one of ${JSON.stringify(CATEGORIES)}, "story": "the member's account in the first person, plain words, 4-7 sentences, under 900 characters"}.
Category: someone pretending to be a government agency, a business, a lawyer, a love interest or a family member is "${IMPERSONATOR}" (romance scams count here); a fake investment is "${INVESTMENT}". Do not include account numbers, dates of birth or Social Security numbers.
Rules: use only the facts given; never invent names, phone numbers, websites, dates or amounts; payment.started_at is when the payment was started, not when anyone called; Sound Credit Union is the member's own credit union, never the place the money went; a call, text or email the member says came "from Sound" during the fraud was from someone pretending to be Sound; do not say how the payment ended or what anyone did after it started (code adds that fact); describe people by what they claimed to be ("someone claiming to be a federal agent", "a man who said he was a lawyer"), because they were impersonators; do not mention staying anonymous; write amounts exactly as given (like $8,500); if something is unknown, leave it out; no passwords or codes; no advice; calm and factual.`;
const SCHEMA = { type: 'object', required: ['category', 'story'], properties: { category: { type: 'string', enum: CATEGORIES }, story: { type: 'string' } } };

function templateStory(f, a) {
  return [f.ato ? `The password, email and phone number on my Sound Credit Union account were changed by someone else, and a ${f.amount} ${f.method} to a new recipient was started from my account.`
    : `I started a ${f.amount} ${f.method}${f.recipient_new ? ' to someone new' : ''} because ${a.contact && a.contact !== 'Not sure' ? 'someone who contacted me by ' + a.contact.toLowerCase() : 'someone'} asked me to.`,
    `Sound Credit Union paused it for a safety check on ${f.date}.`, f.member_said && f.member_said.length ? `I told Sound: "${f.member_said.slice(0, 2).join('" and "')}".` : '',
    a.pretended && !/didn|sure/i.test(a.pretended) ? `They said they were ${a.pretended}.` : '', a.name && !/didn|remember/i.test(a.name) ? `The person called themselves ${a.name}.` : '', a.other_info && !/^no$/i.test(a.other_info) ? `They used ${a.other_info}.` : '', f.loss ? `I lost ${f.loss}${f.recovered ? ` and ${f.recovered} was recovered` : ''}.` : 'No money was lost.'].filter(Boolean).join(' ');
}

/** How the payment ended is a fact code knows, so code writes it: the model's own sentences about it are dropped
 *  (it tends to invent "I noticed and stopped it" or "I called Sound"), then the true ending is appended. */
const OUTCOME = /\b(stopped|paused|cancel+ed|before any money|never (left|sent)|lost|recover|reported|contacted sound|called sound|i noticed)\b/i;
const MOVED = /\b(I|we)\b[^.!?]*\b(took out|withdrew|wired|sent|transferred|paid|handed|gave)\b/;   // money that never moved must not be said to have moved
/** An impersonator is described by what they claimed to be: "a federal agent called" -> "someone claiming to be a federal agent called". */
const ROLE = /(?<!(?:claiming|pretending|claimed|pretended) to be |said (?:he|she|they) (?:was|were) |posing as |posed as )\b(a|an) (federal agent|fbi agent|irs agent|government agent|police officer|officer|detective|lawyer|attorney|judge|bank employee)\b/gi;
function withOutcome(story, f) {
  const kept = story.split(/(?<=[.!?])\s+/).filter((x) => !OUTCOME.test(x) && !/anonymous/i.test(x) && (f.loss || !MOVED.test(x))).join(' ');
  const end = f.loss ? `${kept.includes(f.amount) ? '' : `I sent ${f.amount} by ${f.method}. `}I lost ${f.loss}${f.recovered ? `, and ${f.recovered} was recovered` : ''}.`
    : `Sound Credit Union stopped the ${f.amount} ${f.method} before any money left my account.`;
  return (kept + ' ' + end).trim().replace(ROLE, (m, art, role, i, str) => (i === 0 || /[.!?]\s*$/.test(str.slice(0, i)) ? 'Someone' : 'someone') + ` claiming to be ${art.toLowerCase()} ${role}`);
}
/** The report, section by section. The model writes the story and category; code writes everything else and checks the model. */
async function draft(input) {
  const f = deep(input.facts || {}), a = deep(Object.assign({}, known(f), input.answers || {})), t0 = Date.now();
  let category = f.ato ? 'Identity theft (IdentityTheft.gov)' : f.signals && (f.signals.includes('authority_pressure') || f.signals.includes('unmet_online_contact')) || a.pretended ? IMPERSONATOR : f.signals && f.signals.includes('growing_amounts') ? INVESTMENT : ELSE;
  let story = templateStory(f, a), source = 'template', model = null, reason = null;
  const p = agent.provider();
  if (p && p.name !== 'mock') {
    const brief = { account_takeover: !!f.ato, payment: { amount: f.amount, method: f.method, started_at: f.date, to: f.ato ? 'a new recipient added by whoever took over the account' : f.recipient_new ? 'a recipient new to the account' : 'a recipient' },
      money_lost: f.loss || '$0', money_recovered: f.recovered || '$0', what_the_member_told_sound: f.member_said || [], member_answers: a };   // clearly named, so the model cannot mix them up
    const meta = {}, messages = [{ role: 'user', content: JSON.stringify(brief) }];
    try {
      const j = agent.extractJSON(await agent.callModel(p, SYSTEM, messages, meta, SCHEMA, { temperature: 0.2, num_predict: 400 }) || '');
      const s = j && String(j.story || '').replace(/\s+/g, ' ').trim(), amounts = (s || '').match(/\$[\d,]+(\.\d+)?/g) || [], allowed = [f.amount, f.loss, f.recovered].filter(Boolean);
      reason = !s ? 'no story' : s.length > 3500 ? 'longer than the form allows' : f.amount && !s.includes(f.amount) ? 'payment amount missing' : amounts.some((x) => !allowed.includes(x)) ? 'an amount it was not given' : null;
      if (!reason) { story = withOutcome(s, f); source = 'llm'; model = p.model; if (!f.ato && CATEGORIES.includes(j.category)) category = j.category; }
      agent.trace.record({ kind: 'ftc_draft', label: f.member_id, provider: p.name, model: p.model, latencyMs: meta.latencyMs, usage: meta.usage, input: { system: SYSTEM, messages }, output: { raw: meta.raw, parsed: j, final: { category, story } }, guardrails: reason ? [{ type: 'ftc_story_rejected', detail: reason }] : [] });
    } catch (e) { reason = 'model error: ' + e.message.slice(0, 60); }
  } else reason = 'no model configured';
  story = redact(story).slice(0, 3500);                                        // the form allows 3,500 characters
  if (f.ato) {                                                                 // a takeover is identity theft: IdentityTheft.gov has its own form
    return { site: { name: 'IdentityTheft.gov', url: 'https://www.identitytheft.gov/' }, category, story, source, model, reason, ms: Date.now() - t0, agent_version: agent.VERSION, sections: [
      ['What happened', [['Type', 'Someone took over my account and tried to use it'], ['How they got in', a.access || 'Not known'], ['When it started (mm/dd/yyyy)', startDate(a.when, f.date_iso)]]],
      ['The account', [['Bank', 'Sound Credit Union'], ['What they did', `Changed the password, email and phone number, then started a ${f.amount} ${f.method} to a new recipient`], ['Money lost', f.loss || '$0']]],
      ['Your story', [['Describe what happened', story]]],
      ['About you', [['Your details', /use my/i.test(a.share || '') ? 'From the member\'s Sound profile (the member confirms them)' : 'The member enters them (they chose not to share their Sound profile)']]]] };
  }
  const paidBefore = /^yes/i.test(a.paid_before || ''), [first, last] = splitName(a.name);
  const sections = [
    ['Is your report about any of these common problems?', [['Choose', category]]],
    ['Report details', [['Did you send the scammer payment of any kind?', f.loss || paidBefore ? 'Yes' : 'No (Sound stopped the payment)'], ['Did the scammer ask you to pay or send money?', 'Yes'],
      ['How much money did the scammer ask you to pay or send?', f.amount], ['How did it start?', (a.contact || 'Not sure') + ' (pick the closest option)'],
      ...(a.contact === 'Social media or a dating app' ? [['What social media app or website was it?', a.platform || 'Not sure']] : []), ['When did you encounter the scam (mm/dd/yyyy)?', startDate(a.when, f.date_iso)]]],
    ['Details about the scammer', [['Which company did they pretend to be?', a.pretended && !/didn|sure/i.test(a.pretended) ? a.pretended : 'Not known'], ['Their first name', first], ['Their last name', last || 'Not known'],
      ['Do you know any other information about the scammer (phone, website, etc.)?', a.other_info && !/^no$/i.test(a.other_info) ? 'Yes: ' + a.other_info : 'No']]],
    ['Comments: describe what happened', [['In your own words (3,500 characters max, no account numbers)', story]]],
    ['About you', [['Are you filing this report for someone else?', 'No (the member files it, with a Sound employee helping)'], ['Your details', /use my/i.test(a.share || '') ? 'From the member\'s Sound profile (the member confirms them)' : 'The member enters them, or leaves them out (they chose to stay anonymous)'],
      ['Age range, military status', 'Ask the member (optional)'], ['Are you filing on behalf of your small business or organization?', 'No']]],
  ];
  return { site: { name: 'reportfraud.ftc.gov', url: 'https://reportfraud.ftc.gov/' }, category, story, sections, source, model, reason, ms: Date.now() - t0, agent_version: agent.VERSION };
}
module.exports = { draft, questionsFor, known };

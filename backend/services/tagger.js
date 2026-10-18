// EVERY EVENT: events.scored (already seen by the rules) -> small LLM with tools over a tag table -> Postgres.
//   Category comes from the data dictionary (deterministic). The tag comes from a small model that can read the `tags` table
//   and create a new tag when none fits. Advisory only: it never messages a member.
//   Medium/high risk or a rules alert also asks the analyst agent to look at the member (analysis.requests).
//   If the rules stayed silent but the model reads high risk, the event goes to a human review queue.
const cfg = require('../lib/config'), { pool, ensureSchema } = require('../lib/db'), K = require('../lib/kafka'), llm = require('../lib/llm'), ev = require('../lib/events');
const NAME_RE = /^[a-z][a-z_]{2,39}$/;                       // letters and underscores only: no dates, ids or counters
const ROUTINE = new Set(['Login', 'Debit Purchase', 'Deposit', 'Bill Payment', 'Automatic Payment', 'ATM Withdrawal', 'Payment Completed']);   // everyday events never need a new tag
const BAD_SUFFIX = /_(high|higher|low|lower|medium|event|events|new|v\d*)$/;
/** Event types from the data dictionary, snake_cased. A tag must describe a pattern, not restate the type ("payment_initiated", "email_change"). */
const EVENT_TYPES = ['Login', 'Failed Login', 'Password Reset', 'Email Change', 'Phone Change', 'Address Change', 'One-Time Code Sent', 'Recipient Added', 'Payment Initiated', 'Payment Completed',
  'Deposit', 'Bill Payment', 'Automatic Payment', 'Debit Purchase', 'ATM Withdrawal', 'Branch Visit', 'Contact Center Call', 'Warning Displayed', 'Payment Held'].map((t) => t.toLowerCase().replace(/[^a-z]+/g, '_'));
const toks = (n) => new Set(n.split('_').filter((t) => t.length > 2));
/** A new tag must be genuinely different: reject near-duplicates of an existing tag (shared words) so the vocabulary stays tidy. */
function similarTo(name, rows) {
  const a = toks(name);
  for (const r of rows) { const b = toks(r.name), shared = [...a].filter((t) => b.has(t)).length; if (shared && shared / Math.min(a.size, b.size) >= 0.5) return r.name; }
  return null;
}

const SYSTEM = (vocab) => `You tag ONE account event for a credit union fraud team. State facts only; never accuse anyone or say "scam" or "fraud" as a conclusion.
Existing tags:
${vocab.map((t) => `- ${t.name}: ${t.description}`).join('\n')}
Rules: prefer an existing tag. Everyday events (purchases, deposits, bill pay, logins, ATM) always use routine_activity, routine_payment, card_or_atm_spend or normal_login. Creating a tag is rare: only for a genuinely new kind of pattern no existing tag describes (lower_snake_case, short description). Always finish by calling tag_event once.
risk=high only when several independent signals line up (new contact details + new recipient + payment within minutes; a large hard-to-reverse payment right after contact with the bank; payments to new people growing). Ordinary events are low. An unusual event with an innocent explanation is low or medium.`;

let cache = { at: 0, rows: [] };
async function vocab(force) {
  if (!force && Date.now() - cache.at < 4000) return cache.rows;
  cache = { at: Date.now(), rows: (await pool.query('select name, description, uses, created_by from tags order by uses desc, name limit 60')).rows };
  return cache.rows;
}

function ruleTag(e, d) {                                    // deterministic fallback when no model is available
  if (d && d.rules.includes('ATO')) return { tag: 'takeover_pattern', risk: 'high', note: 'Rules matched the takeover pattern.' };
  if (d && d.rules.length) return { tag: 'high_value_payment', risk: 'medium', note: 'Rules matched: ' + d.rules.join(', ') };
  const t = { 'Recipient Added': 'new_recipient', 'Password Reset': 'password_reset', 'Failed Login': 'failed_login', Login: 'normal_login', 'Debit Purchase': 'card_or_atm_spend', 'ATM Withdrawal': 'card_or_atm_spend' }[e.type];
  if (t) return { tag: t, risk: e.type === 'Password Reset' ? 'medium' : 'low', note: e.type + '.' };
  if (/Change/.test(e.type)) return { tag: 'profile_change', risk: 'low', note: e.type + '.' };
  if (e.cat === 'Intervention' || e.cat === 'Case & Recovery') return { tag: 'intervention_or_outcome', risk: 'low', note: e.type + '.' };
  return { tag: 'routine_activity', risk: 'low', note: 'No notable signal.' };
}

(async () => {
  await ensureSchema(); await K.ensureTopics();
  const prod = await K.producer();
  const model = (llm.provider() || {}).name === 'ollama' ? cfg.tagModel : (llm.provider() || {}).model;

  const processEvent = async ({ event: e, decision, history }) => {
    const t0 = Date.now(), created = new Set();
    const recent = (await pool.query(`select to_char(ts,'Mon DD HH24:MI') t, type, rail, amount, recipient_status rs from events
      where member_id=$1 and ts<=$2 and event_id<>$3 and type in ('Password Reset','Email Change','Phone Change','Address Change','Recipient Added','Payment Initiated','Branch Visit','Contact Center Call','Failed Login')
      order by ts desc limit 8`, [e.member_id, e.ts, e.id])).rows.reverse();
    const user = `Event: ${e.type} (${e.cat}) via ${e.ch}${e.dir === 'Incoming' ? ', INCOMING money (into the member\'s account)' : e.dir === 'Outgoing' ? ', outgoing' : ''}${e.rail && e.rail !== 'Not Applicable' ? ', ' + e.rail : ''}${e.amt ? ', $' + Math.round(e.amt) : ''}${e.rs === 'New' ? ', NEW recipient' : ''}${e.ratio ? ', ' + e.ratio + 'x member baseline' : ''} at ${e.ts}.
Rules engine decision: ${decision ? decision.level + (decision.rules.length ? ' (' + decision.rules.join('+') + ')' : '') : 'n/a'}.
Earlier events: ${recent.map((r) => `${r.t} ${r.type}${r.rail && r.rail !== 'Not Applicable' ? ' ' + r.rail : ''}${r.amount > 0 ? ' $' + Math.round(r.amount) : ''}${r.rs === 'New' ? ' new-recipient' : ''}`).join('; ') || 'none'}`;
    const handlers = {
      list_tags: async () => (await vocab(true)).map((t) => ({ name: t.name, description: t.description, uses: t.uses })),
      create_tag: async ({ name, description }) => {
        name = String(name || '').trim().toLowerCase().replace(/\s+/g, '_'); description = String(description || '').trim().slice(0, 140);
        if (!NAME_RE.test(name) || BAD_SUFFIX.test(name) || description.length < 15) return { error: 'name must be lower_snake_case letters only, not end in high/low/event, and the description must explain the pattern (15+ chars)' };
        if (/[\d$]/.test(description)) return { error: 'describe the general pattern, not this event: no amounts, dates or ids in the description' };
        if (EVENT_TYPES.some((t) => name === t || name.startsWith(t + '_'))) return { error: 'a tag names a pattern, not the event type: pick an existing tag' };
        const all = (await pool.query('select name from tags')).rows, dupe = all.find((r) => r.name === name) ? null : similarTo(name, all);
        if (dupe) return { error: `too similar to the existing tag "${dupe}": use that one` };
        const n = (await pool.query('select count(*)::int n from tags')).rows[0].n;
        const r = await pool.query(`insert into tags (name, description, created_by) select $1,$2,'llm' where $3 < $4 on conflict (name) do nothing returning name`, [name, description, n, cfg.maxTags]);
        if (r.rowCount) { created.add(name); cache.at = 0; return { ok: true, name }; }
        return n >= cfg.maxTags ? { error: 'vocabulary is full: reuse an existing tag' } : { ok: true, name, note: 'already existed' };
      },
      tag_event: async ({ tag, risk, note }) => {
        tag = String(tag || '').trim().toLowerCase();
        if (!['low', 'medium', 'high'].includes(risk)) return { error: 'risk must be low, medium or high' };
        const all = (await pool.query('select name from tags')).rows.map((r) => r.name);
        if (all.includes(tag)) return { ok: true, tag };
        const a = toks(tag), best = all.map((n) => { const b = toks(n), sh = [...a].filter((t) => b.has(t)).length; return { n, sc: sh / Math.max(1, Math.min(a.size, b.size)) }; }).sort((x, y) => y.sc - x.sc)[0];
        if (best && best.sc >= 0.5) return { ok: true, tag: best.n, note: `mapped "${tag}" to the existing tag "${best.n}"` };    // a small model often paraphrases a tag name: use the closest existing one
        return { error: `unknown tag "${tag}". Use exactly one of: ${all.slice(0, 40).join(', ')}` };
      },
    };
    const tools = [
      { name: 'list_tags', description: 'List existing tags with descriptions and usage counts.', parameters: { type: 'object', properties: {} } },
      { name: 'create_tag', description: 'Create a new tag only if no existing tag fits.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'lower_snake_case' }, description: { type: 'string' } }, required: ['name', 'description'] } },
      { name: 'tag_event', description: 'Final answer for this event.', parameters: { type: 'object', properties: { tag: { type: 'string' }, risk: { type: 'string', enum: ['low', 'medium', 'high'] }, note: { type: 'string', description: 'One factual sentence, at most 25 words' } }, required: ['tag', 'risk', 'note'] } },
    ];
    let out = null, source = 'llm', used = model;
    const routine = ROUTINE.has(e.type) && !(decision && decision.level !== 'none');                // everyday events: pick from the vocabulary, no creating
    if (routine) handlers.create_tag = async () => ({ error: 'everyday events must use an existing tag' });
    const use = routine ? tools.filter((t) => t.name === 'tag_event') : tools;
    const structured = async () => {                           // constrained decoding over the existing tag names: always a valid answer
      const names = (await pool.query(`select name from tags ${routine ? "where created_by='seed'" : ''} order by name`)).rows.map((r) => r.name);   // everyday events: the curated vocabulary only
      const j = await llm.chatSchema({ model, system: SYSTEM(await vocab()), user, kind: 'tag', label: e.member_id + ' ' + e.type, timeoutMs: cfg.tagTimeoutMs,
        schema: { type: 'object', properties: { tag: { type: 'string', enum: names }, risk: { type: 'string', enum: ['low', 'medium', 'high'] }, note: { type: 'string' } }, required: ['tag', 'risk', 'note'] } });
      return j && names.includes(j.tag) && ['low', 'medium', 'high'].includes(j.risk) ? { tag: j.tag, risk: j.risk, note: j.note } : null;
    };
    try {
      if ((llm.provider() || {}).name !== 'ollama') {          // no native tools or schemas on this provider: one JSON call, same vocabulary
        const j = await llm.completeJSON(SYSTEM(await vocab()) + '\nReturn ONLY JSON {"tag","risk","note","new_tag":{"name","description"}|null}.', user, 'tag', e.member_id + ' ' + e.type);
        if (j && j.new_tag) await handlers.create_tag(j.new_tag);
        const chk = j && await handlers.tag_event(j); if (chk && chk.ok) out = { tag: chk.tag, risk: j.risk, note: j.note };
      } else {
        if (!routine) {                                        // unusual events: the model may use the tools, including creating a tag
          const r = await llm.chatTools({ model, system: SYSTEM(await vocab()), user, tools: use, handlers, terminal: ['tag_event'], maxSteps: 3, kind: 'tag', label: e.member_id + ' ' + e.type, timeoutMs: cfg.tagTimeoutMs });
          if (r.result) out = { tag: String((r.result.result && r.result.result.tag) || r.result.args.tag).toLowerCase(), risk: r.result.args.risk, note: r.result.args.note };
        }
        if (!out) out = await structured();                    // everyday events (or a tool loop that gave no answer)
      }
    } catch (err) { console.error('[tagger] llm failed, using rule tag:', err.message); }
    if (!out) { out = ruleTag(e, decision); source = 'rule'; used = null; }
    // The data overrules the model: a deposit or purchase, a payment below the member's own usual amount, or the bank's own intervention never reaches the human review queue.
    if (out.risk === 'high' && (routine || (decision && decision.lookalike) || (e.ratio != null && e.ratio < 1) || e.cat === 'Intervention' || e.cat === 'Case & Recovery')) out.risk = 'medium';
    const alerted = !!(decision && decision.level !== 'none');
    const disagrees = !!((alerted && out.risk === 'low') || (!alerted && decision && out.risk === 'high'));
    await pool.query(`insert into event_notes (event_id, member_id, tag, category, risk, note, source, model, latency_ms, disagrees, new_tag) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      on conflict (event_id) do nothing`, [e.id, e.member_id, out.tag, ev.categoryOf(e), out.risk, String(out.note || '').slice(0, 300), source, used, Date.now() - t0, disagrees, created.has(out.tag)]);
    await pool.query('update tags set uses = uses + 1 where name=$1', [out.tag]);
    if (created.size) console.log(`[tagger] new tag(s) created by the model: ${[...created].join(', ')}`);
    if (out.risk === 'high' && !alerted) {
      const r = await pool.query(`insert into review_queue (event_id, member_id, reason) values ($1,$2,$3) on conflict (event_id) do nothing returning id`, [e.id, e.member_id, out.note]);
      if (r.rowCount) console.log(`[tagger] REVIEW QUEUE ${e.member_id} ${e.type}: ${out.note}`);
    }
    // Ask the analyst agent to look at this member when something notable happened (not for replayed background history).
    if (!history && (out.risk !== 'low' || alerted)) await K.send(prod, cfg.topics.analysis, e.member_id, { member_id: e.member_id, event_id: e.id, ts: e.ts, reason: alerted ? 'rules alert ' + decision.rules.join('+') : 'tag ' + out.tag + ' (' + out.risk + ')' });
  };
  // Live events jump the queue: the moment that matters is never stuck behind background history.
  const WORKERS = +process.env.TAG_WORKERS || 3, live = [], bg = [], idle = [], queued = new Set(); let active = 0;
  const pump = () => { while (active < WORKERS && (live.length || bg.length || idle.length)) { const it = live.shift() || bg.shift() || idle.shift(); active++;
    processEvent(it).catch((err) => console.error('[tagger]', err.message)).finally(() => { queued.delete(it.event.id); active--; pump(); }); } };
  const enqueue = (it) => { if (queued.has(it.event.id)) return; queued.add(it.event.id); (it.idle ? idle : it.history ? bg : live).push(it); pump(); };
  await K.consume({ group: 'harbor-tagger', topic: cfg.topics.scored, handler: async (m) => { enqueue(m); }, dlqProducer: prod, concurrency: 4 });
  // Catch-up sweep: anything stored but never tagged (a crash, a restart, a backlog) is tagged from Postgres, so no event is left behind.
  setInterval(async () => {
    try {
      if (live.length + bg.length + idle.length > 50) return;
      const rows = (await pool.query(`select e.* from events e left join event_notes n on n.event_id=e.event_id where n.event_id is null and e.ingested_at < now() - interval '30 seconds' order by e.ts limit 100`)).rows;
      for (const r of rows) enqueue({ history: true, idle: true, decision: null, event: { id: r.event_id, member_id: r.member_id, ts: new Date(r.ts).toISOString(), type: r.type, cat: r.category, ch: r.channel, dir: r.direction, rail: r.rail, amt: Number(r.amount), rs: r.recipient_status, ratio: r.ratio == null ? null : Number(r.ratio) } });
    } catch (err) { console.error('[tagger] sweep', err.message); }
  }, 20000);
  console.log('[tagger] running. model:', model || 'none (rule tags only)', '| tools:', (llm.provider() || {}).name === 'ollama' ? 'native' : 'json fallback');
})().catch((e) => { console.error(e); process.exit(1); });

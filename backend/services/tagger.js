// SLOW PATH, ADVISORY. events.scored -> LLM tag + analyst note -> Postgres. Never messages a member.
// If the rules stayed silent but the model reads high risk, the event goes to a human review queue (gray zone).
const cfg = require('../lib/config'), { pool } = require('../lib/db'), K = require('../lib/kafka'), llm = require('../lib/llm');
const TAGS = ['takeover_pattern', 'escalating_pattern', 'high_value_payment', 'pressure_context', 'new_recipient', 'profile_change', 'contact_before_payment', 'explainable_activity', 'routine'];

const SYSTEM = `You help a credit union fraud team by tagging ONE account event. State facts only. Never accuse anyone and never say "scam" or "fraud" as a conclusion; say what is unusual and why it may or may not matter. You cannot know the truth.
Return ONLY JSON: {"tag": one of [${TAGS.join(', ')}], "risk": "low"|"medium"|"high", "note": "max 30 words, factual"}.
risk=high only when several independent signals line up (for example new contact details plus a new recipient plus a payment within minutes, or a large hard-to-reverse payment right after contact with the bank, or payments to new people growing and escalating). An unusual event with a plausible innocent explanation is low or medium.`;

function ruleTag(e, d) {                                    // deterministic fallback when no model is available
  if (d && d.rules.includes('ATO')) return { tag: 'takeover_pattern', risk: 'high', note: 'Rules matched the takeover pattern.' };
  if (d && d.rules.length) return { tag: 'high_value_payment', risk: 'medium', note: 'Rules matched: ' + d.rules.join(', ') };
  if (e.type === 'Recipient Added') return { tag: 'new_recipient', risk: 'low', note: 'New recipient added.' };
  if (/Change/.test(e.type)) return { tag: 'profile_change', risk: 'low', note: e.type + '.' };
  return { tag: 'routine', risk: 'low', note: 'No notable signal.' };
}

(async () => {
  await K.ensureTopics();
  const prod = await K.producer();
  const handler = async ({ event: e, decision, history }) => {
    const t0 = Date.now();
    const recent = (await pool.query(`select to_char(ts,'Mon DD HH24:MI') t, type, rail, amount, recipient_status rs, ratio from events
      where member_id=$1 and ts<=$2 and type in ('Password Reset','Email Change','Phone Change','Address Change','Recipient Added','Payment Initiated','Branch Visit','Contact Center Call') and event_id<>$3
      order by ts desc limit 8`, [e.member_id, e.ts, e.id])).rows.reverse();
    const user = `Event: ${e.type} via ${e.ch}${e.rail && e.rail !== 'Not Applicable' ? ', ' + e.rail : ''}${e.amt ? ', $' + Math.round(e.amt) : ''}${e.rs === 'New' ? ', NEW recipient' : ''}${e.ratio ? ', ' + e.ratio + 'x member baseline' : ''} at ${e.ts}.
Rules engine decision: ${decision ? decision.level + (decision.rules.length ? ' (' + decision.rules.join('+') + ')' : '') : 'n/a (not a payment)'}.
Earlier key events: ${recent.map((r) => `${r.t} ${r.type}${r.rail && r.rail !== 'Not Applicable' ? ' ' + r.rail : ''}${r.amount > 0 ? ' $' + Math.round(r.amount) : ''}${r.rs === 'New' ? ' new-recipient' : ''}`).join('; ') || 'none'}`;
    let out = null, source = 'llm', model = (llm.provider() || {}).model || null;
    // Replayed account history is background: rule tags only, so the model stays free for the live moment.
    try { if (!history) out = await llm.completeJSON(SYSTEM, user, 'tag', e.member_id + ' ' + e.type); } catch (err) { console.error('[tagger] llm failed, using rule tag:', err.message); }
    if (!out || !TAGS.includes(out.tag) || !['low', 'medium', 'high'].includes(out.risk)) { out = ruleTag(e, decision); source = 'rule'; model = null; }
    const alerted = !!(decision && decision.level !== 'none');
    const disagrees = !!((alerted && out.risk === 'low') || (!alerted && decision && out.risk === 'high'));
    await pool.query(`insert into event_notes (event_id, member_id, tag, risk, note, source, model, latency_ms, disagrees) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      on conflict (event_id) do nothing`, [e.id, e.member_id, out.tag, out.risk, String(out.note).slice(0, 300), source, model, Date.now() - t0, disagrees]);
    if (out.risk === 'high' && !alerted) {
      const r = await pool.query(`insert into review_queue (event_id, member_id, reason) values ($1,$2,$3) on conflict (event_id) do nothing returning id`, [e.id, e.member_id, out.note]);
      if (r.rowCount) console.log(`[tagger] REVIEW QUEUE ${e.member_id} ${e.type}: ${out.note}`);
    }
  };
  await K.consume({ group: 'harbor-tagger', topic: cfg.topics.scored, handler, dlqProducer: prod, concurrency: 1 });
  console.log('[tagger] running, provider:', (llm.provider() || { name: 'none (rule tags only)' }).name);
})().catch((e) => { console.error(e); process.exit(1); });

// ANALYST AGENT. analysis.requests (a trigger: rules alert, or a medium/high tag) -> scan Postgres for the member's
// tagged history -> build context -> ask an analyst model -> decide whether to start a conversation.
//   It can only recommend a light check-in (level "confirm"). It never holds a payment, and code gates every start:
//   no open case, no rules alert already covering the trigger, at least two medium/high tagged events, per-member cooldown.
//   Whatever it decides is stored in `analyses` and shown to the employee as context.
const crypto = require('crypto');
const cfg = require('../lib/config'), { pool, ensureSchema } = require('../lib/db'), K = require('../lib/kafka'), llm = require('../lib/llm');

const SYSTEM = `You are Harbor's analyst at a credit union. You read a member's recent tagged account activity (pulled from the database) and decide whether a friendly check-in conversation with the member is warranted. You cannot know the truth; never accuse anyone or say "scam" or "fraud" as a conclusion.
Return ONLY JSON: {"assessment": "max 60 words, factual: what is unusual and why it may or may not matter", "key_signals": ["max 4 short items"], "risk": "low"|"medium"|"high", "start_conversation": true|false, "urgency": "low"|"medium"|"high", "focus": "what the check-in should ask about, max 20 words"}.
start_conversation=true only when several independent signals line up and talking to the member would help. If a case is already open or rules already alerted, still give your assessment but use start_conversation=false.
Read the data carefully: rule_findings are facts from the deterministic rules, so build on them (for example, a takeover finding means the payment may NOT have been made by the member: never write "the member initiated" it). "incoming" money is a deposit into the account, not a payment out. A cash withdrawal has no recipient. Use only amounts and facts present in the input. If rules_decision says looks_like_real_move or lists a lowered_because reason, the rules judged a look-alike of legitimate activity: say so and rate it low or medium unless other facts contradict it.`;

const COOLDOWN_MS = 5 * 60 * 1000;                                    // wall clock: never start two analyst conversations with one member close together
const KEY = ['Password Reset', 'Email Change', 'Phone Change', 'Address Change', 'Recipient Added', 'Payment Initiated', 'Branch Visit', 'Contact Center Call', 'Failed Login', 'One-Time Code Sent'];

async function buildContext(memberId, ts, eventId) {
  const rows = (await pool.query(`select e.event_id, to_char(e.ts,'Mon DD HH24:MI') t, e.type, e.category, e.rail, e.amount::float amount, e.recipient_status rs, e.direction dir, e.ratio::float ratio,
      n.tag, n.risk, n.note, d.level from events e left join event_notes n on n.event_id=e.event_id left join decisions d on d.event_id=e.event_id
      where e.member_id=$1 and e.ts<=$2 order by e.ts desc limit 60`, [memberId, ts])).rows.reverse();
  const tagged = rows.filter((r) => r.tag), untagged = rows.length - tagged.length;
  const notable = rows.filter((r) => (r.risk && r.risk !== 'low') || KEY.includes(r.type)).slice(-20);
  const openCase = (await pool.query(`select case_id, status from cases where member_id=$1 and status in ('awaiting_member','in_conversation') limit 1`, [memberId])).rows[0] || null;
  const ruleAlert = eventId ? (await pool.query(`select alert_id, level, kind, payload->'rules' rules from alerts where event_id=$1 limit 1`, [eventId])).rows[0] || null : null;
  const dec = eventId ? (await pool.query(`select d.level, d.suppress, d.detail->>'realMover' real_mover, round(extract(epoch from e.ts - to_timestamp((d.detail->>'resetAt')::bigint / 1000.0)) / 3600)::int reset_h
      from decisions d join events e on e.event_id=d.event_id where d.event_id=$1`, [eventId])).rows[0] : null;
  const lastStart = (await pool.query(`select extract(epoch from now()-created_at)*1000 ms from analyses where member_id=$1 and action='started_conversation' order by created_at desc limit 1`, [memberId])).rows[0];
  const hist = {}; for (const r of tagged) hist[r.risk] = (hist[r.risk] || 0) + 1;
  const tagCounts = {}; for (const r of tagged) if (r.risk !== 'low') tagCounts[r.tag] = (tagCounts[r.tag] || 0) + 1;
  return { member: memberId, events_seen: rows.length, tagged: tagged.length, untagged, risk_histogram: hist, notable_tags: tagCounts, openCase, ruleAlert: ruleAlert && { level: ruleAlert.level, kind: ruleAlert.kind },
    rules_decision: dec ? { level: dec.level, lowered_because: dec.suppress || [], looks_like_real_move: dec.real_mover === 'true', hours_since_password_reset: dec.reset_h ?? undefined } : null,
    rule_findings: ruleAlert ? (ruleAlert.rules || []).map((r) => r.label + ': ' + r.reason) : [], sinceLastStartMs: lastStart ? Number(lastStart.ms) : null,
    timeline: notable.map((r) => ({ t: r.t, type: r.type, rail: r.rail && r.rail !== 'Not Applicable' ? r.rail : undefined, amount: r.amount > 0 ? Math.round(r.amount) : undefined, direction: r.dir === 'Incoming' ? 'incoming' : r.dir === 'Outgoing' ? 'outgoing' : undefined, new_recipient: (r.rs === 'New' && r.rail !== 'Cash') || undefined, tag: r.tag, risk: r.risk, note: r.note, rules: r.level && r.level !== 'none' ? r.level : undefined })) };
}

async function analyze(req) {
  const t0 = Date.now(), { member_id: memberId, event_id: eventId, ts, reason } = req;
  await new Promise((r) => setTimeout(r, 900));                       // let neighbouring events finish tagging
  const ctx = await buildContext(memberId, ts, eventId);
  let verdict = null, model = (llm.provider() || {}).model || null;
  try { verdict = await Promise.race([llm.completeJSON(SYSTEM, JSON.stringify(ctx), 'analyst', memberId), new Promise((_, no) => setTimeout(() => no(new Error('analyst timeout')), cfg.analystTimeoutMs))]); }
  catch (e) { console.error('[analyst] model failed:', e.message); }
  const okVerdict = verdict && typeof verdict.assessment === 'string' && ['low', 'medium', 'high'].includes(verdict.risk);
  if (!okVerdict) verdict = { assessment: 'No model assessment available. Rules and tags are in the timeline.', key_signals: [], risk: 'low', start_conversation: false, urgency: 'low', focus: '' };
  verdict.assessment = String(verdict.assessment).replace(/\s+/g, ' ').slice(0, 500);
  verdict.start_conversation = !!verdict.start_conversation && okVerdict;
  const lookAlike = ctx.rules_decision && (ctx.rules_decision.looks_like_real_move || ctx.rules_decision.lowered_because.length);
  if (lookAlike && verdict.risk === 'high') { verdict.risk = 'medium'; verdict.capped = 'the rules judged this a look-alike of legitimate activity, so code capped the risk at medium'; }

  // Guardrails in code. The model only recommends.
  const strong = ctx.timeline.filter((r) => r.risk === 'medium' || r.risk === 'high').length;
  let action = 'recorded_only', why = 'the analyst did not recommend a conversation';
  if (verdict.start_conversation) {
    if (ctx.openCase) { action = 'recorded_only'; why = 'a case is already open: this assessment is added as context'; }
    else if (ctx.ruleAlert) { action = 'recorded_only'; why = 'the rules already alerted on this event: this assessment is added as context'; }
    else if (!['medium', 'high'].includes(verdict.risk)) { action = 'blocked'; why = 'risk below medium'; }
    else if (strong < 2) { action = 'blocked'; why = 'fewer than two medium/high tagged events to corroborate'; }
    else if (ctx.sinceLastStartMs != null && ctx.sinceLastStartMs < COOLDOWN_MS) { action = 'blocked'; why = 'cooldown: this member was just contacted'; }
    else { action = 'started_conversation'; why = 'the analyst recommended a check-in and every safety check passed'; }
  }
  const latency = Date.now() - t0;
  const row = await pool.query(`insert into analyses (member_id, trigger_event, trigger_reason, context, verdict, action, action_reason, model, latency_ms) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [memberId, eventId || null, reason || null, JSON.stringify(ctx), JSON.stringify(verdict), action, why, okVerdict ? model : null, latency]);
  console.log(`[analyst] ${memberId} (${reason}): risk ${verdict.risk}, ${action}${action === 'started_conversation' ? '' : ' (' + why + ')'} in ${latency}ms`);
  if (action === 'started_conversation') {
    const alertId = 'AN-' + crypto.createHash('sha1').update(memberId + '|' + row.rows[0].id).digest('hex').slice(0, 10);
    await K.send(prod, cfg.topics.alerts, memberId, { schema: 1, alert_id: alertId, member_id: memberId, source: 'analyst', kind: 'ANALYST', level: 'confirm', event_id: null,
      summary: verdict.assessment, focus: verdict.focus || '', rules: [{ id: 'ANALYST', label: 'Analyst review', reason: verdict.assessment }], amount: null, completed: false, ts: ts || new Date().toISOString() });
  }
}

let prod; const running = new Set(), again = new Map();
async function handler(req) {                                          // one analysis per member at a time; a newer trigger during a run queues exactly one more
  const m = req.member_id;
  if (running.has(m)) { again.set(m, req); return; }
  running.add(m);
  try { await analyze(req); } finally { running.delete(m); }
  const next = again.get(m); if (next) { again.delete(m); handler(next).catch((e) => console.error('[analyst]', e.message)); }
}

(async () => {
  await ensureSchema(); await K.ensureTopics(); prod = await K.producer();
  await K.consume({ group: 'harbor-analyst', topic: cfg.topics.analysis, handler, dlqProducer: prod, concurrency: 2 });
  console.log('[analyst] running. model:', (llm.provider() || { model: 'none' }).model);
})().catch((e) => { console.error(e); process.exit(1); });

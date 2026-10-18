// Notification + conversation agent.
//   alerts.risk -> case management (merge, rate-limit) -> personalized message -> notifications.out -> delivery adapter
//   HTTP API: conversation with the member (reuses the Harbor chat agent), case timeline, pipeline stats.
//   Timer: no reply by due_at -> escalate to a human.
const http = require('http'), crypto = require('crypto');
const cfg = require('../lib/config'), { pool, q } = require('../lib/db'), K = require('../lib/kafka'), llm = require('../lib/llm');
const agent = llm.agent;

const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
const railWord = (r) => ({ P2P: 'P2P payment', Wire: 'wire', Cash: 'cash withdrawal', 'External Transfer': 'external transfer', ACH: 'ACH payment' }[r] || String(r || 'payment').toLowerCase());
const NEVER = 'Sound will never ask for your password or a code, and never asks you to move money.';

/* ---------- outbound message composition ---------- */
function template(a, name) {
  const hi = name ? `Hi ${name}, this is Harbor from Sound.` : 'Hi, this is Harbor from Sound.';
  const amt = a.amount ? money(a.amount) : 'a payment';
  if (a.source === 'retro') return `${hi} I'm checking in on some recent activity: ${a.summary} Nothing is wrong on your side. If anything looks unfamiliar, you can talk to a Sound employee right away. ${NEVER}`;
  if (a.ato) return `${hi} A few minutes ago the password, email and phone number on your account were changed, and a ${amt} ${railWord(a.rail)} to a new recipient was started. I've paused it, and nothing has left your account. Was that you? Open your Sound app to review. ${NEVER}`;
  if (a.level === 'confirm') return `${hi} Quick check on your ${amt} ${railWord(a.rail)} to a newer recipient, since it's more than you usually send. Open your Sound app and tell me a bit about it. ${NEVER}`;
  return `${hi} Your ${amt} ${railWord(a.rail)} is paused for a quick check. Nothing has been sent, and you're in control. Open your Sound app so we can talk it through. ${NEVER}`;
}
const COMPOSE_SYSTEM = `You write the FIRST outbound message from Harbor, a personal security analyst at Sound Credit Union, to a member about their account. 2-3 short sentences, plain language, warm and calm. Return ONLY JSON {"message": "..."}.
Rules: say what happened in plain words; if a payment is paused say nothing has been sent and the member is in control; never say "scam", "fraud" or "criminal"; never ask for passwords, PINs or codes; do not promise safety or recovery; do not include links; end by inviting them to open the Sound app (or reply) and include that Sound never asks for a password or code or to move money. Use the member's first name only if given.`;
async function compose(a, name) {
  const fallback = { text: template(a, name), source: 'template' };
  try {
    const out = await llm.completeJSON(COMPOSE_SYSTEM, JSON.stringify({ first_name: name || null, source: a.source, level: a.level, takeover_suspected: !!a.ato, payment_already_completed: !!a.completed,
      amount: a.amount || null, rail: railWord(a.rail), why: a.rules ? a.rules.map((r) => r.reason) : [a.summary] }), 'compose', a.member_id);
    const text = out && String(out.message || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 700 || agent.BAD_REPLY.some((r) => r.test(text)) || !/never ask/i.test(text)) return fallback;
    return { text, source: 'llm' };
  } catch (e) { return fallback; }
}

/* ---------- alert handling ---------- */
let prod;
async function say(caseId, direction, body, source, channel, memberId) {
  const r = await q('insert into messages (case_id, direction, body, source) values ($1,$2,$3,$4) returning id', [caseId, direction, body, source]);
  if (direction === 'out') await K.send(prod, cfg.topics.out, memberId, { message_id: r.rows[0].id, case_id: caseId, member_id: memberId, channel, body });
  return r.rows[0].id;
}
function ctxFrom(a) {
  return { amount: a.amount ? money(a.amount) : '', rail: railWord(a.rail), recipient: a.recipient_status === 'New' ? 'a new recipient' : 'a recipient', reasons: a.rules ? a.rules.map((r) => r.reason) : [a.summary],
    ato: !!a.ato, level: a.level === 'confirm' || a.level === 'followup' ? 'confirm' : 'hold', completed: !!a.completed, trustedContact: !!a.trusted_contact };
}
async function onAlert(a) {
  const dupe = await q('select 1 from case_alerts where alert_id=$1', [a.alert_id]);
  if (dupe.rowCount) return;                                                       // replayed alert: already handled
  const mem = (await q('select first_name from members where member_id=$1', [a.member_id])).rows[0] || {};
  const open = (await q(`select * from cases where member_id=$1 and status in ('awaiting_member','in_conversation') order by opened_at desc limit 1`, [a.member_id])).rows[0];
  await q('insert into alerts (alert_id, member_id, source, kind, level, event_id, payload, published) values ($1,$2,$3,$4,$5,$6,$7,true) on conflict (alert_id) do nothing',
    [a.alert_id, a.member_id, a.source, a.kind || (a.rules || []).map((r) => r.id).join('+'), a.level, a.event_id || null, JSON.stringify(a)]);
  // One conversation per member at a time. A second alert (for example the attacker's second payment) joins the open case.
  if (open) {
    await q('insert into case_alerts (case_id, alert_id) values ($1,$2)', [open.case_id, a.alert_id]);
    const reasons = a.rules ? a.rules.map((r) => r.reason) : [a.summary];
    await q('update cases set ctx = jsonb_set(ctx, \'{reasons}\', (ctx->\'reasons\') || $2::jsonb), updated_at=now() where case_id=$1', [open.case_id, JSON.stringify(reasons)]);
    await say(open.case_id, 'system', `Another alert joined this case (${a.kind || 'rules'}${a.amount ? ', ' + money(a.amount) : ''}). Member not messaged again.`, 'system');
    console.log(`[agent] merged alert ${a.alert_id} into ${open.case_id}`);
    return;
  }
  // Rate limit outbound messages, except suspected takeover which always gets through.
  const recent = (await q(`select count(*)::int n from messages m join cases c on c.case_id=m.case_id where c.member_id=$1 and m.direction='out' and m.created_at > now() - interval '24 hours'`, [a.member_id])).rows[0].n;
  if (recent >= cfg.maxMessagesPer24h && !a.ato) { console.log(`[agent] rate-limited ${a.member_id}`); return; }

  const msg = await compose(a, mem.first_name);                                      // compose BEFORE the case becomes visible, so the opening message is always first
  const caseId = 'C-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const channel = a.ato ? 'sms_pre_change_phone' : 'app_push';                      // takeover: never the contact details the attacker may have changed
  const trusted = (await q(`select bool_or(trusted_contact) t from events where member_id=$1`, [a.member_id])).rows[0].t;
  const ctx = ctxFrom(Object.assign({}, a, { trusted_contact: trusted }));
  await q(`insert into cases (case_id, member_id, status, channel, ato, ctx, due_at) values ($1,$2,'awaiting_member',$3,$4,$5, now() + ($6 || ' seconds')::interval)`,
    [caseId, a.member_id, channel, !!a.ato, JSON.stringify(ctx), String(cfg.caseTimeoutSec)]);
  await q('insert into case_alerts (case_id, alert_id) values ($1,$2)', [caseId, a.alert_id]);
  await say(caseId, 'out', msg.text, msg.source, channel, a.member_id);
  console.log(`[agent] case ${caseId} ${a.member_id} via ${channel} (${msg.source}): ${msg.text.slice(0, 90)}...`);
}

/* ---------- conversation + resolution ---------- */
async function caseDetail(id) {
  const c = (await q('select * from cases where case_id=$1', [id])).rows[0]; if (!c) return null;
  const messages = (await q('select id, direction, body, source, delivered_at, created_at from messages where case_id=$1 order by id', [id])).rows;
  const alerts = (await q(`select a.alert_id, a.source, a.kind, a.level, a.created_at, n.tag, n.risk, n.note from case_alerts ca join alerts a on a.alert_id=ca.alert_id
    left join event_notes n on n.event_id=a.event_id where ca.case_id=$1 order by a.created_at`, [id])).rows;
  return { case: c, messages, alerts };
}
async function reply(id, text) {
  const d = await caseDetail(id); if (!d) throw Object.assign(new Error('no such case'), { code: 404 });
  if (['resolved', 'escalated_human'].includes(d.case.status)) throw Object.assign(new Error('case closed'), { code: 409 });
  text = String(text || '').slice(0, 600).trim(); if (!text) throw Object.assign(new Error('empty'), { code: 400 });
  await say(id, 'in', text, 'member');
  const hist = d.messages.filter((m) => m.direction !== 'system').map((m) => ({ role: m.direction === 'out' ? 'assistant' : 'user', content: m.body })); hist.push({ role: 'user', content: text });
  const r = await agent.chat({ ctx: d.case.ctx, messages: hist });
  await say(id, 'out', r.reply, 'llm', d.case.channel, d.case.member_id);
  const signals = Object.assign({}, d.case.signals); for (const k in r.signals) if (r.signals[k]) signals[k] = true;
  await q(`update cases set status='in_conversation', signals=$2, handoff_note=$3, due_at=null, updated_at=now() where case_id=$1`, [id, JSON.stringify(signals), r.handoff_note]);
  return { reply: r.reply, signals, red: Object.keys(signals).some((k) => agent.RED_FLAGS.includes(k) && signals[k]), member_state: r.member_state, guarded: !!r.guarded, handoff_note: r.handoff_note };
}
async function resolve(id, outcome, status) {
  await q(`update cases set status=$2, outcome=$3, due_at=null, updated_at=now() where case_id=$1`, [id, status, outcome]);
  await say(id, 'system', `Case ${status}: ${outcome}`, 'system');
}

/* ---------- http ---------- */
function json(res, code, obj) { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' }); res.end(JSON.stringify(obj)); }
async function route(req, res) {
  const url = new URL(req.url, 'http://x'), p = url.pathname;
  if (agent.trace.handle(req, res)) return;                   // model inspector endpoints
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (p === '/api/pipeline') {
    const one = async (s) => (await q(s)).rows;
    const [events, decisions, alerts, cases, notes, review, retro, latency] = await Promise.all([
      one('select count(*)::int n from events'), one('select level, count(*)::int n from decisions group by 1'), one('select source, level, count(*)::int n from alerts group by 1,2'),
      one('select status, count(*)::int n from cases group by 1'), one('select risk, source, count(*)::int n from event_notes group by 1,2'), one(`select count(*)::int n from review_queue where status='open'`),
      one('select kind, count(*)::int n from retro_findings group by 1'), one('select coalesce(percentile_cont(0.5) within group (order by latency_ms),0)::int p50, coalesce(max(latency_ms),0)::int max from decisions')]);
    return json(res, 200, { events: events[0].n, decisions, alerts, cases, notes, review_open: review[0].n, retro, latency: latency[0],
      recentAlerts: await one(`select a.alert_id, a.member_id, a.source, a.kind, a.level, a.created_at, n.risk, n.note from alerts a left join event_notes n on n.event_id=a.event_id order by a.created_at desc limit 12`) });
  }
  if (p === '/api/cases') return json(res, 200, (await q(`select c.case_id, c.member_id, c.status, c.channel, c.ato, c.outcome, c.opened_at, c.due_at, c.signals, c.handoff_note, c.ctx,
      (select body from messages m where m.case_id=c.case_id order by id limit 1) as opening from cases c order by c.opened_at desc limit 60`)).rows);
  let m = p.match(/^\/api\/cases\/([\w-]+)$/); if (m) { const d = await caseDetail(m[1]); return d ? json(res, 200, d) : json(res, 404, { error: 'not found' }); }
  if (p === '/api/review') return json(res, 200, (await q(`select r.id, r.event_id, r.member_id, r.reason, r.status, r.created_at, n.tag, n.risk from review_queue r left join event_notes n on n.event_id=r.event_id order by r.id desc limit 40`)).rows);
  if (p === '/api/retro') return json(res, 200, (await q('select finding_key, member_id, kind, summary, created_at from retro_findings order by created_at desc limit 40')).rows);
  m = p.match(/^\/api\/cases\/([\w-]+)\/(reply|resolve)$/);
  if (m && req.method === 'POST') {
    const body = await new Promise((ok) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 10000) req.destroy(); }); req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { ok({}); } }); });
    if (m[2] === 'reply') return json(res, 200, await reply(m[1], body.text));
    const status = ['human', 'no_response'].includes(body.outcome) ? 'escalated_human' : 'resolved';
    await resolve(m[1], String(body.outcome || 'resolved').slice(0, 60), status); return json(res, 200, { ok: true, status });
  }
  return json(res, 404, { error: 'not found' });
}

/* ---------- main ---------- */
(async () => {
  await K.ensureTopics(); prod = await K.producer();
  await K.consume({ group: 'harbor-agent', topic: cfg.topics.alerts, handler: onAlert, dlqProducer: prod, concurrency: 2 });
  // Delivery adapter: the only part that would change for a real SMS / push provider.
  await K.consume({ group: 'harbor-delivery', topic: cfg.topics.out, dlqProducer: prod, handler: async (m) => {
    console.log(`[delivery] ${m.channel} -> ${m.member_id}: ${m.body.slice(0, 100)}${m.body.length > 100 ? '...' : ''}`);
    await q('update messages set delivered_at=now() where id=$1', [m.message_id]);
  } });
  setInterval(async () => {                                                        // no reply in time: a human takes over
    try { for (const c of (await q(`select case_id from cases where status='awaiting_member' and due_at < now()`)).rows) { await resolve(c.case_id, 'no_response', 'escalated_human'); console.log(`[agent] ${c.case_id} escalated to a human (no reply)`); } }
    catch (e) { console.error('timer', e.message); }
  }, 5000);
  http.createServer((req, res) => route(req, res).catch((e) => { console.error('http', e.message); json(res, e.code || 500, { error: e.message }); })).listen(cfg.agentPort, () =>
    console.log(`[agent] running. API http://localhost:${cfg.agentPort}  provider: ${(llm.provider() || { name: 'none (template messages only)' }).name}`));
})().catch((e) => { console.error(e); process.exit(1); });

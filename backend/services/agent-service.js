// API server + notification agent. One process serves the app on http://localhost:8787 and runs the agent.
//   alerts.risk -> case management (merge, rate-limit) -> personalized message -> notifications.out -> delivery adapter
//   HTTP: static front end, /api/demo/* (stream a demo story into Kafka), /api/console + /api/cases/* (real cases),
//         /api/chat (direct model chat), /api/traces (model inspector), /api/pipeline (stats).
//   Timer: no reply by due_at -> escalate to a human.
const http = require('http'), crypto = require('crypto'), fs = require('fs'), path = require('path');
const cfg = require('../lib/config'), { pool, q, ensureSchema } = require('../lib/db'), K = require('../lib/kafka'), llm = require('../lib/llm'), demo = require('../lib/demo');
const agent = llm.agent;

const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
const railWord = (r) => ({ P2P: 'P2P payment', Wire: 'wire', Cash: 'cash withdrawal', 'External Transfer': 'external transfer', ACH: 'ACH payment' }[r] || String(r || 'payment').toLowerCase());
/** What the member may be told about why something was flagged: plain facts, no rule names, thresholds or staff wording. */
const MEMBER_WHY = { ATO: 'your password, email and phone number were all changed just before this payment started', RAMP: 'there have been a few payments to new people lately, and this one is bigger',
  HIGHSTAKES: 'this is much more than usual, and it is hard to get back once sent', CONTACT: 'this came right after contact with Sound, and it is a large payment', FRESH: 'this is more than you usually send to someone new' };
const whyFor = (a) => (a.rules ? a.rules.map((r) => (r.id === 'ANALYST' ? r.reason : MEMBER_WHY[r.id] || 'this looks different from usual activity')) : [a.summary]);
const NEVER = 'Sound will never ask for your password or a code, and never asks you to move money.';

/* ---------- outbound message composition ---------- */
function template(a, name) {
  const hi = name ? `Hi ${name}, this is Harbor from Sound.` : 'Hi, this is Harbor from Sound.';
  const amt = a.amount ? money(a.amount) : 'a payment';
  if (a.source === 'analyst') return `${hi} I noticed some activity on your account that I'd like to check with you: ${a.summary} Nothing has been paused, and nothing is wrong on your side. If anything looks unfamiliar, you can talk to a Sound employee right away. ${NEVER}`;
  if (a.source === 'retro') return `${hi} I'm checking in on some recent activity: ${a.summary} Nothing is wrong on your side. If anything looks unfamiliar, you can talk to a Sound employee right away. ${NEVER} Does any of it look unfamiliar to you?`;
  if (a.ato) return `${hi} A few minutes ago the password, email and phone number on your account were changed, and a ${amt} ${railWord(a.rail)} to a new recipient was started. I've paused it, and nothing has left your account. Was that you? Open your Sound app to review. ${NEVER}`;
  if (a.level === 'confirm') return `${hi} Quick check on your ${amt} ${railWord(a.rail)} to a newer recipient, since it's more than you usually send. ${NEVER} What is this payment for?`;
  return `${hi} Your ${amt} ${railWord(a.rail)} is paused for a quick check. Nothing has been sent, and you're in control. ${NEVER} What is this payment for?`;
}
const COMPOSE_SYSTEM = `You write the FIRST outbound message from Harbor, a personal security analyst at Sound Credit Union, to a member about their account. 2-3 short sentences, plain language, warm and calm. Return ONLY JSON {"message": "..."}.
Rules: say only what Sound's systems know, in plain words, from the facts given; if a payment is paused say nothing has been sent and the member is in control; you do NOT yet know why the member is doing this, so do not mention scams, impersonation, police, banks or government, and give no warnings or advice about them; never say "scam", "fraud" or "criminal"; never ask for passwords, PINs or codes; do not promise safety or recovery; do not include links; include that Sound never asks for a password or code or to move money; END with exactly one open question the member can answer in their own words (if takeover is suspected, ask whether they made the changes; otherwise ask what the payment is for). Use the member's first name only if given.
The input JSON has a must_say list: every item must be stated in your own words. Style example (change the wording to fit the facts): {"message": "Hi Dana, this is Harbor from Sound. Your $4,000 wire is paused for a quick check, and nothing has been sent. You're in control. Sound never asks for your password or a code, or to move money. What is this payment for?"}`;
async function compose(a, name) {
  const t0 = Date.now(), fallback = { text: template(a, name), source: 'template', ms: 0 };
  try {
    const out = await Promise.race([llm.completeJSON(COMPOSE_SYSTEM, JSON.stringify({ first_name: name || null, source: a.source, level: a.level, takeover_suspected: !!a.ato, payment_already_completed: !!a.completed,
      amount: a.amount || null, rail: railWord(a.rail), why: whyFor(a),
      must_say: (a.completed ? ['the payment already went through'] : a.level === 'hold' ? ['the payment is paused', 'nothing has been sent', 'the member is in control'] : ['this is a quick check, nothing is blocked']).concat(a.ato ? ['the password, email and phone number on the account were changed just before this payment started'] : []) }), 'compose', a.member_id),
      new Promise((_, no) => setTimeout(() => no(new Error('compose timeout')), cfg.composeTimeoutMs))]);          // a slow model must not hold the member up: fall back to the template
    const text = out && String(out.message || '').replace(/\s+/g, ' ').trim();
    const heldOk = a.level !== 'hold' || a.completed || (/\b(paused|on hold|held)\b/i.test(text) && /\bnothing\b/i.test(text));      // a held payment must be said to be paused, with nothing sent
    if (!text || text.length > 700 || agent.BAD_REPLY.some((r) => r.test(text)) || !/never ask/i.test(text) || !heldOk || !/\?/.test(text) || (a.ato && !/password/i.test(text))) return Object.assign(fallback, { ms: Date.now() - t0 });   // otherwise the safe template is used
    return { text, source: 'llm', ms: Date.now() - t0, model: (llm.provider() || {}).model };
  } catch (e) { return Object.assign(fallback, { ms: Date.now() - t0 }); }
}

/* ---------- alert handling ---------- */
let prod;
async function say(caseId, direction, body, source, channel, memberId, meta, deliver = true) {
  const r = await q('insert into messages (case_id, direction, body, source, meta) values ($1,$2,$3,$4,$5) returning id', [caseId, direction, body, source, meta ? JSON.stringify(meta) : null]);
  if (direction === 'out' && deliver) await K.send(prod, cfg.topics.out, memberId, { message_id: r.rows[0].id, case_id: caseId, member_id: memberId, channel, body });
  return r.rows[0].id;
}
function ctxFrom(a) {
  return { amount: a.amount ? money(a.amount) : '', rail: railWord(a.rail), recipient: a.rail === 'Cash' ? '' : a.recipient_status === 'New' ? 'someone new' : 'a recipient', reasons: whyFor(a),
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
  await say(caseId, 'out', msg.text, msg.source, channel, a.member_id, { ms: msg.ms, model: msg.model || null });
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
/* ---------- demo: stream a story into the pipeline, read back what it decided ---------- */
const readBody = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 20000) req.destroy(); }); req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { ok({}); } }); });
const iso = (d) => (d ? new Date(d).toISOString() : null);
const streams = new Map();                                                         // member -> current stream id; a newer start cancels an older one
async function demoStart(mid, planned) {
  if (!demo.known(mid)) throw Object.assign(new Error('unknown member'), { code: 404 });
  const t = demo.triggerFor(mid, planned); if (!t) throw Object.assign(new Error('no trigger payment for this story'), { code: 422 });
  const cs = (await q('select case_id from cases where member_id=$1', [mid])).rows.map((r) => r.case_id);
  if (cs.length) { await q('delete from messages where case_id = any($1)', [cs]); await q('delete from case_alerts where case_id = any($1)', [cs]); await q('delete from cases where case_id = any($1)', [cs]); }
  for (const tb of ['analyses', 'decisions', 'alerts', 'event_notes', 'review_queue', 'retro_findings', 'member_state', 'events']) await q(`delete from ${tb} where member_id=$1`, [mid]);
  await K.send(prod, cfg.topics.raw, mid, { schema: 1, type: '__reset', member_id: mid, planned: planned || null, ts: new Date().toISOString() });
  const hist = demo.historyOf(mid, t), gen = (streams.get(mid) || 0) + 1, gap = Math.max(10, Math.min(60, 3000 / Math.max(1, hist.length)));
  streams.set(mid, gen);
  (async () => {                                                                   // events arrive over a few seconds, like a live feed, so the UI can show them being consumed
    for (const e of hist) { if (streams.get(mid) !== gen) return; await K.send(prod, cfg.topics.raw, mid, e); await new Promise((r) => setTimeout(r, gap)); }
  })().catch((e) => console.error('[demo] stream', e.message));
  return { triggerEventId: t.eventId, historyTotal: hist.length, trigger: { amount: t.event.amt, rail: t.event.rail, recipient: t.event.rs } };
}
async function demoSend(mid, eventId) {
  const t = demo.triggerFor(mid, undefined), env = demo.envelopeById(mid, eventId || (t && t.eventId));
  if (!env) throw Object.assign(new Error('no such event'), { code: 404 });
  await K.send(prod, cfg.topics.raw, mid, env); return { sent: env.id, at: Date.now() };
}
/** Everything the pipeline did for one payment (or for a member's latest case), shaped for the UI. */
async function view(mid, eventId) {
  const one = async (sql, a) => (await q(sql, a)).rows[0] || null;
  const processed = (await one('select count(*)::int n from events where member_id=$1', [mid])).n;
  let c = null, ald = null;
  if (eventId) { ald = await one('select * from alerts where event_id=$1', [eventId]); if (ald) c = await one('select c.* from cases c join case_alerts ca on ca.case_id=c.case_id where ca.alert_id=$1 limit 1', [ald.alert_id]); }
  else { c = await one('select * from cases where member_id=$1 order by opened_at desc limit 1', [mid]); if (c) ald = await one('select a.* from alerts a join case_alerts ca on ca.alert_id=a.alert_id where ca.case_id=$1 order by a.created_at limit 1', [c.case_id]); }
  const evId = eventId || (ald && ald.event_id);
  const event = evId ? await one('select * from events where event_id=$1', [evId]) : null;
  const decision = evId ? await one('select * from decisions where event_id=$1', [evId]) : null;
  const note = evId ? await one('select tag, risk, note, source, model, latency_ms, disagrees from event_notes where event_id=$1', [evId]) : null;
  const messages = c ? (await q('select id, direction, body, source, meta, delivered_at, created_at from messages where case_id=$1 order by id', [c.case_id])).rows : [];
  const tags = Object.fromEntries((await q('select event_id, category, tag, risk, note, new_tag from event_notes where member_id=$1', [mid])).rows.map((r) => [r.event_id, r]));
  const analysis = await one(`select id, trigger_reason, verdict, action, action_reason, model, latency_ms, created_at, context->'risk_histogram' histogram, (context->>'events_seen')::int events_seen from analyses where member_id=$1 order by id desc limit 1`, [mid]);
  const member = await one('select first_name from members where member_id=$1', [mid]);
  const out = messages.find((m) => m.direction === 'out');
  return { member_id: mid, first_name: member && member.first_name, processed, tags, analysis, event, decision, alert: ald && { alert_id: ald.alert_id, level: ald.level, kind: ald.kind, payload: ald.payload, published: ald.published },
    note, case: c, messages,
    timings: { ingested: iso(event && event.ingested_at), decided: iso(decision && decision.decided_at), decide_ms: decision && decision.latency_ms, alerted: iso(ald && ald.created_at),
      composed: iso(out && out.created_at), delivered: iso(out && out.delivered_at), compose_ms: out && out.meta && out.meta.ms, compose_model: out && out.meta && out.meta.model, compose_source: out && out.source } };
}
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const WEB = path.join(__dirname, '..', '..', 'harbor');
function serveStatic(req, res, p) {
  const f = path.join(WEB, p === '/' ? 'index.html' : decodeURIComponent(p));
  if (!f.startsWith(WEB) || /(agent|server|trace)\.js$|\.traces/.test(f) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
}

function json(res, code, obj) { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' }); res.end(JSON.stringify(obj)); }
async function route(req, res) {
  const url = new URL(req.url, 'http://x'), p = url.pathname;
  if (agent.trace.handle(req, res)) return;                   // model inspector endpoints
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (p === '/api/status') { const pr = llm.provider(); return json(res, 200, { backend: true, live: !!pr, provider: pr && pr.name, model: pr && pr.model, timeoutMs: pr && pr.timeoutMs }); }
  if (p === '/api/chat' && req.method === 'POST') { try { return json(res, 200, await agent.chat(await readBody(req))); } catch (e) { console.error('chat error:', e.message); return json(res, 502, { error: 'agent unavailable' }); } }
  if (p === '/api/demo/start' && req.method === 'POST') { const b = await readBody(req); return json(res, 200, await demoStart(String(b.member || ''), b.planned)); }
  if (p === '/api/demo/send' && req.method === 'POST') { const b = await readBody(req); return json(res, 200, await demoSend(String(b.member || ''), b.event)); }
  if (p === '/api/analyst/run' && req.method === 'POST') {                          // ask the analyst agent to look at a member now
    const b = await readBody(req), last = (await q('select event_id, ts from events where member_id=$1 order by ts desc limit 1', [String(b.member || '')])).rows[0];
    if (!last) return json(res, 404, { error: 'no events for that member' });
    await K.send(prod, cfg.topics.analysis, b.member, { member_id: b.member, event_id: last.event_id, ts: new Date(last.ts).toISOString(), reason: 'manual request' }); return json(res, 200, { ok: true });
  }
  if (p === '/api/demo/state') return json(res, 200, await view(url.searchParams.get('member') || '', url.searchParams.get('event') || null));
  if (p === '/api/console') {
    const ids = (await q('select distinct on (member_id) member_id from cases order by member_id, opened_at desc')).rows.map((r) => r.member_id);
    const views = await Promise.all(ids.map((m) => view(m))); views.sort((a, b) => String(b.case.opened_at).localeCompare(String(a.case.opened_at)));
    return json(res, 200, views);
  }
  if (p === '/api/pipeline') {
    const one = async (s) => (await q(s)).rows;
    const [events, decisions, alerts, cases, notes, review, retro, latency] = await Promise.all([
      one('select count(*)::int n from events'), one('select level, count(*)::int n from decisions group by 1'), one('select source, level, count(*)::int n from alerts group by 1,2'),
      one('select status, count(*)::int n from cases group by 1'), one('select risk, source, count(*)::int n from event_notes group by 1,2'), one(`select count(*)::int n from review_queue where status='open'`),
      one('select kind, count(*)::int n from retro_findings group by 1'), one('select coalesce(percentile_cont(0.5) within group (order by latency_ms),0)::int p50, coalesce(max(latency_ms),0)::int max from decisions')]);
    const tagList = await one('select name, description, created_by, uses from tags order by uses desc, name'), analyses = await one(`select a.id, a.member_id, a.trigger_reason, a.action, a.action_reason, a.verdict, a.model, a.latency_ms, a.created_at from analyses a order by a.id desc limit 10`);
    return json(res, 200, { tags: tagList, analyses, events: events[0].n, decisions, alerts, cases, notes, review_open: review[0].n, retro, latency: latency[0],
      recentAlerts: await one(`select a.alert_id, a.member_id, a.source, a.kind, a.level, a.created_at, n.risk, n.note from alerts a left join event_notes n on n.event_id=a.event_id order by a.created_at desc limit 12`) });
  }
  if (p === '/api/cases') return json(res, 200, (await q(`select c.case_id, c.member_id, c.status, c.channel, c.ato, c.outcome, c.opened_at, c.due_at, c.signals, c.handoff_note, c.ctx,
      (select body from messages m where m.case_id=c.case_id order by id limit 1) as opening from cases c order by c.opened_at desc limit 60`)).rows);
  let m = p.match(/^\/api\/cases\/([\w-]+)$/); if (m) { const d = await caseDetail(m[1]); return d ? json(res, 200, d) : json(res, 404, { error: 'not found' }); }
  if (p === '/api/review') return json(res, 200, (await q(`select r.id, r.event_id, r.member_id, r.reason, r.status, r.created_at, n.tag, n.risk from review_queue r left join event_notes n on n.event_id=r.event_id order by r.id desc limit 40`)).rows);
  if (p === '/api/retro') return json(res, 200, (await q('select finding_key, member_id, kind, summary, created_at from retro_findings order by created_at desc limit 40')).rows);
  m = p.match(/^\/api\/cases\/([\w-]+)\/(reply|resolve|log|action|takeover)$/);
  if (m && req.method === 'POST') {
    const body = await readBody(req);
    if (m[2] === 'reply') return json(res, 200, await reply(m[1], body.text));
    if (m[2] === 'log') {                                     // scripted chat mirrored into the case: stored, not delivered
      const c = (await q('select channel, member_id from cases where case_id=$1', [m[1]])).rows[0]; if (!c) return json(res, 404, { error: 'not found' });
      const dir = ['in', 'out', 'system'].includes(body.direction) ? body.direction : 'system';
      await say(m[1], dir, String(body.text || '').slice(0, 600), String(body.source || 'script').slice(0, 20), c.channel, c.member_id, null, false);
      await q(`update cases set status=case when status in ('awaiting_member') then 'in_conversation' else status end, due_at=null, updated_at=now() where case_id=$1`, [m[1]]);
      return json(res, 200, { ok: true });
    }
    if (['log', 'action', 'takeover'].includes(m[2]) && !(await q('select 1 from cases where case_id=$1', [m[1]])).rowCount) return json(res, 404, { error: 'not found' });   // the story was reset while a message was in flight
    if (m[2] === 'takeover') {                                // a person takes the chat from the agent (or hands it back)
      const on = !!body.on;
      await q(`update cases set status=$2, due_at=null, updated_at=now() where case_id=$1 and status not in ('resolved')`, [m[1], on ? 'escalated_human' : 'in_conversation']);
      await say(m[1], 'system', on ? 'A Sound team member took over the chat.' : 'The chat was handed back to Harbor.', 'employee'); return json(res, 200, { ok: true });
    }
    if (m[2] === 'action') { await say(m[1], 'system', String(body.text || '').slice(0, 300), 'employee'); return json(res, 200, { ok: true }); }
    const status = ['human', 'no_response', 'timeout', 'callback', 'callback_fast', 'ato_stop'].includes(body.outcome) ? 'escalated_human' : 'resolved';
    await resolve(m[1], String(body.outcome || 'resolved').slice(0, 60), status); return json(res, 200, { ok: true, status });
  }
  if (p.startsWith('/api/')) return json(res, 404, { error: 'not found' });
  return serveStatic(req, res, p);
}

/* ---------- main ---------- */
(async () => {
  await ensureSchema(); await K.ensureTopics(); prod = await K.producer();
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
  http.createServer((req, res) => route(req, res).catch((e) => { console.error('http', e.message); json(res, Number.isInteger(e.code) && e.code >= 400 && e.code < 600 ? e.code : 500, { error: e.message }); })).listen(cfg.agentPort, () =>
    console.log(`[agent] running. API http://localhost:${cfg.agentPort}  provider: ${(llm.provider() || { name: 'none (template messages only)' }).name}`));
})().catch((e) => { console.error(e); process.exit(1); });

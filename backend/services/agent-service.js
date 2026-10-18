// API server + notification agent. One process serves the app on http://localhost:8787 and runs the agent.
//   alerts.risk -> case management (merge, rate-limit) -> personalized message -> notifications.out -> delivery adapter
//   HTTP: static front end, /api/demo/* (stream a demo story into Kafka), /api/console + /api/cases/* (real cases),
//         /api/chat (direct model chat), /api/traces (model inspector), /api/pipeline (stats).
//   Timer: no reply by due_at -> escalate to a human.
const http = require('http'), crypto = require('crypto');
const cfg = require('../lib/config'), { pool, q, ensureSchema } = require('../lib/db'), K = require('../lib/kafka'), llm = require('../lib/llm'), demo = require('../lib/demo');
const { compose, whyFor, money, railWord } = require('../lib/compose');
const agent = llm.agent, { json, readBody, serveStatic } = require('../../harbor/http.js'), feedback = require('../../harbor/feedback.js'), ftc = require('../../harbor/ftc.js'), { redact, deep } = require('../../harbor/redact.js');

/* ---------- alert handling ---------- */
let prod;
async function say(caseId, direction, body, source, channel, memberId, meta, deliver = true) {
  const r = await q('insert into messages (case_id, direction, body, source, meta) values ($1,$2,$3,$4,$5) returning id', [caseId, direction, body, source, meta ? JSON.stringify(meta) : null]);
  if (direction === 'out' && deliver) await K.send(prod, cfg.topics.out, memberId, { message_id: r.rows[0].id, case_id: caseId, member_id: memberId, channel, body });
  return r.rows[0].id;
}
function ctxFrom(a) {
  return { amount: a.amount ? money(a.amount) : '', rail: railWord(a.rail), recipient: a.rail === 'Cash' ? '' : a.recipient_status === 'New' ? 'someone new' : 'a recipient', reasons: whyFor(a),
    name: a.name || '', ato: !!a.ato, level: a.level === 'confirm' || a.level === 'followup' ? 'confirm' : 'hold', completed: !!a.completed, trustedContact: !!a.trusted_contact };
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
    const reasons = whyFor(a);                                                     // member-safe wording: the chat model may repeat it
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
  const ctx = ctxFrom(Object.assign({}, a, { trusted_contact: trusted, name: mem.first_name }));
  await q(`insert into cases (case_id, member_id, status, channel, ato, ctx, due_at) values ($1,$2,'awaiting_member',$3,$4,$5, now() + ($6 || ' seconds')::interval)`,
    [caseId, a.member_id, channel, !!a.ato, JSON.stringify(ctx), String(cfg.caseTimeoutSec)]);
  await q('insert into case_alerts (case_id, alert_id) values ($1,$2)', [caseId, a.alert_id]);
  await say(caseId, 'out', msg.text, msg.source, channel, a.member_id, { ms: msg.ms, model: msg.model || null, fallback: msg.reason || null });
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
  await say(id, 'in', redact(text), 'member');                                    // a typed password or code is never stored
  const hist = d.messages.filter((m) => m.direction !== 'system').map((m) => ({ role: m.direction === 'out' ? 'assistant' : 'user', content: m.body }));
  hist.push({ role: 'user', content: text });                                     // raw: the agent detects a shared secret, then masks it before the model sees it
  const r = await agent.chat({ ctx: d.case.ctx, messages: hist });
  await say(id, 'out', r.reply, 'llm', d.case.channel, d.case.member_id);
  const signals = Object.assign({}, d.case.signals); for (const k in r.signals) if (r.signals[k]) signals[k] = true;
  await q(`update cases set status='in_conversation', signals=$2, handoff_note=$3, due_at=null, updated_at=now() where case_id=$1`, [id, JSON.stringify(signals), r.handoff_note]);
  return { reply: r.reply, signals, red: Object.keys(signals).some((k) => agent.RED_FLAGS.includes(k) && signals[k]), member_state: r.member_state, guarded: !!r.guarded, handoff_note: r.handoff_note, tone: r.tone, agent_version: r.agent_version };
}
async function resolve(id, outcome, status) {
  await q(`update cases set status=$2, outcome=$3, due_at=null, updated_at=now() where case_id=$1`, [id, status, outcome]);
  await say(id, 'system', `Case ${status}: ${outcome}`, 'system');
}

/* ---------- demo: stream a story into the pipeline, read back what it decided ---------- */
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
  const env = demo.envelopeById(mid, eventId || (demo.triggerFor(mid) || {}).eventId);
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
      composed: iso(out && out.created_at), delivered: iso(out && out.delivered_at), compose_ms: out && out.meta && out.meta.ms, compose_model: out && out.meta && out.meta.model, compose_source: out && out.source, compose_fallback: out && out.meta && out.meta.fallback } };
}
async function route(req, res) {
  const url = new URL(req.url, 'http://x'), p = url.pathname;
  if (agent.trace.handle(req, res)) return;                   // model inspector endpoints
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (p === '/api/status') { const pr = llm.provider(); return json(res, 200, { backend: true, live: !!pr, provider: pr && pr.name, model: pr && pr.model, timeoutMs: pr && pr.timeoutMs }); }
  if (p === '/api/chat' && req.method === 'POST') { try { return json(res, 200, await agent.chat(await readBody(req))); } catch (e) { console.error('chat error:', e.message); return e.code === 400 ? json(res, 400, { error: 'bad request' }) : json(res, 502, { error: 'agent unavailable' }); } }
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
  if (p === '/api/feedback' && req.method === 'POST') {                          // member thumbs or employee 1-5, with a snapshot of the case at that moment
    const row = feedback.clean(await readBody(req)); if (!row) return json(res, 400, { error: 'bad feedback' });
    const d = row.case_id ? await caseDetail(row.case_id) : null;               // the case may be reset later; the snapshot keeps what was rated
    if (d) Object.assign(row.context, { case: { status: d.case.status, outcome: d.case.outcome, channel: d.case.channel, ato: d.case.ato, signals: d.case.signals, handoff_note: d.case.handoff_note, reasons: d.case.ctx.reasons },
      stored_messages: d.messages.map((m) => ({ direction: m.direction, source: m.source, body: m.body, at: m.created_at })), alerts: d.alerts.map((a) => ({ source: a.source, kind: a.kind, level: a.level, tag: a.tag, risk: a.risk })) });
    const r = await q(`insert into feedback (source, kind, score, comment, case_id, member_id, outcome, mode, agent_version, context) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [row.source, row.kind, row.score, row.comment, row.case_id, row.member_id || (d && d.case.member_id), row.outcome, row.mode, agent.VERSION, JSON.stringify(row.context)]);
    return json(res, 200, { ok: true, id: r.rows[0].id });
  }
  if (p === '/api/feedback') return json(res, 200, (await q(`select id, source, kind, score, comment, case_id, member_id, outcome, mode, agent_version, created_at from feedback order by id desc limit 200`)).rows);
  if (p === '/api/interactions' && req.method === 'POST') {
    const rows = feedback.cleanEvents(await readBody(req));
    for (const r of rows) await q('insert into interactions (kind, case_id, member_id, story, mode, tone, agent_version, ms, detail) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [r.kind, r.case_id, r.member_id, r.story, r.mode, r.tone, agent.VERSION, r.ms, JSON.stringify(r.detail)]);
    return json(res, 200, { ok: true, n: rows.length });
  }
  if (p === '/api/interactions') return json(res, 200, (await q('select id, kind, case_id, member_id, story, mode, tone, agent_version, ms, detail, created_at from interactions order by id desc limit 500')).rows);
  if (p === '/api/ftc/questions' && req.method === 'POST') { const b = await readBody(req); return json(res, 200, { questions: ftc.questionsFor(b.facts || {}), known: ftc.known(b.facts || {}) }); }
  if (p === '/api/ftc/draft' && req.method === 'POST') {                          // the agent drafts the FTC report; an employee files it with the member
    const b = await readBody(req), d = await ftc.draft(b), choice = ['assisted', 'self', 'later'].includes(b.choice) ? b.choice : 'assisted';
    await q('insert into ftc_reports (case_id, member_id, choice, status, answers, draft) values ($1,$2,$3,$4,$5,$6)', [b.case_id || null, b.member_id || null, choice,
      { assisted: 'ready_for_review', self: 'member_filing', later: 'not_now' }[choice], JSON.stringify(deep(b.answers || {})), JSON.stringify(d)]);
    if (b.case_id && (await q('select 1 from cases where case_id=$1', [b.case_id])).rowCount) await say(b.case_id, 'system', `FTC report drafted (${choice === 'assisted' ? 'member asked for help: ready for an employee to review and file' : choice === 'self' ? 'member will file it themselves' : 'member chose not now'})`, 'system');
    return json(res, 200, d);
  }
  if (p === '/api/ftc') return json(res, 200, (await q('select id, case_id, member_id, choice, status, answers, draft, created_at from ftc_reports order by id desc limit 100')).rows);
  if (p === '/api/review') return json(res, 200, (await q(`select r.id, r.event_id, r.member_id, r.reason, r.status, r.created_at, n.tag, n.risk from review_queue r left join event_notes n on n.event_id=r.event_id order by r.id desc limit 40`)).rows);
  if (p === '/api/retro') return json(res, 200, (await q('select finding_key, member_id, kind, summary, created_at from retro_findings order by created_at desc limit 40')).rows);
  m = p.match(/^\/api\/cases\/([\w-]+)\/(reply|resolve|log|action|takeover|join)$/);
  if (m && req.method === 'POST') {
    const body = await readBody(req);
    if (m[2] === 'reply') return json(res, 200, await reply(m[1], body.text));
    if (m[2] === 'log') {                                     // scripted chat mirrored into the case: stored, not delivered
      const c = (await q('select channel, member_id from cases where case_id=$1', [m[1]])).rows[0]; if (!c) return json(res, 404, { error: 'not found' });
      const dir = ['in', 'out', 'system'].includes(body.direction) ? body.direction : 'system';
      await say(m[1], dir, redact(String(body.text || '').slice(0, 600)), String(body.source || 'script').slice(0, 20), c.channel, c.member_id, null, false);
      await q(`update cases set status=case when status in ('awaiting_member') then 'in_conversation' else status end, due_at=null, updated_at=now() where case_id=$1`, [m[1]]);
      return json(res, 200, { ok: true });
    }
    if (['action', 'takeover', 'resolve', 'join'].includes(m[2]) && !(await q('select 1 from cases where case_id=$1', [m[1]])).rowCount) return json(res, 404, { error: 'not found' });   // the story was reset while a message was in flight
    if (m[2] === 'takeover') {                                // a person takes the chat from the agent (or hands it back)
      const on = !!body.on;
      await q(`update cases set status=$2, due_at=null, updated_at=now() where case_id=$1 and status not in ('resolved')`, [m[1], on ? 'escalated_human' : 'in_conversation']);
      await say(m[1], 'system', on ? 'A Sound team member took over the chat.' : 'The chat was handed back to Harbor.', 'employee'); return json(res, 200, { ok: true });
    }
    if (m[2] === 'join') { await say(m[1], 'system', 'Harbor asked a Sound team member to join: ' + String(body.reason || 'needs a person').slice(0, 200), 'system'); return json(res, 200, { ok: true }); }   // the agent asks for a person; code decides when
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

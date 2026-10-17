// FAST PATH. events.raw -> rules engine (deterministic, no LLM) -> Postgres + alerts.risk.
// No model call sits between an event and an alert decision: it must be fast, repeatable and explainable.
const cfg = require('../lib/config'), { pool } = require('../lib/db'), K = require('../lib/kafka'), ev = require('../lib/events');
const engine = require('../../harbor/engine.js');

const stateCache = new Map();
async function loadState(memberId) {
  if (stateCache.has(memberId)) return stateCache.get(memberId);
  const r = await pool.query('select state from member_state where member_id=$1', [memberId]);
  const st = r.rows[0] ? r.rows[0].state : engine.createState();
  stateCache.set(memberId, st); return st;
}

(async () => {
  await K.ensureTopics();
  const prod = await K.producer();
  let processed = 0;

  async function publishAlert(row) {
    await K.send(prod, cfg.topics.alerts, row.member_id, row.payload);
    await pool.query('update alerts set published=true where alert_id=$1', [row.alert_id]);
  }
  // Outbox sweeper: an alert committed to Postgres but not yet published (crash between the two) is re-sent.
  setInterval(async () => {
    try { for (const r of (await pool.query('select alert_id, member_id, payload from alerts where not published order by created_at limit 50')).rows) await publishAlert(r); }
    catch (e) { console.error('sweeper', e.message); }
  }, 5000);

  const handler = async (e) => {
    const t0 = Date.now(), st = await loadState(e.member_id), client = await pool.connect();
    let alert = null, decision = null;
    try {
      await client.query('begin');
      const ins = await client.query(`insert into events (${ev.EVENT_COLS.join(',')}) values (${ev.EVENT_COLS.map((_, i) => '$' + (i + 1)).join(',')}) on conflict (event_id) do nothing`, ev.eventRow(e));
      if (!ins.rowCount) { await client.query('rollback'); return; }                // duplicate delivery: already handled
      decision = engine.step(st, e, {});                                           // mutates st
      await client.query('insert into member_state (member_id, state) values ($1,$2) on conflict (member_id) do update set state=$2, updated_at=now()', [e.member_id, st]);
      if (decision) {
        await client.query('insert into decisions (event_id, member_id, level, rules, suppress, armed, latency_ms) values ($1,$2,$3,$4,$5,$6,$7)',
          [e.id, e.member_id, decision.level, JSON.stringify(decision.rules.map((r) => ({ id: r.id, label: r.label, reason: r.reason }))), JSON.stringify(decision.suppress), decision.armed, Date.now() - t0]);
        if (decision.level !== 'none') {
          alert = { alert_id: e.id, member_id: e.member_id,
            payload: { schema: 1, alert_id: e.id, member_id: e.member_id, source: 'rules', level: decision.level, event_id: e.id, payment_id: e.pid || null, ts: e.ts,
              amount: e.amt, rail: e.rail, recipient_status: e.rs, ato: decision.rules.some((r) => r.id === 'ATO'),
              rules: decision.rules.map((r) => ({ id: r.id, label: r.label, reason: r.reason })), suppress: decision.suppress, decided_ms: Date.now() - t0 } };
          await client.query('insert into alerts (alert_id, member_id, source, kind, level, event_id, payload) values ($1,$2,$3,$4,$5,$6,$7)',
            [alert.alert_id, e.member_id, 'rules', decision.rules.map((r) => r.id).join('+'), decision.level, e.id, JSON.stringify(alert.payload)]);
        }
      }
      await client.query('commit');
    } catch (err) { await client.query('rollback').catch(() => {}); stateCache.delete(e.member_id); throw err; }
    finally { client.release(); }

    if (alert) await publishAlert(alert);
    // Only meaningful events go to the slow, LLM-based tagger. Routine card swipes and logins do not.
    if (ev.isKeyEvent(e)) await K.send(prod, cfg.topics.scored, e.member_id, { schema: 1, event: e, decision: decision ? { level: decision.level, rules: decision.rules.map((r) => r.id) } : null });
    if (++processed % 500 === 0) console.log(`[scorer] ${processed} events`);
    if (alert) console.log(`[scorer] ALERT ${alert.payload.level.toUpperCase()} ${e.member_id} ${alert.payload.rules.map((r) => r.id).join('+')} $${Math.round(e.amt)} in ${alert.payload.decided_ms}ms`);
  };
  await K.consume({ group: 'harbor-scorer', topic: cfg.topics.raw, handler, dlqProducer: prod, concurrency: 3 });
  console.log('[scorer] running');
})().catch((e) => { console.error(e); process.exit(1); });

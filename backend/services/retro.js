// RETRO JOB (cron). Looks back over the full Postgres history for patterns real-time rules cannot see:
// long windows, cumulative amounts, cases that went quiet. Detection is SQL (cheap, repeatable);
// the LLM only writes the plain-language insight. Findings re-enter the SAME alerts.risk topic, so the same
// notification agent contacts the member again (follow-up tone, recovery-oriented if money already moved).
//   node services/retro.js --once                  run now
//   node services/retro.js --every-hours 24        run on an interval
//   crontab: 0 3 * * *  cd /path/to/backend && node services/retro.js --once
// "Now" is the newest event time in the data, so the synthetic replay behaves like a live clock. Override: --as-of 2026-10-31T00:00:00Z
const crypto = require('crypto');
const cfg = require('../lib/config'), { pool, q } = require('../lib/db'), K = require('../lib/kafka'), llm = require('../lib/llm');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const money = (n) => '$' + Math.round(n).toLocaleString('en-US');

const DETECTORS = [
  { kind: 'slow_ramp', completed: true, level: 'followup',
    // 3+ outgoing P2P payments to people new to the account within 21 days, nobody alerted on any of them. Rules only look at one payment at a time.
    sql: `select member_id, count(*)::int n, sum(amount) total, min(ts) first_ts, max(ts) last_ts, min(event_id) anchor
          from events e where type='Payment Initiated' and direction='Outgoing' and rail='P2P' and (recipient_status='New' or recipient_age_days<=30) and ts <= $1::timestamptz and ts > $1::timestamptz - interval '21 days'
            and not exists (select 1 from alerts a where a.event_id=e.event_id)
          group by member_id having count(*) >= 3 and sum(amount) >= 400`,
    fact: (r) => `${r.n} payments totalling ${money(r.total)} to people who are new to the account in the past three weeks, with no earlier check-in.` },
  { kind: 'takeover_slow', completed: true, level: 'followup',
    // New contact details followed by a payment to a new recipient within 72 hours, outside the 90 minute real-time window.
    sql: `select e.member_id, 1 n, e.amount total, e.ts first_ts, e.ts last_ts, e.event_id anchor from events e
          where e.type='Payment Initiated' and e.direction='Outgoing' and e.recipient_status='New' and e.ts <= $1::timestamptz
            and exists (select 1 from events x where x.member_id=e.member_id and x.type='Email Change' and x.ts between e.ts - interval '72 hours' and e.ts)
            and exists (select 1 from events x where x.member_id=e.member_id and x.type='Phone Change' and x.ts between e.ts - interval '72 hours' and e.ts)
            and not exists (select 1 from alerts a where a.event_id=e.event_id)`,
    fact: (r) => `a ${money(r.total)} payment to a new recipient within three days of the email and phone number being changed.` },
  { kind: 'large_unflagged', completed: true, level: 'followup',
    // Money already moved: hard-to-reverse payment, well above normal, to a new recipient, never alerted.
    sql: `select member_id, 1 n, amount total, ts first_ts, ts last_ts, event_id anchor from events e
          where type='Payment Initiated' and direction='Outgoing' and rail in ('Wire','Cash','External Transfer') and recipient_status='New' and ratio >= 1.5 and ts <= $1::timestamptz
            and not exists (select 1 from alerts a where a.event_id=e.event_id)`,
    fact: (r) => `a ${money(r.total)} transfer to a new recipient that was well above your usual activity.` },
  { kind: 'quiet_case', completed: false, level: 'followup',
    // A case escalated because the member never replied: one more gentle attempt before the human queue is the only contact.
    sql: `select c.member_id, 1 n, 0::numeric total, c.opened_at first_ts, c.updated_at last_ts, c.case_id anchor from cases c
          where c.status='escalated_human' and c.outcome='no_response' and c.updated_at <= now() - ($2::text || ' hours')::interval and $1::timestamptz is not null`,
    fact: () => `we tried to reach you about a paused payment and haven't heard back.` },
];

async function insight(d, r, facts) {                                               // LLM writes one calm paragraph; falls back to the SQL fact
  const fallback = `Looking back over your recent activity, I noticed ${facts}`;
  try {
    const out = await llm.completeJSON(`You write ONE short, calm sentence (max 35 words) for a member follow-up from a credit union security analyst. Facts only, no accusation, never say "scam" or "fraud", no passwords or codes. Return ONLY JSON {"summary": "..."}.`, JSON.stringify({ detector: d.kind, facts }));
    const s = out && String(out.summary || '').trim();
    return s && s.length < 300 && !llm.agent.BAD_REPLY.some((x) => x.test(s)) ? s : fallback;
  } catch { return fallback; }
}

async function run() {
  const asOf = arg('as-of') || (await q('select max(ts) t from events')).rows[0].t;
  if (!asOf) { console.log('[retro] no events yet'); return; }
  const quietHours = arg('quiet-hours', '0');
  const prod = await K.producer(); let raised = 0;
  for (const d of DETECTORS) {
    const rows = (await pool.query(d.sql, d.sql.includes('$2') ? [asOf, quietHours] : [asOf])).rows;
    for (const r of rows) {
      const key = `${d.kind}|${r.member_id}|${d.kind === 'slow_ramp' ? new Date(r.first_ts).toISOString().slice(0, 10) : r.anchor}`;
      const facts = d.fact(r);
      const summary = await insight(d, r, facts);
      const alertId = 'retro:' + crypto.createHash('sha1').update(key).digest('hex').slice(0, 12);
      const ins = await q('insert into retro_findings (finding_key, member_id, kind, summary, detail, alert_id) values ($1,$2,$3,$4,$5,$6) on conflict (finding_key) do nothing returning finding_key',
        [key, r.member_id, d.kind, summary, JSON.stringify({ n: r.n, total: r.total, first: r.first_ts, last: r.last_ts, anchor: r.anchor }), alertId]);
      if (!ins.rowCount) continue;                                                  // already raised on an earlier run
      await K.send(prod, cfg.topics.alerts, r.member_id, { schema: 1, alert_id: alertId, member_id: r.member_id, source: 'retro', kind: d.kind, level: d.level, event_id: null,
        summary, amount: Number(r.total) || null, completed: d.completed, ts: new Date(asOf).toISOString() });
      raised++; console.log(`[retro] ${d.kind} ${r.member_id}: ${summary}`);
    }
  }
  console.log(`[retro] as of ${new Date(asOf).toISOString()}: ${raised} new finding(s)`); await prod.disconnect();
}

(async () => {
  await K.ensureTopics();
  if (arg('every-hours')) { await run(); setInterval(() => run().catch((e) => console.error(e)), +arg('every-hours') * 3600e3); }
  else { await run(); await pool.end(); process.exit(0); }
})().catch((e) => { console.error(e); process.exit(1); });

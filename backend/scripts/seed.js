const { pool } = require('../lib/db'), load = require('../lib/data');
(async () => {
  const d = load();
  for (const m of d.members) {
    await pool.query('insert into members (member_id, first_name) values ($1,$2) on conflict (member_id) do update set first_name=$2', [m.id, m.persona || null]);
    await pool.query(`insert into ground_truth (member_id, scenario, subtype, is_lookalike, outcome, summary, scam_payment_ids) values ($1,$2,$3,$4,$5,$6,$7)
      on conflict (member_id) do update set scenario=$2, subtype=$3, is_lookalike=$4, outcome=$5, summary=$6, scam_payment_ids=$7`, [m.id, m.scenario, m.subtype, m.lookalike, m.outcome, m.summary, m.scamPayments]);
  }
  console.log('seeded', d.members.length, 'members'); await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });

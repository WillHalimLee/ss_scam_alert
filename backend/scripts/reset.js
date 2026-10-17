// Wipes pipeline tables and Kafka topics for a clean demo run (keeps the schema, reseeds members).
const { pool } = require('../lib/db'), K = require('../lib/kafka'), cfg = require('../lib/config');
(async () => {
  await pool.query('truncate case_alerts, messages, cases, retro_findings, review_queue, event_notes, alerts, decisions, member_state, events restart identity cascade');
  const admin = K.kafka.admin(); await admin.connect();
  const have = await admin.listTopics();
  const del = Object.values(cfg.topics).filter((t) => have.includes(t));
  if (del.length) await admin.deleteTopics({ topics: del });
  await admin.disconnect(); await pool.end();
  // consumer groups keep offsets for deleted topics in some brokers; a new group suffix avoids stale offsets
  console.log('reset: tables truncated, topics deleted:', del.join(', ') || 'none');
})().catch((e) => { console.error(e); process.exit(1); });

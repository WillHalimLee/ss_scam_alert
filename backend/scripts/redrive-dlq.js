// Re-publishes dead-lettered messages to their original topic after a bug is fixed. Safe to repeat:
// every consumer is idempotent (event_id / alert_id keys), so a message processed twice has no extra effect.
//   node scripts/redrive-dlq.js [group]     (default: all groups)
const cfg = require('../lib/config'), K = require('../lib/kafka');
(async () => {
  const only = process.argv[2], prod = await K.producer();
  const c = K.kafka.consumer({ groupId: 'redrive-' + Date.now() }); await c.connect();
  await c.subscribe({ topic: cfg.topics.dlq, fromBeginning: true });
  let n = 0, last = Date.now();
  await c.run({ eachMessage: async ({ message }) => {
    last = Date.now(); const m = JSON.parse(message.value.toString());
    if (only && m.group !== only) return;
    const raw = JSON.parse(m.raw), key = (raw.member_id || (raw.event && raw.event.member_id) || null);
    await prod.send({ topic: m.topic, messages: [{ key, value: m.raw }] }); n++;
  } });
  while (Date.now() - last < 3000) await new Promise((r) => setTimeout(r, 500));
  console.log('redriven', n, 'message(s)'); await c.disconnect(); await prod.disconnect(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

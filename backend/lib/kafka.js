const { Kafka, logLevel } = require('kafkajs');
const cfg = require('./config');
const kafka = new Kafka({ clientId: 'harbor', brokers: cfg.brokers, logLevel: logLevel.ERROR, retry: { retries: 8 } });

async function ensureTopics() {
  const admin = kafka.admin(); await admin.connect();
  const t = cfg.topics, want = [[t.raw, cfg.partitions], [t.scored, cfg.partitions], [t.alerts, cfg.partitions], [t.out, cfg.partitions], [t.dlq, 1]];
  const have = new Set(await admin.listTopics());
  const missing = want.filter(([n]) => !have.has(n)).map(([topic, numPartitions]) => ({ topic, numPartitions }));
  if (missing.length) { try { await admin.createTopics({ topics: missing, waitForLeaders: true }); } catch (e) { /* another service created it first */ } }
  await admin.disconnect();
}
async function producer() { const p = kafka.producer({ idempotent: true, maxInFlightRequests: 1 }); await p.connect(); return p; }
const send = (p, topic, key, value) => p.send({ topic, messages: [{ key, value: JSON.stringify(value) }] });

/** Consume with retries. A message that keeps failing goes to the dead-letter topic instead of blocking the partition. */
async function consume({ group, topic, handler, dlqProducer, concurrency = 1, retries = 3 }) {
  const c = kafka.consumer({ groupId: group }); await c.connect();
  await c.subscribe({ topic, fromBeginning: true });
  await c.run({ partitionsConsumedConcurrently: concurrency, eachMessage: async ({ message, partition }) => {
    const raw = message.value.toString();
    for (let i = 1; i <= retries; i++) {
      try { return await handler(JSON.parse(raw), { partition, key: message.key && message.key.toString() }); }
      catch (e) {
        console.error(`[${group}] attempt ${i}/${retries} failed: ${e.message}`);
        if (i === retries) { if (dlqProducer) await send(dlqProducer, cfg.topics.dlq, group, { group, topic, error: e.message, raw }); return; }
        await new Promise((r) => setTimeout(r, 300 * i));
      }
    }
  } });
  return c;
}
module.exports = { kafka, ensureTopics, producer, send, consume };

// Replays the challenge data into events.raw, keyed by member_id (keeps each member's events ordered).
//   node services/replayer.js [--members M1003,M1001] [--rate 25] [--limit N]
const cfg = require('../lib/config'), K = require('../lib/kafka'), ev = require('../lib/events'), load = require('../lib/data');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
(async () => {
  const data = load(), want = arg('members') ? new Set(arg('members').split(',')) : null, rate = +arg('rate', 25), limit = +arg('limit', 1e9);
  await K.ensureTopics();
  const prod = await K.producer();
  const all = [];
  for (const m of data.members) if (!want || want.has(m.id)) for (const e of data.events[m.id]) all.push(ev.toEnvelope(m.id, e));
  all.sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));                      // global event-time order, like a live feed
  const batch = Math.max(1, Math.round(rate / 10));
  let n = 0;
  for (let i = 0; i < all.length && n < limit; i += batch) {
    const slice = all.slice(i, i + batch);
    await prod.send({ topic: cfg.topics.raw, messages: slice.map((e) => ({ key: e.member_id, value: JSON.stringify(e) })) });
    n += slice.length; if (n % 500 < batch) console.log(`[replayer] ${n}/${all.length}`);
    await new Promise((r) => setTimeout(r, 1000 / (rate / batch)));
  }
  console.log(`[replayer] done, ${n} events`); await prod.disconnect(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

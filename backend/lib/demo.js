// Demo orchestration: which payment is the trigger for a story, and the account history that comes before it.
const load = require('./data'), engine = require('../../harbor/engine.js'), ev = require('./events');
let DATA;
const data = () => (DATA ||= load());
const eventsOf = (mid) => (data().events[mid] || []);
/** Same choice the browser makes: the first payment the rules react to, else the first new-recipient payment after a reset. */
function triggerFor(mid, planned) {
  const evs = eventsOf(mid), decs = engine.evaluate(evs, { planned });
  let d = decs.find((x) => x.level !== 'none');
  if (!d) { const reset = evs.find((e) => e.type === 'Password Reset'); d = decs.find((x) => x.rs === 'New' && (!reset || x.t > reset.t)); }
  if (!d) return null;
  const index = evs.findIndex((e) => e.id === d.eventId);
  return { eventId: d.eventId, index, event: evs[index] };
}
const historyOf = (mid, t) => eventsOf(mid).slice(0, t.index).map((e) => Object.assign(ev.toEnvelope(mid, e), { h: 1 }));
const triggerEnvelope = (mid, t) => ev.toEnvelope(mid, t.event);
const envelopeById = (mid, id) => { const e = eventsOf(mid).find((x) => x.id === id); return e ? ev.toEnvelope(mid, e) : null; };
const known = (mid) => data().members.some((m) => m.id === mid);
module.exports = { triggerFor, historyOf, triggerEnvelope, envelopeById, known };

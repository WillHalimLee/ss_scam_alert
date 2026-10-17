// Event envelope on events.raw: the engine's event shape plus member_id, ISO timestamp and a schema version.
const KEY_TYPES = new Set(['Password Reset', 'Email Change', 'Phone Change', 'Address Change', 'Profile Change Alert Sent', 'Recipient Added',
  'Payment Initiated', 'Branch Visit', 'Contact Center Call', 'Failed Login', 'One-Time Code Sent']);
const toEnvelope = (memberId, e) => Object.assign({ schema: 1, member_id: memberId, ts: new Date(e.t).toISOString() }, e);
const isKeyEvent = (e) => KEY_TYPES.has(e.type) && !(e.type === 'Payment Initiated' && e.dir !== 'Outgoing');
const EVENT_COLS = ['event_id', 'member_id', 'ts', 'category', 'type', 'channel', 'payment_id', 'rail', 'amount', 'direction', 'recipient_id', 'recipient_status', 'recipient_age_days',
  'ratio', 'vs_baseline', 'velocity', 'balance', 'profile_change_recent', 'password_reset_recent', 'trusted_contact', 'member_response', 'payment_status', 'note'];
const eventRow = (e) => [e.id, e.member_id, e.ts, e.cat, e.type, e.ch, e.pid || null, e.rail, e.amt, e.dir, e.rid || null, e.rs, e.rage, e.ratio, e.vs, e.vel, e.bal, e.pr, e.rr, e.tc, e.resp, e.pst, e.note || null];
module.exports = { toEnvelope, isKeyEvent, EVENT_COLS, eventRow };

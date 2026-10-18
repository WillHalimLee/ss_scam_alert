/* Data for improving the agent, all of it masked by redact.js before it is stored:
   - feedback: the member's 1-5 rating, the employee's 1-5 rating, and the employee's close-out verdict (was it really a scam?)
   - interactions: what the member was offered and chose, how long it took, voice or typing, fallbacks, abandoned chats, employee replies
   The API server stores both in Postgres; the chat-only server (harbor/server.js) appends them to harbor/.feedback/*.jsonl. Node only. */
const fs = require('fs'), path = require('path'), { redact, deep } = require('./redact.js');
const DIR = process.env.HARBOR_FEEDBACK_DIR || path.join(__dirname, '.feedback');
const short = (v, n) => (v == null || v === '' ? null : String(v).slice(0, n));
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? deep(v) : {});
const VERDICTS = { '-1': 'legitimate', 0: 'unsure', 1: 'confirmed scam' };

/** POST /api/feedback body -> row, or null. Member and employee: rating 1-5 (5 = very good). Employee also: verdict (-1 legitimate, 0 unsure, 1 confirmed scam). */
function clean(b) {
  const source = ['member', 'employee'].includes(b.source) ? b.source : null, score = Math.round(+b.score);
  const kind = source === 'employee' && b.kind === 'verdict' ? 'verdict' : 'rating';
  if (!source || !(kind === 'verdict' ? [-1, 0, 1] : [1, 2, 3, 4, 5]).includes(score)) return null;
  const context = obj(b.context);
  if (kind === 'verdict') for (const k of ['loss', 'recovered']) context[k] = Math.max(0, +context[k] || 0);
  return { source, kind, score, comment: short(redact((b.comment || '').trim()), 1000), case_id: short(b.case_id, 40), member_id: short(b.member_id, 20), outcome: short(b.outcome, 40),
    mode: ['live', 'guided'].includes(b.mode) ? b.mode : null, context };
}

const EVENTS = ['offered', 'chose', 'typed', 'voice', 'fallback', 'abandoned', 'employee_reply', 'join_request', 'join_answered'];
/** POST /api/interactions body ({ events: [...] }) -> up to 50 rows. Unknown kinds are dropped. */
const cleanEvents = (b) => (Array.isArray(b.events) ? b.events : []).slice(0, 50).filter((e) => e && EVENTS.includes(e.kind)).map((e) => ({
  kind: e.kind, case_id: short(e.case_id, 40), member_id: short(e.member_id, 20), story: short(e.story, 20), mode: ['live', 'guided'].includes(e.mode) ? e.mode : null,
  tone: short(e.tone, 20), ms: Number.isFinite(+e.ms) && e.ms != null ? Math.max(0, Math.round(+e.ms)) : null, detail: obj(e.detail) }));

const store = (name) => {
  const file = path.join(DIR, name + '.jsonl');
  return {
    add(row) { fs.mkdirSync(DIR, { recursive: true }); const r = Object.assign({ id: Date.now() + Math.random().toString(36).slice(2, 6), created_at: new Date().toISOString() }, row); fs.appendFileSync(file, JSON.stringify(r) + '\n'); return r; },
    list(n = 200) { try { return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).slice(-n).reverse(); } catch { return []; } },
  };
};
module.exports = { clean, cleanEvents, VERDICTS, EVENTS, store, fileStore: store('feedback'), eventStore: store('interactions'), DIR };

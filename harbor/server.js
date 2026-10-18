// node harbor/server.js   -> http://localhost:8787  (serves the prototype + POST /api/chat)
// Keys stay on the server. Set ONE of: ANTHROPIC_API_KEY, OPENAI_API_KEY (or HARBOR_PROVIDER=mock to test offline).
// Optional: HARBOR_PROVIDER=ollama|openai|anthropic|mock (ollama needs no key: HARBOR_MODEL=qwen2.5:14b), HARBOR_MODEL=<model id>, PORT=8787
const http = require('http');
const agent = require('./agent.js'), feedback = require('./feedback.js'), { json, readBody, serveStatic } = require('./http.js');
const PORT = +process.env.PORT || 8787;
const hits = new Map(); // tiny per-IP rate limit: 30 requests / minute
function limited(ip) {
  const now = Date.now(), a = (hits.get(ip) || []).filter((t) => now - t < 60000); a.push(now); hits.set(ip, a); return a.length > 30;
}
http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (agent.trace.handle(req, res)) return;                 // /api/traces, /api/traces/stream, /api/traces/clear
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/api/status') { const pr = agent.provider(); return json(res, 200, { live: !!pr, provider: pr && pr.name, model: pr && pr.model, timeoutMs: pr && pr.timeoutMs }); }
  if (p === '/api/chat' && req.method === 'POST') {
    if (limited(req.socket.remoteAddress)) return json(res, 429, { error: 'slow down' });
    try { return json(res, 200, await agent.chat(await readBody(req))); }
    catch (e) { console.error('chat error:', e.message); return json(res, e.code || 502, { error: e.code === 400 ? 'bad request' : 'agent unavailable' }); }
  }
  if (p === '/api/feedback' && req.method === 'POST') {                   // no database here: kept in harbor/.feedback/feedback.jsonl
    const row = feedback.clean(await readBody(req)); if (!row) return json(res, 400, { error: 'bad feedback' });
    return json(res, 200, { ok: true, id: feedback.fileStore.add(Object.assign(row, { agent_version: agent.VERSION })).id });
  }
  if (p === '/api/feedback') return json(res, 200, feedback.fileStore.list());
  if (p === '/api/interactions' && req.method === 'POST') { const rows = feedback.cleanEvents(await readBody(req)); for (const r of rows) feedback.eventStore.add(Object.assign(r, { agent_version: agent.VERSION })); return json(res, 200, { ok: true, n: rows.length }); }
  if (p === '/api/interactions') return json(res, 200, feedback.eventStore.list(500));
  if (p.startsWith('/api/')) return json(res, 404, { error: 'not found' });
  serveStatic(req, res, p);
}).listen(PORT, () => {
  const p = agent.provider();
  console.log(`Harbor on http://localhost:${PORT}  |  agent: ${p ? p.name + ' (' + p.model + ')' : 'NO PROVIDER (set a key, or HARBOR_PROVIDER=mock); app falls back to the guided script'}`);
});

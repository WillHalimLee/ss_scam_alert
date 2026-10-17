// node harbor/server.js   -> http://localhost:8787  (serves the prototype + POST /api/chat)
// Keys stay on the server. Set ONE of: ANTHROPIC_API_KEY, OPENAI_API_KEY (or HARBOR_PROVIDER=mock to test offline).
// Optional: HARBOR_PROVIDER=ollama|openai|anthropic|mock (ollama needs no key: HARBOR_MODEL=qwen2.5:14b), HARBOR_MODEL=<model id>, PORT=8787
const http = require('http'), fs = require('fs'), path = require('path');
const agent = require('./agent.js');
const PORT = +process.env.PORT || 8787;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const hits = new Map(); // tiny per-IP rate limit: 30 requests / minute
function limited(ip) {
  const now = Date.now(), a = (hits.get(ip) || []).filter((t) => now - t < 60000); a.push(now); hits.set(ip, a); return a.length > 30;
}
function send(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' });
  res.end(JSON.stringify(obj));
}
http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.url === '/api/status') { const p = agent.provider(); return send(res, 200, { live: !!p, provider: p && p.name, model: p && p.model, timeoutMs: p && p.timeoutMs }); }
  if (req.url === '/api/chat' && req.method === 'POST') {
    if (limited(req.socket.remoteAddress)) return send(res, 429, { error: 'slow down' });
    let raw = ''; req.on('data', (c) => { raw += c; if (raw.length > 20000) req.destroy(); });
    req.on('end', async () => {
      try { send(res, 200, await agent.chat(JSON.parse(raw))); }
      catch (e) { console.error('chat error:', e.message); send(res, e.code || 502, { error: 'agent unavailable' }); }
    });
    return;
  }
  const f = path.join(__dirname, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(__dirname) || /agent\.js$|server\.js$/.test(f) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(PORT, () => {
  const p = agent.provider();
  console.log(`Harbor on http://localhost:${PORT}  |  agent: ${p ? p.name + ' (' + p.model + ')' : 'NO PROVIDER (set a key, or HARBOR_PROVIDER=mock); app falls back to the guided script'}`);
});

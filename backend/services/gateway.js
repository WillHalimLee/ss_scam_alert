// API GATEWAY: the one public port (:8787). Serves the app and routes every /api/* call to the service that owns it:
//   /api/screenshot/*  -> screenshot service (:8791)      everything else under /api/  -> agent service (:8790)
// It owns what every request needs: CORS, per-IP rate limits on the expensive calls, request-size limits, and a clear
// 503 when a service is down. Responses are streamed, so the model inspector's live feed (SSE) passes straight through.
const http = require('http');
const cfg = require('../lib/config'), { json, serveStatic } = require('../../harbor/http.js');

const ROUTES = [                                                                     // first match wins
  { prefix: '/api/screenshot', name: 'screenshot', port: cfg.screenshotPort, maxBytes: 9e6 },
  { prefix: '/api/', name: 'agent', port: cfg.agentPort, maxBytes: 64e3 },
];
const LIMITS = [                                                                     // per IP, per minute: calls that run a model
  { test: (m, p) => m === 'POST' && p.startsWith('/api/screenshot'), max: 10 },
  { test: (m, p) => m === 'POST' && (p === '/api/chat' || /^\/api\/cases\/[\w-]+\/reply$/.test(p) || p === '/api/ftc/draft'), max: 40 },
];
const hits = new Map();
function limited(ip, rule) {
  const key = ip + '|' + LIMITS.indexOf(rule), now = Date.now(), a = (hits.get(key) || []).filter((t) => now - t < 60000);
  a.push(now); hits.set(key, a); return a.length > rule.max;
}
setInterval(() => { const now = Date.now(); for (const [k, a] of hits) if (!a.some((t) => now - t < 60000)) hits.delete(k); }, 60000).unref();

function proxy(req, res, route) {
  if (+req.headers['content-length'] > route.maxBytes) return json(res, 413, { error: 'request too large' });
  const up = http.request({ host: '127.0.0.1', port: route.port, method: req.method, path: req.url, headers: Object.assign({}, req.headers, { 'x-forwarded-for': req.socket.remoteAddress }) }, (r) => {
    res.writeHead(r.statusCode, r.headers); r.pipe(res);
  });
  up.on('error', () => { if (!res.headersSent) json(res, 503, { error: route.name + ' service unavailable', service: route.name }); else res.end(); });
  let size = 0;
  req.on('data', (c) => { size += c.length; if (size > route.maxBytes) { up.destroy(); if (!res.headersSent) json(res, 413, { error: 'request too large' }); req.destroy(); } });
  req.pipe(up);
  res.on('close', () => up.destroy());                                                // the browser left (e.g. closed the inspector): stop the upstream stream
}

/** Is each service answering? Shown under Dev tools > Live pipeline and by `task status`. */
async function health() {
  const check = (port, path) => new Promise((ok) => { const r = http.get({ host: '127.0.0.1', port, path, timeout: 1500 }, (x) => { x.resume(); ok(x.statusCode < 500); }); r.on('error', () => ok(false)); r.on('timeout', () => { r.destroy(); ok(false); }); });
  const [agent, screenshot] = await Promise.all([check(cfg.agentPort, '/api/status'), check(cfg.screenshotPort, '/api/screenshot/health')]);
  return { gateway: true, agent, screenshot };
}

http.createServer(async (req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (p === '/api/gateway/health') return json(res, 200, await health());
  if (!p.startsWith('/api/')) return serveStatic(req, res, p);
  const rule = LIMITS.find((l) => l.test(req.method, p));
  if (rule && limited(req.socket.remoteAddress, rule)) return json(res, 429, { error: 'too many requests, slow down' });
  proxy(req, res, ROUTES.find((r) => p === r.prefix || p.startsWith(r.prefix.replace(/\/?$/, '/'))));
}).listen(cfg.gatewayPort, () => console.log(`[gateway] http://localhost:${cfg.gatewayPort}  ->  agent :${cfg.agentPort}, screenshot :${cfg.screenshotPort}`));

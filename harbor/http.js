/* HTTP helpers shared by the chat-only server (harbor/server.js) and the API server (backend/services/agent-service.js). Node only. */
const fs = require('fs'), path = require('path');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const WEB = __dirname;
const PRIVATE = /(agent|server|trace|http|feedback|eval_agent|test_engine)\.js$|\.traces|\.feedback|\.(py|md)$/;   // server-side code, tests and notes are never served

function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' });
  res.end(JSON.stringify(obj));
}
const readBody = (req) => new Promise((ok) => {
  let b = ''; req.on('data', (c) => { b += c; if (b.length > 20000) req.destroy(); });
  req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { ok({}); } });
});
/** The prototype's files. Dev server: always revalidate so edits show up. */
function serveStatic(req, res, p) {
  const f = path.join(WEB, p === '/' ? 'index.html' : decodeURIComponent(p));
  if (!f.startsWith(WEB) || PRIVATE.test(f) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
}
module.exports = { json, readBody, serveStatic };

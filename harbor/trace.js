/* Shared model trace log. Every LLM call, from any Harbor process, appends one JSON line to the same file.
   The inspector page reads it live (SSE) or you can export / load the .jsonl anywhere. Node only. */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const FILE = process.env.HARBOR_TRACE_FILE || path.join(__dirname, '.traces', 'traces.jsonl');
const SERVICE = process.env.HARBOR_SERVICE || path.basename(process.argv[1] || 'node').replace(/\.js$/, '');
const MAX_BYTES = 25 * 1024 * 1024;

function record(entry) {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    try { if (fs.statSync(FILE).size > MAX_BYTES) fs.renameSync(FILE, FILE + '.1'); } catch { /* no file yet */ }
    const row = Object.assign({ id: crypto.randomBytes(5).toString('hex'), ts: new Date().toISOString(), service: SERVICE }, entry);
    fs.appendFileSync(FILE, JSON.stringify(row) + '\n');
    return row.id;
  } catch (e) { console.error('[trace] write failed:', e.message); return null; }
}

function readFrom(offset) {                       // returns { rows, size } for bytes after offset
  let fd; try { fd = fs.openSync(FILE, 'r'); } catch { return { rows: [], size: 0 }; }
  try {
    const size = fs.fstatSync(fd).size, start = Math.max(0, Math.min(offset, size));
    const buf = Buffer.alloc(size - start); fs.readSync(fd, buf, 0, buf.length, start);
    const rows = buf.toString('utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    return { rows, size };
  } finally { fs.closeSync(fd); }
}
function tail(n) {                                // last n rows (reads at most the last 8 MB)
  let size = 0; try { size = fs.statSync(FILE).size; } catch { return []; }
  const { rows } = readFrom(Math.max(0, size - 8 * 1024 * 1024));
  return rows.slice(-n);
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
/** Mount on any http server: returns true when it handled the request. */
function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/traces' && req.method === 'GET') {
    res.writeHead(200, Object.assign({ 'content-type': 'application/json' }, CORS));
    res.end(JSON.stringify({ file: FILE, traces: tail(Math.min(+url.searchParams.get('limit') || 200, 1000)) })); return true;
  }
  if (url.pathname === '/api/traces/clear' && req.method === 'POST') {
    try { fs.writeFileSync(FILE, ''); } catch { /* nothing to clear */ }
    res.writeHead(200, Object.assign({ 'content-type': 'application/json' }, CORS)); res.end('{"ok":true}'); return true;
  }
  if (url.pathname === '/api/traces/stream' && req.method === 'GET') {
    res.writeHead(200, Object.assign({ 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' }, CORS));
    let offset = 0; try { offset = fs.statSync(FILE).size; } catch { /* starts empty */ }
    res.write(': connected\n\n');
    const timer = setInterval(() => {
      const { rows, size } = readFrom(offset);
      if (size < offset) offset = 0; else offset = size;           // file was cleared or rotated
      for (const r of rows) res.write('data: ' + JSON.stringify(r) + '\n\n');
      if (!rows.length) res.write(': ping\n\n');
    }, 700);
    req.on('close', () => clearInterval(timer)); return true;
  }
  return false;
}
module.exports = { record, tail, handle, FILE, SERVICE };

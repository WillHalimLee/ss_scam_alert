// SCREENSHOT SERVICE (internal :8791, public through the gateway as /api/screenshot/*).
//   POST /api/screenshot/analyze  { image: data URL or base64, case_id?, member_id? }  -> findings + code decisions
//   GET  /api/screenshot?case_id=  -> findings stored for a case          GET /api/screenshot/health -> is the vision model ready?
// The image is read once and never stored: only masked findings and a SHA-256 fingerprint go to Postgres.
const http = require('http');
const cfg = require('../lib/config'), { q, ensureSchema } = require('../lib/db'), shot = require('../lib/screenshot'), agent = require('../../harbor/agent.js'), { json } = require('../../harbor/http.js');
const TYPES = ['image/png', 'image/jpeg', 'image/webp'], MAX_BYTES = 6e6;

const readJson = (req, limit) => new Promise((ok, no) => {
  let size = 0; const parts = [];
  req.on('data', (c) => { size += c.length; if (size > limit) { no(Object.assign(new Error('screenshot too large (6 MB max)'), { code: 413 })); req.destroy(); } else parts.push(c); });
  req.on('end', () => { try { ok(JSON.parse(Buffer.concat(parts).toString('utf8') || '{}')); } catch { no(Object.assign(new Error('bad request'), { code: 400 })); } });
});
const visionReady = async () => { try { const t = await (await fetch(agent.OLLAMA + '/api/tags')).json(); return (t.models || []).some((m) => m.name === cfg.visionModel || m.model === cfg.visionModel); } catch { return false; } };

async function route(req, res) {
  const url = new URL(req.url, 'http://x'), p = url.pathname;
  if (p === '/api/screenshot/health') return json(res, 200, { ok: true, model: cfg.visionModel, ready: await visionReady() });
  if (p === '/api/screenshot/analyze' && req.method === 'POST') {
    const b = await readJson(req, MAX_BYTES * 1.4 + 2000), m = /^data:(image\/[\w.+-]+);base64,(.+)$/s.exec(String(b.image || '')), mime = m ? m[1] : b.mime, image = m ? m[2] : String(b.image || '');
    if (!TYPES.includes(mime)) return json(res, 415, { error: 'send a PNG, JPEG or WebP screenshot' });
    if (!image || image.length * 0.75 > MAX_BYTES) return json(res, 413, { error: 'screenshot too large (6 MB max)' });
    const r = await shot.analyze({ image, mime });
    await q('insert into screenshots (case_id, member_id, sha256, mime, bytes, findings, decision, model, ms) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [b.case_id || null, b.member_id || null, r.sha256, r.mime, r.bytes, JSON.stringify(r.findings), JSON.stringify(r.decision), r.model, r.ms]);
    return json(res, 200, r);
  }
  if (p === '/api/screenshot') return json(res, 200, (await q('select id, case_id, member_id, sha256, findings, decision, model, ms, created_at from screenshots where ($1::text is null or case_id=$1) order by id desc limit 50', [url.searchParams.get('case_id')])).rows);
  return json(res, 404, { error: 'not found' });
}

(async () => {
  await ensureSchema();
  http.createServer((req, res) => route(req, res).catch((e) => { console.error('[screenshot]', e.message); json(res, Number.isInteger(e.code) ? e.code : 500, { error: e.message }); }))
    .listen(cfg.screenshotPort, async () => console.log(`[screenshot] internal :${cfg.screenshotPort}  model ${cfg.visionModel}${(await visionReady()) ? '' : ' (not pulled yet: ollama pull ' + cfg.visionModel + ')'}`));
})().catch((e) => { console.error(e); process.exit(1); });

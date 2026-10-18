const { Pool } = require('pg');
const cfg = require('./config');
const pool = new Pool({ connectionString: cfg.databaseUrl, max: 8 });
pool.on('error', (e) => console.error('pg pool error', e.message));
/** Additive migrations so an existing database keeps working when the schema grows. Safe to run every start. */
async function ensureSchema() {
  await pool.query(`alter table decisions add column if not exists detail jsonb;
                    alter table messages add column if not exists meta jsonb;`);
}
module.exports = { pool, q: (text, params) => pool.query(text, params), ensureSchema };

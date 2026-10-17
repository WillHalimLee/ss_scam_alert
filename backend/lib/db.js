const { Pool } = require('pg');
const cfg = require('./config');
const pool = new Pool({ connectionString: cfg.databaseUrl, max: 8 });
pool.on('error', (e) => console.error('pg pool error', e.message));
module.exports = { pool, q: (text, params) => pool.query(text, params) };

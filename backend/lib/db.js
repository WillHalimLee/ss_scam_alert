const { Pool } = require('pg');
const cfg = require('./config');
const pool = new Pool({ connectionString: cfg.databaseUrl, max: 12 });
const q = (text, params) => pool.query(text, params);
const SEED_TAGS = [
  ['routine_activity', 'Ordinary day-to-day activity with nothing unusual'],
  ['card_or_atm_spend', 'Card purchase, ATM withdrawal or similar everyday spending'],
  ['routine_payment', 'Bill pay, automatic payment, deposit or other ordinary money movement'],
  ['normal_login', 'A usual sign-in'],
  ['failed_login', 'A failed sign-in attempt'],
  ['password_reset', 'The password was reset'],
  ['profile_change', 'Email, phone or address on the account changed'],
  ['new_recipient', 'A new recipient was added'],
  ['payment_to_new_recipient', 'A payment to someone new to the account'],
  ['high_value_payment', 'A payment much larger than the member usually makes, or hard to reverse'],
  ['contact_before_payment', 'Contact with the bank shortly before a large payment'],
  ['escalating_pattern', 'Several signals lining up or payments growing over time'],
  ['takeover_pattern', 'Credentials reset and contact details changed close together before a payment'],
  ['pressure_context', 'Signs the member may be pressured by someone else'],
  ['explainable_activity', 'Unusual, but with a plausible innocent explanation'],
  ['intervention_or_outcome', 'A bank intervention, case or recovery event'],
];
/** Idempotent: older databases get the new columns and tables without a reset. */
async function ensureSchema() {
  await pool.query(`alter table decisions add column if not exists detail jsonb;
    alter table messages add column if not exists meta jsonb;
    create table if not exists tags (name text primary key, description text not null, created_by text not null default 'seed', uses int not null default 0, created_at timestamptz not null default now());
    alter table event_notes add column if not exists category text;
    alter table event_notes add column if not exists new_tag boolean not null default false;
    create table if not exists analyses (id serial primary key, member_id text not null, trigger_event text, trigger_reason text, context jsonb not null default '{}', verdict jsonb not null default '{}', action text not null, action_reason text, model text, latency_ms int, created_at timestamptz not null default now());
    create index if not exists analyses_member on analyses (member_id, created_at);
    create table if not exists feedback (id serial primary key, source text not null, kind text not null, score int not null, comment text, case_id text, member_id text, outcome text, mode text, agent_version text, context jsonb not null default '{}', created_at timestamptz not null default now());
    create index if not exists feedback_case on feedback (case_id);
    create table if not exists interactions (id serial primary key, kind text not null, case_id text, member_id text, story text, mode text, tone text, agent_version text, ms int, detail jsonb not null default '{}', created_at timestamptz not null default now());
    create index if not exists interactions_case on interactions (case_id, created_at);
    create table if not exists screenshots (id serial primary key, case_id text, member_id text, sha256 text not null, mime text, bytes int, findings jsonb not null default '{}', decision jsonb not null default '{}', model text, ms int, created_at timestamptz not null default now());
    create table if not exists ftc_reports (id serial primary key, case_id text, member_id text, choice text, status text not null, answers jsonb not null default '{}', draft jsonb not null default '{}', created_at timestamptz not null default now());`);
  for (const [name, description] of SEED_TAGS) await pool.query('insert into tags (name, description) values ($1,$2) on conflict (name) do nothing', [name, description]);
}
module.exports = { pool, q, ensureSchema };

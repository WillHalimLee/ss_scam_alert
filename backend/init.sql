-- Harbor pipeline schema. Synthetic data only.
-- Every event is stored (alerted or not): the retro job needs the full history, and alerted events need their context.

create table members (
  member_id  text primary key,
  first_name text                      -- only the 4 anchor personas have one; others are addressed without a name
);

-- Ground truth is for evaluation and the demo UI only. Pipeline services must never read it.
create table ground_truth (
  member_id text primary key,
  scenario text, subtype text, is_lookalike boolean, outcome text, summary text, scam_payment_ids text[]
);

create table events (
  event_id text primary key,                         -- idempotency key (at-least-once delivery)
  member_id text not null,
  ts timestamptz not null,                           -- event time, not ingest time
  category text, type text, channel text, payment_id text, rail text,
  amount numeric, direction text, recipient_id text, recipient_status text, recipient_age_days int,
  ratio numeric, vs_baseline text, velocity text, balance numeric,
  profile_change_recent boolean, password_reset_recent boolean, trusted_contact boolean,
  member_response text, payment_status text, note text,
  ingested_at timestamptz not null default now()
);
create index events_member_ts on events (member_id, ts);
create index events_type_ts on events (type, ts);

-- Rolling per-member rule state so the scorer can restart without losing context.
create table member_state (
  member_id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

create table decisions (
  event_id text primary key references events(event_id),
  member_id text not null,
  level text not null,                               -- none | confirm | hold
  rules jsonb not null default '[]',
  suppress jsonb not null default '[]',
  armed boolean not null default false,
  latency_ms int,
  decided_at timestamptz not null default now()
);

-- Alerts are written in the same transaction as the decision (outbox), then published to Kafka.
create table alerts (
  alert_id text primary key,
  member_id text not null,
  source text not null,                              -- rules | retro
  kind text not null,                                -- rule id(s) or retro detector name
  level text not null,                               -- confirm | hold | followup
  event_id text,
  payload jsonb not null,
  published boolean not null default false,
  created_at timestamptz not null default now()
);
create index alerts_unpublished on alerts (published) where not published;
create index alerts_member on alerts (member_id, created_at);

-- Advisory LLM tags and notes. They never trigger a member message on their own.
create table event_notes (
  event_id text primary key,
  member_id text not null,
  tag text not null,
  risk text not null,                                -- low | medium | high
  note text not null,
  source text not null,                              -- llm | rule
  model text,
  latency_ms int,
  disagrees boolean not null default false,          -- rules alerted but the LLM said low, or vice versa
  created_at timestamptz not null default now()
);

-- Gray zone: rules said no alert, the LLM said high risk. A human looks; the member is not messaged.
create table review_queue (
  id serial primary key,
  event_id text unique not null,
  member_id text not null,
  reason text,
  status text not null default 'open',               -- open | dismissed | actioned
  created_at timestamp not null default now()
);

create table cases (
  case_id text primary key,
  member_id text not null,
  status text not null,                              -- awaiting_member | in_conversation | resolved | escalated_human
  channel text not null,                             -- sms_pre_change_phone | app_push
  ato boolean not null default false,
  ctx jsonb not null,
  signals jsonb not null default '{}',
  handoff_note text,
  outcome text,
  opened_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  due_at timestamptz                                 -- no reply by then: escalate to a human
);
create index cases_member_open on cases (member_id) where status in ('awaiting_member','in_conversation');

create table case_alerts (
  case_id text references cases(case_id),
  alert_id text references alerts(alert_id),
  primary key (case_id, alert_id)
);

create table messages (
  id serial primary key,
  case_id text not null references cases(case_id),
  direction text not null,                           -- out | in | system
  body text not null,
  source text not null,                              -- llm | template | member | system
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

create table retro_findings (
  finding_key text primary key,                      -- dedupe: same finding is never raised twice
  member_id text not null,
  kind text not null,
  summary text not null,
  detail jsonb not null default '{}',
  alert_id text,
  created_at timestamptz not null default now()
);

-- Outcome feedback so rules can be measured, not just trusted.
create view v_rule_outcomes as
  select r->>'id' as rule, d.level, c.outcome, count(*) as n
  from decisions d
  cross join lateral jsonb_array_elements(d.rules) r
  join alerts a on a.event_id = d.event_id
  join case_alerts ca on ca.alert_id = a.alert_id
  join cases c on c.case_id = ca.case_id
  group by 1, 2, 3;

-- Tag vocabulary. The tagger reads it and may add to it; code caps its size.
create table if not exists tags (
  name text primary key,
  description text not null,
  created_by text not null default 'seed',          -- seed | llm
  uses int not null default 0,
  created_at timestamptz not null default now()
);
alter table event_notes add column if not exists category text;
alter table event_notes add column if not exists new_tag boolean not null default false;
-- Analyst agent: reads tagged history from Postgres at a trigger and decides whether a conversation is warranted.
create table if not exists analyses (
  id serial primary key,
  member_id text not null,
  trigger_event text,
  trigger_reason text,
  context jsonb not null default '{}',
  verdict jsonb not null default '{}',
  action text not null,                              -- started_conversation | recorded_only | blocked
  action_reason text,
  model text,
  latency_ms int,
  created_at timestamptz not null default now()
);
create index if not exists analyses_member on analyses (member_id, created_at);

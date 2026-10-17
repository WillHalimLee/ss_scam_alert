module.exports = {
  brokers: [process.env.KAFKA_BROKERS || 'localhost:19092'],
  databaseUrl: process.env.DATABASE_URL || 'postgres://harbor:harbor@localhost:5439/harbor',
  topics: { raw: 'events.raw', scored: 'events.scored', alerts: 'alerts.risk', out: 'notifications.out', dlq: 'events.dlq' },
  partitions: 6,                                   // member_id is the key, so one member's events stay ordered
  caseTimeoutSec: +process.env.CASE_TIMEOUT_SEC || 600,
  maxMessagesPer24h: +process.env.MAX_MSGS_24H || 3,
  agentPort: +process.env.AGENT_PORT || 8790,
};

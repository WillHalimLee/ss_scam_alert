module.exports = {
  brokers: [process.env.KAFKA_BROKERS || 'localhost:19092'],
  databaseUrl: process.env.DATABASE_URL || 'postgres://harbor:harbor@localhost:5439/harbor',
  topics: { raw: 'events.raw', scored: 'events.scored', alerts: 'alerts.risk', out: 'notifications.out', analysis: 'analysis.requests', dlq: 'events.dlq' },
  partitions: 6,                                   // member_id is the key, so one member's events stay ordered
  caseTimeoutSec: +process.env.CASE_TIMEOUT_SEC || 600,
  maxMessagesPer24h: +process.env.MAX_MSGS_24H || 3,
  gatewayPort: +process.env.PORT || +process.env.GATEWAY_PORT || 8787,   // the one public port: the app and every /api/* call
  agentPort: +process.env.AGENT_PORT || 8790,                // internal: cases, chat, demo, pipeline API (behind the gateway)
  screenshotPort: +process.env.SCREENSHOT_PORT || 8791,      // internal: screenshot analysis (behind the gateway)
  visionModel: process.env.HARBOR_VISION_MODEL || 'qwen2.5vl:7b',   // reads screenshots; local via Ollama
  screenshotTimeoutMs: +process.env.SCREENSHOT_TIMEOUT_MS || 90000,
  tagModel: process.env.HARBOR_TAG_MODEL || 'qwen2.5:3b',      // a small, fast model: it tags every event
  tagTimeoutMs: +process.env.TAG_TIMEOUT_MS || 30000,
  maxTags: +process.env.MAX_TAGS || 80,                        // the model may create tags, but the vocabulary stays bounded
  analystTimeoutMs: +process.env.ANALYST_TIMEOUT_MS || 30000,
  composeTimeoutMs: +process.env.COMPOSE_TIMEOUT_MS || 9000,
};

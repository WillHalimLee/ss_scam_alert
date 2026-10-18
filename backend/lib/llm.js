// Thin wrapper over the same provider selection the chat agent uses (ollama | anthropic | openai | mock).
const agent = require('../../harbor/agent.js');
const provider = () => agent.provider();
/** kind/label only name the call in the trace log (tag, compose, retro_insight). */
async function completeJSON(system, user, kind = 'json', label = '') {
  const p = agent.provider(); if (!p || p.name === 'mock') return null;           // mock is a keyword double for chat, not for tagging
  const meta = {}, messages = [{ role: 'user', content: user }];
  let text;
  try { text = await agent.callModel(p, system, messages, meta); }
  catch (e) { agent.trace.record({ kind, label, provider: p.name, model: p.model, latencyMs: meta.latencyMs, input: { system, messages }, error: e.message }); throw e; }
  const parsed = agent.extractJSON(text);
  agent.trace.record({ kind, label, provider: p.name, model: p.model, latencyMs: meta.latencyMs, usage: meta.usage, input: { system, messages }, output: { raw: text, parsed, final: parsed }, guardrails: [] });
  return parsed;
}
module.exports = { provider, completeJSON, agent };

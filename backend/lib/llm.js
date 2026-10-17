// Thin wrapper over the same provider selection the chat agent uses (ollama | anthropic | openai | mock).
const agent = require('../../harbor/agent.js');
const provider = () => agent.provider();
async function completeJSON(system, user) {
  const p = agent.provider(); if (!p || p.name === 'mock') return null;           // mock is a keyword double for chat, not for tagging
  const text = await agent.callModel(p, system, [{ role: 'user', content: user }]);
  return agent.extractJSON(text);
}
module.exports = { provider, completeJSON, agent };

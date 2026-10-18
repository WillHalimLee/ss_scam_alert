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

/** Tool-calling loop (Ollama native tools). The model may call the handlers any number of times up to maxSteps;
 *  a handler returning {ok:true} for a `terminal` tool ends the loop. Every step is recorded in the trace log. */
async function chatTools({ model, system, user, tools, handlers, terminal = [], maxSteps = 4, kind = 'tool', label = '', timeoutMs = 20000 }) {
  const p = agent.provider(); if (!p || p.name !== 'ollama') return { unsupported: true };
  const messages = [{ role: 'system', content: system }, { role: 'user', content: user }], steps = [], t0 = Date.now(); let result = null, usage = null, error = null;
  try {
    for (let i = 0; i < maxSteps && !result; i++) {
      const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), timeoutMs);
      let j; try {
        const r = await fetch(agent.OLLAMA + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctl.signal,
          body: JSON.stringify({ model, stream: false, keep_alive: '30m', options: { temperature: 0.2, num_predict: 200, num_ctx: agent.NUM_CTX }, tools: tools.map((t) => ({ type: 'function', function: t })), messages }) });
        j = await r.json(); if (!r.ok) throw new Error('upstream ' + r.status + ' ' + JSON.stringify(j).slice(0, 160));
      } finally { clearTimeout(to); }
      usage = { prompt_tokens: j.prompt_eval_count, output_tokens: j.eval_count, tokens_per_sec: j.eval_count && j.eval_duration ? +(j.eval_count / (j.eval_duration / 1e9)).toFixed(1) : null };
      const msg = j.message || {}; messages.push(msg);
      const calls = msg.tool_calls || [];
      if (!calls.length) { if (i < maxSteps - 1) { messages.push({ role: 'user', content: 'Answer by calling a tool now. Do not reply in plain text.' }); continue; } break; }
      for (const c of calls) {
        const name = c.function && c.function.name; let args = (c.function && c.function.arguments) || {}; if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
        const step = { name, args }; steps.push(step);
        try { step.result = handlers[name] ? await handlers[name](args) : { error: 'unknown tool ' + name }; } catch (e) { step.result = { error: e.message }; }
        messages.push({ role: 'tool', content: JSON.stringify(step.result) });
        if (terminal.includes(name) && step.result && step.result.ok) { result = step; break; }
      }
    }
  } catch (e) { error = e.message; }
  const latencyMs = Date.now() - t0;
  agent.trace.record({ kind, label, provider: 'ollama', model, latencyMs, usage, input: { system, messages: [{ role: 'user', content: user }] }, output: { raw: JSON.stringify(steps), parsed: steps, final: result && result.args }, error: error || undefined, guardrails: [] });
  if (error) throw new Error(error);
  return { result, steps, latencyMs, usage };
}
/** Structured output (Ollama): decoding is constrained to the JSON schema, so a small model always returns a valid answer. */
async function chatSchema({ model, system, user, schema, kind = 'tag', label = '', timeoutMs = 20000 }) {
  const p = agent.provider(); if (!p || p.name !== 'ollama') return null;
  const messages = [{ role: 'user', content: user }], meta = {}; let out = null, error = null;
  try { out = agent.extractJSON(await agent.callModel(Object.assign({}, p, { model, timeoutMs }), system, messages, meta, schema, { temperature: 0.1, num_predict: 160 }) || ''); }
  catch (e) { error = e.message; }
  agent.trace.record({ kind, label, provider: 'ollama', model, latencyMs: meta.latencyMs, usage: meta.usage, input: { system, messages }, output: { raw: meta.raw, parsed: out, final: out }, error: error || undefined, guardrails: [] });
  if (error) throw new Error(error);
  return out;
}
module.exports = { provider, completeJSON, chatTools, chatSchema, agent };

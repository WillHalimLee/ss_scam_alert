# Harbor prototype

Open `index.html` directly for the guided-script demo, or run the server for the live AI agent:

```
# pick ONE provider; the key stays on the server, never in the browser
ANTHROPIC_API_KEY=... node harbor/server.js        # default model claude-sonnet-5-5
OPENAI_API_KEY=...    node harbor/server.js        # default model gpt-4o-mini
HARBOR_MODEL=<id>     # optional model override
HARBOR_PROVIDER=mock  node harbor/server.js        # offline keyword test double, NOT an LLM
```
Then open http://localhost:8787 and switch "Guided script" to "Live AI" in the Member app demo controls.

- `engine.js` event-based trigger (flag the account, then check each payment), rule trace. `node harbor/test_engine.js` scores all 118 members.
- `agent.js` system prompt, provider calls, output guardrails (code adds the safety lines that matter and removes `[placeholders]`, extra questions, and pointers to buttons that are not shown). `server.js` static server + `/api/chat`; `http.js` is shared with the backend API server.
- `eval_agent.js` (`task eval`) scores the chat agent and the first messages on scripted member conversations with code checks. `--repeat N`, `--only id,id`, `--agent <file>` to compare versions.
- If the live call fails or takes over 9 seconds, the chat falls back to the guided script automatically.
- `build_data.py` regenerates `data.js` from `data/*.csv`. Synthetic data only.

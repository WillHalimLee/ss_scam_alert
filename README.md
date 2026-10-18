# Harbor: your personal security analyst

HuskyHack 2026 entry for Sound Credit Union. Harbor spots the moment a member may be scammed or compromised, talks them through it like a calm expert, and brings in a real person with full context. Synthetic data only.

**Try it:** https://willhalimlee.github.io/ss_scam_alert/ (static prototype: scripted chat, simulator, trigger chart, architecture, recorded pipeline run)

## What's here

| Path | What |
|---|---|
| `docs/` | The hosted prototype (served by GitHub Pages). A copy of `harbor/` without the dev tooling. |
| `harbor/` | Prototype source: trigger engine (`engine.js`), UI (`app.js`), chat agent and server (`agent.js`, `server.js`). |
| `backend/` | Streaming pipeline: Kafka-compatible bus, rules scorer, LLM tagger, notification agent, retro job. See `backend/ARCHITECTURE.md`. |
| `data/` | The challenge's synthetic events and member key. |
| `submission/` | `gallery/`: the 10 pitch slides as 3:2 PNGs for the Devpost gallery. `slides-16x9/`: same slides at 16:9. `gallery-screenshots/`: prototype screenshots. `SUBMISSION.md` is the write-up. |

## Run it locally

Prototype only (no install): open `harbor/index.html`.

Live AI chat (any one provider; keys stay on the server):
```
HARBOR_PROVIDER=ollama HARBOR_MODEL=qwen2.5:14b node harbor/server.js   # local, no key
ANTHROPIC_API_KEY=... node harbor/server.js                              # or OPENAI_API_KEY
```
Then open http://localhost:8787 and switch to "Live AI" in the Member app.

**Full demo (`task run`)**: one command starts Docker (Redpanda/Kafka + Postgres), the scorer and tagger workers, and the API server that also serves the app on http://localhost:8787. Picking a story in the app streams that member's account history into Kafka; **Send payment** sends the trigger event, the real rules engine decides, an alert and case are stored in Postgres, the agent writes the first message, and the Employee console shows the real case. Open the Pipeline tab for counts. The hosted GitHub Pages copy has no backend and runs the same flow locally in the browser.

Full pipeline (Docker required): see `backend/ARCHITECTURE.md`.

## Honest notes

- The trigger rules were tuned on the same synthetic data they are scored on, so results are in-sample and are not real fraud rates.
- The AI reads and writes; deterministic code decides what options appear. The model cannot release, cancel or hold a payment.
- Dev credentials in `backend/docker-compose.yml` are local-only defaults.

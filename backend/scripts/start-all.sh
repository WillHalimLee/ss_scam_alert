#!/usr/bin/env bash
# Starts scorer, tagger and agent in the background (logs in backend/.logs). Provider: ollama by default.
cd "$(dirname "$0")/.." && mkdir -p .logs
export HARBOR_PROVIDER="${HARBOR_PROVIDER:-ollama}" HARBOR_MODEL="${HARBOR_MODEL:-qwen2.5:14b}"
for s in scorer tagger agent-service; do nohup node services/$s.js > .logs/$s.log 2>&1 & echo $! > .logs/$s.pid; echo "started $s (pid $(cat .logs/$s.pid))"; done

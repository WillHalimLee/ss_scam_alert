#!/usr/bin/env bash
# Starts the services in the background (logs and pids in backend/.logs). Provider: ollama by default.
# Default: the pipeline workers, the agent (:8790) and screenshot (:8791) services, and the gateway (:8787).
cd "$(dirname "$0")/.." && mkdir -p .logs
export HARBOR_PROVIDER="${HARBOR_PROVIDER:-ollama}" HARBOR_MODEL="${HARBOR_MODEL:-qwen2.5:14b}"
for s in ${@:-scorer tagger analyst agent-service screenshot gateway}; do nohup node services/$s.js > .logs/$s.log 2>&1 & echo $! > .logs/$s.pid; echo "started $s (pid $(cat .logs/$s.pid))"; done

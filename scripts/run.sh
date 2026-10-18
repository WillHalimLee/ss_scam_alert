#!/usr/bin/env bash
# Starts the whole Harbor demo: Docker infra, scorer + tagger, then the API server that also serves the app.
# Nothing is replayed up front: choosing a story in the app streams that member's events into Kafka live.
# Ctrl+C stops everything this script started (Docker is left running; use `task down` to stop it).
#   OPEN=false                 don't open the browser
#   RESET=false                keep earlier data instead of starting clean
#   HARBOR_PROVIDER=ollama|anthropic|openai|none   force an AI provider (default: auto-detect)
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
LOGS="$ROOT/backend/.logs"; mkdir -p "$LOGS"
RESET="${RESET:-true}"
MODEL="${HARBOR_MODEL:-qwen2.5:14b}"
CHAT_PORT="${PORT:-8787}"

say() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn(){ printf '  \033[33m!\033[0m %s\n' "$*"; }
die() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*"; exit 1; }
need(){ command -v "$1" >/dev/null 2>&1 || die "'$1' not found. $2"; }

need node "Install Node.js 18 or newer."
need docker "Install Docker (Colima or Docker Desktop)."
need curl "Install curl."

BG_PIDS=()
cleanup() {
  trap - EXIT INT TERM
  say "Stopping Harbor services"
  for p in "${BG_PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null; done
  bash "$ROOT/backend/scripts/stop-all.sh" >/dev/null 2>&1
  ok "stopped. Docker (Redpanda, Postgres) is still running: 'task down' stops it."
  exit 0
}
trap cleanup EXIT INT TERM

if lsof -iTCP:"$CHAT_PORT" -sTCP:LISTEN -n -P >/dev/null 2>&1; then
  die "Port $CHAT_PORT is already in use. Run 'task stop' first, or set PORT=<other>."
fi

say "1/7 Docker"
if ! docker info >/dev/null 2>&1; then
  command -v colima >/dev/null 2>&1 || die "Docker isn't running. Start Docker Desktop and try again."
  warn "Docker isn't running; starting Colima (about a minute)"
  colima start --cpu 4 --memory 6 --disk 20 >"$LOGS/colima.log" 2>&1 || die "Colima failed to start. See $LOGS/colima.log"
fi
ok "docker is up"

say "2/7 AI provider"
PROVIDER="${HARBOR_PROVIDER:-}"
if [ -z "$PROVIDER" ]; then
  if [ -n "${ANTHROPIC_API_KEY:-}" ]; then PROVIDER=anthropic
  elif [ -n "${OPENAI_API_KEY:-}" ]; then PROVIDER=openai
  else
    if command -v ollama >/dev/null 2>&1 && ! curl -s -m 2 localhost:11434/api/tags >/dev/null 2>&1; then
      warn "starting Ollama"; nohup ollama serve >"$LOGS/ollama.log" 2>&1 & BG_PIDS+=($!); sleep 3
    fi
    if curl -s -m 2 localhost:11434/api/tags 2>/dev/null | grep -q "\"$MODEL\""; then PROVIDER=ollama
    else PROVIDER=none; warn "no AI provider found (set a key, or: ollama pull $MODEL). Using the guided script."
    fi
  fi
fi
export HARBOR_PROVIDER="$PROVIDER" HARBOR_MODEL="$MODEL"
TAG_MODEL="${HARBOR_TAG_MODEL:-qwen2.5:3b}"; export HARBOR_TAG_MODEL="$TAG_MODEL"
ok "provider: $PROVIDER${PROVIDER:+ ($MODEL)}"
if [ "$PROVIDER" = ollama ] && ! curl -s -m 2 localhost:11434/api/tags | grep -q "\"$TAG_MODEL\""; then
  warn "pulling the small tagging model $TAG_MODEL (one time, about 2 GB)"; ollama pull "$TAG_MODEL" >"$LOGS/ollama-pull.log" 2>&1 || warn "could not pull $TAG_MODEL: events will get rule tags only"
fi
if [ "$PROVIDER" = ollama ]; then   # load the model now so the first chat message isn't slow
  curl -s -m 120 localhost:11434/api/generate -d "{\"model\":\"$MODEL\",\"prompt\":\"hi\",\"stream\":false,\"keep_alive\":\"30m\"}" >/dev/null 2>&1 &
  BG_PIDS+=($!)
fi

say "3/7 Dependencies"
if [ ! -d backend/node_modules ]; then (cd backend && npm install --no-audit --no-fund >"$LOGS/npm.log" 2>&1) || die "npm install failed. See $LOGS/npm.log"; fi
ok "backend packages ready"

say "4/7 Kafka and Postgres"
bash backend/scripts/stop-all.sh >/dev/null 2>&1
(cd backend && docker compose up -d --wait >"$LOGS/compose.log" 2>&1) || die "docker compose failed. See $LOGS/compose.log"
ok "Redpanda :19092 and Postgres :5439 are healthy"

say "5/7 Data"
if [ "$RESET" = true ]; then (cd backend && node scripts/reset.js 2>&1 | grep -E "^reset|rror" ); else ok "keeping earlier data (RESET=false)"; fi
(cd backend && node scripts/seed.js 2>&1 | grep -v -E "Timeout|trace-warnings")

say "6/7 Pipeline workers"
(cd backend && CASE_TIMEOUT_SEC="${CASE_TIMEOUT_SEC:-600}" ./scripts/start-all.sh scorer tagger analyst) | sed 's/^/  /'
ok "scorer, tagger and analyst are running"

say "7/7 API server and app"
URL="http://localhost:$CHAT_PORT"
printf '\n  \033[1mHarbor is running\033[0m\n    App + API:       %s   (pick a story, then Send payment: events stream through Kafka live)\n    Model inspector: %s/inspector.html  (what the model sees and says)\n    Logs:            backend/.logs/\n    Stop:            Ctrl+C\n\n' "$URL" "$URL"
[ "${OPEN:-true}" = true ] && ( sleep 3; command -v open >/dev/null 2>&1 && open "$URL" ) & BG_PIDS+=($!)
cd backend && AGENT_PORT="$CHAT_PORT" CASE_TIMEOUT_SEC="${CASE_TIMEOUT_SEC:-600}" node services/agent-service.js

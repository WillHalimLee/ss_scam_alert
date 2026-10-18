#!/usr/bin/env bash
# Starts the whole Harbor demo: Docker infra, backend services, demo events, retro job, chat server, browser.
# Ctrl+C stops everything this script started (Docker is left running; use `task down` to stop it).
#   DEMO_MEMBERS=M1003,M1001   members to replay (default below)
#   OPEN=false                 don't open the browser
#   RESET=false                keep earlier data instead of starting clean
#   HARBOR_PROVIDER=ollama|anthropic|openai|none   force an AI provider (default: auto-detect)
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
LOGS="$ROOT/backend/.logs"; mkdir -p "$LOGS"
MEMBERS="${DEMO_MEMBERS:-M1003,M1001,M1039,M1057,M1002,M1004,M1010,M1018}"
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
ok "provider: $PROVIDER${PROVIDER:+ ($MODEL)}"
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

say "6/7 Backend services"
(cd backend && CASE_TIMEOUT_SEC="${CASE_TIMEOUT_SEC:-600}" ./scripts/start-all.sh) | sed 's/^/  /'
for i in $(seq 1 40); do curl -s -m 2 localhost:8790/api/pipeline >/dev/null 2>&1 && break; sleep 1; done
curl -s -m 2 localhost:8790/api/pipeline >/dev/null 2>&1 && ok "agent API on :8790" || warn "agent API not answering yet (see backend/.logs/agent-service.log)"
(cd backend && node services/replayer.js --members "$MEMBERS" --rate 60 2>&1 | grep -E "done|rror")
# Retro job: runs once shortly after the replay. "Now" is set to Oct 5 so it can see the slow-ramp pattern.
( sleep 35; cd backend && node services/retro.js --once --as-of 2026-10-05T00:00:00Z >>"$LOGS/retro.log" 2>&1 ) & BG_PIDS+=($!)

say "7/7 Chat server"
URL="http://localhost:$CHAT_PORT"
printf '\n  \033[1mHarbor is running\033[0m\n    App:            %s\n    Pipeline tab:   live (events and cases appear over the next ~30 s)\n    Model inspector: %s/inspector.html  (what the model sees and says)\n    Logs:           backend/.logs/\n    Stop:           Ctrl+C\n\n' "$URL" "$URL"
[ "${OPEN:-true}" = true ] && ( sleep 2; command -v open >/dev/null 2>&1 && open "$URL" ) & BG_PIDS+=($!)
PORT="$CHAT_PORT" node harbor/server.js

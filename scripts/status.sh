#!/usr/bin/env bash
# What is running right now.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
up()   { printf '  \033[32m● up\033[0m    %s\n' "$1"; }
down() { printf '  \033[31m○ down\033[0m  %s\n' "$1"; }
port() { lsof -iTCP:"$1" -sTCP:LISTEN -n -P >/dev/null 2>&1; }
echo "Harbor status"
port 8787 && up "gateway + app      http://localhost:8787 ($(curl -s -m 2 localhost:8787/api/gateway/health 2>/dev/null))" || down "gateway + app      :8787"
port 8790 && up "agent service      :8790 (internal)" || down "agent service      :8790"
port 8791 && up "screenshot service :8791 (internal, $(curl -s -m 2 localhost:8791/api/screenshot/health 2>/dev/null | grep -q '"ready":true' && echo 'vision model ready' || echo 'vision model not pulled'))" || down "screenshot service :8791"
for s in scorer tagger analyst; do
  f="$ROOT/backend/.logs/$s.pid"; { [ -f "$f" ] && kill -0 "$(cat "$f")" 2>/dev/null; } && up "$s" || down "$s"
done
docker info >/dev/null 2>&1 && { docker ps --format '{{.Names}}' | grep -q harbor-redpanda && up "redpanda (Kafka)    :19092" || down "redpanda (Kafka)    :19092"
  docker ps --format '{{.Names}}' | grep -q harbor-postgres && up "postgres            :5439" || down "postgres            :5439"; } || down "docker (not running)"
curl -s -m 2 localhost:11434/api/tags >/dev/null 2>&1 && up "ollama             :11434" || down "ollama             :11434"

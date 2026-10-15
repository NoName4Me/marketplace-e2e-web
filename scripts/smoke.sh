#!/usr/bin/env bash
set -euo pipefail

base="${1:-http://127.0.0.1:8080}"
expected_sha="${2:-}"
health=$(curl -fsS "$base/healthz")
echo "$health" | jq -e '.status == "ok"' >/dev/null
curl -fsS "$base/readyz" | jq -e '.status == "ready"' >/dev/null
version=$(curl -fsS "$base/version")
echo "$version" | jq -e '.service == "marketplace-e2e-web" and .version == "1.0.0"' >/dev/null
if [[ -n "$expected_sha" ]]; then
  echo "$version" | jq -e --arg sha "$expected_sha" '.commit == $sha' >/dev/null
fi
curl -fsS "$base/metrics" | grep -q 'marketplace_e2e_release_info'
curl -fsS "$base/" | grep -q '任务看板'

created=$(curl -fsS -X POST -H 'Content-Type: application/json' \
  -d '{"title":"CI smoke task"}' "$base/api/tasks")
id=$(echo "$created" | jq -r '.task.id')
[[ "$id" =~ ^[0-9a-f-]{36}$ ]]
curl -fsS -X PATCH -H 'Content-Type: application/json' \
  -d '{"completed":true}' "$base/api/tasks/$id" | jq -e '.task.completed == true' >/dev/null
curl -fsS -X DELETE "$base/api/tasks/$id" | jq -e '.deleted == true' >/dev/null
echo "PASS: UI, health, readiness, release SHA, metrics, task create/update/delete"

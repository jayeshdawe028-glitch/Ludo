#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  echo "ERROR: .env is missing. Copy .env.example to .env and fill the required credentials."
  exit 1
fi

# Keep the host Caddy service untouched; Compose only manages Aarohi.
git pull --ff-only
docker compose up -d --build --remove-orphans
docker compose ps

if curl -fsS http://127.0.0.1:3000/health >/dev/null; then
  echo "Aarohi health check: OK"
else
  echo "Aarohi health check: FAILED"
  docker compose logs --tail=80 aarohi || true
  exit 1
fi

echo "Aarohi deployment complete."

#!/bin/sh
set -e

echo "[start] Running database migrations..."
npx prisma migrate deploy

if [ "$SERVICE" = "worker" ]; then
  echo "[start] Starting worker process..."
  exec node dist/worker.js
else
  echo "[start] Starting API server..."
  exec node dist/main.js
fi

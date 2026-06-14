#!/bin/sh
set -e

echo "[startup] Running Prisma migrations..."
node node_modules/prisma/build/index.js migrate deploy

echo "[startup] Starting Next.js server..."
exec node server.js

#!/usr/bin/env bash
set -e
echo "شروع Legal Platform — سیستم حقوقی برای وکلای ایرانی / Starting Legal Platform — سیستم حقوقی برای وکلای ایرانی..."
if [ -f docker-compose.yml ]; then
  docker compose up -d
  docker compose ps
  echo "✓ اجرا شد / Started - http://localhost:8080"
else
  echo "برای CLI: ./project-robots --help یا source .venv/bin/activate && python -m app.main"
  if [ -f package.json ]; then npm run dev; fi
fi

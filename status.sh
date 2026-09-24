#!/usr/bin/env bash
echo "وضعیت Legal Platform — سیستم حقوقی برای وکلای ایرانی / Status Legal Platform — سیستم حقوقی برای وکلای ایرانی"
echo "========================================"
if [ -f docker-compose.yml ]; then
  docker compose ps
  echo ""
  echo "Health: http://localhost:8080/api/health یا http://localhost:3001/api/health"
  if command -v curl &> /dev/null; then
    echo "Checking health..."
    curl -sf http://localhost:8080/api/health یا http://localhost:3001/api/health 2>&1 | head -n 10 || echo "Health endpoint not responding yet"
    curl -sf http://localhost:3000 2>&1 | head -n 2 || true
    curl -sf http://localhost:8000/api/health 2>&1 | head -n 5 || true
  fi
else
  echo "CLI tool - checking processes"
  ps aux | grep -E "project-robots|python|node" | grep -v grep | head -n 10
  echo "برای تست: pytest -q"
fi
echo ""
echo "URL: http://localhost:8080"
echo "Logs: ./logs.sh"

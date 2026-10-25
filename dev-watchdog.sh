#!/bin/bash
cd /home/z/my-project
while true; do
  if ! curl -s -o /dev/null --max-time 4 http://127.0.0.1:3000/api/health; then
    echo "[$(date '+%H:%M:%S')] watchdog: start dev" >> dev-watchdog.log
    bun run dev >> dev.log 2>&1 || echo "[$(date '+%H:%M:%S')] watchdog: dev exit $?" >> dev-watchdog.log
  fi
  sleep 5
done

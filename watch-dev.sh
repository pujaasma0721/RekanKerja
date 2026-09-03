#!/bin/bash
cd /home/z/my-project
while true; do
  NODE_OPTIONS="--max-old-space-size=1536" bun run dev >> dev.log 2>&1
  echo "[watchdog] server exited, restarting in 3s ($(date +%H:%M:%S))" >> dev.log
  sleep 3
done

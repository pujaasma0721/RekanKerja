#!/usr/bin/env bash
# watch-dev.sh — watchdog dev server RekanKerja (sandbox)
# Menjaga `bun run dev` tetap hidup: start bila mati, log ke dev.log (root project).
cd /home/z/my-project || exit 1
while true; do
  if ! curl -s -o /dev/null --max-time 3 http://localhost:3000/api/health; then
    echo "[watch $(date +%H:%M:%S)] dev server mati — restart…" >> /home/z/my-project/dev.log
    ( cd /home/z/my-project && bun run dev >> /home/z/my-project/dev.log 2>&1 ) &
    wait $!
  fi
  sleep 15
done

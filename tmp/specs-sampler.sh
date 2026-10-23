#!/bin/bash
# Sampler CPU/RAM dgn parsing /proc/PID/stat YANG BENAR (comm bisa berisi spasi).
OUT=/tmp/specs-samples.csv
NPID=$(pgrep -f "next-server" | head -1)
echo "ts,next_rss_kb,next_ticks,pg_rss_kb,pg_ticks,load1,memavail_kb" > $OUT
ticks() { # $1=pid → utime+stime (field 14,15 SETELAH ')')
  awk '{ i=index($0,")"); if(i>0){ n=split(substr($0,i+1),a," "); print a[12]+a[13] } else print 0 }' /proc/$1/stat 2>/dev/null || echo 0
}
while true; do
  ts=$(date +%s)
  if [ -d /proc/$NPID ]; then
    nr=$(awk '/VmRSS/{print $2}' /proc/$NPID/status)
    nt=$(ticks $NPID)
  else nr=0; nt=0; fi
  pr=0; pt=0
  for p in $(pgrep -x postgres); do
    r=$(awk '/VmRSS/{print $2}' /proc/$p/status 2>/dev/null); pr=$((pr + ${r:-0}))
    pt=$((pt + $(ticks $p)))
  done
  l1=$(awk '{print $1}' /proc/loadavg)
  ma=$(awk '/MemAvailable/{print $2}' /proc/meminfo)
  echo "$ts,$nr,$nt,$pr,$pt,$l1,$ma" >> $OUT
  sleep 2
done

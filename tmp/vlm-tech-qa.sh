#!/bin/bash
# QA visual deck teknis — 14 slide via VLM
declare -A Q
for i in $(seq -w 1 14); do
  PROMPT="Ini slide presentasi teknis berbahasa Indonesia. Periksa dan jawab singkat: (1) apakah ada teks terpotong/tumpang tindih/keluar kanvas? (2) apakah ada area kosong janggal atau layout rusak? (3) nilai kesan profesional 1-10. Format: POTONG:ya/tidak | RUSAK:ya/tidak | SKOR:x — satu kalimat alasan."
  RES=$(z-ai vision -p "$PROMPT" -i "tmp/teckdeck-check/s-$i.png" 2>/dev/null | grep -o '"content": "[^"]*"' | head -1 | cut -c13-)
  echo "SLIDE $i: $RES"
done

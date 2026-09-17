#!/usr/bin/env bash
# ============================================================================
# OneVity — Deploy otomatis ke production .15
# ============================================================================
# Alur: preflight → clone fresh → npm ci → db:generate → build → cutover PM2
#       → healthcheck → (gagal? rollback otomatis) → bereskan rollback lama.
#
# Pemakaian (dari .15, user puja):
#   ~/deploy.sh                          # deploy branch main
#   ONEVITY_BRANCH=dev ~/deploy.sh       # deploy branch lain
#
# Konfigurasi lewat env (opsional):
#   ONEVITY_REPO_URL   URL git (default: baca dari ~/.onevity-deploy.conf,
#                      baris "REPO_URL=..." — file 600, TIDAK di-commit)
#   ONEVITY_APP_DIR    folder app aktif   (default /home/puja/onevity)
#   ONEVITY_BUILD_ROOT induk folder build (default /home/puja)
#   ONEVITY_BRANCH     branch             (default main)
#   PM2_APP            nama proses pm2    (default onevity)
#   HEALTH_URL         URL healthcheck    (default https://onevity.sayone.my.id/)
#
# Log: /home/puja/onevity-deploy.log
# ============================================================================
set -euo pipefail

APP_DIR="${ONEVITY_APP_DIR:-/home/puja/onevity}"
BUILD_ROOT="${ONEVITY_BUILD_ROOT:-/home/puja}"
PM2_APP="${PM2_APP:-onevity}"
HEALTH_URL="${HEALTH_URL:-https://onevity.sayone.my.id/}"
BRANCH="${ONEVITY_BRANCH:-main}"
CONF_FILE="${ONEVITY_DEPLOY_CONF:-$BUILD_ROOT/.onevity-deploy.conf}"
KEEP_ROLLBACKS=3
LOG_FILE="$BUILD_ROOT/onevity-deploy.log"

exec > >(tee -a "$LOG_FILE") 2>&1
log()  { echo "[$(date '+%F %T')] $*"; }
die()  { log "❌ $*"; exit 1; }

# ---------- lock anti-deploy-bersamaan ----------
LOCK_DIR="/tmp/onevity-deploy.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  die "Deploy lain sedang berjalan (lock: $LOCK_DIR). Hapus folder lock bila yakin tidak ada."
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

# ---------- repo URL (token TIDAK pernah di-commit ke repo) ----------
repo_url_of() {
  if [[ -n "${ONEVITY_REPO_URL:-}" ]]; then echo "$ONEVITY_REPO_URL"; return; fi
  if [[ -f "$CONF_FILE" ]]; then
    local u
    u=$(grep -E '^REPO_URL=' "$CONF_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true)
    [[ -z "$u" ]] && u=$(head -1 "$CONF_FILE" 2>/dev/null || true)
    [[ -n "$u" ]] && { echo "$u"; return; }
  fi
  if git -C "$APP_DIR" remote get-url origin >/dev/null 2>&1; then
    git -C "$APP_DIR" remote get-url origin; return
  fi
  echo ""
}

# ---------- 0. preflight ----------
log "== OneVity deploy — preflight =="
[[ "$(id -u)" -eq 0 ]] && die "Jalankan sebagai user puja (bukan root)."
command -v git  >/dev/null || die "git tidak ditemukan"
command -v npm  >/dev/null || die "npm tidak ditemukan"
command -v pm2  >/dev/null || die "pm2 tidak ditemukan"
command -v curl >/dev/null || die "curl tidak ditemukan"
pm2 describe "$PM2_APP" >/dev/null 2>&1 || die "Proses pm2 '$PM2_APP' tidak ada"
[[ -d "$APP_DIR" ]] || die "Folder app aktif tidak ada: $APP_DIR"
[[ -f "$APP_DIR/.env.local" ]] || die ".env.local tidak ada di $APP_DIR"
REPO_URL=$(repo_url_of)
[[ -z "$REPO_URL" ]] && die "Repo URL tidak ditemukan. Isi $CONF_FILE dengan 'REPO_URL=...' atau set ONEVITY_REPO_URL."
cd "$BUILD_ROOT"   # cwd harus di luar APP_DIR — folder akan di-rename saat cutover
log "repo=${REPO_URL%%@*@}***@… branch=$BRANCH app=$APP_DIR pm2=$PM2_APP"

TS=$(date +%Y%m%d-%H%M%S)
BUILD_DIR="$BUILD_ROOT/onevity-build-$TS"
ROLLBACK_DIR="$BUILD_ROOT/onevity-rollback-$TS"

rollback_now() { # dipakai saat gagal SETELAH folder aktif diswap
  log "↩️  ROLLBACK otomatis…"
  pm2 stop "$PM2_APP" >/dev/null 2>&1 || true
  [[ -d "$APP_DIR" ]] && mv "$APP_DIR" "$BUILD_ROOT/onevity-failed-$TS"
  mv "$ROLLBACK_DIR" "$APP_DIR"
  pm2 restart "$PM2_APP" --update-env >/dev/null
  sleep 5
  curl -sk -o /dev/null -w "rollback health=%{http_code}\n" "$HEALTH_URL" || true
  die "Rollback selesai. Versi gagal tersimpan: onevity-failed-$TS (cek $LOG_FILE)"
}

# ---------- 1. clone fresh ----------
log "1/6 Clone $BRANCH → $BUILD_DIR"
rm -rf "$BUILD_DIR"
git clone --depth 1 -b "$BRANCH" "$REPO_URL" "$BUILD_DIR" || die "git clone gagal"
NEW_COMMIT=$(git -C "$BUILD_DIR" log --oneline -1)
log "   commit: $NEW_COMMIT"

# ---------- 2. dependensi ----------
log "2/6 npm ci (lockfile $( [[ -f "$BUILD_DIR/package-lock.json" ]] && echo ada || echo HILANG ))"
[[ -f "$BUILD_DIR/package-lock.json" ]] || die "package-lock.json tidak ada di repo — jalankan npm install --package-lock-only dulu."
cp "$APP_DIR"/.env* "$BUILD_DIR"/ 2>/dev/null || true
[[ -f "$BUILD_DIR/.env.local" ]] || die ".env.local gagal disalin ke folder build"
( cd "$BUILD_DIR" && npm ci --no-audit --no-fund ) || die "npm ci gagal"

# ---------- 3. prisma client ----------
log "3/6 prisma generate"
( cd "$BUILD_DIR" && npm run db:generate ) || die "db:generate gagal"

# ---------- 4. build ----------
log "4/6 next build (bisa beberapa menit)"
( cd "$BUILD_DIR" && npm run build ) || die "build gagal"
[[ -f "$BUILD_DIR/.next/standalone/server.js" ]] || die "Output build tidak lengkap (standalone/server.js tidak ada)"

# ---------- 5. cutover ----------
log "5/6 Cutover: $APP_DIR → $ROLLBACK_DIR, build → $APP_DIR"
mv "$APP_DIR" "$ROLLBACK_DIR" || die "Gagal me-rename folder aktif"
if ! mv "$BUILD_DIR" "$APP_DIR"; then
  mv "$ROLLBACK_DIR" "$APP_DIR"
  die "Gagal memindahkan folder build — folder lama dipulihkan"
fi
pm2 restart "$PM2_APP" --update-env >/dev/null || rollback_now

# ---------- 6. healthcheck ----------
log "6/6 Healthcheck $HEALTH_URL (maks 12×5s)"
HEALTH_OK=0
for i in $(seq 1 12); do
  CODE=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 10 "$HEALTH_URL" 2>/dev/null || echo 000)
  if [[ "$CODE" == "200" ]]; then HEALTH_OK=1; log "   attempt $i: HTTP $CODE ✓"; break; fi
  log "   attempt $i: HTTP $CODE — tunggu 5s"
  sleep 5
done
[[ "$HEALTH_OK" -eq 1 ]] || rollback_now

# ---------- bereskan rollback/failed lama ----------
# catatan: glob tanpa match membuat ls exit 2 — amankan dengan || true agar
# pipefail tidak membunuh skrip di ujung alur (bug exit=2 saat deploy pertama).
log "Pembersihan: menyisakan $KEEP_ROLLBACKS rollback terbaru"
ls -1dt "$BUILD_ROOT"/onevity-rollback-* 2>/dev/null | tail -n +$((KEEP_ROLLBACKS + 1)) | while read -r d; do
  log "   hapus $(basename "$d")"; rm -rf "$d"
done || true
ls -1dt "$BUILD_ROOT"/onevity-failed-* 2>/dev/null | tail -n +3 | while read -r d; do
  log "   hapus $(basename "$d")"; rm -rf "$d"
done || true

log "✅ Deploy sukses — $NEW_COMMIT aktif di $APP_DIR (rollback tersimpan: $(basename "$ROLLBACK_DIR"))"

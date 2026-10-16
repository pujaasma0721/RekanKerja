# RekanKerja — HR Suite (multi-tenant SaaS)

Aplikasi HR lengkap: HRIS inti, payroll (1721-A1 + PMK 168/2023), presensi, cuti,
perjalanan dinas, medis, whistleblowing, rekrutmen (F0–F9), kinerja (P0–P9), dan
backlog ekstensi (B1–B8: OKR kuartalan, AI ringkasan+deteksi bias, attrisi & talent,
succession, benchmark gaji, WA+meeting, portal pelamar magic-link, referral).

- **Stack**: Next.js 16 (App Router) · TypeScript · Prisma (PostgreSQL embedded,
  schema-per-tenant) · Tailwind + shadcn/ui · dwibahasa EN/ID.
- **Menjalankan dev**: `bun run dev` (port 3000; log `dev.log`). Watchdog:
  `setsid -f bash scripts/watch-dev.sh`.
- **Database**: `bun run db:push` (platform schema) → `bun scripts/restore-demo.ts`
  (3 tenant demo: MII penuh + Cahaya + Sentra). Akun demo:
  `hrd@mii.co.id/onevity123` (owner) · `yusuf@mii.co.id/EssDemo123!` (ESS).
- **Dokumen rencana**: `DEVELOPMENT-PLAN-*.md` · riwayat lengkap: `worklog.md`.

## Uji E2E (agregator)

Menjalankan seluruh suite E2E stabil secara berurutan dengan ringkasan per-suite
dan per-grup. Setiap suite self-cleaning (residu data uji dibersihkan di akhir
skripnya sendiri) dan menarget fixture demo di `localhost:3000`.

```bash
bun run test:e2e                 # semua suite stabil (urut), ringkasan akhir
bun run test:e2e -- --list       # daftar suite (+ yang dikurasi keluar & alasannya)
bun run test:e2e -- b1 b5 referral # subset — cocok kata-kunci di nama file
bun run test:e2e -- --reset      # reset fixture dulu, lalu semua suite
bun run test:e2e -- --reset b8   # reset fixture dulu, lalu subset
```

**Prasyarat**: dev server hidup di `:3000` + PostgreSQL embedded `:5432`
(mini-services). Bila dev server mati, agregator berhenti lebih dulu (exit 2).

**Apa itu `--reset`?** Membangun ulang fixture demo secara deterministik tanpa
mematikan dev server — urutan: `restore-demo` → `migrate-password-security` →
`seed-ess-demo-user` → master rekrutmen `migrate-recruitment-f0` → demo
rekrutmen (F1–F3) → kinerja (P0→P1→seed P6/P7/P8→P9)
→ backlog (B1→B2→B4→B5→B6→B7→B8; B3 stateless tanpa migrasi). Semua langkah
idempoten — aman dijalankan berulang.

**Suite stabil vs dikurasi keluar**: suite yang menarget lingkungan lain —
era-Task SayOne (BASE argv default URL PROD + kredensial deployment, bukan akun
demo MII), PROD URL, browser eksternal, atau DNS subdomain — dicatat di `--list`
beserta alasannya dan tidak dijalankan agregator (mereka adalah bukti riwayat
verifikasi deployment). Menambah suite baru: tambahkan entri di
`scripts/test-e2e-all.ts` (array `SUITES`, urut grup) — pastikan skripnya
self-cleaning, menarget `localhost:3000` dengan akun demo, dan lolos berulang
sebelum masuk daftar stabil.

**Diagnosis kegagalan**: agregator mencetak 6 baris output terakhir tiap suite
yang gagal + durasi per-suite; jalankan langsung `bun scripts/e2e-<nama>.ts`
untuk output penuh.

**Batas memori (host kecil / sandbox 4GB tanpa swap)**: dev server Next 16
(turbopack, mode dev) mengakumulasi heap seiring meng-compile rute yang
disentuh suite — pada mesin 4GB ia kehabisan memori sekitar suite ke-9–12
(GC-death-spiral atau OOM-kill kernel; watchdog `scripts/watch-dev.sh`
memulihkannya otomatis ≤15 dtk). Suite yang menabrak jendela pemulihan gagal
`ConnectionRefused` BUKAN karena bug — jalankan ulang subsetnya (semua suite
stabil bersifat re-runnable/self-cleaning), atau pecah verifikasi per-grup:
`bun run test:e2e -- medical`, lalu `-- p7 p8 p9`, lalu `-- b1 b2 b3 b4 b5 b6
b7 b8`. (Terverifikasi BF: rebuild penuh dari nol — 17/17 LULUS dalam 2 tahap.)

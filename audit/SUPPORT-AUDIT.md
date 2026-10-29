# AUDIT — Sistem Support Service (Online Support, FEAT-SUPPORT-P1…P4.8)

**Tanggal:** 30 Okt 2026 · **Cakupan:** seluruh modul Online Support (backend, frontend, mini-service, DB, tata kelola AI)
**Metode:** pembacaan menyeluruh kode (static) + verifikasi live end-to-end (browser nyata, DB psql, log server) + remediasi temuan.

---

## 1. Ringkasan Eksekutif

| Aspek | Status |
|---|---|
| Isolasi multi-tenant (schema-per-tenant) | ✅ KUKUH — semua akses via client tenant; tidak ada jalur lintas-schema |
| Otorisasi endpoint (owner / op `support:service/manage`) | ✅ KUKUH — 7/7 endpoint terguard |
| Keamanan tools AI (read-only, denylist, redaksi, kurungan origin) | ✅ KUKUH — berlapis, audit-tested |
| Tata kelola AI P2–P4.8 (sakelar, approval manusia, verifikasi-dulu, model SaaS) | ✅ TERPASANG & TERBUKTI LIVE |
| Keandalan konkurensi (race double-answer, rate-limit, memory) | ⚠️ 6 TEMUAN → **SEMUA DIPERBAIKI di commit ini** |
| UI/UX & aksesibilitas | ✅ BAIK (dwibahasa, mobile, markdown rapat, paste/drag-drop, polling tanpa sentakan) |

**Kesimpulan:** sistem secara desain sehat; audit menemukan 6 celah hardening (tidak kritis, mayoritas konkurensi/DoS-biaya) — semuanya diperbaiki + diverifikasi ulang live dalam commit audit ini. Sisa risiko yang diterima (residual) didokumentasikan di §6.

---

## 2. Peta Komponen yang Diaudit

```
src/rekankerja/support/
├── services/
│   ├── support-agent.ts    — loop ReAct (14 LLM / 12 tool / 210s), guard P4.7/P4.8,
│   │                          scope hak akses penanya, triase [[META]], VLM lampiran
│   ├── support-tools.ts    — search_code / read_file / query_db / read_logs (read-only)
│   ├── support-browser.ts  — reproduce_browser / analyze_screenshot + kolektor bukti
│   └── support-patch.ts    — propose_patch + decidePatchProposal (approval manusia)
├── api/
│   ├── support-auth.ts     — resolusi aktor + ticketAccess (owner|manage)
│   ├── tickets.ts          — GET daftar / POST buat (SP-YYYY-NNN, rate-limit 5/30m)
│   ├── ticket-id.ts        — GET detail / PATCH status (transisi tervalidasi + audit)
│   ├── ticket-messages.ts  — GET riwayat / POST pesan multipart (0–5 lampiran)
│   ├── ticket-agent.ts     — POST picu giliran AI (cek last=USER, 409/502)
│   ├── ticket-patches.ts   — GET usulan / POST keputusan (op manage saja)
│   ├── attachment-id.ts    — GET stream lampiran (guard tiket, bukan generic)
│   └── agent-config.ts     — GET/PUT konfigurasi agen (guard settings:ai-provider)
├── components/support-module.tsx — UI penuh (daftar tiket, chat, patch card, dsb.)
mini-services/browser-runner/index.ts — headless browser :3020 (kurungan origin)
prisma/schema-tenant.prisma — SupportTicket / SupportMessage / SupportPatchProposal /
                              SupportAgentConfig (sakelar + kredensial akun uji terenkripsi)
```

---

## 3. Verifikasi Keamanan (HASIL ✅)

1. **Isolasi tenant** — semua query memakai `TenantDb` client schema aktif; `SupportAgentConfig.browserLoginPassEnc` terenkripsi field-crypto per-tenant; kredensial TIDAK PERNAH masuk konteks LLM (login browser menyemai cookie lewat runner).
2. **Otorisasi** — chat: sesi valid + profil AppUser; lintas-tiket: wajib op `support:service/manage` (super admin / mode ALL lolos `requireMenuAction`); keputusan patch: pelapor TIDAK boleh menyetujui usulan tiketnya sendiri (separation of duties).
3. **query_db** — satu pernyataan SELECT/WITH; token DML/DDL/session/komentar/multi-statement ditolak; dibungkus subquery `LIMIT 200`; `statement_timeout` 8s dalam transaksi; denylist 30+ tabel rahasia (kredensial/privasi/medis); redaksi kolom uang & kredensial `[DISENSOR]`; auto-kutip nama tabel PascalCase.
4. **search_code / read_file** — path relatif saja, tanpa `..`/dotfile/segmen terlarang (node_modules, db, audit, generated…); ekstensi whitelist teks; jendela 250 baris; batas ukuran file.
5. **read_logs** — hanya ekor log aplikasi; scrub Bearer/enc/api-key/hash panjang.
6. **reproduce_browser (runner)** — kurungan origin (`context.route` abort lintas-origin); path goto relatif tanpa `..`/protokol; download dibatalkan; dialog ditolak; budget 2 sesi/24 aksi/3 tangkapan/TTL 3 menit + reaper; runner bind 127.0.0.1 (server-ke-server saja).
7. **propose_patch** — TIDAK menulis file; server baca isi file sendiri; cuplikan wajib unik; unified diff + sha256 basis; approve → re-verifikasi hash (KONFLIK bila berubah) → tulis atomik (temp+rename) → ActivityLog + pesan SYSTEM.
8. **Anti-konfabulasi & anti-klaim-palsu** — guard runtime: "hasil pemeriksaan" tanpa [HASIL TOOL] → tolak; "sudah diterapkan" tanpa catatan DISETUJUI → tolak.
9. **P4.7 VERIFIKASI DULU** — laporan error (pola `ERROR_REPORT_RE`) + tools aktif + belum ada tool → nudge 1× untuk mereproduksi/memeriksa dulu. **TERBUKTI LIVE** di SP-2026-004 (log ×2 · db ×1 · browser ×1 pada giliran pertama; ×6 saat diminta eksplisit).
10. **P4.8 MODEL SAAS** — blok prompt "SIAPA MENGURUS APA" + guard `REDIRECT_IT_RE` (nudge 1× bila menjawab "hubungi tim IT/admin tenant" utk masalah infrastruktur). **TERBUKTI LIVE**: jawaban SP-2026-004 berkata "gangguan infrastruktur database di sisi platform RekanKerja… akan ditindaklanjuti tim platform" — arahan benar, tanpa redirect sia-sia.
11. **XSS** — balasan AI dirender react-markdown (raw HTML tidak dirender); nama file lampiran tampil sebagai teks; URL lampiran memakai id internal.
12. **Attachment** — whitelist MIME + magic number + 5 MB + 5 file; stream diguard kepemilikan tiket; `Cache-Control: no-store` + `nosniff`.

---

## 4. Temuan & Remediasi (DIPERBAIKI di commit ini)

| # | Temuan | Dampak | Perbaikan |
|---|--------|--------|-----------|
| A-1 | **POST /messages tanpa rate-limit** — tiap pesan memicu giliran AI (biaya LLM); spam membakar kuota | DoS-biaya | `hitRateLimit` 30 pesan / 10 menit per sesi (pola tickets.ts) → 429 + `Retry-After` |
| A-2 | **POST /agent tanpa rate-limit** — satu giliran ≤ 14 panggilan LLM + aksi browser | DoS-biaya | `hitRateLimit` 20 giliran / 10 menit per sesi → 429 |
| A-3 | **Race jawaban ganda** — dua POST /agent paralel sama-sama lolos cek "pesan terakhir USER" sebelum salah satu menulis → 2 balasan AI untuk 1 pesan | Integritas data / biaya | Lock `turnsInFlight` per ticket di `agentRespond` + error khusus `AgentTurnInProgressError` → route 409. **Diuji live: A=201, B=409, DB=1 balasan** |
| A-4 | **shotCollector bocor di memori** — giliran gagal (502) setelah tangkapan layar terkumpul → bukti menetap di Map sampai giliran tiket itu berikutnya (mungkin tak pernah datang) | Memory leak | Seluruh badan giliran dibungkus try/catch → gagal = `clearShotCollector` + rethrow |
| A-5 | **Riwayat dimuat TANPA batas** — `findMany` seluruh pesan tiket (ribuan) hanya untuk dipangkas ke 16 terakhir | Memori/latensi utas panjang | `take: 80` (desc) + reverse — cukup utk konteks LLM + analisa lampiran sejak balasan AI terakhir |
| A-6 | **Race nomor tiket** — dua POST /tickets paralel menghitung `max+1` sama → pelanggaran UNIQUE `ticketNo` → 500 | UX | Retry 3× (hitung ulang + simpan) saat konflik unik |

Semua perbaikan lolos `eslint` 0 error dan `tsc --noEmit` 0 error, dan diverifikasi live:
- SP-2026-005 dibuat via API → pesan tersimpan → **dua POST /agent paralel** → `A: 201 (AI menjawab)` + `B: 409` → DB: tepat **1 sambutan + 1 pesan user + 1 balasan AI**.

---

## 5. Verifikasi Live (bukti)

| Uji | Hasil |
|---|---|
| Login `hrd@mii.co.id` → `?m=support` | ✅ modul terbuka, 4 tiket + badge status/prioritas/kategori |
| Buka SP-2026-004 (kasus prisma FATAL) | ✅ pill "🔎 Pemeriksaan internal: log server ×2 · basis data ×1 · reproduksi browser ×1", bukti `reproduksi-login-dashboard.jpg` terlampir, jawaban gaya SaaS-platform (tanpa "hubungi tim IT Anda") |
| Create tiket + kirim pesan via API | ✅ SP-2026-005 + pesan tersimpan (rate-limit lolos wajar) |
| Dua POST /agent paralel | ✅ 201 + 409; 1 balasan saja di DB (lock bekerja) |
| Pengaturan → AI & Pengetahuan → Provider AI | ✅ kartu "Support Agent (Online Support)": sakelar L2/L3/L4 + akun uji terenkripsi |
| Viewport 390px | ✅ layout mobile (screenshot `audit/support-audit/03-mobile-390.png`) |
| dev.log selama sesi audit | ✅ tanpa error runtime; hanya recompile hot-reload |
| browser-runner `/health` | ✅ `{"ok":true,"sessions":0}` |
| Gate statis akhir | ✅ eslint 0 · tsc 0 |

Bukti tangkapan layar: `audit/support-audit/01…05*.png`.

---

## 6. Risiko Sisa yang Diterima (documented residuals)

1. **Rate-limit & lock in-process** — memori proses tunggal; deploy multi-instance butuh penyimpanan bersama (Redis) bila skala naik. Saat ini single-instance — memadai.
2. **Prompt injection residual** — pesan user jahat bisa "menyamar" arahkan agen memanggil tool, namun seluruh tool read-only + diguard + hasil hanya sampai ke penanya yang sudah ter-scope menu-nya; tidak ada jalur tulis tanpa approval manusia.
3. **`read_logs` path default `dev.log`** — deploy produksi wajib set `SUPPORT_LOG_PATH` (sudah didokumentasikan di header file & DEPLOY-RUNBOOK).
4. **VLM analisa gambar selalu memakai builtin ZAI** meski tenant pakai provider ketiga — by design (fallback vision bawaan), dicatat sebagai keputusan arsitektur.
5. **Browser runner tanpa autentikasi antar-layanan** — aman karena bind 127.0.0.1; bila keluar dari localhost (container network) wajib ditambah token bersama.
6. **Anggaran giliran** (14 LLM/210s) bisa terlampaui satu-kali oleh panggilan terakhir yang lambat — diterima (deadline dicek tiap awal langkah).

---

## 7. Rekomendasi Lanjutan (opsional, bukan blocker)

1. **Notifikasi balasan AI** — pill/push saat balasan tiba saat pengguna di modul lain (saat ini hanya polling di dalam modul).
2. **SLA/prioritas otomatis → notifikasi admin** — tiket KRITIS otomatis menyalakan notifikasi pemegang op manage.
3. **Ekspor CSV/analitik tiket** — laporan volume kategori/prioritas per periode untuk admin tenant.
4. **Persistensi bukti browser ke object storage** — bila volume tiket naik, pindahkan `uploads/` ke S3-compatible.
5. **Guard nudge P4.7 saat browser OFF** — saat ini nudge verifikasi hanya aktif bila `browserEnabledFor` = true; bila browser dimatikan, ketergantungan prompt murni (read_logs/query_db). Bisa diperluas nudge ringan tanpa browser.

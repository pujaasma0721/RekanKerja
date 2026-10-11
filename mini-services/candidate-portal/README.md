# Portal Kandidat RekanKerja — APLIKASI TERPISAH

> **Keputusan arsitektur (AMANDEMEN 1 · DEVELOPMENT-PLAN-RECRUITMENT.md §2.0, 2026-10-11):**
> Portal kandidat (career site publik) dan aplikasi RekanKerja (ATS internal + ESS) adalah
> **DUA APLIKASI BERBEDA** yang di-deploy di **DOMAIN BERBEDA**. Alasan: (1) di produksi,
> halaman karir publik pasti berdiri di domain sendiri (`karir.<perusahaan>.co.id`) terpisah
> dari aplikasi internal (`app.<perusahaan>.co.id`); (2) permukaan serangan & branding
> publik vs internal berbeda total; (3) skalabilitas & SEO masing-masing.

## Apa ini

Layanan mini mandiri (pola `mini-services/`) — satu-satunya wajah **publik** rekrutmen:

| | Aplikasi utama RekanKerja | **Layanan ini (Portal Kandidat)** |
|---|---|---|
| Audiens | HR/recruiter (ATS admin) + karyawan (ESS) | **Pelamar/publik — tanpa login** |
| Domain produksi | `app.<perusahaan>` | **`karir.<perusahaan>`** |
| Port dev (sandbox) | 3000 | **3010** |
| Akses DB | Schema tenant PostgreSQL (PII terenkripsi) | **TIDAK ADA** — hanya konsumen API |
| Kunci enkripsi | Ya (field-crypto, vault uang) | **TIDAK PERNAH** |

## Kontrak dengan aplikasi utama (satu-satunya integrasi)

Portal hanya memanggil **API publik** aplikasi utama — tidak ada akses DB langsung, tidak
ada kunci enkripsi, tidak ada logika bisnis rekrutmen di sini (aturan: PII dienkripsi dan
divalidasi di SATU tempat — batas serializer aplikasi utama):

```
GET  /api/public/recruitment/openings?t=<slug-tenant>   → daftar slot lowongan Posted
GET  /api/public/recruitment/captcha?t=<slug-tenant>     → challenge captcha (HMAC, TTL 10 mnt)
POST /api/public/recruitment/apply?t=<slug-tenant>       → kirim lamaran (multipart, honeypot,
                                                          consent UU PDP) → staging PublicApplication
```

- **Sandbox (gateway)**: browser memanggil relatif + port via query —
  `fetch("/api/public/recruitment/openings?XTransformPort=3000")`.
- **Server-ke-server** (SSR daftar lowongan di layanan ini): langsung
  `http://127.0.0.1:3000/...` (internal, tidak lewat gateway).
- **Produksi**: domain `karir.<perusahaan>` mem-proxy `/api/public/recruitment/*` ke
  aplikasi utama (reverse proxy), atau aplikasi utama membuka CORS untuk origin portal.

## Struktur

```
mini-services/candidate-portal/
├── package.json     # proyek bun mandiri — port 3010
├── index.ts         # server: / (halaman karir SSR) + /healthz
├── README.md        # dokumen ini
└── src/
    └── career-portal.tsx  # KOMPONEN REACT REFERENSI F2 — DIPINDAH dari
                           # src/rekankerja/shared/components/auth/career-portal.tsx
                           # (dulu salah tempat di aplikasi utama). Menjadi basis UI
                           # saat layanan ini di-scaffold jadi aplikasi Next.js penuh
                           # pada resume F2 — bukan bagian bundle aplikasi utama.
```

## Menjalankan (dev)

```bash
cd mini-services/candidate-portal && bun run dev   # → http://127.0.0.1:3010
```

Preview via gateway sandbox: buka `/?XTransformPort=3010` (query port ke gateway).
Bila aplikasi utama menyala, daftar lowongan terisi live; bila mati, halaman menampilkan
state fallback yang rapi.

## Status & roadmap

- **Sekarang (skeleton)**: halaman karir SSR dependensi-nol (bun murni) — daftar lowongan
  live dari API publik + toggle bahasa ID/EN + landing fallback; komponen React referensi
  diparkir di `src/` (belum di-serve).
- **Resume F2**: scaffold Next.js penuh di folder ini → serve `career-portal.tsx`
  (form lamaran + captcha + upload CV + konfirmasi email) — tetap di layanan ini,
  domain sendiri saat produksi.
- **Backlog** (lihat plan §7): portal akun pelamar (self-service status lamaran) —
  kalau dibuka, tetap di aplikasi ini, bukan di aplikasi utama.

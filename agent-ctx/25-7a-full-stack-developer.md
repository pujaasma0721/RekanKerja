# Task 25-7a — full-stack-developer — Catatan Kerja

Konteks: lanjutan Task 25 (backend approval berjenjang selesai). Task ini murni frontend (client components) — TIDAK menyentuh service/API backend, TIDAK menambah route app/ baru, semua via view switch modul yang sudah ada.

## File yang dibuat
1. `src/onevity/human-resource/components/org/office-location-view.tsx` (BARU) — `OfficeLocationView()`: PageHeader (eyebrow "PERUSAHAAN & ORGANISASI", title "Kantor & Lokasi Kerja"), 3 stat card (jumlah kantor / jumlah lokasi / karyawan terpenempatan = Σ employeeCount kantor + Σ employeeCount lokasi tanpa induk kantor agar tidak double count), Tabs "Kantor Perusahaan" + "Lokasi Kerja" gaya attendance-templates (rounded-2xl, emerald aktif), tabel masing-masing (kantor: kode+nama chip Building2, kota, alamat truncate, karyawan, jumlah lokasi, status ActivePill klik-untuk-toggle PATCH active, aksi edit/hapus; lokasi: kode+nama chip MapPin + badge NONAKTIF bila nonaktif, kantor induk (badge code + nama / "— Tanpa kantor —"), kota, karyawan, aksi), dialog form kantor (kode wajib, disabled saat edit — PATCH tidak menerima code; nama wajib; kota/telepon/alamat), dialog form lokasi (kode+nama wajib, Select kantor induk opsi "— Tanpa kantor —" dari GET /api/onevity/company-offices, kota/alamat, switch Aktif saat edit), hapus via AlertDialog + toast.error pesan guard API ("Kantor dipakai N struktur approval — hapus referensi dulu", "Kantor masih memiliki lokasi kerja terhubung…", "Lokasi dipakai N struktur approval…").
2. `src/onevity/human-resource/components/position/level-view.tsx` (BARU) — `PositionLevelView()` meniru pola GradeView: PageHeader (eyebrow "POSISI & JABATAN", title "Level Jabatan", description dinamis jumlah level + karyawan), tombol Muat Ulang + Level Baru, tabel level (chip kode gradient teal→emerald, nama, badge "urutan N", jumlah posisi, jumlah karyawan, ActivePill klik-toggle, aksi edit/hapus), dialog form (kode disabled saat edit, nama, urutan number), AlertDialog hapus + toast.error guard ("Level masih dipakai (N posisi, N karyawan)" / "Level dipakai N struktur approval"), kartu ringkasan LevelStats (level terpadat + total karyawan terpetakan) gaya GradeStats.

## File yang diubah (dispatch + nav saja)
3. `src/onevity/human-resource/components/org/org-module.tsx` — import + dispatch `if (view === "offices") return <OfficeLocationView />;`
4. `src/onevity/human-resource/components/position/position-module.tsx` — import + dispatch `if (view === "levels") return <PositionLevelView />;`
5. `src/onevity/shared/components/shell/app-shell.tsx` — HR_NAV: section "org" + `{ id: "offices", label: "Kantor & Lokasi Kerja", icon: Building2 }` setelah "Perusahaan"; section "position" + `{ id: "levels", label: "Level Jabatan", icon: TrendingUp }` setelah "Grade & Level"; import lucide `TrendingUp` (Building2 sudah ada). Breadcrumb + command palette otomatis mengikuti NAV.

## Kontrak API yang dipakai (terverifikasi live, tenant MII)
- `GET /api/onevity/company-offices` → `{ offices: [{ id, code, name, address, city, phone, active, employeeCount, locationCount }] }` (3 kantor: OFF-HO 22/1, OFF-PLG 20/4, OFF-SBY 0/1)
- `GET /api/onevity/work-locations` → `{ locations: [{ id, code, name, address, city, active, officeId, office: { code, name } | null, employeeCount }] }` (6 lokasi)
- `GET /api/onevity/position-levels` → `{ levels: [{ id, code, name, sortOrder, active, positionCount, employeeCount }] }` (PL1..PL8)
- POST/PATCH/DELETE masing-masing sesuai kontrak Task 25; error guard ditampilkan via toast.error apa adanya

## Catatan lingkungan
- Dev server :3000 ditemukan MATI (kemungkinan OOM saat compile 295s paralel dgn 2 agent); direstart background via `nohup bun run dev` — kembali Ready, semua endpoint + page 200. Transien 500 GET / & API terjadi hanya saat file travel-approval.tsx milik agent 25-7b sedang mid-edit (syntax error) — bukan file saya, sudah normal kembali.
- Verifikasi E2E via agent-browser (login hrd@mii.co.id → workspace MII): nav "Kantor & Lokasi Kerja" render stat 3/6/42 + tabel 2 tab; create LOC-TST via dialog → muncul; delete LOC-TST → hilang (round-trip bersih); nav "Level Jabatan" URL `?s=position&v=levels` render tabel PL1..PL8; guard delete PL1 → HTTP 400 + baris tetap; 0 error JS browser; screenshot 2 view dicek VLM (layout bersih, tanpa indigo/blue).
- Data uji LOC-TST sudah dihapus (tidak ada residu).

## Verifikasi
- `bunx tsc --noEmit` → 0 error src/onevity (2 baseline skills/ tetap, bukan milik task)
- `bun run lint` → exit 0
- Dev server :3000 jalan, GET / 200

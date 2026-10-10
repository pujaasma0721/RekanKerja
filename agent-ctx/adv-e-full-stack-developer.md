# Task adv-e — Advance Search wiring: sisa modul HR + SETTINGS

## Ringkasan
Wire tombol + dialog Advance Search (`AdvSearchButton` dari
`@/rekankerja/shared/components/adv-search`) ke 8 view HR + 2 view SETTINGS.
Semua wiring CLIENT-SIDE (`filterRowsByAdv`) — filter TAMBAHAN di atas
query/status/search filter yang sudah ada (tidak ada logika lama yang
diubah), persis pola kontrak Task adv-search & contoh employee-directory.
Ini penutup coverage: adv-a (leave/travel), adv-b (medical/whistle/EES),
adv-c (payroll), adv-d (attendance), adv-e (HR sisa + settings).

## File yang di-wire (10/10, tanpa skip)
| View | Baris | Field |
|---|---|---|
| employee/employee-documents.tsx | DocumentRowUI | 7 field (employeeName, employeeNo, docType sel 9 via DOC_TYPE_LABEL(_EN), docNumber, issuedAt dt, expiresAt dt, notes) — adv di atas query lama; tombol sebelah search + filter karyawan |
| assets/assets-module.tsx (InventoryTab) | AssetRow | 8 field (code, name, serialNumber, category sel 6, location, status sel 5 via ASSET_STATUS, value num `?? undefined` anti null→0, holder txt getter nested) — adv pada hasil fetch (query server q/kategori/status tetap) |
| employee/disciplinary-view.tsx | DisciplinaryRow | 8 field (employeeName/employeeNo getter nested, warningLevel sel Verbal/Written/Final via WARNING_LEVEL_META/_EN, violation, sanction, issuedAt dt, expiresAt dt, notes) — adv SEBELUM filter level; kartu statistik ikut hasil; tombol PageHeader actions |
| offboarding/offboarding-module.tsx (OffboardingList) | OffRow | 9 field (employeeName/employeeNo/position/orgUnit getter nested, lastDay dt, source txt getter sourcePA?.docNo, status sel Open/Completed/Cancelled, taskTotal & taskDone num getter taskStats) — adv SEBELUM filter status; tombol PageHeader actions |
| position/position-module.tsx (PositionList) | Position | 9 field (code, title, job getter, orgUnit getter, grade getter, headcount num, filled num, holder txt getter, active sel boolean String()) — stats & useTableSort menerima hasil adv; dialog reportsTo tetap daftar penuh |
| announcements/announcements-view.tsx (AnnouncementsList) | AnnouncementRow | 9 field (code, title, body, category sel 4, status sel draft/published/expired, pinned sel boolean, reads num, publishedAt dt, expiresAt dt) — adv di atas query server tab/kategori/q |
| actions/actions-module.tsx (AllDocuments) | PA | 8 field (docNo, employeeName/employeeNo/position getter nested, type sel 12 via PA_TYPES+PA_TYPE_LABEL_EN, effectiveDate dt, createdAt dt, status sel 6 label STATUS_MAP) — useTableSort(progress) & rows ikut hasil adv |
| actions/letter-templates-view.tsx (tab Dokumen Terbit) | DocRow | 7 field (refNo, employeeName, employeeNo, templateName, category sel 3, issuedAt dt, esign sel signed/unsigned via getter) — adv DI ATAS docQ; badge tab tetap daftar penuh |
| settings/user-security-view.tsx (UsersPanel) | AppUserRow | 7 field (username, fullName, email, role sel 6 via APP_ROLES, lastLogin dt, passwordChangedAt dt, active sel boolean String()) — adv SEBELUM useTableSort (sort+filter kompos); tombol sebelah "Tambah Pengguna" |
| settings/user-access-view.tsx | AccessUser | 10 field (username, fullName, email, role sel 6, employeeNo/employeeName getter nested, menuMode sel ALL/CUSTOM, subordinateCount num, ruleCount num) — adv DI ATAS search lama; seleksi & detail tetap daftar penuh |

## Catatan penting
- TDZ guard: blok konst ADV yang membaca peta label module-level
  (ADV_DOC_TYPES/ADV_STATUSES/ADV_ROLES dst.) diletakkan SETELAH deklarasi
  peta tsb (employee-documents & assets) supaya tidak kena
  "used before initialization" saat evaluasi modul.
- Kolom uang/angka nullable diberi getter `?? undefined` agar nilai kosong
  tidak dianggap 0 oleh Number() (pola adv-a/adv-b) — assets `value`.
- Boolean selalu select via getter `String(x)` atau ternary → label
  dwibahasa (pola adv-a leave-templates).
- View tanpa search box (disciplinary, offboarding) → tombol ditaruh di
  PageHeader actions berdampingan tombol utama (pola adv-b ess-payslips).
- user-security: `users` (hasil adv) kini masuk ke `useTableSort` SEBELUM
  sort — sort.sorted otomatis kompos dengan adv; counter judul kartu ikut
  hasil adv.
- Tidak ada view dengan tombol "reset semua filter" → tidak perlu
  setAdv(null) tambahan (Reset adv sudah ada di dialog).
- Whistleblowing triage & ESS (adv-b) dan employee-directory (server-side)
  TIDAK disentuh sesuai instruksi task.

## Verifikasi
- `bunx tsc --noEmit` → 0 error.
- `bun run lint` → 0 error, 7 warning pre-existing (file lain + 1 di infra
  adv-search.tsx yang tidak boleh diubah — identik baseline adv-a/b/c/d).
- dev.log: tidak ada error kompilasi.

# BL2-b — full-stack-developer — Fix temuan audit bilingual slice LEAVE + TRAVEL + TIME-ATTENDANCE + RECRUITMENT + WHISTLEBLOWING

Task ID: BL2-b
Agent: full-stack-developer
Date: 2026-10-26

## Scope
~40 temuan audit-bilingual (baseline TOTAL_GAP=149) di area leave/travel/time-attendance/recruitment/whistleblowing — klasifikasi koordinator [A real gap / B verifikasi / C by-design]. Aturan emas dipatuhi: tanpa blue/indigo, DialogContent `sm:max-w-*` tak disentuh strukturnya, hanya 7 file milik slice ini, audit-bilingual.ts & i18n-core.ts TIDAK disentuh, tanpa commit/push, tanpa test file.

## Konvensi kunci yang dipakai (dari worklog + i18n-core.ts)
- t("Teks ID", "English text") dua argumen; audit punya 4 konvensi pasangan yang di-skip: R1 adv-search builder, R2 tabel triple [value, labelID, labelEN], R3 record 2-tuple bertipe, R4 pasangan X + X_EN.
- Judul DocHeader laporan (report-views) = EN-only BY DESIGN; katalog laporan punya titleId/titleEn per baris (ar41/ar42/lr33: titleId == titleEn).

## Perubahan (7 file)
1. **src/rekankerja/leave/components/leave-templates.tsx** — temuan [A] L341-346: 6 label checkbox kebijakan cuti direstrukturisasi dari array 2-elemen + peta POLICY_LABEL_EN (paralel, tak terlihat AST) menjadi TABEL TRIPLE [key, labelID, labelEN] (konvensi R2, pola GENDERS/MARITAL), render `t(label, labelEn)`; peta POLICY_LABEL_EN dihapus (satu-satunya konsumen = render tsb). EN natural: "Paid leave (paid absence)", "Monthly prorate (earned ÷12)", "Balance can be encashed (UCT)", "Negative balance allowed (advance)", "Allow half-day (AM/PM)", "Supporting document required". Hanya display — yang tersimpan ke DB boolean form (paid/cashable/dst.), bukan label.
2. **src/rekankerja/travel/components/travel-claim-approval.tsx** — L218 & L352: `TOTAL` → `{t("TOTAL","TOTAL")}` (identik dua bahasa; file konsisten pakai t() utk semua label sekitar: "(a) kurs − pihak lain", "(b) karyawan", "(c) perusahaan").
3. **src/rekankerja/travel/components/travel-overview.tsx** — L259: "Travel &amp; Entertainment Settlement" (nama konsep T&E, by-design sama di 2 bahasa, bukan kartu KPI 102-f — terverifikasi KPI cards travel-overview semuanya sudah t() 2-arg) → `{t("Travel & Entertainment Settlement","Travel & Entertainment Settlement")}`; L269: `Budget {budget.year}` → `{t("Budget","Budget")} {budget.year}`.
4. **src/rekankerja/travel/components/travel-budget.tsx** — L107: `Budget {b.year}` → `{t("Budget","Budget")} {b.year}` (label sekitar sudah t(): "Total Budget", "Terpakai"/"Used", "Sisa"/"Remaining").
5. **src/rekankerja/travel/components/travel-claims.tsx** — L755: `Total = {fmtIDR(totalFormula)}` (kotak formula settlement dialog klaim, user-visible) → `{t("Total","Total")} = {fmtIDR(totalFormula)}`.
6. **src/rekankerja/travel/components/travel-requests.tsx** — L248: `ServerSortHead label="Template"` → `label={t("Template","Template")}` (header kolom tabel; head sekitar semua t()).
7. **src/rekankerja/recruitment/components/offer-dialogs.tsx** — L748 fallback `?? ["Surat","Letter"]` (pasangan bilingual, dirender t(label,labelEn) — audit tak melihat) direstrukturisasi jadi `kindLabel?.[0] ?? "Surat"` / `kindLabel?.[1] ?? "Letter"` (tanpa array literal); + FIX NYATA a11y: iframe pratinjau `title={label}` (ID-only saat EN) → `title={t(label, labelEn)}`.

## Verifikasi [B] — fix vs skip
- **FIX**: travel-claim-approval TOTAL ×2, travel-overview L259+L269, travel-budget L107, travel-claims L755, travel-requests L248, offer-dialogs (restrukturisasi + iframe title) — semua identik-dua-bahasa/netral, dibungkus t() identitas mengikuti pola label sekitar yang sudah t() (menghapus 7 gap audit).
- **SKIP (by design — verified)**:
  - time-attendance report-views-g34 L267/L323 "Roster & Shift Schedule Deviation Report" / "Night Shift & Special Premium Hours Log" — judul DocHeader laporan EN-only by design (katalog titleId==titleEn; 30+ judul laporan seragam); flag hanya karena kata "shift" cocok ID_WORD_RE.
  - leave report-views-g34 L135 "Unexcused Absence / Alpa Log" — sama (katalog lr33 titleId==titleEn); flag karena kata "alpa".
  - whistleblow/api/reports.ts L15 STATUSES — enum status DB; komponen whistleblow-module.tsx SUDAH menerjemahkan via STATUS_META (id/en) di 4 titik render (kartu statistik L179, Select filter L196, badge tabel L253, badge detail L274) → tidak diubah.
  - pr-list.tsx L492 "Draft" — array pembanding status enum (`["Draft","Submitted",...]`), bukan label; kata identik EN.
  - travel-templates.tsx L286 placeholder "TRAVEL-KA" — contoh kode template teknis, netral.
  - Semua [C]: machine-import ID_KEYS/DATE_KEYS dst. (token CSV), menu-access keys attendance:shift-swap / recruitment:budget / travel:travel-* (diverifikasi via grep), attendance-service L1159 "LEMBUR" (tag teknis tuple; L1200 note "Tunjangan kehadiran penuh…" = data historis tersimpan ke EmployeeComponentAssignment.notes/PayrollRunItem — BUKAN label UI), recruitment services Draft = enum status, layout.tsx "normal" = font style key, parity-runner = console server, AI services = prompt by-design.

## Hasil
- audit-bilingual: TOTAL_GAP 149 → 127 (14 gap hilang dari slice ini; 8 lainnya dari agent paralel shared/HR/payroll).
- lint: 0 error / 6 warning pre-existing (semua di file luar slice: ess-shell, auth-gate, editorial, app-shell — unused eslint-disable directive).
- tsc --noEmit: 0 error.
- dev.log: bersih — GET /?s=leave|travel|recruitment 200, tanpa error runtime (POST login 200, API overview/templates/claims/requests 200).
- Browser (agent-browser, :3000): login hrd@mii.co.id → Leave > Leave Types > New Leave Type: 6 label EN tampil benar ("Paid leave (paid absence)" … "Supporting document required"); ganti ID → 6 label ID ("Cuti dibayar (absen berbayar)" … "Perlu dokumen pendukung"); Travel > Overview: kalimat "…equivalent to Travel & Entertainment Settlement with final status…" + kartu "BUDGET 2026"; Travel Budget & Claims & Settlement render tanpa error; console bersih (1 ChunkLoadError transien saat reload di tengah Fast Refresh — hilang setelah reload, halaman kembali normal).

## Catatan untuk koordinator
- 5 temuan saya yang tersisa di audit adalah by-design (judul laporan EN-only ×3, STATUSES whistleblow, "Draft" pr-list, "TRAVEL-KA") + menu keys — kandidat penanganan di audit-bilingual.ts (exclusion/R-rules), bukan perubahan UI.
- Catatan lingkungan: direktori /agent-ctx root tidak writable (root-owned) → record ini ditulis di /home/z/my-project/agent-ctx/ (folder yang sudah dipakai task-task sebelumnya).

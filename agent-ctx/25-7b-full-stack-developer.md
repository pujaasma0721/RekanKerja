# Task 25-7b — full-stack-developer — Catatan Kerja

Konteks: lanjutan Task 25 (approval berjenjang backend selesai). Task ini murni frontend (client components) — TIDAK menyentuh service/API backend, TIDAK menambah route app/ baru.

## File yang diubah
1. `src/onevity/leave/components/leave-types.ts` — +`ApprovalChainUI` + `approval?` di RequestRowUI
2. `src/onevity/leave/components/leave-approval.tsx` — kolom Approval kondisional, toast parsial, info jenjang di dialog
3. `src/onevity/leave/components/leave-requests.tsx` — toast submit + firstApprover/approvalLevels
4. `src/onevity/travel/components/travel-types.ts` — +`TravelApprovalUI` + `approval?`
5. `src/onevity/travel/components/travel-approval.tsx` — badge jenjang di kartu, toast parsial, info jenjang di dialog
6. `src/onevity/medical/components/medical-types.ts` — +`MedicalApprovalUI` + `approval?`
7. `src/onevity/medical/components/medical-approval.tsx` — badge jenjang di antrean, toast parsial, info jenjang di dialog
8. `src/onevity/payroll/components/payroll-types.ts` — +`LoanApprovalUI` + `approval?` di LoanRow
9. `src/onevity/payroll/components/payroll-transactions.tsx` — LoanCard: status Submitted/Rejected, badge jenjang, tombol Setujui/Tolak (PATCH loans), guard cicilan kosong; LoanDialog toast submit baru
10. `src/onevity/human-resource/components/employee/employee-wizard.tsx` — Select Kantor & Lokasi Kerja (GET company-offices / work-locations), Level Jabatan opsional dari posisi, POST body, review, draft
11. `src/onevity/human-resource/components/employee/types.ts` — EmployeeDetail + companyOfficeId/workLocationId/positionLevelId + object opsional companyOffice/workLocation/positionLevel
12. `src/onevity/human-resource/components/employee/employee-detail.tsx` — DetailItem Kantor & Lokasi Kerja (resolve: object flatten → fallback snapshot ID + list endpoint)

## Kontrak API yang dipakai (terverifikasi live)
- Row list: `approval: { status: "InProgress"|"Approved"|"Rejected"|"Cancelled", currentLevel, totalLevels, currentApprover } | null`
- Decide parsial (hanya approve jenjang menengah): `{ ..., status/state tetap "Submitted", approval: { currentLevel, totalLevels, currentApprover } }`
- Loans PATCH final approve: `{ loan: Active(+cicilan), approval: { final: true, totalLevels } }`; reject: `{ loan }`
- Loans POST: `{ loan, approval: { levels, firstApprover } }` (leave/travel/medical POST: `approvalLevels`, `firstApprover`)
- Catatan: employee-detail GET mengirim snapshot ID (companyOfficeId/workLocationId/positionLevelId) TANPA object relasi — resolve nama frontend via company-offices/work-locations

## Keputusan
- detail-dialogs.tsx EditWorkDialog TIDAK ditambah field kantor/lokasi karena PATCH /api/onevity/employee-detail belum menerima field tsb (JOB_FIELDS) dan backend dilarang diubah di task ini
- Data uji: LTR-2026-004 (Submitted, 2 jenjang) dibiarkan sebagai demo alur approval pinjaman; LTR-TEST-25B dibersihkan via SQL langsung

## Verifikasi
- `bunx tsc --noEmit` → 0 error src/onevity (2 baseline skills/ tetap, bukan milik task)
- `bun run lint` → exit 0
- Dev server :3000 — GET / 200, endpoints 200

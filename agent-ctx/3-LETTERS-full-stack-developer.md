# Task 3-LETTERS — Letter template system (surat cetak + template editable perusahaan)

Agent: full-stack-developer subagent (OneVity HRIS)
Lihat worklog.md section `Task ID: 3-LETTERS` untuk ringkasan penuh.

## Files created
- `src/onevity/shared/services/letter-service.ts` — renderLetterBody ({{token}} → "—" bila kosong), buildLetterContext (Company pertama + CompanyOffice via employee.companyOfficeId fallback kantor pertama; snapshot karyawan posisi/unit/grade/level + status dari assignment aktif; token disipliner: validity bulan penuh, warning_no = urutan record level sama per karyawan; token PA dari detailJson dengan resolve positionId/orgUnitId → title/name), issueLetter (idempoten per sumber+templateKey; refNo 001/HR-DIS|HR-PA/IX/2026; snapshot body + ActivityLog), letterPdfBuffer (pdf-lib A4, kop tengah + NPWP kantor/perusahaan, paragraf split baris kosong, baris ≥4 spasi = rincian menjorok x+36 tanpa re-wrap, word-wrap + multi-halaman, sanitizer WinAnsi pola payslip).
- `src/onevity/human-resource/api/letter-templates.ts` + route `/api/onevity/letter-templates` — GET (guard hr:templates view), PATCH (guard update; body ≤ 20000; signatoryName "" → null), POST {action:"reset"} restore dari LETTER_TEMPLATE_DEFAULTS.
- `src/onevity/shared/api/letters.ts` + routes `/api/onevity/letters` (list ?employeeId=, 100 terbaru), `/letters/issue` POST (resolusi templateKey DISC_<LEVEL>/PA_<TYPE>, guard hr:directory create), `/letters/[id]/pdf` GET ?download=1 (guard view; runtime nodejs; filename Surat-<refNo>.pdf dengan "/" → "-").
- `src/onevity/human-resource/components/actions/letter-templates-view.tsx` — 2 seksi kategori, kartu baris (key chip mono, pil aktif klik=toggle, penanda tangan, diperbarui), editor sm:max-w-5xl 2 kolom: form + palet placeholder (klik sisip {{token}} di caret) | PRATINJAU LIVE kertas font-serif dengan sampel nilai.
- `src/onevity/human-resource/components/employee/letter-preview-dialog.tsx` — dialog bersama: POST issue saat dibuka (idempoten), kartu meta refNo+template+karyawan+tanggal, kertas scrollable max-h-[65vh], Unduh PDF (a download) + Tutup, error → toast + inline.

## Files edited
- `actions-module.tsx` — dispatcher: `view === "templates"` dicek PERTAMA (sebelum params.id); **PENTING**: view detail PA LIVE adalah komponen internal `ActionDetail` di file ini (bukan pa-detail.tsx yang orphan) → tombol "Cetak Surat" (tone stone, hanya Approved/Processed) + LetterPreviewDialog ditambahkan di sini.
- `employee-wizard.tsx` DisciplinaryPage — kolom "Aksi" w-24 (Surat FileText + Hapus Trash2 AlertDialog → DELETE + refresh); AddDisciplinaryDialog + Tanggal Kejadian (default hari ini), Masa Berlaku s.d. (default +6 bulan, clamp overflow), Catatan → POST issuedAt/expiresAt/notes.
- `pa-detail.tsx` — WorkflowBar + prop onPrint, tombol Cetak Surat Approved/Processed + LetterPreviewDialog (sesuai instruksi task; komponen ini legacy/orphan — versi live ada di actions-module).

## Catatan penting bagi agent berikutnya
- DisciplinaryRecord TIDAK punya kolom createdAt → orderBy [{issuedAt:asc},{id:asc}].
- detailJson PA menyimpan kode (toPosition/toUnit/newGrade) + id (positionId/orgUnitId/gradeId); Hire pakai plannedPosition/plannedSalary; ContractRenewal & ExtendProbation → newEndDate.
- Template ter-seed di 3 tenant memakai script lama — sebagian body berbeda tipis dari letter-defaults.ts saat ini (mis. "berlaku selama {{validity_months}} (enam) bulan", "Berdasarkan evaluasi{{reason}}"); tombol "Kembalikan ke Bawaan" menyembuhkan quirk itu.
- Guard API memakai requireMenuAction → role platform VIEWER ditolak juga untuk GET (sesuai spesifikasi task).
- Jangan sentuh: prisma schema, letter-defaults.ts, app-shell.tsx, personnel-actions-detail.ts (hook offboarding), i18n-core.ts.

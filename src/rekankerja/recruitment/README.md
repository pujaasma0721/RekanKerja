# Modul Rekrutmen (F0–F9) — RekanKerja HRIS

Modul rekrutmen end-to-end: dari permintaan karyawan (PR) sampai kandidat
diterima menjadi karyawan — plus kepatuhan UU PDP (F9). Sumber desain:
`DEVELOPMENT-PLAN-RECRUITMENT.md` (§5 kontrak API, §7 fase F0–F9) mengacu
analisa §2.5/§2.6 + HRX (pattern AI-recruitment engine).

## 1. Purpose

- **F0 Master** — metode rekrutmen, media iklan, agency, cost item, skill,
  dokumen wajib, kategori/skala evaluasi, SLA group, proses seleksi.
- **F1 PR & approval** — PersonnelRequisition (PR) + jalur persetujuan +
  anggaran (budget line vs actual).
- **F2 Lowongan & talent pool** — JobOpportunity/JobOpening (slot) + portal
  karir publik (staging lamaran) + Applicant (talent pool) + dokumen.
- **F3 Kandidat & seleksi terstruktur** — JobCandidate per PR, tahapan
  (CandidateSelectionStep) + scorecard terstruktur + surat undangan;
  **tahapan kustom per PR** (SB-RC-BL — user-defined selection process:
  HR memilih tahap + urutannya per rekrutmen; kosong = standar tenant,
  rantai kandidat existing aman sebagai snapshot).
- **F4 Offer & pengangkatan** — CandidateOffer (surat penawaran), timer
  kedaluwarsa, pengangkatan → Employee + lanjut onboarding.
- **F5 Demografi & rencana** — segmen talent pool, silver medalist, rencana &
  anggaran rekrutmen.
- **F6 AI** — parsing CV, skor kandidat explainable, pencarian natural
  language, knockout question, recruiter copilot (fallback simulasi).
- **F7 Otomasi & integrasi** — webhook outbound (HMAC + retry), e-sign OTP,
  preferensi notifikasi, pengaturan otomasi.
- **F8 Analytics** — dashboard, katalog metrik, adverse-impact 4/5ths,
  proyeksi heuristik, snapshot metrik, saved views + export CSV/XLSX/PDF (`?export=…&format=csv|xlsx|pdf`).
- **F9 Kepatuhan UU PDP** — DSR (akses/ekspor/hapus + SLA), consent ledger +
  withdrawal, retensi & anonimisasi otomatis, audit akses PII, utilitas
  pseudonimisasi.

## 2. Data flow (ujung ke ujung)

```
Portal karir (publik)                HR / Recruiter
  lamaran + consent ──► PublicApplication (staging, PII terenkripsi)
                            │ verifikasi HR (+ parse CV F6a opsional)
                            ▼
                        Applicant (talent pool, PII terenkripsi)
                            │ apply-to-slot (multi-lamaran)
                            ▼
                        ApplicantApplication ── knockout (F6) ──► tolak otomatis
                            │ nominasi / lamaran internal (ESS)
                            ▼
                        JobCandidate (per PR) ──► tahapan seleksi + scorecard
                            │                              └ surat undangan
                            ▼
                        CandidateOffer (penawaran) ── e-sign OTP (F7)
                            │ diterima
                            ▼
                        CandidateAppointment ──► Employee + onboarding HRIS
                                                          │
   F9 (sepanjang siklus): consent ledger · DSR · audit PII · retensi/anonimisasi
```

## 3. Inventaris API

### Publik (tanpa sesi — rate-limit + captcha + anti-enumeration)
| Endpoint | Fungsi |
|---|---|
| `GET /api/public/recruitment/openings` | Daftar lowongan terpasang |
| `POST /api/public/recruitment/apply` | Kirim lamaran (staging) + consent |
| `GET /api/public/recruitment/captcha` | Captcha aritmetika form publik |
| `GET/POST /api/public/recruitment/sign/[token]` | Portal e-sign kandidat (OTP + nama terketik) |

### Admin (guard menu `recruitment:*`)
| Endpoint | Menu | Ringkas |
|---|---|---|
| `/api/rekankerja/recruitment/masters` | masters | Master F0 (multi-tipe) |
| `/api/rekankerja/recruitment/pr` | pr | PR + approval + anggaran |
| `/api/rekankerja/recruitment/pr-options` | pr | Dropdown form PR |
| `/api/rekankerja/recruitment/openings` | openings | JO + slot + knockout |
| `/api/rekankerja/recruitment/applicants` | applicants | Talent pool CRUD + query builder |
| `/api/rekankerja/recruitment/applicant-documents` | applicants | Upload/dokumen pelamar |
| `/api/rekankerja/recruitment/public-applications` | public-staging | Inbox verifikasi staging |
| `/api/rekankerja/recruitment/candidates` | candidates | Kandidat per PR |
| `/api/rekankerja/recruitment/selection` | selection | Tahapan, hasil, board, surat, tahapan kustom per PR (`?prStages=1` / `pr-stages-save`) |
| `/api/rekankerja/recruitment/offers` | offers | Offer + respons + pengangkatan |
| `/api/rekankerja/recruitment/plan` | plan | Rencana rekrutmen |
| `/api/rekankerja/recruitment/budget` | plan | Anggaran vs actual |
| `/api/rekankerja/recruitment/demographics` | demographics | Demografi + silver medalist |
| `/api/rekankerja/recruitment/ai` | applicants/selection | Parse CV, skor, NL-search, copilot |
| `/api/rekankerja/recruitment/reports` | reports | Dashboard/metrik/adverse-impact + export CSV/XLSX/PDF |
| `/api/rekankerja/recruitment/settings` | settings | Webhook, otomasi, pref, e-sign |
| `/api/rekankerja/recruitment/compliance` | compliance | **F9**: DSR, consent, retensi, audit PII |

Endpoint **compliance** (F9):
`GET ?section=dsr|consents|retention|audit` · `GET ?dsr-package=<id>` (JSON,
op:export) · `GET ?export=audit` (CSV log PII, op:export) ·
`POST {action: dsr-create|dsr-progress|dsr-complete|dsr-reject|consent-withdraw
(op:handle) | retention-config|retention-run (op:retention)}`.

## 4. PII map (field terenkripsi ↔ titik decrypt)

Enkripsi field-level per tenant (`enc:v1:t:…` teks, `enc:v1:n:…` uang) via
`tenantCryptoForDb` — kunci tenant, tidak pernah keluar DB sebagai plaintext
persisten.

| Data | Kolom terenkripsi | Titik decrypt (in-memory) |
|---|---|---|
| Applicant | `email, phone, address, city, placeOfBirth, identityNo, expectedSalary` | serializer `applicant-service` (detail penuh / topeng di list), paket DSR `getDsrPackage` |
| PublicApplication | `payloadJson` (field email/phone/city/salary per-field) | `decryptPayload` di inbox verifikasi |
| CandidateOffer | `salary` | serializer offer (moneyVisible) |
| EsignRequest | `signerEmailEnc` | kirim OTP |
| Applicant lain | `birthDate, gender, maritalStatus, source, status, applicantNo` | polos (agregat/filter) |

`birthDate` polos mengikuti konvensi `Employee.birthDate` (filter umur
analytics); mengikuti prinsip minimisasi — bukan identifikasi unik.

## 5. Config (RecruitmentSetting)

Tabel key-value per tenant (baca `getRecruitmentSetting` never-throw,
fallback default). Kunci sah:

| Key | Default | Arti |
|---|---|---|
| `auto.reply.public-application` | true | Email konfirmasi lamaran publik |
| `auto.reminder.selection` | true | Reminder tahap H-3/overdue |
| `auto.reminder.offer` | true | Reminder offer akan berakhir |
| `auto.escalate.sla` | true | Eskalasi tahap telat 3/7/14 hari |
| `auto.ack.email.candidate` | true | Email undangan saat step dijadwalkan |
| `retention.months.rejected` | 24 | Jendela retensi pelamar Rejected |
| `retention.months.outdated` | 24 | Jendela retensi pelamar Outdated |
| `retention.anonymize` | true | false = dry-run (hitung tanpa anonim) |

## 6. Retensi & DSR policy (F9)

**DSR (Data Subject Request)** — hak akses/ekspor/hapus UU PDP Pasal 7–9.
SLA 7 hari (`dueAt`). Satu DSR aktif per pelamar (409 bila masih ada).
Erase → `anonymizeApplicant` (bukan hapus baris):

1. **Sebelum** PII di-null: `dedupHash = sha256(email|birthDate)` dicatat di
   ActivityLog `ApplicantAnonymized` — satu-arah, untuk deteksi re-lamar.
2. PII di-null (kolom terenkripsi + birthDate + expectedSalary), nama →
   `Anonim <applicantNo>`, status → `Anonymized`, note di-prepend jejak.
3. Dihapus: dokumen (+ file fisik), parse CV, pendidikan, pengalaman,
   keahlian; nama snapshot kandidat → `Anonim (APP-…)`.
4. **Dipertahankan**: ApplicantApplication (lamaran = catatan bisnis/
   rekonsiliasi) + ApplicantConsent (bukti ledger kepatuhan).
5. GUARD: pelamar `Employed` tidak dapat dianonimkan (karyawan aktif).

**Retensi** — job scheduler harian `recruitment-retention`: pelamar
Rejected/Outdated dengan umur status melewati `retention.months.*` →
anonimisasi, KECUALI punya consent `talent-pool` aktif (belum ditarik) —
data ditahan (skippedConsent). `retention.anonymize=false` → dry-run.
Ringkasan 1× ActivityLog `RetentionRun` per hari.

**Consent withdrawal** — `withdrawConsent` menandai `withdrawnAt`; efek:
pelamar keluar dari saran silver medalist/talent pool (demographics).
Consent ledger sendiri tidak pernah dihapus (bukti UU PDP).

**Audit PII** — setiap GET detail pelamar mencatat ActivityLog `PiiAccess`
(siapa/kapan/pelamar mana); export CSV op:export. List hanya versi topeng.

## 7. Limitation (disengaja — jangan dianggap bug)

- **E-sign kandidat ringkas** — OTP email + nama terketik + `pdfSha256`
  tamper-evident; BUKAN TTE bersertifikat (BSrE/PAdES) — cocok untuk
  kesepakatan offer internal, bukan dokumen yang mensyaratkan sertifikat.
- **AI fallback simulasi** — parse CV/skor/NL-search/copilot jalan tanpa
  provider AI (mode `simulated`, berlabel di UI); keputusan tetap manusia.
- **Snapshot staging** — `PublicApplication.payloadJson` menyimpan salinan
  PII terenkripsi miliknya sendiri (dengan consent-nya); tidak ada FK ke
  Applicant, jadi DSR erase tidak menyentuhnya (lineage terpisah).
- **Webhook retry** tanpa advisory lock saat dipicu tombol uji — dedup di
  sisi penerima via header `X-RekanKerja-Delivery`.
- **Retensi bulan = 30 hari** (aproksimasi); umur status pakai `updatedAt`.
- **Anonimisasi irreversibel** — tidak ada undo; dedupHash hanya untuk
  screening ulang, bukan pemulihan data.

## 8. Lokasi kode

- Services: `src/rekankerja/recruitment/services/*` (applicant, pr, opening,
  candidate, selection, scorecard, offer, appointment, planning,
  demographics, ai-*, webhook, esign, setting, analytics, compliance).
- API: `src/rekankerja/recruitment/api/*` + route
  `src/app/api/rekankerja/recruitment/*` + publik `src/app/api/public/recruitment/*`.
- UI: `src/rekankerja/recruitment/components/*` (digerakkan NAV app-shell).
- Migrasi: `scripts/migrate-recruitment-f{0..9}.ts` (idempoten per tenant).

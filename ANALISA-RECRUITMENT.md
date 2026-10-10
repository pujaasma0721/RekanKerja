# ANALISA DEEP-DIVE: Modul Recruitment oranHR → Rencana Implementasi Recruitment RekanKerja

> Dokumen analisa murni (tanpa perubahan kode aplikasi — sesuai mandat user).
> Basis: eksplorasi langsung **demo.oranhr.com** (login `MII000001` / `MII1`, company
> *MII - Mitra Industri Internasional*, aplikasi versi `11.08.00`, JSP + ExtJS).
> Metode: browser automation (agent-browser) — navigasi 50 halaman, ekstraksi store
> ExtJS (kolom grid + field model + sample data), screenshot 29 bukti visual + analisa
> VLM form-form kunci. Artefak: `.tmp-research/rec-*.png`, `.tmp-research/rec-data/*.json`.
> Cakupan: **60 halaman (54 admin + 6 ESS self-service)**.

---

## 1. PETA MODUL RECRUITMENT ORANHR (60 HALAMAN)

```
MODULE: Recruitment (admin)
├─ (mandiri) Recruitment Plan .......................... /RecruitmentPlanning.jsp
├─ (mandiri) Selection Process Calendar ................. /SelectionProcessCalendar.jsp
│
├─ Recruitment Budget
│  ├─ Recruitment Budget ............................... /RecruitmentBudget.jsp
│  └─ Recruitment Budget Summary
│     ├─ per Job Opportunity .......................... /RecruitmentBudgetJobOpportunity.jsp
│     └─ per Advertised Personnel Requisition .......... /RecruitmentBudgetAdvertisedPersonnelReq.jsp
│
├─ Personnel Requisition
│  ├─ Personnel Requisition ............................. /PersonnelRequisition.jsp
│  ├─ Personnel Requisition Approval .................... /PersonnelRequisitionToApprove.jsp
│  └─ Query - Recruitment Activity ..................... /RecruitmentActivity.jsp
│
├─ Job Opportunity Advertisement
│  ├─ Job Opportunity Advertisement .................... /JobOpportunity.jsp
│  ├─ ...per Personnel Requisition .................... /JOAdvertisedPersonnelReq.jsp
│  ├─ ...Recruitment Method Details .................... /JobOpportunityMethod.jsp
│  └─ Advertised Job Detail ............................. /JobDescription.jsp
│
├─ Receive Application Letter
│  ├─ Applicant Search Engine .......................... /ApplicantEngine.jsp
│  ├─ Applicant Search Engine Based on Job ............. /ApplicantEngineJob.jsp
│  ├─ Applicant Demography (chart) ..................... /ApplicantDemography.jsp
│  ├─ Applicant Information ............................ /Applicant.jsp
│  ├─ Applicant Applied Positions ...................... /ApplicantAllAppliedPos.jsp
│  ├─ Outdated Applicant ............................... /ApplicantOutdated.jsp
│  └─ Applicant Information Temporary (web staging) .... /ApplicantWeb.jsp
│
├─ Evaluation Job Candidate
│  ├─ Evaluation Process ............................... /EvaluationProcess.jsp
│  ├─ Evaluation Process per Candidate ................. /EvaluationProcessPerCandidate.jsp
│  ├─ Incomplete Evaluation Result per PR .............. /IncompleteEvaluation.jsp
│  ├─ Request Acknowledge .............................. /RequestAcknowledge.jsp
│  └─ Applicant Psikotest .............................. /ApplicantPsikotest.jsp
│
├─ Appoint Candidate
│  └─ Candidate Appointment ............................ /CandidateAppointment.jsp
│
├─ General Setting (15 master langsung)
│  ├─ Advertisement Media Type ......................... /AdMediaType.jsp
│  ├─ Employment Agency ................................ /EmpAgency.jsp
│  ├─ Standard Selection Process ....................... /StandardSelectionProcess.jsp
│  ├─ Recruitment Cost Item ............................. /RecruitmentCostItem.jsp
│  ├─ Recruitment Identity (penomoran dokumen) ......... /RecruitmentIdentity.jsp
│  ├─ Recruitment Method Description ................... /RecruitmentMethodDesc.jsp
│  ├─ External Evaluator ............................... /ApplicantEvaluator.jsp
│  ├─ Evaluation Category .............................. /ApplicantEvalCategory.jsp
│  ├─ Requirement Document List ........................ /RequiredDocument.jsp
│  ├─ Applicant Evaluation Scale ....................... /ApplicantEvaluationScale.jsp
│  ├─ Statement Template (bank pertanyaan) ............. /TemplateStatement.jsp
│  ├─ Selection Process Event Notifier ................. /SelectionNotifier.jsp
│  ├─ Skill ............................................. /Skill.jsp
│  ├─ Recruitment Scoring Indicator Result ............. /RecruitmentScoring.jsp
│  └─ SLA Group ......................................... /SlaGroup.jsp
│
└─ Psikotest Setting Template (subgrup, 14 master)
   ├─ Psikotest Rule ................................... /PsikotestRule.jsp
   ├─ DISC: Statement / Formula / Dictionary ............ /DISC*.jsp
   ├─ Papikostik: Statement / Formula / Dictionary /
   │  Scale Score ....................................... /Papikostik*.jsp
   ├─ WPT: Statement / Dictionary ....................... /WPT*.jsp
   ├─ Kraepelin: Statement / Dictionary ................. /Kraepelin*.jsp
   └─ MSDT: Statement / Dictionary ...................... /MSDT*.jsp

ESS (menu self-service karyawan internal):
├─ Job Opportunity (lowongan internal) .................. /MyJobOpportunity.jsp
├─ My Applied Job Opportunities ......................... /MyEmpAppliedJobOpportunity.jsp
├─ My Selection Process to be Performed ................. /MySelectionProcess.jsp
├─ My Personnel Requistion [sic] ........................ /MyPersonnelRequisition.jsp
├─ My Personnel Requisition Approval (approve di ESS) .. /MyPersonnelRequisitionToApprove.jsp
└─ My Recruitment Plan ................................ /MysRecruitmentPlanning.jsp
```

---

## 2. ANALISIS PER GRUP

### 2.1 Recruitment Plan (manpower planning)

Perencanaan kebutuhan SDM per **periode + posisi + company office**. Grid-nya adalah
"lempeng hitung" berpola kolom bertanda rumus — persis mindset spreadsheet SDM:

```
Initial Target Head Count (a) → Adjusted (b) → Total Target (c)=(a)+(b)
Initial Number of Employees (d)
+ Recruited/Transferred In (e) − Turnover/Transferred Out (f) → Resulted (g)=(d)+(e)−(f)
Number to Recruit (h) = (c)−(g)
↘ rekonsiliasi ke Personnel Requisition: requested / fulfilled / appointed / unfulfilled
```

- Field lain: `sequence_no`, `position_id/title`, `company_office`, `start_date`,
  `end_date`, `period_id` (basis period), `salary_budget` (total anggaran upah).
- Tombol toolbar generik + **Apply** (submit workflow). ESS punya "My Recruitment Plan".
- **Insight**: plan = dasar justifikasi PR; angka rekrut (h) vs realisasi PR direkonsiliasi otomatis.

### 2.2 Recruitment Budget

- `RecruitmentBudget`: per periode — `total_budget`, `total_adjust` (penyesuaian),
  `total_adjust_budget`, `total_used`, `total_unused`, `currency_code`.
- Summary **per Job Opportunity**: per `job_opportunity_ref_no` + `cost_item` + `cost`.
- Summary **per Advertised Personnel Requisition**: turunan per PR di dalam JO
  (position, work location, cost item, cost) — pelacakan biaya rekrutmen dua level.
- **Insight**: budget = agregat; pemakaian (used) dihitung dari metode advertensi
  (cost per method per JO/PR) — lihat 2.4.

### 2.3 Personnel Requisition (PR — permintaan karyawan)

**Inti modul**. Field model hasil ekstraksi store (sample live: PR No 68, 67 MII):

| Field | Contoh nilai | Catatan |
|---|---|---|
| `personnel_req_no` | "68" | nomor urut per company (RecruitmentIdentity) |
| `request_date` | 2026-08-04 | |
| `requested_by` / `requested_name` | MII000001 / Dita Tri Avista | employee pengaju |
| `position_id` / `position_title` | J006 / ASSISTANT ACCOUNTING MGR… | master posisi |
| `job_id` / `job_title` | J006 / … | master job |
| `company_office` | BDG | office penempatan |
| `org_id` / `org_name` | 001 / CEO | unit organisasi |
| `required_no` | 2 | jumlah yang diminta |
| `preferred_source` | (kosong) | preferensi sumber rekrutmen |
| `state` | **"Approved"** | status workflow |
| `earliest_date` / `latest_date` | 2026-08-04 / 2026-09-30 | jendela waktu kebutuhan |
| `recruitment_officer_id/name` | MII000001 | petugas rekrutmen (owner proses) |
| `reason`, `misc_spec`, `additional_qualification` | teks bebas | justifikasi & kualifikasi tambahan |
| `employee_type` | **"Permanent"** | jenis pekerjaan yang diminta |
| `temporary_assign` | null | penugasan sementara? |
| `period_id` | "2026" | ikut periode HR |
| `salary_budget` | null | anggaran upah |
| `auto_jop` | false | **auto-buat Job Opportunity saat PR disetujui** |

- Tombol: New/Duplicate/Edit/Delete/**Apply** (submit approval)/Save/Cancel.
- `PersonnelRequisitionToApprove` = inbox approval PR (kolom identik + state).
- **Workflow approval PR** memakai mesin approval oranHR (lihat §4).
- `RecruitmentActivity` = query funnel rekrutmen (filter: job, company office,
  from–to date). Kolom: `Applied Applicant → Candidate → Processed Candidate →
  Interview HR → Interview User → Psikotes → Offering Salary → Medical Cek Up →
  Hired → Closed Personnel Requisition` — **metrik funnel bertingkat**.

### 2.4 Job Opportunity Advertisement (JO — iklan lowongan)

- `JobOpportunity` (sample live: Ref 10, 11 MII): `job_opportunity_ref_no`,
  `prepared_by/name`, `date_prepared`, **`state`** (teramati: *"Active", "Obsolete"*),
  `date_posted`, **`content`** (isi iklan rich-text), `contact` (CP umum),
  `last_date_accept` (batas terima lamaran), `period_id` (teramati "2025_B" —
  periode bisa sub-periode!), `start_date`, `end_date`.
- **JO Advertised per PR** (a.k.a. *job opening slot*): satu JO memuat ≥1 slot posisi
  dari PR berbeda: `personnel_req_no`, `state` (teramati **"Fulfilled"**), `required_no`,
  `position_id`, **`pos_title_to_show`** (judul yang dipajang), `work_location`,
  `estimated_salary` / `min` / `max` + `currency_code` + `duration_unit`
  (per bulan/tahun), `job_desc_summ`, `job_spec_summ`, `contact_person`.
- **Job Opportunity Method Details**: per JO — metode rekrutmen yang dipakai
  (teramati dari master + budget summary): method (`Internal Job Posting`,
  `Matching Recommendation` [Internal]; eksternal: advertensi via media/agency),
  ad media type, employment agency, **cost item + cost** (→ memakai budget).
- `JobDescription` = tampilan "Advertised Job Detail" yang dilihat pelamar/karyawan.
- **Insight**: JO = wadah iklan; slot = posisi nyata dari PR; method = kanal + biaya.

### 2.5 Receive Application Letter (pengelolaan pelamar)

- `Applicant` (sample live: applicant 1 "Bondan", 10 "Rizki Ridho" — status
  **"Employed"**, data lintas company SPS terlihat karena demo shared-db):
  - Identitas: `applicant_id`, `first/middle/last_name`, `app_display_name`,
    `app_pic_id` (foto), `state` (**Employed**; sistem lengkap: Active/Rejected/
    Outdated/Employed…), **`blacklist`**, **`suspend`**, **`password` +
    `activation_ref`** (akun portal pelamar!), `date_applied`, `date_available`,
    `expected_salary` + `currency` + `duration_unit` (per bulan/tahun),
    **`keep_on_file_duration` = 12** (bulan — simpan di talent pool), `note`.
  - Sumber: `applicant_source`, `ad_media_type_seq_no` (koran/portal),
    `emp_agency_seq_no`, `institution_no` (kampus), `referral_company` /
    `referral_employee` (referensi karyawan!).
  - PII lengkap: alamat, kota, kode pos, negara, `insurance_id`, tempat/tgl lahir,
    kewarganegaraan, agama, gender, status kawin, gol. darah, punya anak.
- `ApplicantAllAppliedPos` — satu pelamar bisa melamar banyak posisi (history).
- `ApplicantOutdated` — pelamar yang melewati keep-on-file duration (arsip otomatis).
- `ApplicantWeb` — **staging pelamar dari web** (form publik → sementara →
  "Upload Applicant" ke data resmi; grid memuat semua field PII + posisi dilamar).
- `ApplicantEngine` — **query builder talent pool**: Parameter (field) × Operand
  (=, >, <, LIKE, IN, BETWEEN…) × Value, multi-kondisi (Add/Undo/Clear), hasil
  "Find Applicant!" + "Print Applicant!", opsi *Use Previous Result* (chaining),
  *Based on Date*. Dimensi yang bisa difilter (dari kolom grid): usia, gender,
  status kawin, kewarganegaraan, kota, **jenjang & bidang pendidikan, IPK,
  lisensi/sertifikat**, posisi yang dilamar, grade/level posisi, **bidang &
  lama pengalaman kerja**, ekspektasi gaji.
- `ApplicantEngineJob` — sama tapi scope per job + tombol **"Transfer To Job
  Candidate"** (promosikan pelamar → kandidat seleksi).
- `ApplicantDemography` — analisa demografi pelamar (tombol **Display Chart**).
- **Insight**: ini *talent pool* sesungguhnya — database pelamar persisten dengan
  pencarian multi-dimensi, retensi (keep on file), blacklist, dan portal web.

### 2.6 Evaluation Job Candidate (proses seleksi)

- **Standard Selection Process** (master langkah seleksi per company; sample live):
  `std_selection_name` ("Psikotes", "Interview HR", "Interview User", "Offering
  Salary", "Medical Check Up"…), `mandatory`, **`result_type` ("Quantitative" /
  "Qualitative")**, `apply_internal`, `apply_external`, `based_on_pr`,
  `unlimited_candidate`, `need_acknowledgement`, `min_result_pass` (nilai minimal
  lulus), **`process_order`** (urutan), **`sla_group_no`** (SLA per tahap),
  `template_code` (template surat/attachment), `internal_psikotest` (flag tes online).
- `EvaluationProcess` — penjadwalan proses seleksi per PR (plan date/due date/due
  time, performed by, plan from–to).
- `EvaluationProcessPerCandidate` (sample live: kandidat 104 "Prisla Novia",
  42 "Mahendra" di PR 68): `candidate_id/name`, **`recruitment_source`
  ("External"/"Internal")**, **`state` ("Nominated")**, `pos_level_no`
  ("Assistant Manager"), dst.
- `IncompleteEvaluation` — monitor tahap yang belum tuntas per PR
  (continue process, note, selection process status).
- `RequestAcknowledge` — pengakuan/permintaan jadwal oleh kandidat/peserta.
- `ApplicantPsikotest` — hasil tes psikologi per pelamar per lamaran:
  `psychotest_status`, `generate_date`, `valid_from/until` + waktu, hasil per
  instrumen **DISC / Papikostik / WPT / Kraepelin / MSDT**, `updated_by`.
- `MySelectionProcess` (ESS) — langkah seleksi yang harus dijalani user ESS
  (kalau kandidat internal): plan/actual date-time, `result_type`,
  `min_result_pass`, `state`, skor + komentar.

### 2.7 Appoint Candidate (pengangkatan)

`CandidateAppointment` — kolom grid (data demo kosong, struktur lengkap):
`personnel_req_no`, `letter_no`, `request_status`, `candidate_id/name`,
`recruitment_source`, `candidate_status`, `applicant_status`,
**`appointment_date`, `appointment_letter_no`** (surat), lalu data penempatan
hasil rekrutmen: **`new_assign_company`, `new_assign_employee` (=Employee ID
baru!), `person_id`, `user_id`, `role_group_id`** (pembuatan user + role!),
`position_id/title`, `primary_position`, `company_office`, `work_location`,
**`new_supervisor_company/employee/name`**.

**Insight penting**: appointment = titik serah-terima rekrutmen → HR Base:
membuat Employee baru + Employee (Person) + **User + Role Group** sekaligus,
dengan surat pengangkatan bernomor. Di RekanKerja, titik ini harus disambungkan
ke **onboarding wizard** yang sudah ada.

### 2.8 General Setting (15 master)

| Master | Isi (sample live) |
|---|---|
| Ad Media Type | Newspaper, Portal News, … |
| Employment Agency | nama + alamat + note (vendor) |
| Standard Selection Process | lihat §2.6 |
| Recruitment Cost Item | "Advertisment", "General (non-budget)", … |
| Recruitment Identity | penomoran dokumen per company (Next Value) |
| Recruitment Method Desc | Internal Job Posting (Internal), Matching Recommendation (Internal), … |
| External Evaluator | evaluator luar: alamat, kontak, template package |
| Evaluation Category | kategori penilaian |
| Requirement Document | **CV (mandatory), KTP (mandatory)**, … |
| Applicant Evaluation Scale | Low(1), … (skala + ranking) |
| Statement Template | teks pertanyaan + kriteria rating + order |
| Selection Process Event Notifier | event → notifier (email) |
| Skill | "Bahasa Inggris (menulis)", "Others" + kriteria |
| Recruitment Scoring Indicator | result type scoring |
| SLA Group | "Interview" 30 hari, … |

### 2.9 Psikotest Setting Template (engine tes online)

- `PsikotestRule` (sample live): instrumen **DISC** (durasi 420 dtk, allow jump,
  random question, **capture kamera sebelum & sesudah tes**), **Papikostik**
  (1800 dtk, indexing question), WPT, Kraepelin, MSDT.
- Per instrumen: bank Statement (soal), Formula (skoring), Dictionary (kamus
  interpretasi) — total 14 halaman master.
- **Insight**: oranHR punya engine uji psikologi ONLINE lengkap dengan proctoring
  kamera. Ini fitur sangat berat — kandidat "nice-to-have" jangka panjang, bukan MVP.

### 2.10 ESS self-service rekrutmen

- `MyJobOpportunity` — lowongan internal: opportunity, requisition no, **openings**,
  latest date to apply, posisi, work location, deskripsi & spesifikasi, CP.
- `MyEmpAppliedJobOpportunity` — riwayat lamaran internal + status kandidat.
- `MySelectionProcess` — tahapan seleksi milik sendiri (lihat §2.6).
- `MyPersonnelRequisition` + `MyPersonnelRequisitionToApprove` — pengajuan PR oleh
  manager via ESS + approval PR dari ESS (tanpa buki aplikasi admin).
- `MysRecruitmentPlanning` — rencana rekrutmen milik sendiri.

---

## 3. DATA MODEL INFERENSI (reverse-engineering dari store ExtJS)

> Konvensi oranHR: PK `golid` + `golversion` (optimistic lock). Nama kolom snake_case.
> Di bawah ini diterjemahkan ke konsep entitas (nama RekanKerja disarankan di §7).

```
RecruitmentPlan        (company, period, seqNo, position, office, targetA, adjustB,
                        empD, inE, outF, salaryBudget, basePeriod)
RecruitmentBudget      (company, period, total, adjust, used, currency)
PersonnelRequisition   (prNo, requestDate, requestedBy→Employee, position, job,
                        office, org, requiredNo, preferredSource, state,
                        earliestDate, latestDate, recruitmentOfficer→Employee,
                        reason, miscSpec, additionalQualification, employeeType,
                        period, salaryBudget, autoJop)
JobOpportunity         (refNo, preparedBy→Employee, datePrepared, state, datePosted,
                        content, contact, lastAcceptDate, period)
JobOpening/JoAdvPr     (jo→refNo, pr→prNo, state, requiredNo, position,
                        titleToShow, workLocation, estSalary min/max + currency +
                        perUnit, jobDescSumm, jobSpecSumm, contactPerson)
JoMethodDetail         (jo, method, adMediaType, empAgency, costItem, cost, datePosted)
Applicant              (applicantNo, nama 3 bagian + displayName, foto, state,
                        blacklist, suspend, password+activationRef, dateApplied,
                        dateAvailable, expectedSalary, keepOnFileMonths, note,
                        source: adMedia/agency/institution/referral, PII lengkap,
                        pendidikan[], pengalaman[], lisensi[])
ApplicantApplication   (applicant, jo/pr, position, dateApplied)   → multi-lamar
JobCandidate           (candidateNo, applicant | employeeInternal, pr, source
                        Internal|External, state Nominated|…, nominatedBy)
SelectionProcessMaster (name, mandatory, resultType Quant|Qual, applyInternal,
                        applyExternal, basedOnPr, unlimitedCandidate,
                        needAcknowledgement, minResultPass, processOrder,
                        slaGroup, letterTemplate, internalPsikotest)
CandidateSelectionStep (candidate, pr, selectionProcess, seqNo, planDate,
                        dueDate, dueTime, performedBy, actualDate, actualTime,
                        state, score, result, comment, continueProcess, letterNo,
                        location)
PsikotestResult        (applicant, appliedJob, instrument, status, generateDate,
                        validFrom/Until, hasil DISC/Papikostik/WPT/Kraepelin/MSDT)
CandidateAppointment   (appointmentNo, letterNo, pr, candidate, appointmentDate,
                        appointmentLetterNo, newEmployee→Employee, userId,
                        roleGroup, position, office, workLocation, supervisor)
+ 15 master §2.8 + 14 master psikotest §2.9
```

**Enumerasi terverifikasi dari data live**:
`PR.state = Approved` (+ Fulfilled teramati di slot JO) · `JO.state = Active / Obsolete` ·
`slot.state = Fulfilled` · `Applicant.state = Employed` (+ blacklist/suspend bool) ·
`candidate.state = Nominated` · `recruitmentSource = Internal / External` ·
`resultType = Quantitative / Qualitative` · `employeeType = Permanent` ·
`currency = Rupiah` · period dapat berupa sub-periode ("2025_B").

---

## 4. WORKFLOW & STATUS MACHINE

```
RecruitmentPlan (Apply) ──┐
                           ▼
PersonnelRequisition (New → Apply → [Approval inbox] → Approved)
   │  auto_jop = true ─────────────┐
   │                               ▼
   │              JobOpportunity (New → Posted → [Obsolete])
   │                   └─ slot PR (requiredNo, salary range, job desc)
   │                        └─ JoMethodDetail (kanal + cost → budget.used)
   ▼
Penerimaan lamaran ── Applicant (+ ApplicantApplication per lamaran)
   │    sumber: web staging (ApplicantWeb → Upload), ESS internal, manual, agency,
   │            advertensi, referral karyawan
   │    keep-on-file 12 bln → ApplicantOutdated ; blacklist/suspend khusus
   ▼
Transfer To Job Candidate ── JobCandidate (per PR; source Internal|External; Nominated)
   ▼
SelectionProcess chain (urut process_order, SLA group, per kandidat):
   Interview HR → Psikotes (online/manual) → Interview User → Offering Salary
   → Medical Check Up → (tahapan dapat dikustomisasi per company)
   tiap tahap: Plan → Due → [Acknowledgement] → Performed → hasil (skor/qual)
   → Pass (≥ minResultPass) / Fail → Continue Process / berhenti
   ▼
CandidateAppointment (surat + tanggal) ── create Employee + User + Role
   │  + assignment posisi/office/work location/supervisor
   ▼
PR Fulfilled → RecruitmentPlan rekonsiliasi (fulfilled/appointed/unfulfilled)
Applicant.state = Employed ; lamaran lain → Send Rejection Date (surat penolakan)
```

- **Approval**: PR melewati mesin approval oranHR (inbox khusus PR + ESS approval).
- **SLA**: per tahap seleksi punya `sla_days` (mis. Interview 30 hari) — pantau overdue.
- **Notifikasi**: SelectionNotifier memicu email per event (terhubung email config).
- **Penomoran dokumen**: RecruitmentIdentity (PR No, JO Ref No, Letter No) per company.

---

## 5. INTEGRASI LINTAS MODUL

| Tujuan | Bentuk integrasi oranHR |
|---|---|
| HR Base | PR memakai position/job/org/office master; appointment membuat **Employee + Person + User + Role Group** sekaligus; supervisor dari master employee |
| Approval engine | PR approval berjenjang + ESS approval inbox |
| Letter/surat | surat pengangkatan (appointment letter no), surat penolakan, surat undangan seleksi (template per tahap) |
| Email | notifier per event seleksi; konfirmasi pelamar |
| Payroll | `salary_budget` di plan & PR; `expected_salary` pelamar; offering salary |
| ESS | lowongan internal, apply, my selection process, PR & approval manager |
| Web publik | form lamaran publik → staging (ApplicantWeb) → upload ke Applicant |
| Report | katalog Report Collection + funnel Recruitment Activity + demography |

---

## 6. GAP ANALYSIS vs RekanKerja SEKARANG

| Aspek | oranHR | RekanKerja saat ini | Status |
|---|---|---|---|
| Modul recruitment | 60 halaman penuh | — | **GAP TOTAL** |
| Permintaan karyawan (PR) + approval | PR + inbox + ESS approval | engine approval parametrik (ApprovalStructure) + PA sudah ada | **MODAL KUAT** (engine-nya tinggal pakai) |
| Manpower planning | Recruitment Plan berpola rumus (a)-(h) | — (HR Reports ada headcount stats) | GAP TOTAL (versi oranHR) |
| Anggaran rekrutmen | budget + realisasi 2 level | — | GAP TOTAL |
| Iklan lowongan (JO) + slot per PR + metode | lengkap | — | GAP TOTAL |
| Talent pool pelamar + query builder | ApplicantEngine multi-dimensi | — | GAP TOTAL |
| Portal lamaran web | ApplicantWeb staging + password pelamar | — | GAP TOTAL |
| Dokumen pelamar (CV/KTP) | RequiredDocument mandatory checklist | EmployeeDocument + MIME whitelist + attachments | **MODAL KUAT** (pattern reuse) |
| Proses seleksi kustom + SLA | Standard Selection + SLA group | — | GAP TOTAL |
| Psikotest online + proctoring | 5 instrumen + statement/formula/dictionary | — | GAP TOTAL (opsional — jangan dibuat dulu) |
| Pengangkatan → Employee | create Employee+User+Role otomatis | **Onboarding wizard + checklist sudah ada** | **MODAL SANGAT KUAT** |
| Surat (pengangkatan/penolakan/undangan) | template per tahap | Letter templates + engine PDF | **MODAL KUAT** |
| ESS karyawan | 6 halaman rekrutmen ESS | portal ESS + role ESS baru | **MODAL KUAT** (tinggal view baru) |
| Notifikasi email per event | SelectionNotifier | notifications + email config + template | **MODAL KUAT** |
| Funnel & demografi | Recruitment Activity + Demography chart | HR Reports engine + charts | MODAL (engine laporan ada) |
| Dwibahasa | ID only | ID/EN penuh | REKAN KERJA UNGGUL |
| PII & enkripsi | plaintext di demo | field-crypto + masking + vault | REKAN KERJA UNGGUL (harus dipertahankan) |

---

## 7. REKOMENDASI DESAIN UNTUK RekanKerja

### 7.1 Penempatan & navigasi
- Modul baru **`recruitment`** (module switcher: Human Resource · Payroll · … · **Recruitment**), route `?s=recruitment` dengan view: `plan`, `budget`, `pr` (list), `pr-approval`, `openings`, `applicants`, `talent-pool` (search), `candidates`, `selection`, `appointments`, `reports` (funnel), `settings` (master).
- ESS: menu baru "Karier Internal" — Lowongan, Lamaran Saya, Proses Seleksi Saya; manager: PR & approval.
- Seragamkan pola UI existing: list + quick sheet + detail + dialog, advance search `&`, sticky footer, dwibahasa ID/EN sejak baris pertama.

### 7.2 Skema Prisma (proposal — konvensi proyek: cuid, index, tanpa list primitive)

```prisma
model PersonnelRequisition {
  id            String   @id @default(cuid())
  prNo          String   @unique                 // PR-2026-0001 (RecruitmentIdentity → ikuti pola docNo modul lain: prefix-tahun-seq)
  requestDate   DateTime @default(now())
  requestedById String                            // Employee pengaju
  positionId    String?                           // Position master
  jobId         String?
  orgUnitId     String?
  companyOfficeId String?
  requiredNo    Int      @default(1)
  employmentStatus String  @default("Permanent") // Permanent|Contract|Probation|Outsourcing (selaras Employee)
  preferredSource   String?                       // Internal|External|Any
  earliestDate  DateTime?
  latestDate    DateTime?
  recruitmentOfficerId String?                    // Employee owner proses
  reason        String?
  miscSpec      String?
  additionalQualification String?
  salaryBudget  Decimal?                          // opsional; kalau dipakai → ikut gating vault uang
  autoPostOpening Boolean @default(false)        // auto_jop
  status        String   @default("Draft")        // Draft|Submitted|Approved|Rejected|Fulfilled|Closed|Cancelled
  requestedBy   Employee @relation("PrRequester", fields:[requestedById], references:[id])
  position      Position?
  orgUnit       OrgUnit?
  openings      JobOpening[]
  candidates    JobCandidate[]
  @@index([status, requestDate])
}

model JobOpportunity {
  id            String   @id @default(cuid())
  refNo         String   @unique                 // JO-2026-0001
  preparedById  String
  datePrepared  DateTime @default(now())
  status        String   @default("Draft")        // Draft|Posted|Closed|Obsolete
  datePosted    DateTime?
  content       String?                            // isi iklan (rich text)
  contactPerson String?
  lastAcceptDate DateTime?
  openings      JobOpening[]
  methods       JobOpeningMethod[]
  @@index([status])
}

model JobOpening {                                  // slot PR di dalam JO
  id            String @id @default(cuid())
  jobOpportunityId String
  prId          String
  titleToShow   String
  workLocationId String?
  salaryMin     Decimal?
  salaryMax     Decimal?
  currency      String  @default("IDR")
  salaryUnit    String  @default("Monthly")
  jobDescSummary String?
  jobSpecSummary String?
  status        String  @default("Open")           // Open|Fulfilled|Closed
  jobOpportunity JobOpportunity @relation(fields:[jobOpportunityId], references:[id])
  pr            PersonnelRequisition @relation(fields:[prId], references:[id])
  applications  ApplicantApplication[]
  @@unique([jobOpportunityId, prId])
}

model JobOpeningMethod {                            // kanal + biaya per JO
  id                String @id @default(cuid())
  jobOpportunityId String
  methodId          String                          // RecruitmentMethod master
  adMediaTypeId     String?
  agencyId          String?                         // EmploymentAgency
  costItemId        String?                         // RecruitmentCostItem
  plannedCost       Decimal?
  actualCost        Decimal?
  datePosted        DateTime?
  jobOpportunity    JobOpportunity @relation(fields:[jobOpportunityId], references:[id])
}

model Applicant {
  id              String  @id @default(cuid())
  applicantNo     String  @unique                  // APP-26-00001
  firstName       String
  middleName      String?
  lastName        String?
  displayName     String?
  photoUrl        String?
  status          String  @default("Active")      // Active|Rejected|Outdated|Employed
  blacklist       Boolean @default(false)
  blacklistNote   String?
  suspend         Boolean @default(false)
  dateApplied     DateTime @default(now())
  dateAvailable   DateTime?
  expectedSalary  Decimal?                        // dienkripsi field-crypto (kompensasi)
  currency        String  @default("IDR")
  salaryUnit      String  @default("Monthly")
  keepOnFileMonths Int     @default(12)
  source          String?                          // Advertisement|Agency|Referral|Web|Internal|Other
  adMediaTypeId   String?
  agencyId        String?
  institutionName String?
  referralEmployeeId String?                       // Employee perujuk
  // PII — encrypt via field-crypto (pattern Employee): address/city/phone/email/
  // tempat & tgl lahir; consent UU PDP + retention policy wajib (lihat §9 risiko)
  email           String?
  phone           String?
  address         String?
  city             String?
  placeOfBirth    String?
  birthDate       DateTime?
  gender          String?
  maritalStatus   String?
  education       ApplicantEducation[]
  experiences     ApplicantExperience[]
  skills          ApplicantSkill[]
  documents       ApplicantDocument[]
  applications    ApplicantApplication[]
  @@index([status]) @@index([keepOnFileUntil])
}

model ApplicantEducation { id, applicantId, level, field, institution, graduationYear, gpa }
model ApplicantExperience { id, applicantId, company, position, field, startYear, endYear, months }
model ApplicantSkill { id, applicantId, skillId (Skill master), level }
model ApplicantDocument { id, applicantId, requiredDocumentId?, title, fileName, storagePath, mimeType } // pattern EmployeeDocument

model ApplicantApplication {                        // satu pelamar → banyak lamaran
  id            String @id @default(cuid())
  applicantId   String
  jobOpeningId  String
  dateApplied   DateTime @default(now())
  status        String  @default("Received")       // Received|Screening|Rejected|Hired
  rejectionLetterNo String?
  applicant     Applicant @relation(fields:[applicantId], references:[id])
  jobOpening    JobOpening @relation(fields:[jobOpeningId], references:[id])
  @@unique([applicantId, jobOpeningId])
}

model JobCandidate {                                // pelamar/employee → kandidat PR
  id            String @id @default(cuid())
  prId          String
  applicantId   String?                             // eksternal
  employeeId    String?                             // internal (mutasi/promosi)
  source        String  @default("External")        // Internal|External
  status        String  @default("Nominated")      // Nominated|InProcess|Passed|Failed|Withdrawn|Appointed
  nominatedById String
  nominatedAt   DateTime @default(now())
  pr            PersonnelRequisition @relation(fields:[prId], references:[id])
  selectionSteps CandidateSelectionStep[]
  @@unique([prId, applicantId])  // + partial utk employeeId
}

model SelectionProcess {                            // master tahap (std selection)
  id              String @id @default(cuid())
  name            String
  description     String?
  mandatory       Boolean @default(true)
  resultType      String  @default("Qualitative")  // Quantitative|Qualitative
  appliesInternal Boolean @default(true)
  appliesExternal Boolean @default(true)
  minResultPass   Float?
  processOrder    Int     @default(1)
  slaDays         Int?                              // SLA per tahap
  letterTemplateId String?                         // surat undangan/hasil
  internalTest    Boolean @default(false)          // marker psikotest (fase lanjut)
  @@index([processOrder])
}

model CandidateSelectionStep {
  id                String @id @default(cuid())
  candidateId       String
  selectionProcessId String
  seqNo             Int
  planDate          DateTime?
  dueDate           DateTime?
  performedById     String?                        // Employee evaluator
  performedAt       DateTime?
  status            String @default("Planned")    // Planned|Acknowledged|Performed|Passed|Failed|Cancelled
  score             Float?
  result            String?                        // kualitatif / indeks
  comment           String?
  letterNo          String?
  continueProcess   Boolean @default(true)
  candidate         JobCandidate @relation(fields:[candidateId], references:[id])
  @@unique([candidateId, selectionProcessId, seqNo])
}

model CandidateAppointment {
  id                  String @id @default(cuid())
  appointmentNo       String @unique              // AP-2026-0001
  prId                String
  candidateId         String
  appointmentDate     DateTime
  letterNo            String?                      // surat pengangkatan (letter engine)
  employeeId          String?                      // Employee hasil create (via onboarding)
  status              String @default("Prepared")  // Prepared|Appointed|Cancelled
  candidate           JobCandidate @relation(fields:[candidateId], references:[id])
  @@index([prId])
}

// Masters (satu file master umum modul):
model RecruitmentMethod   { id, name, internalExternal, description }
model AdMediaType         { id, name }                             // Koran, Portal, LinkedIn…
model EmploymentAgency    { id, name, address, note }
model RecruitmentCostItem { id, name, description }
model Skill               { id, name, description, criteria }
model RequiredDocument    { id, title, fileType, mandatory }
model EvaluationCategory  { id, name, description }
model EvaluationScale     { id, name, ranking }
model StatementTemplate   { id, questionText, categoryId, ratingCriteria, orderNo }
model SlaGroup            { id, name, days }
```

**Catatan skema**: penomoran dokumen (`prNo`, `refNo`, `appointmentNo`, `letterNo`)
mengikuti pola modul lain (prefix-tahun-seq, contoh `PR-2026-0001`, `PA-2022-0101`)
— **tidak perlu** replikasi RecruitmentIdentity per company (RekanKerja satu
registry per tenant). `RecruitmentPlan` & budget baru masuk fase lanjut (lihat §8).

### 7.3 API (route handler selaras konvensi `/api/rekankerja/...`)

```
GET/POST        /api/rekankerja/recruitment/pr              (list server-side + adv search &)
GET/PATCH/DELETE /api/rekankerja/recruitment/pr?id=          (PATCH = data; apply via action)
POST            /api/rekankerja/recruitment/pr/apply          (submit approval → ApprovalChain)
GET/POST/PATCH  /api/rekankerja/recruitment/openings          (JO + slot + method + cost)
GET/POST/PATCH  /api/rekankerja/recruitment/applicants        (talent pool + filter multi-dimensi)
GET/POST/PATCH  /api/rekankerja/recruitment/applicants/education|experience|skill|documents
POST            /api/rekankerja/recruitment/candidates         (transfer applicant/employee → kandidat PR)
GET/PATCH       /api/rekankerja/recruitment/selection          (steps per kandidat; hasil)
POST            /api/rekankerja/recruitment/appointments       (appoint → surat + onboarding)
GET            /api/rekankerja/recruitment/reports/funnel      (metrik funnel per rentang)
GET/POST       /api/rekankerja/recruitment/masters             (15 master CRUD ringan)
ESS: GET /api/rekankerja/ess/job-openings · POST ess/apply · GET ess/my-applications ·
     GET ess/my-selection · POST/PATCH ess/pr (pengajuan & approval manager)
```
Semua endpoint: guard sesi + scope data per tenant, `requireMutator()` untuk tulis,
ActivityLog, notifikasi, dan PII masking sesuai role (pola M-9). Gaji/gaji ekspektasi
mengikuti gating vault uang.

### 7.4 Integrasi kunci
1. **Approval PR** → `ApprovalStructure` parametrik baru scope `recruitment/pr`
   (dimensi: posisi/grade/jumlah/anggaran — dimensi sudah tersedia dari snapshot).
2. **Appointment → Employee** → tombol "Proses Onboarding" membuka **wizard
   onboarding existing ter-prefill** (nama, posisi, office, work location,
   supervisor, employmentStatus dari PR) — bukan duplikasi wizard.
3. **Surat** → letter engine: template Surat Pengangkatan / Penolakan / Undangan
   Seleksi (variabel kandidat + PR + perusahaan).
4. **Notifikasi + email** → notifications + email templates per event
   (lamaran diterima, undangan seleksi, hasil, offer).
5. **Announcements** (opsional) → JO Posted otomatis bisa di-broadcast.
6. **ESS** → view baru di portal ESS (role ESS sudah ada).

### 7.5 Hal yang TIDAK diadopsi (disengaja)
- **Engine psikotest online** (5 instrumen + statement/formula/dictionary +
  proctoring kamera) — sangat berat, niche, dan risiko privasi tinggi. Di fase
  lanjut cukup catat HASIL tes manual (upload laporan) — bila suatu saat mau
  online, buat fase tersendiri.
- **Password pelamar / portal self-service pelamar** (oranHR field password +
  activation) — tunda; fase awal pelamar tidak login. Portal apply publik
  cukup form anonim tanpa akun.
- **Multi-company lintas tenant** — RekanKerja schema-per-tenant; companyId
  internal tetap didukung via relasi Company yang sudah ada.
- **RecruitmentIdentity per company** — digantikan pola penomoran docNo proyek.

---

## 8. ROADMAP PENGEMBANGAN (DEVELOPMENT PLAN)

> Estimasi effort: S ≤ 1 hari · M 2–4 hari · L 1–2 minggu · XL > 2 minggu (efektif, satu agent).
> Tiap fase: commit + push + E2E browser + lint bersih (protokol proyek).

### FASE P1 — Fondasi: Permintaan Karyawan (MVP inti) — effort **L**
**Scope**
1. Skema Prisma (prisma/schema-tenant.prisma): `PersonnelRequisition` + masters
   minimal (`RecruitmentMethod`, `Skill`, `RequiredDocument`) + db push + seed demo.
2. UI modul `recruitment` shell + view **PR list** (server-side pagination, adv
   search `&`, filter status, tab Draft/Submitted/Approved/Fulfilled) + dialog
   New/Edit PR (semua field §2.3) + duplikat + nomor otomatis PR-2026-0001.
3. **Approval PR** via ApprovalStructure scope `recruitment/pr` + inbox approval
   (view `pr-approval`) + ESS approval manager (My Personnel Requisition Approval).
4. Guard menu + role + ActivityLog + notifikasi in-app + dwibahasa penuh.
**Acceptance**: buat PR → apply → approve (2 lapis) → status Approved; E2E browser
lewat jalur penuh; lint 0 error; advance search bekerja.
**Dependensi**: —. **Risiko**: kalibrasi dimensi approval (mitigasi: default 1 lapis).

### FASE P2 — Lowongan & Iklan + Pelamar (talent pool) — effort **L**
**Scope**
1. `JobOpportunity` + `JobOpening` (slot per PR, `autoPostOpening` saat PR
   approved) + `JobOpeningMethod` (kanal + biaya terencana) — UI view `openings`
   (master-detail JO → slot → method).
2. `Applicant` penuh (+ education/experience/skill) + `ApplicantApplication`
   (multi-lamaran) + `ApplicantDocument` (CV/KTP — checklist `RequiredDocument`
   mandatory) + upload file (pattern EmployeeDocument: MIME whitelist + magic number).
3. **Talent pool**: view `applicants` + query builder sederhana (filter gabungan:
   pendidikan, bidang, pengalaman, ekspektasi gaji, umur, status) — padanan
   ApplicantEngine versi rasional (bukan SQL builder bebas).
4. Auto **outdated** (keep-on-file berjalan oleh scheduler 6 jam yang sudah ada)
   + blacklist/suspend (dengan catatan alasan — kepatuhan).
**Acceptance**: PR approved → JO auto-post → slot tampil; input pelamar + CV;
pelamar melamar 2 slot; talent-pool filter kombinasi menemukan pelamar; pelamar
kadaluarsa otomatis muncul di filter Outdated.
**Dependensi**: P1. **Risiko**: volume PII (mitigasi: enkripsi field + masking + retensi).

### FASE P3 — Kandidat & Proses Seleksi — effort **L**
**Scope**
1. `JobCandidate` (transfer dari applicant / employee internal → kandidat PR;
   source Internal|External).
2. `SelectionProcess` master (katalog tahap + urutan + SLA + minResultPass +
   template surat) + seeding standar: Interview HR → Psikotes (manual) → Interview
   User → Offering → Medical.
3. `CandidateSelectionStep`: penjadwalan (plan/due), pelaksanaan (performed,
   evaluator), hasil Quantitative/Qualitative, pass/fail + continueProcess,
   surat undangan via letter engine, monitor **Incomplete Evaluation** (view
   `selection` + badge PR).
4. `MySelectionProcess` ESS untuk kandidat internal.
**Acceptance**: kandidat melewati 3 tahap, tahap 2 fail → proses berhenti &
status Failed; lulus semua → status Passed; SLA overdue tampil; surat undangan
terbit PDF.
**Dependensi**: P2. **Risiko**: fleksibilitas tahap per PR (mitigasi: salin
katalog default per PR, boleh edit).

### FASE P4 — Appointment & Onboarding Integration — effort **M**
**Scope**
1. `CandidateAppointment`: dialog pengangkatan (tanggal, penempatan: posisi/
   office/work location/supervisor — semua dari PR, boleh override).
2. **Surat pengangkatan** (letter engine, template dwibahasa) + surat penolakan
   otomatis ke pelamar lain di PR yang sama (batch) + nomor AP-2026-0001.
3. Tombol **"Lanjutkan ke Onboarding"** → wizard onboarding existing ter-prefill
   (nama, posisi, office, supervisor, status) → Employee dibuat → backlink
   `employeeId` di appointment + `Applicant.status = Employed` + `PR → Fulfilled`.
4. **Funnel report** (`reports`): Applied → Candidate → per tahap → Hired per
   rentang tanggal (padanan Recruitment Activity) — pakai engine chart existing.
**Acceptance**: appoint → surat PDF → onboarding → Employee muncul di Direktori
dengan assignment benar; PR otomatis Fulfilled; funnel akurat.
**Dependensi**: P3. **Risiko**: sinkronisasi ganda wizard (mitigasi: wizard
dipanggil mode prefill-readonly untuk field rekrutmen).

### FASE P5 — ESS & Portal Publik + Anggaran (penyempurnaan) — effort **M–L**
**Scope**
1. **ESS internal job posting**: `MyJobOpportunity` (lowongan aktif + batas
   apply) + apply internal + `MyEmpAppliedJobOpportunity` + notifikasi.
2. **Form lamaran publik** (tanpa akun): halaman `/` guest section atau subdomain
   — data masuk staging `ApplicantWeb`-style (status Pending) → HR "Upload"
   (verifikasi) ke talent pool + email konfirmasi + captcha/rate-limit.
3. **RecruitmentPlan** (manpower sederhana: per periode + posisi + office,
   target vs realisasi rekrut — tanpa 24 kolom spreadsheet oranHR; 6–8 kolom inti)
   + **RecruitmentBudget** (anggaran periode + realisasi dari method cost +
   ringkasan per JO/PR).
4. **Demografi & kalender**: chart demografi pelamar + kalender jadwal seleksi
   bulanan (bulan berjalan + filter).
**Acceptance**: karyawan ESS apply lowongan internal terlihat HR; lamaran publik
masuk staging & diverifikasi; budget vs realisasi cocok dengan method cost.
**Dependensi**: P4. **Risiko**: eksposur publik (mitigasi: rate limit, honeypot,
validasi upload, consent UU PDP).

### FASE LANJUT (backlog, belum dijadwalkan — XL)
- Engine **psikotest online** (DISC/Papikostik/WPT/Kraepelin/MSDT + proctoring).
- Portal self-service pelamar (akun + status lamaran + upload dokumen mandiri).
- AI screening: parsing CV (VLM/OCR) + auto-match kandidat via RekanKerja AI
  Assistant + skor rekomendasi.
- Integrasi job board (posting otomatis) & referal tracker berinsentif.

### Ringkasan urutan & logika

```
P1 PR+approval ──► P2 JO+pelamar ──► P3 seleksi ──► P4 appointment+onboarding
                                                    └► P5 ESS+publik+anggaran
Nilai bisnis tercepat: P1+P2 (permintaan terkontrol + talent pool)
Titik diferensiator RekanKerja: P4 (onboarding integration) — oranHR tidak
seamless di sini (buat Employee manual dua kali input).
```

---

## 9. RISIKO & MITIGASI (lintas fase)

| Risiko | Mitigasi |
|---|---|
| PII pelamar (UU PDP 27/2022): data pihak ketiga, retensi, consent | consent checkbox saat input/apply; retensi = keepOnFile lalu anonimisasi/hapus; blacklist wajib alasan; enkripsi field-crypto; masking per scope |
| Upload berbahaya (CV) | pattern EmployeeDocument: whitelist MIME + magic number + ukuran maks + antivirus opsional |
| Spam form publik (P5) | rate-limit per IP, honeypot, captcha ringan, staging manual approval |
| Scope creep psikotest | dipisah ke backlog XL — jangan masuk P1–P5 |
| Kualitas data applicant → employee | prefill wizard + validasi; duplikat name/phone check sebelum create Employee |
| Performa list pelamar besar | index status/keepOnFileUntil + server-side pagination (pola existing) |
| Dwibahasa konsisten | semua label baru lewat t() + kamus EN paralel sejak P1 |

---

## 10. KEPUTUSAN YANG PERLU DIPUTUSKAN (sebelum mulai P1)

1. **Portal publik** sejak awal (P5) atau internal-only dulu? → rekomendasi: internal dulu.
2. **Budget & biaya rekrutmen** perlu di fase berapa? (oranHR menaruhnya di depan;
   rekomendasi kita: P5 — nilai bisnisnya setelah alur inti jalan).
3. **Kandidat internal** (mutasi/promosi via rekrutmen) masuk P3 atau ditunda?
   → rekomendasi: masuk (modal Employee sudah ada).
4. **Recruitment Plan (manpower)** perlu pola 24-kolom oranHR atau versi ringkas?
   → rekomendasi ringkas (§8 P5).
5. Psikotest online: **tidak dibangun** dalam 5 fase ini (backlog) — setuju?

---

## 11. LAMPIRAN

### 11.1 Bukti eksplorasi
- 30 screenshot: `.tmp-research/rec-00-login.png` … `rec-29-candidate-appointment-retry.png`
  (login, dashboard, navtree, PR grid, PR form, recruitment plan, selection calendar,
  budget, PR approval, recruitment activity, JO, JO-per-PR, JO method edit, applicant
  grid, applicant form, applied positions, applicant engine, demography, web temp,
  evaluation process, eval per candidate, selection history, psikotest, appointment
  form/grid, ad media type, std selection, psikotest rule, report process result).
- 50 file ekstraksi store ExtJS: `.tmp-research/rec-data/*.json` (kolom + field
  model + sample data per halaman).
- Analisa VLM form kunci: `.tmp-research/vlm-*.json`.

### 11.2 Keterbatasan eksplorasi
- Beberapa grid demo kosong (CandidateAppointment, MySelectionProcess,
  ApplicantWeb, External Evaluator, EmpAgency, TemplateStatement, dll.) — kolom
  & field model tetap terekam; nilai enum untuk entitas tsb diinferensi.
- `ReportCollection` tidak termuat di demo — katalog laporan spesifik rekrutmen
  tidak dapat diverifikasi daftarnya (Report Process Result terlihat via menu).
- Dialog form hanya dibuka pada halaman kunci (PR, Applicant, JO Method) sesuai
  batasan read-only (tidak submit apa pun di demo).
- Master psikotest (statement/dictionary per instrumen) tidak dieksplorasi
  satu per satu (repetitif; keputusan: tidak diadopsi di 5 fase pertama).
- ESS Recruitment diakun demo MII000001 (admin) menampilkan menu, namun grid
  personal kosong — struktur halaman terekam dari kolom.

---

*Dokumen ini disusun sebagai dasar implementasi. Tidak ada baris kode aplikasi
RekanKerja yang diubah dalam pembuatannya (mandat user: analisa + development plan only).*

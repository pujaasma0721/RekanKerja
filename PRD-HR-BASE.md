# PRD — Human Resource Base Module (OranHR Rebuild)

> **Dokumen ini adalah Product Requirements Document (PRD) yang ditujukan untuk AI Agent** yang akan membangun ulang aplikasi web HRIS "OranHR" dengan **fokus scope: module `Human Resource Base`**.
> Referensi studi: `https://demo.oranhr.com/` (akun demo: `MII000001` / `MII1`, company: `MII - Mitra Industri Internasional`, aplikasi versi `11.08.00`).
> Aplikasi aslinya berbasis JSP + ExtJS; rebuild disarankan dengan stack modern (lihat §2).

---

## 1. Ringkasan Produk

### 1.1 Deskripsi
OranHR adalah aplikasi Human Resource Information System (HRIS) enterprise multi-company untuk pasar Indonesia. **Module Human Resource Base (HR Base)** adalah **fondasi master data & transaksi inti** bagi seluruh modul lain (Payroll, Leave, Time Attendance, Medical, Travel, dsb.). HR Base menyediakan:

1. **Struktur organisasi** — company, organization unit, brand/outlet, struktur & chart.
2. **Struktur posisi** — position, job, grade, level, struktur & chart, kualifikasi, DISC.
3. **Data karyawan** — onboarding wizard, personal & working info, riwayat, disciplinary, terminasi, blacklist.
4. **Personnel Action** — transaksi perubahan status karyawan dengan workflow approval.
5. **Wage & Accounting Rules** — komponen upah dan integrasi posting ke akuntansi.
6. **General Setting** — 25+ master lookup pendukung.
7. **Security Setting** — user access, module access group, scheme akses data.
8. **Multiple Approval** — approval engine multi-level yang dipakai semua modul.

### 1.2 Target Pengguna (Persona)
| Persona | Deskripsi | Kebutuhan Utama |
|---|---|---|
| HR Administrator | Staf HRD yang mengelola master data | CRUD employee, org, position, lookup |
| HR Manager | Approver & pengawas proses HR | Approval inbox, Personnel Action |
| Employee (via modul lain) | Karyawan biasa | Menjadi penerima Personnel Action / surat |
| Superadmin | Admin sistem | User access, scheme, approval setup |

### 1.3 Fitur Kunci (Highlights)
- Multi-company (`company_id` ada di hampir semua entitas) + **Change Company** saat runtime.
- New Employee Wizard 5 langkah (personal → working → salary → schedule → BPJS).
- 12 jenis Personnel Action dengan mesin approval + generate surat.
- Versioning data berlaku (effective dating): `valid_from`/`valid_to`, `based_on_date` untuk query history.
- Approval engine seragam untuk 14+ jenis dokumen lintas modul.
- Letter Generator massal dari template (DOCX/PDF, password, multi-bahasa).
- Posting jurnal ke sistem akuntansi (Accurate) via Posting Event.

---

## 2. Tech Stack Rebuild (Rekomendasi)

| Layer | Teknologi | Catatan |
|---|---|---|
| Framework | Next.js 16 (App Router) + TypeScript 5 | Halaman client-side interaktif ala ExtJS |
| Styling/UI | Tailwind CSS 4 + shadcn/ui (New York) + Lucide icons | DataGrid → pakai TanStack Table |
| Database | Prisma ORM + SQLite (dev) | Schema di `prisma/schema.prisma` |
| Auth | Session-based auth (login Employee Id + password) | Multi-company session, forgot password |
| State | Zustand (client) + TanStack Query (server) | |
| Export | DOCX/PDF via template engine | Letter Generator, Preview grid |
| Arsitektur API | REST `/api/*` (route handlers) | Bukan server action |

**Prinsip:** setiap "page" OranHR = 1 route CRUD generik; pertimbangkan **DataGrid Page Engine** (komponen grid+toolbar generik terkonfigurasi) karena 90% halaman memakai pola identik (lihat §5.1).

---

## 3. Arsitektur Informasi (Struktur Menu HR Base)

Navigasi = **tree menu** di sisi kiri (dapat di-collapse). Urutan modul di dashboard: HR Base, Payroll, Leave, Time Attendance, Medical, Travel, HR Analysis, Performance Assessment, Competency, Employee Development, Recruitment, Training, Report, Administration. **Scope PRD ini = HR Base saja** (menu lain hanya jadi konteks integrasi).

### 3.1 Peta Menu Lengkap (7 grup, 74 halaman)

```
Human Resource Base
├─ 1. Organization Definition
│   ├─ Company ........................................... /Company
│   ├─ Company Chart ..................................... /CompanyChart
│   ├─ Change Company .................................... /ChangeCompany
│   ├─ Organization Unit ................................ /OrganizationUnit
│   ├─ Organization Structure (tree) ..................... /OrganizationStructureTree
│   ├─ Organization Chart ................................ /OrganizationChart
│   ├─ Human Resource Period ............................. /HrbasePeriod
│   ├─ Company Event Notifier ............................ /CompanyNotifier
│   ├─ Brand ............................................. /Brand
│   └─ Outlet ............................................ /Outlet
├─ 2. Position Definition
│   ├─ Position .......................................... /Position
│   ├─ Position Structure (tree) ......................... /PositionStructureTree
│   ├─ Position Chart .................................... /PositionChart
│   ├─ Query - Position Vacant ........................... /QueryPositionVacant
│   ├─ Position Description .............................. /PositionDescription
│   ├─ Position Qualification ............................ /PositionQualification
│   ├─ DISC Profile Analysis ............................. /DISCProfileAnalysis
│   └─ Job ................................................ /Job
├─ 3. Employee Information
│   ├─ New Employee Wizard ............................... /NewEmployeeWiz
│   ├─ Employee Personal Information ..................... /EmployeePersonalInfo
│   ├─ Request Personal Data Changes ..................... /RequestPersonalDataChanges
│   ├─ Employee Working Information ...................... /EmployeeWorkingInfo
│   ├─ Employee Position Structure (tree) ................ /EmployeeStructureTree
│   ├─ Employee Supervisory Chart ........................ /EmployeeChart
│   ├─ Personnel Action .................................. /PersonnelAction
│   ├─ Personnel Action Approval ......................... /PersonnelActionToApprove
│   ├─ Letter Generator ................................. /LetterGenerator
│   ├─ Letter Generator Result .......................... /LetterGeneratorResult
│   ├─ Query (17 halaman query read-only)
│   │   ├─ Employee Address / Contact / Identification / Family / Emergency
│   │   ├─ Work Experience / Education / License / Physical
│   │   ├─ Employment History / Organization Unit Change History
│   │   ├─ Position Assignment History / Grade Change History
│   │   ├─ Company Office Change History / Work Location Change History
│   │   ├─ Psychological Profile / Achievement / Employee Information
│   ├─ Disciplinary Action
│   │   ├─ Issue Employee Disciplinary .................. /IssueEmployeeDisciplinary
│   │   └─ Employee Disciplinary History ................ /EmployeeDisciplinary
│   └─ Terminated Employee Information
│       ├─ Personal Information ........................ /NonActiveEmployeePersonalInfo
│       ├─ Working Information .......................... /NonActiveEmployeeWorkingInfo
│       └─ Blacklist ..................................... /Blacklist
├─ 4. Wage and Accounting Rules
│   ├─ Wage Component .................................... /WageCode
│   ├─ Account Group ..................................... /AccountGroup
│   ├─ Account ........................................... /Account
│   ├─ Analysis Definition ............................... /AnalysisDefinition
│   ├─ Posting Event ..................................... /PostingEvent
│   ├─ Posting Event Chart of Account .................... /EventAccount
│   ├─ Posting Transaction to Accounting ................. /TransferEvent
│   ├─ Transaction Journal Account ....................... /PostingAccount
│   └─ Accurate User Connection .......................... /AccurateConnection
├─ 5. General Setting
│   ├─ Award Type / Award Name
│   ├─ Country / Company Group / Currency / Exchange Rate
│   ├─ Education Field / Education Institution / Education Level
│   ├─ Functional Area / Line of Business / Language
│   ├─ License Type / Physical Characteristic / Psychological Characteristic
│   ├─ Unit of Measurement / Qualitative Measurement
│   ├─ Reminder Setting / Miscellaneous Benefit
│   ├─ Resignation Reason / Answer Criteria / FasKes
│   ├─ Exit Interview Setting
│   │   ├─ Interview Category / Interview Question / Interview Template
│   ├─ Organization Setting
│   │   ├─ Cost Center / Organization Level
│   │   ├─ Position Grade / Position Level
│   │   ├─ Article and Download Setting / News Ticker Setting
│   │   └─ Letter Template
│   ├─ Warning Level Disciplinary
│   └─ Employee Setting
│       ├─ Employee Grade / Employee Category
│       ├─ Name Configurator / Contract Category
├─ 6. Security Setting
│   ├─ User Access ....................................... /UserWithPerson
│   ├─ User Access Setup ................................ /UserAccessSetup
│   └─ Scheme Setup ...................................... /SchemeSetup
└─ 7. Multiple Approval
    ├─ Approval Process ................................. /ApprovalProcess
    ├─ Approval Process Template ........................ /ApprovalProcessTemplate
    ├─ Approval Template ................................. /ApprovalTemplate
    ├─ Temporary Approver ................................. /TemporaryApprover
    ├─ Query - Pending Approval .......................... /QueryPendingApproval
    └─ Query - Pending Approval By User .................. /QueryPendingApprovalByUser
```

---

## 4. Pola Halaman & UI/UX

### 4.1 Kerangka Aplikasi (App Shell)
- **Header atas**: tombol `Home`, `About`, `News` (dengan badge count), `Profile`, `Sign Out` + kotak pencarian global + indikator company aktif.
- **Sidebar kiri**: navigation tree (module → grup → halaman), collapsible. Terdapat juga `Employee Self Service` (menu "My*") dan `Manager Self Service` (menu approval "My...ToApprove") — di luar scope HR Base tapi sidebar memuat 4 tree: Navigation, ESS, MSS.
- **Dashboard (Home)**: panel Reminder Approval (daftar `Approval - N <jenis dokumen>` per tanggal), panel News/Announcement (kategori: Announcement, Company Regulation, Miscellaneous), panel tanggal penting karyawan (list `MII000042 - Sudarso` + tanggal), Calendar bulanan dengan event, panel Recently Accessed, News Ticker berjalan.
- **Footer**: company name aktif, versi aplikasi, copyright.
- **Login page**: Employee Id + Password (masked) + tombol Sign in + link Forgot Password + logo perusahaan.

### 4.2 Pola Halaman Grid (DataGrid Page) — 90% halaman
Setiap halaman master memakai pola identik, **WAJIB dibuat sebagai engine/komponen generik**:

```
+--------------------------------------------------------------+
| Toolbar: [Display All][Preview][Table][Refresh][Search]        |
|          [Delete][New][Duplicate][Edit][Operation][...]        |
+--------------------------------------------------------------+
| Grid: kolom sesuai konfigurasi, locked-column kiri optional   |
| Pagination bawah + counter record                             |
+--------------------------------------------------------------+
```

Perilaku tombol:
| Tombol | Fungsi |
|---|---|
| Display All | Muat semua record (server-side paging) |
| Search | Buka filter panel / pencarian kolom |
| New | Buka form entri (window/dialog) → Save/Cancel |
| Edit | Edit record terpilih (inline row-editor atau dialog) |
| Duplicate | Clone record terpilih |
| Delete | Hapus record terpilih (dengan konfirmasi) |
| Refresh | Reload data |
| Preview | Cetak/preview daftar (print view) |
| Operation | Dropdown aksi workflow (Submit, Approve, dll — kontekstual per halaman) |
| Apply/Count/Save/Cancel | Muncul saat editing |

Interaksi grid: klik baris = pilih; double-click = edit; sorting per kolom; filter per kolom.

### 4.3 Pola Halaman Tree (Struktur)
`Organization Structure`, `Position Structure`, `Employee Position Structure` menampilkan tree hierarkis:
- Root = Company, anak pertama = unit teratas (mis. `001 - CEO`), lalu turunan (MANAGEMENT → COMMERCIAL → DIVISI CONSUMER PRODUCT → ...).
- Node bisa expand/collapse; leaf = unit paling bawah.
- Toolbar: pilih Based on Date (query struktur historis).

### 4.4 Pola Wizard (New Employee Wizard)
Multi-step form dengan tombol `Previous / Next / Cancel` dan `Finish` di step terakhir, header menampilkan identitas yang sudah diisi (Employee Id, Name, First/Last Name). Detail field: lihat §6.3.

### 4.5 Pola Form Transaksi (Personnel Action, Disciplinary)
Form detail dengan field bertanda `*` (mandatory), tombol `Save/Cancel`, lookup field (tombol "..." membuka popup pencarian), date picker, checkbox.

### 4.6 Aturan UX Umum
- Bahasa antarmaca: Inggris (istilah HR), data demo Indonesia (BPJS, KTP, NPWP, FasKes, Rupiah).
- Format tanggal tampilan: `dd MMM yyyy` (01 Sep 2026).
- Wajib responsive; toolbar grid collapse menjadi menu di layar kecil.
- Konfirmasi untuk Delete; toast/sukses-error feedback.
- Lookup field = kombinasi kode + deskripsi (mis. `MII - Mitra Industri Internasional`).

---

## 5. Model Data (Entities & Fields)

> Konvensi umum: semua entitas master memiliki `id` technical; grid menyembunyikan kolom sistem `golid`, `golversion` (optimistic locking) — di rebuild ganti dengan `id` + `version` otomatis. Kecuali disebut lain, semua entitas memiliki `companyId` (multi-company). Semua entitas historis memiliki `basedOnDate` untuk query as-of.

### 5.1 Core Organization
**Company** (Company.jsp)
- `companyId`* (PK, pattern: `MII`), `name`*, `parentCompanyId` (self-ref), `registrationNo`, `socialInsuranceNo`, `taxCompulsionNo` (NPWP), `bpjsKesehatanNo`, `lineOfBusinessId`, `defaultCurrencyCode`*, `leaderCompanyId`, `leaderEmployeeId`, `leaderName`, `logo` (upload), `autoGenerateEmployeeId` (bool), `resetIdGeneratorType`, `establishedDate`, `companyType`, `companyGroupId`, `useCompanyOfficeAsOutlet` (bool), `idTku`
- Fitur: hierarchy parent-company, chart view, generate Employee Id otomatis per company.

**OrganizationUnit**
- `companyId`, `organizationId`* (mis. `001`), `name`*, `parentOrganizationId` (self-ref), `costCenter`, `organizationLevel`, `validFrom`, `validTo` (+ parent valid dates untuk histori)
- Contoh data: 001 CEO → 002 MANAGEMENT → 014 FINANCE → 019 ACCOUNTING → 020 REPORTING & BUDGET CONTROL.

**HrbasePeriod** (period master)
- `companyId`, `periodId`, `startDate`, `endDate`, flag: `forRecruitment`, `forTraining`, `forEmployeeDevelopment`, `forPerformanceAssessment`, `forMedical`, `forTravel` (bool)

**CompanyNotifier**
- `companyId`, `notifierId`, `description`, `enable` (bool)

**Brand** — `brandId`, `brandDescription`, `brandLogo`
**Outlet** — `outletId`, `brandId`, `description`, `type`, `salesSource`, `salesFromOutlet` (bool), `serviceChargePayment` (%), `fixAllowance`

### 5.2 Core Position
**Job** — `jobId`, `jobTitle`, `validFrom`, `validTo`, `companyId`
**Position**
- `companyId`, `positionId`*, `internalTitle`, `parentPositionId` (self-ref), `externalTitle`, `description`, `positionGrade`, `positionLevel`, `validFrom`, `validTo`, `useFixRateSC`, `jobId`
**PositionDescription / PositionQualification** — view/augmentasi atas Position + detail deskripsi & kualifikasi.
**DiscProfileAnalysis** — `companyId`, `employeeId`, `dominance`, `influence`, `steadiness`, `compliance` (angka D/I/S/C), `positionId`
**QueryPositionVacant** (computed) — per position: `noOfEmployee`, `noOfRequired`, `noOfVacant`, `baseOnDate`

### 5.3 Core Employee (paling penting)
**Employee** (gabungan Personal + Working; di OranHR ditampilkan sebagai 2 grid berbeda)
Personal fields: `employeeId`* (PK, pattern `MII000001`), `personId`*, `firstName`*, `lastName`, `middleName`, `birthName`, `salutation`, `alias`, `preNameTitle`, `postNameTitle`, `citizenship`, `tkCode`, `socialInsuranceNo` (BPJS TK), `socialInsuranceJoinDate`, `gender`* (Male/Female), `maritalStatus`* (Single/Married/...), `placeOfBirth`, `dateOfBirth`, `religion`, `bloodType`, `picture` (upload), `userId`, `employeeCategory`, `bpjsKesehatanNo`, `bpjsKesehatanJoinDate`, `careClass`, `healthFacilityCode` (FasKes), `healthFacilityName`, `firstJoinDate`, `entriedBy`, `entriedDate`, `blacklist` (bool)
Working fields: `supervisorCompanyId`*, `supervisorEmployeeId`*, `supervisorName`, `employeeStatus`* (Active/Non-Active), `probation` (months), `employmentType`* (Permanent/Contract/Temporary), `contractCategoryId`, `contractPeriodMonths`, `remunerationType`* (Monthly/Daily/Hourly), `absenceCardNo`, `joinDate`*, `organizationId`*, `organizationName`, `positionId`*, `positionTitle`, `grade`, `companyOffice`*, `workLocation`, `note`, `yearsInService`, `yearsInGroup` (computed)

**Entitas detail karyawan** (diedit via wizard/form, dilihat via halaman Query):
| Entitas | Field Kunci |
|---|---|
| Address | addressId, addressType, address, city, province, postalCode, country, phone, fax, district, subdistrict, RT, RW |
| ContactMethod | contactNo, contactType, contactNumber, isDefault |
| Identification | identificationType (KTP/Paspor/...), idNumber, validFrom, validTo, placeOfIssue |
| Family | familyName, idNumber, relationship, gender, dateOfBirth, maritalStatus, isPayrollDependent, isMedicalDependent, isBpjsKesehatanDependent, isDead, lastEducationLevel, healthFacilityCode, address, phone |
| EmergencyContact | (mirip contact, prioritas darurat) |
| WorkExperience | lineOfBusiness, company, startDate, endDate, division, location, lastSalary, jobTitle, supervisorName, jobDescription, reasonOfLeaving |
| Education | educationLevel, educationField, institution, location, gpa, startYear, endYear, achievement, note |
| License | licenseType, licenseNo, validFrom, validTo |
| Physical | physicalCharacteristic, value, note |
| Psychological | psychologicalCharacteristic, psychologicalType, value, note |
| Achievement | awardName, awardType, awardPrize, awardDate, achievement, financialValue, currency, nominatedBy, endorsedBy, note |

**EmploymentPeriod (history)** — joinDate, terminationDate, employeeStatus, employmentType, note → query Employment History.
**PositionAssignment (history)** — positionId, positionGrade, positionLevel, startDate, endDate, isPrimaryPosition → query Position Assignment History.
**GradeInterval (history)** — grade, validFrom, validTo.
**CompanyOfficeAssignment (history)** & **WorkLocationAssignment (history)** — idem pola interval.

### 5.4 Personnel Action & Disciplinary
**PersonnelAction**
- `companyId`, `actionNo`, `personnelActionType`* (12 jenis — lihat §6.4), `status` (Prepared/Submitted/Approved/Rejected/Cancelled/...), `recipientEmployeeId`*, `recipientName`, `noPromote` (bool), `noSalaryIncrement` (bool), `reasonToIssue`, `effectiveDate`*, `sendEmailToRecipient` (bool), `letterNo`, `dateOfIssue`, `refLetterNo`, `refLetterDate`, `acceptedDate`, `templateCode` (letter template), `creatorCompanyId`, `createdBy`, `createdName`

**EmployeeDisciplinary**
- `companyId`, `employeeId`, `disciplinaryNo`, `warningLevel`*, `incidentDate`*, `violation`*, `violationDegree`, `violationType`, `effectViolation`, `adviceGiven`, `sanctionGiven`, `note`, `dateIssue`*, `letterNo`, `expiryDate`*, `issuerCompanyId`*, `issuedBy`*, `templateCode`
- Form issue juga punya tombol **Submit** dan **Submit and Print**.

**Blacklist** — `idNo` (KTP), `birthDate`, `personName`, `companyId`, `employeeId`, `gender`, `reason` → dipakai screening rekrutmen & mencegah re-hire.

### 5.5 Wage & Accounting
**WageComponent (WageCode)** — `companyId`, `wageCode`, `wageName`, `wageTypePayroll`, `wageTypeTime`, `timeReportingCode`
**AccountGroup** — `companyId`, `accountGroup`, `description`
**Account** — `companyId`, `accountCode`, `description`, `accountType`, `accountGroupId`, `validFrom`, `validTo`
**AnalysisDefinition** — `companyId`, `analysisType`, `internalName`, `codeUsed`
**PostingEvent** — `companyId`, `eventCode`, `description`, `codeUsed`
**EventAccount (Posting Event CoA)** — `companyId`, `eventCode`, `debitCredit` (D/C), `accountCode`, hingga **10 analysis dimensions** (analysis1..analysis10 + analysis_typeN), `basedOn` (Organization Unit/Company Office/Employment Type/Position Grade/Employee Grade)
**TransferEvent (journal siap posting)** — `journalNo`, `journalType`, `journalDate`, `eventCode`, `accountCode`, `debitCurrencyAmount`, `creditCurrencyAmount`, `currency`, `currencyRate`, `debitAmount`, `creditAmount`, `accountingPeriod`, `accountingYear`
**PostingAccount (jurnal terjadwal)** — rekap per accounting period/year, event, journal: debit/credit/balance.
**AccurateConnection** — `userId`, `accurateUser`, `accurateUserEmail`, `tokenExpired`, `accessCreated`, `expiresIn` (integrasi ke software akuntansi Accurate via token).

### 5.6 General Setting (lookup masters)
| Master | Fields |
|---|---|
| AwardType | awardType, description |
| Award | awardName, description, awardCriteria, awardType, awardPrize, validFrom, validTo, note |
| Country | countryCode, name, defaultCurrency, defaultLanguage, taxCode, description |
| CompanyGroup | companyGroup, description |
| Currency | currencyCode, description |
| ExchangeRate | companyId, currencyCode, directRate, validFrom |
| EducationField | fieldNo, name, description |
| EducationInstitution | institutionNo, name, address |
| EducationLevel | levelNo, name, description, ranking |
| FunctionalArea | functionalNo, functionalArea, description |
| LineOfBusiness (IndustryArea) | areaNo, lineOfBusiness, description |
| Language | languageCode, description |
| LicenseType | typeNo, name, description |
| PhysicalCharacteristic | physicalNo, name, description, measurementMethod |
| PsychologicalCharacteristic | psychologicalNo, name, description, measurementMethod |
| UnitOfMeasurement (Measurement) | measurementCode, description |
| QualitativeMeasurement | qualitativeNo, level, description, ranking |
| ReminderSetting (SystemReminder) | reminderId, description, enable, remindAll, startReminderBefore, endReminderAfter, message |
| MiscBenefit | miscBenefitNo, benefitName, description |
| ResignationReason (ReasonResign) | reasonNo, reason, description, calculateSC |
| AnswerCriteria (EvaluationCriteria) | criteriaNo, criteria |
| FasKes | healthFacilityCode, healthFacilityName, healthFacilityType, address, district, province |
| InterviewCategory | categoryNo, categoryName |
| InterviewQuestion | questionNo, questionText, categoryName, ratingCriteria |
| InterviewTemplate | templateNo, templateName |
| CostCenter | companyId, costCenter, description, validFrom, validTo |
| OrganizationLevel | companyId, orgLevelNo, level, ranking |
| PositionGrade | companyId, gradeId, ranking, grade, gradeInterval, description |
| PositionLevel | companyId, posLevelNo, level, firstSCPayment, ranking |
| EmployeeGrade | companyId, gradeId, ranking, grade, gradeInterval, description |
| EmployeeCategory | companyId, categoryNo, category, description, calculateSC |
| ContractCategory | companyId, contractCategoryNo, contractCategory, contractDescription, durationMonths |
| NameConfigurator | per company: flag pemakaian tiap komponen nama (preTitle, firstName, middleName, lastName, postTitle, birthName, alias) + separator tiap komponen + hasil DisplayName → menentukan penyusunan Employee Name |
| WarningLevelDisciplinary | warningLevel, wageCode, scPenaltyRate, scPenaltyFreq, warningValidity, companyId, noPromote, noSalaryInc |
| FileDownload (Article) | companyId, fileNo, title, fileType, fileName, enable, distributeToAll |
| Ticker | companyId, tickerNo, news, enable, distributeAll, validFrom, validTo |
| LetterTemplate | companyId, templateCode, templateName, moduleAccess, description, valid, grantToAll, fileName, detailList, fileNameFields, fileNameParams (+upload JSON fields/params) |

### 5.7 Security & Approval
**UserWithPerson (User Access)** — `userId`, `personId`, `name`, `basedDate` (read-only mapping user↔person)
**UserAccessSetup** — 7 baris tetap: `moduleAccessId` (1-7), `moduleAccessDescription` (HR Access Setup, Payroll Access Setup, Medical Access Setup, Travel Access Setup, Leave & Time Attendance Access Setup, Performance Assessment Access Setup, Other Strategic Access Setup), `companyId` → menentukan grup module yang bisa diberikan ke user.
**SchemeSetup** — `companyId`, `schemeName`, `includeSubordinate` (bool), `basedOn` (Position Structure / Organization Structure / Company Office / Position Grade / Employee Grade) → scheme akses data: user hanya melihat data bawahannya dalam struktur terpilih.

**ApprovalProcess** — `className` (mis. `com.sps.hrbase.personnelaction.PersonnelAction`), `processName` (mis. `Personnel Action`), `description`, `approvalDays`. 14 proses: Employee Benefit Claim, Employee Clocking, Employee Loan, Employee Overtime Work Order, Employee Work Day Request Changes, Employee Work Off Permission, Employee Leave Encashment, Employee Leave Request, Medical Benefit Adjustment, Medical Benefit Claim, **Personnel Action**, Personnel Requisition, Travel Claim, Travel Request.
**ApprovalTemplate** — `companyId`, `templateName` (mis. Approval 1 Layer, Approval 2 Layer, Direct SPV, HRD, DIRUT, Auto Approve, ...), `autoApprove` (bool), `description` → berisi daftar level approval (approver per level).
**ApprovalProcessTemplate** — `companyId`, `processName`, `templateName`, `ruleParameter` (string 10 flag `N^Y^...` sesuai 10 rule), boolean per rule: byOrganization, byCompanyOffice, byPositionLevel, byPosition, byNominalAmount, byCostCenter, byEmployee, byBenefitType, byEmployeeGrade, byPositionGrade, + kolom nilai filter (organization, companyOffice, positionLevel, position, nominalAmount, costCenter, employee, benefitType, employeeGrade, positionGrade)
**TemporaryApprover** — `replacedCompanyId`, `replacedEmployeeId`, `validFrom`, `validTo`, `replacementCompanyId`, `replacementEmployeeId`, `reasons`, + flag per-jenis-dokumen: forPersonnelAction, forLeaveRequest, forMedicalClaim, forTravelRequest, dst (14 flag)

---

## 6. Bisnis Proses (Utama)

### 6.1 Setup Awal Perusahaan (Initial Setup)
1. Buat **Company** (parent opcional; logo, currency default, auto-generate employee id ON → id karyawan otomatis `MII000001` dst).
2. Definisikan **Cost Center**, **Organization Level** (level + ranking), **Brand/Outlet** (jika retail).
3. Buat **Organization Unit** bertingkat (parent-child) → visualisasi di **Organization Structure/Chart**.
4. Definisikan **Job** lalu **Position** (parent-child = struktur pelaporan posisi, grade, level).
5. Atur **HrbasePeriod** (periode aktif per fungsi: rekrutmen, training, PA, medical, travel).
6. Setup **General Setting** lookups (education, currency, dsb.) & **Name Configurator** (format penyusunan nama).
7. Setup **User Access** + **Scheme** + **Multiple Approval** sebelum transaksi.

### 6.2 Onboarding Karyawan — New Employee Wizard (5 Langkah)
> Proses utama entry karyawan baru. Semua field wajib bertanda *.

**Step 1 — PERSONAL INFO**: EmployeeId (auto-generate bila company setting aktif), PersonId*, FirstName*, LastName, MiddleName, BirthName, Alias, Salutation, Pre/PostNameTitle, EmployeeCategory, Gender*, MaritalStatus*, PlaceOfBirth, DateOfBirth, Religion, BloodType, Citizenship, TKCode, SocialInsuranceNo + join date, upload Picture, UserId + RoleGroupId (opsional, pembuatan user login), KTP Number*, Mobile Number, Email.

**Step 2 — WORKING INFO**: SupervisorCompanyId*, SupervisorId* (atasan langsung), EmployeeStatus* (Active), Probation (bulan), EmployeeType* (Permanent/Contract/Temporary), ContractCategory, Contract/TemporaryPeriodMonths, RemunerationType* (Monthly/...), AbsenceCardNo, JoinDate*, OrganizationId*, PositionId*, Grade, CompanyOffice*, WorkLocation, Note.

**Step 3 — SALARY INFO**: NPWP No, NPWP Submitted Date, SkipBasicSalary (bool), BasicSalary*, Currency* (Rupiah), BasicSalaryUnit* (Month), ProcessMethod* (GrossToNet), PaymentFrequency* (Monthly), WageTemplate*, PayrollDependentAllowed (bool).

**Step 4 — WORK SCHEDULE ASSIGNMENT**: ScheduleType*, Description, 1stMondaySequence* (penentuan minggu pertama), FromDate*, ValidUntil* (default `01 Jan 9999`).

**Step 5 — MEDICAL (BPJS)**: BPJS Kesehatan No, BPJS Kesehatan Join Date, CareClass, HealthFacilityCode (FasKes), HealthFacilityName → tombol **Finish** menyimpan semua data (1 transaksi atomik).

Setelah finish: employee muncul di Employee Personal/Working Information; EmploymentPeriod history dibuat otomatis (joinDate).

### 6.3 Pengelolaan Data Karyawan (Steady State)
- **Employee Personal Information**: view/edit data pribadi (grid 37 kolom). Tidak ada tombol New (karyawan baru hanya via wizard). Duplikasi & delete tersedia.
- **Employee Working Information**: view/edit data kepegawaian (grid 35 kolom) — perubahan struktural organisasi/posisi **tidak boleh** diubah langsung, harus lewat Personnel Action (best practice dari aplikasi asli; grid menampilkan kondisi saat ini berdasarkan `basedOnDate`).
- **Request Personal Data Changes**: karyawan/HR mengajukan perubahan data pribadi → masuk alur approval (Personnel Action Approval serupa).
- **17 halaman Query**: read-only, semua menyediakan filter `Based on Date` untuk melihat kondisi historis (as-of query) — Address, Contact, Identification, Family, Emergency, Work Experience, Education, License, Physical, Employment History, Org Unit Change History, Position Assignment History, Grade Change History, Company Office Change History, Work Location Change History, Psychological Profile, Achievement, Employee Information.
- **Letter Generator**: pilih rentang karyawan (From/To) + TemplateCode (per Module Access) + BasedOnDate + opsi ConvertToPDF, BackgroundJob, ZipDownload, SeparateFile, OpenPassword/EditPassword (docx), DateFormat, DateTimeFormat, Language, UseCommaAs1000Separator → **Generate** menghasilkan surat massal (mis. surat kerja, pengangkatan) dari template; hasil dicek di Letter Generator Result.

### 6.4 Personnel Action — Siklus Hidup Karyawan (PROSES INTI)
**12 jenis aksi** (dropdown `PersonnelActionType`):
1. Transfer Employee (pindah org/posisi antar unit)
2. Promote Employee (naik jabatan)
3. Demote Employee (turun jabatan)
4. Adjust Employee Grade (penyesuaian grade)
5. Confirm Probationary Employee (habis probation → tetap)
6. Extend Probation Period (perpanjang probation)
7. Terminate Employee (berhenti)
8. Extend Employee Contract (perpanjang kontrak)
9. Change Employment Type (perubahan status, mis. Kontrak → Tetap)
10. Assign Non-Primary Position (jabatan rangkap)
11. Release Non-Primary Position (lepas jabatan rangkap)
12. Transfer Across Company (pindah antar company dalam group)

**Form entry**: PersonnelActionType*, RecipientEmployeeId* (lookup), ReasonToIssue, EffectiveDate*, SendEmailToRecipient (bool), DateOfIssue, RefLetterNo/Date (surat acuan), AcceptedDate (tanggal karyawan menerima), TemplateCode (template surat).
Flag khusus: NoPromote, NoSalaryIncrement (mencegah promosi/kenaikan gaji — mis. karena disciplinary).

**State machine (menu Operation)**:
```
Prepared ──Submit──> (Menunggu Approval) ──Approve──> Approved ──Process──> [EFEKTIF: data employee ter-update]
   ▲                                        │
   │──Return to Prepare──────────────────────┘ (kembalikan ke draft)
   │                                        └──Reject──> Rejected
   └──Cancel (tarik dokumen)                └──Cancel Approval ──> Cancel Approved
   Generate Personnel Action: buat massal dari data (mis. probation habis)
```
- **Approve/Reject** dilakukan approver via halaman *Personnel Action Approval* (inbox approval; sama hanya ter-filter `Status = waiting my approval`).
- **Process** = apply perubahan ke master employee pada effectiveDate: memutus PositionAssignment/GrodeInterval/WorkLocation lama (set `validTo`) dan membuat record baru (interval baru) → history query otomatis benar.
- Submit memicu **Multiple Approval** (lihat §6.6) + email opsional ke recipient.
- Surat (Personnel Action Letter) digenerate dari LetterTemplate (letterNo, dateOfIssue).

### 6.5 Disciplinary Action
1. Setup **Warning Level** (Warning Level Disciplinary: tingkat SP 1/2/3 → wageCode penalty service charge, scPenaltyRate, warningValidity bulan, noPromote, noSalaryInc).
2. **Issue Employee Disciplinary** (form): pilih Employee*, WarningLevel*, IncidentDate*, Violation* (uraian), ViolationDegree, ViolationType, EffectViolation, AdviceGiven, SanctionGiven, Note, DateIssue*, ExpiryDate*, Issuer (company & employee), LetterNo → **Submit** / **Submit and Print**.
3. Riwayat dilihat di **Employee Disciplinary History**.
4. Efek otomatis: SP aktif → Personnel Action "No Promote/No Salary Increment" ter-disable; expiry date lewat → warning kadaluarsa.
5. **Blacklist**: person (berdasar KTP/`idNo` + birthDate) masuk daftar hitam dengan reason → blokir rekrutmen ulang.

### 6.6 Multiple Approval Engine (Lintas Modul)
Konsep 3 lapis:
1. **ApprovalProcess** — daftar 14 jenis dokumen yang punya approval (className, approvalDays = SLA hari).
2. **ApprovalTemplate** — template berisi sekuens level approver (mis. Approval 1 Layer = 1 level; Approval 2 Layer = 2 level; Direct SPV = langsung atasan; DIRUT/HRD = role spesifik; **Auto Approve** = template dengan flag `autoApprove=true`).
3. **ApprovalProcessTemplate** — binding per company: proses X pakai template Y **dengan rule scoping**: 10 parameter rule (byOrganization, byCompanyOffice, byPositionLevel, byPosition, byNominalAmount, byCostCenter, byEmployee, byBenefitType, byEmployeeGrade, byPositionGrade) — jika rule aktif, template hanya berlaku untuk dokumen yang cocok dengan nilai filter (mis. Travel Request dengan rule byPositionLevel + nilai tertentu).

Alur saat dokumen di-Submit:
1. Sistem cari ApprovalProcessTemplate yang match (company + proses + rule parameter vs atribut dokumen).
2. Ambil level approver dari template; resolusi approver aktual: atasan langsung recipient (via Position Structure) atau employee/role tetap di level; cek **TemporaryApprover** (delegasi dengan validFrom/validTo + flag per jenis dokumen) → substitusi.
3. Dokumen muncul di inbox approver (dashboard Reminder "Approval - N <jenis>"); Approve semua level → status Approved; satu saja Reject → Rejected; SLA `approvalDays` untuk eskalasi/reminder.
4. AutoApprove → langsung approved tanpa inbox.

### 6.7 Terminasi & Data Mantan Karyawan
1. Personnel Action **Terminate Employee** (dengan ReasonToIssue dari master ResignationReason; hitung service charge bila `calculateSC`).
2. Karyawan berstatus Non-Active → pindah ke menu **Terminated Employee Information** (Personal & Working Information versi non-aktif, read-only + query historis).
3. Exit interview memakai setting **Interview Category/Question/Template** + **AnswerCriteria** (skala penilaian).
4. Optional: masukkan ke **Blacklist** bila alasan berat.

### 6.8 Posting ke Akuntansi (Integrasi)
1. Definisikan **WageComponent** (komponen upah: wageCode, wageTypePayroll, wageTypeTime).
2. Definisikan **Account** (CoA) dalam **AccountGroup**; **AnalysisDefinition** untuk dimensi cost center.
3. **PostingEvent** (eventCode per jenis transaksi payroll/HR) + **EventAccount** (mapping event → account debit/kredit + up to 10 analysis + basedOn organization/employment type/grade).
4. Saat payroll diproses (modul lain) → **TransferEvent** menyusun jurnal (journalNo/Type/Date, debit/credit amount, currency+rate) → **PostingAccount** rekap per accounting period → export/kirim ke **Accurate** via **AccurateConnection** (token user, expired date).

### 6.9 Keamanan & Akses Data
- **User Access**: 1 user login ↔ 1 person/employee; user hanya dibuat via wizard (UserId+RoleGroup) atau admin.
- **User Access Setup**: 7 grup akses modul (HR, Payroll, Medical, Travel, Leave & TA, Performance Assessment, Other Strategic) — user diberi satu/beberapa grup → menentukan module tree yang tampil (menu filtering per module access).
- **SchemeSetup**: data-scope scheme — pilih BasedOn (Position Structure / Organization Structure / Company Office / Position Grade / Employee Grade) + includeSubordinate → user (mis. manager) hanya melihat data karyawan dalam scope bawahannya; dipakai oleh halaman query & approval inbox.
- **Change Company**: multi-company — user dengan akses lintas company bisa switch company aktif (semua grid ter-filter companyId aktif).

### 6.10 Notifikasi & Konten Internal
- **Reminder Setting**: reminder sistem (mis. SP expiry, probation habis) dengan startReminderBefore/endReminderAfter (hari), message, remindAll → tampil di dashboard panel Reminder.
- **Company Event Notifier**: event per company yang dinotifikasi.
- **Article and Download Setting** (FileDownload): file publikasi per company (peraturan perusahaan, form) dengan kategori (Announcement/Company Regulation/Miscellaneous), enable, distributeToAll → tampil di dashboard News.
- **News Ticker**: teks berjalan di header dengan masa berlaku.
- **HrbasePeriod**: kontrol periode aktif transaksi per fungsi.

---

## 7. Kebutuhan Fungsional per Prioritas

### Phase 1 — Fondasi (Wajib duluan)
| ID | Fitur | Acceptance Criteria |
|---|---|---|
| F01 | Login/Logout + session company | Login dengan EmployeeId+password; logout; forgot password |
| F02 | App shell: header, nav tree, dashboard, footer sticky | Semua elemen §4.1; nav tree collapsible |
| F03 | DataGrid Page Engine generik | Toolbar standar (Display All/Search/New/Edit/Duplicate/Delete/Refresh/Preview); paging; sorting; kolom terkonfigurasi |
| F04 | CRUD Company + Company Chart + Change Company | Validasi field §5.1; multi-company switch |
| F05 | CRUD Organization Unit + Structure tree + Chart | Hierarki parent-child; based-on-date |
| F06 | CRUD Job + Position + Structure/Chart | Hierarki position; validFrom/validTo |
| F07 | CRUD semua General Setting lookups (§5.6) | 30+ master lookup CRUD standar |
| F08 | CRUD Employee Grade/Category, Contract Category, Name Configurator | Name Configurator menentukan penyusunan nama display |

### Phase 2 — Inti Employee Lifecycle
| ID | Fitur | Acceptance Criteria |
|---|---|---|
| F09 | New Employee Wizard 5 langkah | Semua field §6.2; validasi per step; Finish = transaksi atomik; auto-generate employee id |
| F10 | Employee Personal Information | Grid+edit 37 field; tidak ada New; duplicate/delete |
| F11 | Employee Working Information | Grid+edit; based-on-date; history intervals |
| F12 | Entitas detail (address s/d achievement, §5.3) | CRUD detail per employee via form; halaman Query read-only + basedOnDate |
| F13 | Personnel Action entry + 12 jenis | Form §6.4; validasi recipient & effective date |
| F14 | Personnel Action workflow (Operation) | Generate/Submit/Return to Prepare/Approve/Reject/Cancel/Process/Cancel Approval; status benar |
| F15 | Personnel Action Approval (inbox) | Filter menunggu approval saya; approve/reject massal |
| F16 | Process PA → update master | Interval history terbentuk; data employee berubah pada effectiveDate |
| F17 | Terminated Employee Info + Blacklist | Non-aktif views; blacklist by idNo |

### Phase 3 — Approval Engine & Security
| ID | Fitur | Acceptance Criteria |
|---|---|---|
| F18 | Approval Process/Template/Process Template | CRUD §5.7; 10 rule parameter |
| F19 | Approval routing saat Submit | Resolusi atasan via struktur; auto-approve; SLA days |
| F20 | Temporary Approver | Delegasi validFrom/To per jenis dokumen; substitusi inbox |
| F21 | Scheme Setup + data scoping | Query & approval ter-scope struktur bawahan |
| F22 | User Access + 7 module group | Menu tree ter-filter sesuai grup user |

### Phase 4 — Lanjutan
| ID | Fitur | Acceptance Criteria |
|---|---|---|
| F23 | Disciplinary (issue, history, warning level) | §6.5; efek noPromote; expiry otomatis |
| F24 | Letter Generator + Template | Generate massal DOCX/PDF + password + multi-bahasa; halaman Result |
| F25 | Wage & Accounting Rules + posting | §6.8; TransferEvent journal; integrasi token Accurate |
| F26 | Reminder, News, Ticker, FileDownload, HrbasePeriod, CompanyNotifier | §6.10; tampil di dashboard |
| F27 | Query Position Vacant & DISC | Vacant = required − employees as-of date; DISC D/I/S/C per employee |

---

## 8. Kebutuhan Non-Fungsional
- **Multi-company**: semua endpoint ter-scope `companyId` session; tidak ada data bocor antar company (kecuali global lookup seperti Country/Currency).
- **Effective dating**: query historis via `basedOnDate` default hari ini; interval `validFrom/validTo` konsisten (mis. default `9999-12-31`).
- **Audit**: `entriedBy`, `entriedDate`, `createdBy` pada transaksi; version guard (golversion) → di rebuild: optimistic locking.
- **Performa**: grid server-side pagination (data demo 100+ karyawan); bulk generate via background job.
- **Keamanan**: password hash; session; role-based menu; data-scope scheme; action log.
- **Bahasa**: UI Inggris; nilai lookup boleh campur; dukung multi-bahasa surat (Language master).
- **Lokal Indonesia**: format tanggal `01 Sep 2026`; currency Rupiah; entitas BPJS/KTP/NPWP/FasKes/TKU; RT/RW address.
- **Kompatibilitas data**: ID karyawan `MII000001` (3 huruf company + 6 digit); org ID `001`; positional ID numerik.

## 9. Out of Scope (Jangan Dibangun di Fase Ini)
Modul selain HR Base: Payroll Administration, Leave Administration, Time Attendance, Medical Benefit, Travel Administration, HR Analysis, Performance Assessment, Competency, Employee Development, Recruitment, Training Administration, Report, Administration — **kecuali** titik integrasi yang disebut di PRD ini (approval engine menerima dokumen dari modul lain; posting event menerima data payroll; Personnel Requisition dari Recruitment hanya sebagai proses approval). Menu ESS/MSS (My*) juga out of scope.

## 10. Definisi Istilah (Glossary)
- **BPJS** — Badan Penyelenggara Jaminan Sosial (TK: ketenagakerjaan; Kesehatan: kesehatan).
- **FasKes** — Fasilitas Kesehatan (rumah sakit/klinik BPJS).
- **NPWP** — Nomor Pokok Wajib Pajak; **KTP** — Kartu Tanda Penduduk; **TKU/ID TKU** — ID tenaga kerja unik (Coretax).
- **SPT** — Surat Pemberitahuan pajak; **SC** — Service Charge; **SPV** — Supervisor; **DIRUT** — Direktur Utama.
- **Personnel Action (PA)** — dokumen transaksi perubahan status karyawan.
- **golid/golversion** — PK & optimistic-lock version kolom sistem OranHR (rebuild: `id`+`version`).

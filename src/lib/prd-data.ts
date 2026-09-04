// PRD data untuk module Human Resource Base — hasil studi aplikasi HRIS referensi
export const meta = {
  product: "OneVity — Human Resource Base",
  docType: "Product Requirements Document (PRD)",
  purpose: "Blueprint untuk AI Agent membangun ulang aplikasi",
  source: "PRD internal OneVity",
  version: "11.08.00",
  account: "MII000001 / MII1",
  company: "MII - Mitra Industri Internasional",
  scope: "Module Human Resource Base (7 grup menu, 74 halaman)",
};

export const stats = [
  { label: "Grup Menu", value: "7" },
  { label: "Halaman/Screen", value: "74" },
  { label: "Entitas Data", value: "60+" },
  { label: "Jenis Personnel Action", value: "12" },
  { label: "Proses Approval", value: "14" },
  { label: "Lookup Master", value: "30+" },
];

export const personas = [
  {
    role: "HR Administrator",
    desc: "Staf HRD yang mengelola master data karyawan & organisasi",
    needs: "CRUD employee, organization, position, dan seluruh lookup master",
  },
  {
    role: "HR Manager",
    desc: "Approver dan pengawas seluruh proses HR",
    needs: "Approval inbox, Personnel Action, monitoring disciplinary",
  },
  {
    role: "Employee",
    desc: "Karyawan penerima aksi HR (via modul ESS)",
    needs: "Menerima Personnel Action, surat, email notifikasi",
  },
  {
    role: "Superadmin",
    desc: "Admin sistem dan keamanan",
    needs: "User access, scheme akses data, konfigurasi approval engine",
  },
];

export const techStack = [
  { layer: "Framework", tech: "Next.js 16 (App Router) + TypeScript 5", note: "UI interaktif ala ExtJS grid" },
  { layer: "Styling / UI", tech: "Tailwind CSS 4 + shadcn/ui (New York) + Lucide", note: "DataGrid memakai TanStack Table" },
  { layer: "Database", tech: "Prisma ORM + PostgreSQL 17 (multi-tenant schema-per-tenant)", note: "Platform: prisma/schema.prisma · Domain: prisma/schema-tenant.prisma" },
  { layer: "Auth", tech: "Session login (Employee Id + password)", note: "Multi-company session, forgot password" },
  { layer: "State", tech: "Zustand (client) + TanStack Query (server)", note: "" },
  { layer: "Export", tech: "Engine template DOCX/PDF", note: "Letter Generator & Preview grid" },
  { layer: "API", tech: "REST /api/* (route handlers)", note: "Bukan server action" },
];

export type TreeNode = {
  label: string;
  path?: string;
  note?: string;
  children?: TreeNode[];
};

export const menuTree: TreeNode[] = [
  {
    label: "1. Organization Definition",
    children: [
      { label: "Company", path: "/Company", note: "Master perusahaan multi-company + logo + auto employee id" },
      { label: "Company Chart", path: "/CompanyChart" },
      { label: "Change Company", path: "/ChangeCompany", note: "Switch company aktif saat runtime" },
      { label: "Organization Unit", path: "/OrganizationUnit", note: "Unit organisasi bertingkat (parent-child)" },
      { label: "Organization Structure", path: "/OrganizationStructureTree", note: "Tree hierarki + based-on-date" },
      { label: "Organization Chart", path: "/OrganizationChart" },
      { label: "Human Resource Period", path: "/HrbasePeriod", note: "Periode aktif per fungsi (rekrut, training, PA...)" },
      { label: "Company Event Notifier", path: "/CompanyNotifier" },
      { label: "Brand", path: "/Brand" },
      { label: "Outlet", path: "/Outlet", note: "Retail: service charge %, fix allowance" },
    ],
  },
  {
    label: "2. Position Definition",
    children: [
      { label: "Position", path: "/Position", note: "Struktur posisi + grade + level + valid date" },
      { label: "Position Structure", path: "/PositionStructureTree" },
      { label: "Position Chart", path: "/PositionChart" },
      { label: "Query - Position Vacant", path: "/QueryPositionVacant", note: "Kebutuhan vs terisi (vacancy)" },
      { label: "Position Description", path: "/PositionDescription" },
      { label: "Position Qualification", path: "/PositionQualification" },
      { label: "DISC Profile Analysis", path: "/DISCProfileAnalysis", note: "Profil D/I/S/C per karyawan" },
      { label: "Job", path: "/Job" },
    ],
  },
  {
    label: "3. Employee Information",
    children: [
      { label: "New Employee Wizard", path: "/NewEmployeeWiz", note: "5 langkah onboarding — proses inti" },
      { label: "Employee Personal Information", path: "/EmployeePersonalInfo", note: "Grid 37 kolom data pribadi" },
      { label: "Request Personal Data Changes", path: "/RequestPersonalDataChanges", note: "Pengajuan ubah data → approval" },
      { label: "Employee Working Information", path: "/EmployeeWorkingInfo", note: "Grid 35 kolom data kepegawaian" },
      { label: "Employee Position Structure", path: "/EmployeeStructureTree" },
      { label: "Employee Supervisory Chart", path: "/EmployeeChart" },
      { label: "Personnel Action", path: "/PersonnelAction", note: "12 jenis aksi + workflow approval" },
      { label: "Personnel Action Approval", path: "/PersonnelActionToApprove", note: "Inbox approval HR" },
      { label: "Letter Generator", path: "/LetterGenerator", note: "Generate surat massal dari template" },
      { label: "Letter Generator Result", path: "/LetterGeneratorResult" },
      {
        label: "Query (17 halaman)",
        children: [
          { label: "Employee Address" }, { label: "Employee Contact" },
          { label: "Employee Identification" }, { label: "Employee Family" },
          { label: "Employee Emergency" }, { label: "Employee Work Experience" },
          { label: "Employee Education" }, { label: "Employee License" },
          { label: "Employee Physical" }, { label: "Employment History" },
          { label: "Organization Unit Change History" }, { label: "Position Assignment History" },
          { label: "Grade Change History" }, { label: "Company Office Change History" },
          { label: "Work Location Change History" }, { label: "Psychological Profile" },
          { label: "Achievement / Employee Information" },
        ],
      },
      {
        label: "Disciplinary Action",
        children: [
          { label: "Issue Employee Disciplinary", path: "/IssueEmployeeDisciplinary", note: "Form SP + Submit & Print" },
          { label: "Employee Disciplinary History", path: "/EmployeeDisciplinary" },
        ],
      },
      {
        label: "Terminated Employee Information",
        children: [
          { label: "Personal Information", path: "/NonActiveEmployeePersonalInfo" },
          { label: "Working Information", path: "/NonActiveEmployeeWorkingInfo" },
          { label: "Blacklist", path: "/Blacklist", note: "Blokir re-hire berdasar No. KTP" },
        ],
      },
    ],
  },
  {
    label: "4. Wage and Accounting Rules",
    children: [
      { label: "Wage Component", path: "/WageCode", note: "Komponen upah (code, type payroll & time)" },
      { label: "Account Group", path: "/AccountGroup" },
      { label: "Account", path: "/Account", note: "Chart of accounts" },
      { label: "Analysis Definition", path: "/AnalysisDefinition", note: "Dimensi analisis (cost center dll)" },
      { label: "Posting Event", path: "/PostingEvent" },
      { label: "Posting Event Chart of Account", path: "/EventAccount", note: "Mapping event → account D/K + 10 analysis" },
      { label: "Posting Transaction to Accounting", path: "/TransferEvent", note: "Jurnal siap posting" },
      { label: "Transaction Journal Account", path: "/PostingAccount", note: "Rekap per accounting period" },
      { label: "Accurate User Connection", path: "/AccurateConnection", note: "Token integrasi software Accurate" },
    ],
  },
  {
    label: "5. General Setting",
    children: [
      { label: "Award Type / Award Name", note: "Master penghargaan karyawan" },
      { label: "Country / Company Group / Currency / Exchange Rate", note: "Master geografi & mata uang" },
      { label: "Education Field / Institution / Level", note: "Master pendidikan" },
      { label: "Functional Area / Line of Business / Language", note: "Master klasifikasi" },
      { label: "License Type / Physical & Psychological Characteristic", note: "Master profil personal" },
      { label: "Unit of Measurement / Qualitative Measurement", note: "Master pengukuran" },
      { label: "Reminder Setting / Miscellaneous Benefit", note: "Reminder & benefit lain-lain" },
      { label: "Resignation Reason / Answer Criteria / FasKes", note: "Master alasan resign, kriteria, faskes BPJS" },
      { label: "Exit Interview Setting", note: "Kategori / pertanyaan / template interview" },
      {
        label: "Organization Setting",
        children: [
          { label: "Cost Center" }, { label: "Organization Level" },
          { label: "Position Grade / Position Level" },
          { label: "Article and Download Setting", note: "Publikasi file perusahaan" },
          { label: "News Ticker Setting" },
          { label: "Letter Template", note: "Template surat + upload JSON fields" },
        ],
      },
      { label: "Warning Level Disciplinary", note: "Tingkat SP + penalty + validity" },
      {
        label: "Employee Setting",
        children: [
          { label: "Employee Grade" }, { label: "Employee Category" },
          { label: "Name Configurator", note: "Aturan penyusunan nama display" },
          { label: "Contract Category", note: "Jenis kontrak + durasi bulan" },
        ],
      },
    ],
  },
  {
    label: "6. Security Setting",
    children: [
      { label: "User Access", path: "/UserWithPerson", note: "Mapping user ↔ person" },
      { label: "User Access Setup", path: "/UserAccessSetup", note: "7 grup akses modul (HR, Payroll, ...)" },
      { label: "Scheme Setup", path: "/SchemeSetup", note: "Data-scope: bawahan per struktur" },
    ],
  },
  {
    label: "7. Multiple Approval",
    children: [
      { label: "Approval Process", path: "/ApprovalProcess", note: "14 jenis dokumen + SLA hari" },
      { label: "Approval Process Template", path: "/ApprovalProcessTemplate", note: "Binding proses → template + 10 rule" },
      { label: "Approval Template", path: "/ApprovalTemplate", note: "Level approver, auto-approve" },
      { label: "Temporary Approver", path: "/TemporaryApprover", note: "Delegasi approver per jenis dokumen" },
      { label: "Query - Pending Approval", path: "/QueryPendingApproval" },
      { label: "Query - Pending Approval By User", path: "/QueryPendingApprovalByUser" },
    ],
  },
];

export const gridToolbar = [
  "Display All", "Preview", "Table", "Refresh", "Search", "Delete",
  "New", "Duplicate", "Edit", "Operation", "Apply", "Count", "Save", "Cancel",
];

export type Entity = { name: string; path?: string; fields: string[]; note?: string };

export const dataModel: { group: string; entities: Entity[] }[] = [
  {
    group: "Organization",
    entities: [
      {
        name: "Company",
        path: "/Company",
        fields: ["companyId*", "name*", "parentCompanyId", "registrationNo", "socialInsuranceNo", "taxCompulsionNo (NPWP)", "bpjsKesehatanNo", "lineOfBusinessId", "defaultCurrencyCode*", "leaderCompanyId", "leaderEmployeeId", "logo", "autoGenerateEmployeeId", "resetIdGeneratorType", "establishedDate", "companyType", "companyGroupId", "useCompanyOfficeAsOutlet", "idTku"],
        note: "Root of multi-company; auto-generate employee id (MII000001...)",
      },
      {
        name: "OrganizationUnit",
        path: "/OrganizationUnit",
        fields: ["companyId", "organizationId*", "name*", "parentOrganizationId", "costCenter", "organizationLevel", "validFrom", "validTo"],
        note: "Contoh: 001 CEO → 002 MANAGEMENT → 014 FINANCE → 019 ACCOUNTING",
      },
      {
        name: "HrbasePeriod",
        path: "/HrbasePeriod",
        fields: ["companyId", "periodId", "startDate", "endDate", "forRecruitment", "forTraining", "forEmployeeDevelopment", "forPerformanceAssessment", "forMedical", "forTravel"],
      },
      { name: "CompanyNotifier", path: "/CompanyNotifier", fields: ["companyId", "notifierId", "description", "enable"] },
      { name: "Brand", path: "/Brand", fields: ["brandId", "brandDescription", "brandLogo"] },
      { name: "Outlet", path: "/Outlet", fields: ["outletId", "brandId", "description", "type", "salesSource", "salesFromOutlet", "serviceChargePayment (%)", "fixAllowance"] },
    ],
  },
  {
    group: "Position",
    entities: [
      { name: "Job", path: "/Job", fields: ["jobId", "jobTitle", "validFrom", "validTo", "companyId"] },
      {
        name: "Position",
        path: "/Position",
        fields: ["companyId", "positionId*", "internalTitle", "parentPositionId", "externalTitle", "description", "positionGrade", "positionLevel", "validFrom", "validTo", "useFixRateSC", "jobId"],
      },
      {
        name: "DiscProfileAnalysis",
        path: "/DISCProfileAnalysis",
        fields: ["companyId", "employeeId", "employeeName", "dominance", "influence", "steadiness", "compliance", "positionId", "positionTitle"],
      },
      { name: "PositionVacant (computed)", path: "/QueryPositionVacant", fields: ["companyId", "positionId", "positionTitle", "noOfEmployee", "noOfRequired", "noOfVacant", "baseOnDate"], note: "Vacant = required − employees (as-of date)" },
    ],
  },
  {
    group: "Employee",
    entities: [
      {
        name: "Employee — Personal",
        path: "/EmployeePersonalInfo",
        fields: ["employeeId* (MII000001)", "personId*", "firstName*", "lastName", "middleName", "birthName", "salutation", "alias", "preNameTitle", "postNameTitle", "citizenship", "tkCode", "socialInsuranceNo", "socialInsuranceJoinDate", "gender*", "maritalStatus*", "placeOfBirth", "dateOfBirth", "religion", "bloodType", "picture", "userId", "employeeCategory", "bpjsKesehatanNo", "bpjsKesehatanJoinDate", "careClass", "healthFacilityCode", "healthFacilityName", "firstJoinDate", "blacklist"],
        note: "37 kolom; employee baru hanya via Wizard (tidak ada tombol New)",
      },
      {
        name: "Employee — Working",
        path: "/EmployeeWorkingInfo",
        fields: ["supervisorCompanyId*", "supervisorEmployeeId*", "employeeStatus*", "probation (months)", "employmentType*", "contractCategoryId", "contractPeriodMonths", "remunerationType*", "absenceCardNo", "joinDate*", "organizationId*", "positionId*", "grade", "companyOffice*", "workLocation", "note", "yearsInService", "yearsInGroup"],
        note: "35 kolom; perubahan struktural wajib via Personnel Action",
      },
      { name: "Address", fields: ["addressId", "addressType", "address", "city", "province", "postalCode", "country", "phone", "fax", "district", "subdistrict", "RT", "RW"] },
      { name: "ContactMethod", fields: ["contactNo", "contactType", "contactNumber", "isDefault"] },
      { name: "Identification", fields: ["identificationType (KTP/Paspor)", "idNumber", "validFrom", "validTo", "placeOfIssue"] },
      { name: "Family", fields: ["familyName", "idNumber", "relationship", "gender", "dateOfBirth", "maritalStatus", "isPayrollDependent", "isMedicalDependent", "isBpjsKesehatanDependent", "isDead", "lastEducationLevel", "healthFacilityCode", "address", "phone"] },
      { name: "WorkExperience", fields: ["lineOfBusiness", "company", "startDate", "endDate", "division", "location", "lastSalary", "jobTitle", "supervisorName", "jobDescription", "reasonOfLeaving"] },
      { name: "Education", fields: ["educationLevel", "educationField", "institution", "location", "gpa", "startYear", "endYear", "achievement", "note"] },
      { name: "EmploymentPeriod (history)", fields: ["joinDate", "terminationDate", "employeeStatus", "employmentType", "note"] },
      { name: "PositionAssignment (history)", fields: ["positionId", "positionGrade", "positionLevel", "startDate", "endDate", "isPrimaryPosition"] },
      { name: "GradeInterval (history)", fields: ["grade", "validFrom", "validTo"] },
    ],
  },
  {
    group: "Personnel Action & Disciplinary",
    entities: [
      {
        name: "PersonnelAction",
        path: "/PersonnelAction",
        fields: ["companyId", "actionNo", "personnelActionType* (12 jenis)", "status", "recipientEmployeeId*", "recipientName", "noPromote", "noSalaryIncrement", "reasonToIssue", "effectiveDate*", "sendEmailToRecipient", "letterNo", "dateOfIssue", "refLetterNo", "refLetterDate", "acceptedDate", "templateCode", "createdBy", "createdName"],
      },
      {
        name: "EmployeeDisciplinary",
        path: "/IssueEmployeeDisciplinary",
        fields: ["companyId", "employeeId*", "disciplinaryNo", "warningLevel*", "incidentDate*", "violation*", "violationDegree", "violationType", "effectViolation", "adviceGiven", "sanctionGiven", "note", "dateIssue*", "letterNo", "expiryDate*", "issuerCompanyId*", "issuedBy*"],
      },
      { name: "Blacklist", path: "/Blacklist", fields: ["idNo (KTP)", "birthDate", "personName", "companyId", "employeeId", "gender", "reason"] },
    ],
  },
  {
    group: "Wage & Accounting",
    entities: [
      { name: "WageComponent", path: "/WageCode", fields: ["companyId", "wageCode", "wageName", "wageTypePayroll", "wageTypeTime", "timeReportingCode"] },
      { name: "Account", path: "/Account", fields: ["companyId", "accountCode", "description", "accountType", "accountGroupId", "validFrom", "validTo"] },
      { name: "PostingEvent", path: "/PostingEvent", fields: ["companyId", "eventCode", "description", "codeUsed"] },
      { name: "EventAccount", path: "/EventAccount", fields: ["eventCode", "debitCredit", "accountCode", "analysis1..analysis10", "basedOn (Org Unit/Company Office/Employment Type/Position Grade/Employee Grade)"] },
      { name: "TransferEvent (journal)", path: "/TransferEvent", fields: ["journalNo", "journalType", "journalDate", "eventCode", "accountCode", "debit/creditAmount", "currency", "currencyRate", "accountingPeriod", "accountingYear"] },
      { name: "AccurateConnection", path: "/AccurateConnection", fields: ["userId", "accurateUser", "accurateUserEmail", "tokenExpired", "accessCreated", "expiresIn"] },
    ],
  },
  {
    group: "General Setting (lookup)",
    entities: [
      { name: "EducationLevel", fields: ["levelNo", "name", "description", "ranking"] },
      { name: "EducationField", fields: ["fieldNo", "name", "description"] },
      { name: "EducationInstitution", fields: ["institutionNo", "name", "address"] },
      { name: "Country", fields: ["countryCode", "name", "defaultCurrency", "defaultLanguage", "taxCode", "description"] },
      { name: "Currency", fields: ["currencyCode", "description"] },
      { name: "ExchangeRate", fields: ["companyId", "currencyCode", "directRate", "validFrom"] },
      { name: "EmployeeGrade", fields: ["companyId", "gradeId", "ranking", "grade", "gradeInterval", "description"] },
      { name: "EmployeeCategory", fields: ["companyId", "categoryNo", "category", "description", "calculateSC"] },
      { name: "ContractCategory", fields: ["companyId", "contractCategoryNo", "contractCategory", "contractDescription", "durationMonths"] },
      { name: "PositionGrade", fields: ["companyId", "gradeId", "ranking", "grade", "gradeInterval", "description"] },
      { name: "PositionLevel", fields: ["companyId", "posLevelNo", "level", "firstSCPayment", "ranking"] },
      { name: "OrganizationLevel", fields: ["companyId", "orgLevelNo", "level", "ranking"] },
      { name: "CostCenter", fields: ["companyId", "costCenter", "description", "validFrom", "validTo"] },
      { name: "NameConfigurator", fields: ["flag pemakaian: preTitle/firstName/middleName/lastName/postTitle/birthName/alias", "separator per komponen", "display name"] },
      { name: "WarningLevelDisciplinary", fields: ["warningLevel", "wageCode", "scPenaltyRate", "scPenaltyFreq", "warningValidity", "noPromote", "noSalaryInc"] },
      { name: "Award", fields: ["awardName", "description", "awardCriteria", "awardType", "awardPrize", "validFrom", "validTo", "note"] },
      { name: "ResignationReason", fields: ["reasonNo", "reason", "description", "calculateSC"] },
      { name: "FasKes", fields: ["healthFacilityCode", "healthFacilityName", "healthFacilityType", "address", "district", "province"] },
      { name: "ReminderSetting", fields: ["reminderId", "description", "enable", "remindAll", "startReminderBefore", "endReminderAfter", "message"] },
      { name: "LetterTemplate", fields: ["companyId", "templateCode", "templateName", "moduleAccess", "valid", "grantToAll", "fileName", "detailList", "fileNameFields", "fileNameParams"] },
      { name: "FileDownload (Article)", fields: ["companyId", "fileNo", "title", "fileType", "fileName", "enable", "distributeToAll"] },
      { name: "Ticker", fields: ["companyId", "tickerNo", "news", "enable", "distributeAll", "validFrom", "validTo"] },
    ],
  },
  {
    group: "Security & Approval",
    entities: [
      { name: "UserWithPerson", path: "/UserWithPerson", fields: ["userId", "personId", "name", "basedDate"] },
      { name: "UserAccessSetup", path: "/UserAccessSetup", fields: ["moduleAccessId (1-7)", "moduleAccessDescription", "companyId"], note: "7 grup tetap: HR, Payroll, Medical, Travel, Leave & TA, Performance Assessment, Other Strategic" },
      { name: "SchemeSetup", path: "/SchemeSetup", fields: ["companyId", "schemeName", "includeSubordinate", "basedOn (Position Structure/Org Structure/Company Office/Position Grade/Employee Grade)"] },
      { name: "ApprovalProcess", path: "/ApprovalProcess", fields: ["className", "processName", "description", "approvalDays"], note: "14 proses dokumen lintas modul" },
      { name: "ApprovalTemplate", path: "/ApprovalTemplate", fields: ["companyId", "templateName", "autoApprove", "description", "(levels...)"] },
      { name: "ApprovalProcessTemplate", path: "/ApprovalProcessTemplate", fields: ["companyId", "processName", "templateName", "ruleParameter (10 flag N^Y)", "byOrganization", "byCompanyOffice", "byPositionLevel", "byPosition", "byNominalAmount", "byCostCenter", "byEmployee", "byBenefitType", "byEmployeeGrade", "byPositionGrade", "+ nilai filter"] },
      { name: "TemporaryApprover", path: "/TemporaryApprover", fields: ["replacedCompanyId", "replacedEmployeeId", "validFrom", "validTo", "replacementCompanyId", "replacementEmployeeId", "reasons", "14 flag per jenis dokumen"] },
    ],
  },
];

export const wizardSteps = [
  {
    title: "Step 1 — Personal Info",
    fields: ["EmployeeId (auto)", "PersonId*", "FirstName*", "LastName", "MiddleName", "BirthName", "Alias", "Salutation", "Pre/PostNameTitle", "EmployeeCategory", "Gender*", "MaritalStatus*", "PlaceOfBirth", "DateOfBirth", "Religion", "BloodType", "Citizenship", "TKCode", "SocialInsuranceNo + join", "Picture (upload)", "UserId + RoleGroupId", "KTP Number*", "MobileNumber", "Email"],
  },
  {
    title: "Step 2 — Working Info",
    fields: ["SupervisorCompanyId*", "SupervisorId*", "EmployeeStatus* (Active)", "Probation (bulan)", "EmployeeType* (Permanent/Contract/Temporary)", "ContractCategory", "ContractPeriodMonths", "RemunerationType* (Monthly...)", "AbsenceCardNo", "JoinDate*", "OrganizationId*", "PositionId*", "Grade", "CompanyOffice*", "WorkLocation", "Note"],
  },
  {
    title: "Step 3 — Salary Info",
    fields: ["NPWP No", "NPWP SubmittedDate", "SkipBasicSalary", "BasicSalary*", "Currency* (Rupiah)", "BasicSalaryUnit* (Month)", "ProcessMethod* (GrossToNet)", "PaymentFrequency* (Monthly)", "WageTemplate*", "PayrollDependentAllowed"],
  },
  {
    title: "Step 4 — Work Schedule",
    fields: ["ScheduleType*", "Description", "1stMondaySequence*", "FromDate*", "ValidUntil* (default 01 Jan 9999)"],
  },
  {
    title: "Step 5 — Medical / BPJS",
    fields: ["BPJS Kesehatan No", "BPJS Kesehatan JoinDate", "CareClass", "HealthFacilityCode (FasKes)", "HealthFacilityName"],
    note: "Finish → simpan atomik semua langkah",
  },
];

export const paTypes = [
  "Transfer Employee", "Promote Employee", "Demote Employee", "Adjust Employee Grade",
  "Confirm Probationary Employee", "Extend Probation Period", "Terminate Employee",
  "Extend Employee Contract", "Change Employment Type", "Assign Non-Primary Position",
  "Release Non-Primary Position", "Transfer Across Company",
];

export const paFlow = {
  operations: ["Generate Personnel Action", "Submit", "Return to Prepare", "Approve", "Reject", "Cancel", "Process", "Cancel Approval"],
  statuses: ["Prepared", "Submitted (waiting approval)", "Approved", "Rejected", "Cancelled", "Cancel Approved"],
};

export const approvalProcesses = [
  "Employee Benefit Claim", "Employee Clocking", "Employee Loan", "Employee Overtime Work Order",
  "Employee Work Day Request Changes", "Employee Work Off Permission", "Employee Leave Encashment",
  "Employee Leave Request", "Medical Benefit Adjustment", "Medical Benefit Claim",
  "Personnel Action", "Personnel Requisition", "Travel Claim", "Travel Request",
];

export const approvalTemplates = [
  "Approval 1 Layer", "Approval 2 Layer", "Approval Payroll", "Auto Approve",
  "BY PA", "CABANG A", "Direct SPV", "DIRUT", "HRD", "leave", "Single Approve", "test111",
];

export const processes = [
  {
    id: "setup",
    title: "6.1 Setup Awal Perusahaan",
    steps: [
      "Buat Company (parent opsional, logo, currency default, auto-generate employee id aktif)",
      "Definisikan Cost Center, Organization Level, Brand/Outlet (retail)",
      "Buat Organization Unit bertingkat → visualisasi di Organization Structure/Chart",
      "Definisikan Job lalu Position (parent-child = struktur pelaporan, grade, level)",
      "Atur HrbasePeriod (periode aktif per fungsi: rekrutmen, training, PA, medical, travel)",
      "Setup General Setting lookups & Name Configurator (format penyusunan nama)",
      "Setup User Access + Scheme + Multiple Approval sebelum transaksi",
    ],
  },
  {
    id: "onboard",
    title: "6.2 Onboarding — New Employee Wizard",
    steps: [
      "Step 1 PERSONAL INFO: identitas lengkap + KTP* + upload foto + opsional user login",
      "Step 2 WORKING INFO: atasan*, status, tipe, organisasi*, posisi*, join date*",
      "Step 3 SALARY INFO: gaji pokok*, currency, process method GrossToNet, wage template*",
      "Step 4 WORK SCHEDULE: tipe jadwal*, minggu pertama, periode berlaku",
      "Step 5 MEDICAL/BPJS: nomor & tanggal BPJS, kelas rawat, FasKes",
      "Finish → simpan atomik; EmploymentPeriod history otomatis terbentuk (joinDate)",
    ],
  },
  {
    id: "steady",
    title: "6.3 Pengelolaan Data Karyawan (Steady State)",
    steps: [
      "Employee Personal/Working Information: view & edit; karyawan baru hanya via wizard",
      "Perubahan struktural (org/posisi/grade) wajib lewat Personnel Action — bukan edit langsung",
      "Request Personal Data Changes: pengajuan perubahan data pribadi → alur approval",
      "17 halaman Query read-only dengan filter Based on Date (as-of query historis)",
      "Letter Generator: surat massal dari template — PDF/DOCX, password, multi-bahasa, ZIP",
    ],
  },
  {
    id: "pa",
    title: "6.4 Personnel Action — Siklus Hidup Karyawan (Inti)",
    steps: [
      "Pilih jenis aksi (12 pilihan) + karyawan penerima + effective date + template surat",
      "Submit → Multiple Approval menentukan approver (atasan via struktur / role / delegasi)",
      "Approver memproses lewat inbox Personnel Action Approval (approve/reject, bisa massal)",
      "Approved → Process: interval history lama ditutup (validTo), record baru dibuat",
      "Data employee ter-update pada effectiveDate; surat digenerate dari LetterTemplate",
      "Operasi lain: Return to Prepare, Cancel, Cancel Approval, Generate massal (mis. probation habis)",
    ],
  },
  {
    id: "disc",
    title: "6.5 Disciplinary Action",
    steps: [
      "Setup Warning Level: SP 1/2/3 → penalty service charge, validity bulan, noPromote, noSalaryInc",
      "Issue Employee Disciplinary: warning level*, incident date*, violation*, expiry*, issuer*",
      "Submit / Submit and Print → surat SP otomatis dari template",
      "Efek: SP aktif memblokir promosi & kenaikan gaji sampai expiry",
      "Blacklist: blokir re-hire berdasar No. KTP + tanggal lahir + alasan",
    ],
  },
  {
    id: "approval",
    title: "6.6 Multiple Approval Engine (Lintas Modul)",
    steps: [
      "ApprovalProcess: 14 jenis dokumen terdaftar dengan SLA approvalDays",
      "ApprovalTemplate: sekuens level approver (1 Layer, 2 Layer, Direct SPV, DIRUT, HRD, Auto Approve)",
      "ApprovalProcessTemplate: binding per company + 10 rule scoping (org, office, poslevel, posisi, nominal, cost center, employee, benefit type, grade)",
      "Saat Submit: cari template yang match → resolusi approver aktual (atasan recipient / role tetap)",
      "TemporaryApprover: delegasi dengan masa berlaku + flag per jenis dokumen",
      "Inbox dashboard: 'Approval - N <jenis>' → approve semua level = Approved; 1 reject = Rejected",
      "Template Auto Approve → dokumen langsung disetujui tanpa inbox",
    ],
  },
  {
    id: "term",
    title: "6.7 Terminasi & Mantan Karyawan",
    steps: [
      "Personnel Action Terminate Employee dengan alasan dari master ResignationReason",
      "Karyawan berstatus Non-Active → pindah ke Terminated Employee Information (read-only)",
      "Exit interview memakai Interview Category/Question/Template + AnswerCriteria",
      "Opsional masuk Blacklist bila alasan berat",
    ],
  },
  {
    id: "posting",
    title: "6.8 Posting ke Akuntansi",
    steps: [
      "Definisikan WageComponent (komponen upah) dan Account (CoA) dalam AccountGroup",
      "AnalysisDefinition → dimensi (cost center)",
      "PostingEvent + EventAccount: mapping event → account debit/kredit + 10 analysis",
      "Payroll diproses → TransferEvent menyusun jurnal (debit/credit, currency+rate)",
      "PostingAccount: rekap per accounting period → kirim ke Accurate via token connection",
    ],
  },
  {
    id: "security",
    title: "6.9 Keamanan & Akses Data",
    steps: [
      "User Access: 1 user login ↔ 1 person/employee (user dibuat via wizard RoleGroup)",
      "User Access Setup: 7 grup akses modul → menu tree ter-filter sesuai grup user",
      "SchemeSetup: data-scope — bawahan berdasar Position/Org Structure, Company Office, atau Grade",
      "Change Company: switch company aktif → semua grid ter-filter companyId",
    ],
  },
  {
    id: "notif",
    title: "6.10 Notifikasi & Konten Internal",
    steps: [
      "Reminder Setting: reminder sistem (SP expiry, probation habis) — start before / end after",
      "Article & Download: publikasi peraturan perusahaan per kategori + distribute to all",
      "News Ticker: teks berjalan di header dengan masa berlaku",
      "Company Event Notifier + HrbasePeriod: kontrol periode & event",
    ],
  },
];

export const phases = [
  {
    phase: "Phase 1 — Fondasi",
    color: "bg-orange-600",
    items: [
      { id: "F01", fitur: "Login/Logout + session company", ac: "Login EmployeeId+password; forgot password" },
      { id: "F02", fitur: "App shell: header, nav tree, dashboard, footer sticky", ac: "Semua elemen §4.1; nav collapsible" },
      { id: "F03", fitur: "DataGrid Page Engine generik", ac: "Toolbar standar; paging; sorting; kolom terkonfigurasi" },
      { id: "F04", fitur: "CRUD Company + Chart + Change Company", ac: "Multi-company switch" },
      { id: "F05", fitur: "CRUD Organization Unit + tree + chart", ac: "Hierarki; based-on-date" },
      { id: "F06", fitur: "CRUD Job + Position + structure/chart", ac: "Valid from/to" },
      { id: "F07", fitur: "CRUD General Setting lookups", ac: "30+ master standar" },
      { id: "F08", fitur: "Employee Grade/Category, Contract Category, Name Configurator", ac: "Nama display sesuai konfigurasi" },
    ],
  },
  {
    phase: "Phase 2 — Employee Lifecycle",
    color: "bg-amber-600",
    items: [
      { id: "F09", fitur: "New Employee Wizard 5 langkah", ac: "Validasi per step; Finish atomik; auto employee id" },
      { id: "F10", fitur: "Employee Personal Information", ac: "Grid+edit 37 field; tanpa New" },
      { id: "F11", fitur: "Employee Working Information", ac: "Based-on-date; history intervals" },
      { id: "F12", fitur: "Entitas detail + 17 halaman Query", ac: "CRUD detail; query as-of" },
      { id: "F13", fitur: "Personnel Action entry + 12 jenis", ac: "Validasi recipient & effective date" },
      { id: "F14", fitur: "Workflow PA (Operation menu)", ac: "Generate/Submit/Return/Approve/Reject/Cancel/Process" },
      { id: "F15", fitur: "Personnel Action Approval (inbox)", ac: "Filter menunggu saya; approve massal" },
      { id: "F16", fitur: "Process PA → update master", ac: "Interval history terbentuk otomatis" },
      { id: "F17", fitur: "Terminated Employee + Blacklist", ac: "Non-aktif views; blacklist by idNo" },
    ],
  },
  {
    phase: "Phase 3 — Approval Engine & Security",
    color: "bg-emerald-600",
    items: [
      { id: "F18", fitur: "Approval Process/Template/Process Template", ac: "CRUD; 10 rule parameter" },
      { id: "F19", fitur: "Approval routing saat Submit", ac: "Resolusi atasan; auto-approve; SLA" },
      { id: "F20", fitur: "Temporary Approver", ac: "Delegasi per jenis dokumen" },
      { id: "F21", fitur: "Scheme Setup + data scoping", ac: "Query & inbox ter-scope" },
      { id: "F22", fitur: "User Access + 7 module group", ac: "Menu ter-filter per grup" },
    ],
  },
  {
    phase: "Phase 4 — Lanjutan",
    color: "bg-rose-600",
    items: [
      { id: "F23", fitur: "Disciplinary lengkap", ac: "Efek noPromote; expiry otomatis" },
      { id: "F24", fitur: "Letter Generator + Template", ac: "Massal DOCX/PDF + password + multi-bahasa" },
      { id: "F25", fitur: "Wage & Accounting + posting", ac: "Journal; token Accurate" },
      { id: "F26", fitur: "Reminder, News, Ticker, Article, Period, Notifier", ac: "Tampil di dashboard" },
      { id: "F27", fitur: "Query Position Vacant & DISC", ac: "Vacant = required − employees; profil D/I/S/C" },
    ],
  },
];

export const nfr = [
  { title: "Multi-company", desc: "Semua endpoint ter-scope companyId session; global lookup (Country/Currency) dikecualikan" },
  { title: "Effective dating", desc: "Query historis via basedOnDate; interval validFrom/validTo (default 9999-12-31)" },
  { title: "Audit", desc: "entriedBy/entriedDate/createdBy pada transaksi; optimistic locking (ganti golid/golversion)" },
  { title: "Performa", desc: "Server-side pagination; bulk generate via background job" },
  { title: "Keamanan", desc: "Password hash; session; role-based menu; data-scope scheme" },
  { title: "Lokal Indonesia", desc: "Tanggal 01 Sep 2026; Rupiah; BPJS/KTP/NPWP/FasKes/TKU; alamat RT/RW" },
];

export const glossary = [
  { term: "BPJS", def: "Badan Penyelenggara Jaminan Sosial (TK: ketenagakerjaan; Kesehatan: kesehatan)" },
  { term: "FasKes", def: "Fasilitas Kesehatan (rumah sakit/klinik BPJS)" },
  { term: "NPWP", def: "Nomor Pokok Wajib Pajak" },
  { term: "KTP", def: "Kartu Tanda Penduduk" },
  { term: "ID TKU", def: "ID tenaga kerja unik (integrasi Coretax)" },
  { term: "SC", def: "Service Charge" },
  { term: "SPV / DIRUT", def: "Supervisor / Direktur Utama" },
  { term: "PA", def: "Personnel Action — dokumen transaksi perubahan status karyawan" },
  { term: "golid/golversion", def: "PK & version kolom sistem legacy → rebuild sebagai id + version" },
];

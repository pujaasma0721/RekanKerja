-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "taxId" TEXT,
    "address" TEXT,
    "city" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "logoUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgUnit" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "companyId" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "headcountBudget" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Grade" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minSalary" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxSalary" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Grade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "jobId" TEXT,
    "orgUnitId" TEXT,
    "gradeId" TEXT,
    "level" TEXT,
    "headcount" INTEGER NOT NULL DEFAULT 1,
    "filled" INTEGER NOT NULL DEFAULT 0,
    "reportsToId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "employeeNo" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "gender" TEXT NOT NULL DEFAULT 'M',
    "birthPlace" TEXT,
    "birthDate" TIMESTAMP(3),
    "nationalId" TEXT,
    "taxId" TEXT,
    "bpjsHealth" TEXT,
    "bpjsEmpSkill" TEXT,
    "maritalStatus" TEXT,
    "religion" TEXT,
    "bloodType" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "photoUrl" TEXT,
    "bankName" TEXT,
    "bankAccount" TEXT,
    "companyId" TEXT NOT NULL,
    "joinDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'Active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeAssignment" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "positionId" TEXT,
    "gradeId" TEXT,
    "managerId" TEXT,
    "employmentStatus" TEXT NOT NULL DEFAULT 'Permanent',
    "workShift" TEXT NOT NULL DEFAULT 'Regular',
    "baseSalary" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "changeReason" TEXT NOT NULL DEFAULT 'Initial',
    "sourceDocNo" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeFamily" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gender" TEXT NOT NULL DEFAULT 'M',
    "birthDate" TIMESTAMP(3),
    "occupation" TEXT,
    "isDependent" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "EmployeeFamily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeEducation" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "institution" TEXT NOT NULL,
    "major" TEXT,
    "startYear" INTEGER,
    "endYear" INTEGER,
    "gpa" DOUBLE PRECISION,

    CONSTRAINT "EmployeeEducation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeExperience" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "EmployeeExperience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisciplinaryRecord" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "warningLevel" TEXT NOT NULL DEFAULT 'Verbal',
    "violation" TEXT NOT NULL,
    "sanction" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "DisciplinaryRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonnelAction" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "detailJson" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Prepared',
    "currentLayer" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "PersonnelAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalLayer" (
    "id" TEXT NOT NULL,
    "personnelActionId" TEXT NOT NULL,
    "layerNo" INTEGER NOT NULL,
    "approverRole" TEXT NOT NULL,
    "approverId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "note" TEXT,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "ApprovalLayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WageComponent" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'Earning',
    "wageType" TEXT NOT NULL DEFAULT 'Compensation',
    "calcMethod" TEXT NOT NULL DEFAULT 'Fixed',
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "formula" TEXT,
    "incomeTaxMethod" TEXT NOT NULL DEFAULT 'Regular',
    "processMethod" TEXT NOT NULL DEFAULT 'GrossToNet',
    "roundingType" TEXT NOT NULL DEFAULT 'Nearest',
    "roundingValue" INTEGER NOT NULL DEFAULT 1,
    "prorated" BOOLEAN NOT NULL DEFAULT false,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "includeInBasicIncome" BOOLEAN NOT NULL DEFAULT false,
    "includeInTHP" BOOLEAN NOT NULL DEFAULT true,
    "displayInPaySlip" BOOLEAN NOT NULL DEFAULT true,
    "applyThrRules" BOOLEAN NOT NULL DEFAULT false,
    "jamsostekBasis" TEXT,
    "sptReference" TEXT,
    "naturaType" TEXT,
    "wageCodeBackPay" TEXT,
    "accountDebitCode" TEXT,
    "accountCreditCode" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WageComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollPeriod" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "payType" TEXT NOT NULL DEFAULT 'Monthly',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "taStartDate" TIMESTAMP(3),
    "taEndDate" TIMESTAMP(3),
    "payPeriod" INTEGER NOT NULL DEFAULT 0,
    "sptMonth" INTEGER NOT NULL,
    "sptYear" INTEGER NOT NULL,
    "processDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'Open',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "calculateTax" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProcessType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WageTemplate" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WageTemplateItem" (
    "id" TEXT NOT NULL,
    "wageTemplateId" TEXT NOT NULL,
    "wageComponentId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WageTemplateItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeePayrollProfile" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "npwp" TEXT,
    "npwpSubmittedAt" TIMESTAMP(3),
    "idtku" TEXT,
    "hasNpwp" BOOLEAN NOT NULL DEFAULT true,
    "processMethod" TEXT NOT NULL DEFAULT 'GrossToNet',
    "paymentFrequency" TEXT NOT NULL DEFAULT 'Monthly',
    "wageTemplateId" TEXT,
    "taxStatus" TEXT NOT NULL DEFAULT 'TK0',
    "dependents" INTEGER NOT NULL DEFAULT 0,
    "payrollDependentAllowed" BOOLEAN NOT NULL DEFAULT true,
    "bankName" TEXT,
    "bankAccount" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "EmployeePayrollProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxBracket" (
    "id" TEXT NOT NULL,
    "bracketType" TEXT NOT NULL DEFAULT 'Income',
    "lowerLimit" DOUBLE PRECISION NOT NULL,
    "upperLimit" DOUBLE PRECISION,
    "rateNpwp" DOUBLE PRECISION NOT NULL,
    "rateNonNpwp" DOUBLE PRECISION NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),

    CONSTRAINT "TaxBracket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TerRate" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "lowerLimit" DOUBLE PRECISION NOT NULL,
    "upperLimit" DOUBLE PRECISION,
    "rate" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "TerRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRegulation" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "biayaJabatanRate" DOUBLE PRECISION NOT NULL DEFAULT 0.05,
    "biayaJabatanCapMonthly" DOUBLE PRECISION NOT NULL DEFAULT 500000,
    "jhtEmployeeRate" DOUBLE PRECISION NOT NULL DEFAULT 0.02,
    "jhtCompanyRate" DOUBLE PRECISION NOT NULL DEFAULT 0.037,
    "jpEmployeeRate" DOUBLE PRECISION NOT NULL DEFAULT 0.01,
    "jpCompanyRate" DOUBLE PRECISION NOT NULL DEFAULT 0.02,
    "jpSalaryCap" DOUBLE PRECISION NOT NULL DEFAULT 10547400,
    "jkkRate" DOUBLE PRECISION NOT NULL DEFAULT 0.0024,
    "jkmRate" DOUBLE PRECISION NOT NULL DEFAULT 0.003,
    "jpkCompanyRate" DOUBLE PRECISION NOT NULL DEFAULT 0.04,
    "jpkEmployeeRate" DOUBLE PRECISION NOT NULL DEFAULT 0.01,
    "jpkSalaryCap" DOUBLE PRECISION NOT NULL DEFAULT 12000000,
    "nonNpwpSurcharge" DOUBLE PRECISION NOT NULL DEFAULT 0.2,
    "useTer" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PayrollRegulation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" TEXT NOT NULL,
    "runNo" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "processTypeId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "calculateTax" BOOLEAN NOT NULL DEFAULT true,
    "allEmployee" BOOLEAN NOT NULL DEFAULT true,
    "employeeCount" INTEGER NOT NULL DEFAULT 0,
    "totalBruto" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalDeduction" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalTax" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalNet" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "calculatedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRunLine" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "employeeNo" TEXT NOT NULL,
    "employeeName" TEXT NOT NULL,
    "orgUnitName" TEXT,
    "positionName" TEXT,
    "ptkpStatus" TEXT NOT NULL,
    "ptkpValue" DOUBLE PRECISION NOT NULL,
    "bruto" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "deduction" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxRegular" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxIrregular" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "net" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "actualNetTax" DOUBLE PRECISION,
    "notes" TEXT,

    CONSTRAINT "PayrollRunLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRunItem" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "wageType" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "incomeTaxMethod" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PayrollRunItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeLoan" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "letterNo" TEXT NOT NULL,
    "loanDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amount" DOUBLE PRECISION NOT NULL,
    "installmentCount" INTEGER NOT NULL,
    "installmentAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "interestRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "startPaymentDate" TIMESTAMP(3) NOT NULL,
    "purpose" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "paidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "outstanding" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "wageComponentCode" TEXT,

    CONSTRAINT "EmployeeLoan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanInstallment" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "periodCode" TEXT,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "deductedRunNo" TEXT,

    CONSTRAINT "LoanInstallment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeComponentAssignment" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "wageComponentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'Specific',
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "periodId" TEXT,
    "processTypeId" TEXT,
    "basedDate" TIMESTAMP(3),
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeComponentAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollJournal" (
    "id" TEXT NOT NULL,
    "journalNo" TEXT NOT NULL,
    "journalDate" TIMESTAMP(3) NOT NULL,
    "runId" TEXT,
    "runNo" TEXT,
    "description" TEXT,
    "totalDebit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalCredit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Posted',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollJournal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollJournalLine" (
    "id" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "accountCode" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "memo" TEXT,
    "wageCode" TEXT,

    CONSTRAINT "PayrollJournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountGroup" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountType" TEXT NOT NULL DEFAULT 'Expense',

    CONSTRAINT "AccountGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountGroupId" TEXT,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostingEvent" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'PayrollRun',
    "debitAccountId" TEXT,
    "creditAccountId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PostingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenefitType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Umum',
    "description" TEXT,
    "resetPeriod" TEXT NOT NULL DEFAULT 'Monthly',
    "maxClaimAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unlimited" BOOLEAN NOT NULL DEFAULT false,
    "allowOverlimit" BOOLEAN NOT NULL DEFAULT false,
    "needDocuments" BOOLEAN NOT NULL DEFAULT false,
    "autoApproveInLimit" BOOLEAN NOT NULL DEFAULT true,
    "payInPayroll" BOOLEAN NOT NULL DEFAULT true,
    "wageComponentId" TEXT,
    "entitleFor" TEXT NOT NULL DEFAULT 'All',
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BenefitType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenefitClaim" (
    "id" TEXT NOT NULL,
    "claimNo" TEXT NOT NULL,
    "benefitTypeId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "claimDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amount" DOUBLE PRECISION NOT NULL,
    "approvedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "description" TEXT,
    "documentsNote" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "limitUsed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "limitRemaining" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "inLimit" BOOLEAN NOT NULL DEFAULT true,
    "periodId" TEXT,
    "paidRunNo" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BenefitClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lookup" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Lookup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppUser" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "role" TEXT NOT NULL DEFAULT 'HR Staff',
    "employeeId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLogin" TIMESTAMP(3),

    CONSTRAINT "AppUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessGroup" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "modulesJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessGroupMember" (
    "id" TEXT NOT NULL,
    "appUserId" TEXT NOT NULL,
    "accessGroupId" TEXT NOT NULL,
    "isApprover" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AccessGroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalTemplate" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "docType" TEXT NOT NULL DEFAULT 'PersonnelAction',
    "layersJson" TEXT NOT NULL,
    "autoApprove" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemporaryApprover" (
    "id" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "delegateId" TEXT NOT NULL,
    "docType" TEXT NOT NULL DEFAULT 'PersonnelAction',
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TemporaryApprover_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "actorType" TEXT NOT NULL DEFAULT 'user',
    "appUserId" TEXT,
    "employeeId" TEXT,
    "personnelActionId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_code_key" ON "Company"("code");

-- CreateIndex
CREATE UNIQUE INDEX "OrgUnit_code_key" ON "OrgUnit"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Job_code_key" ON "Job"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Grade_code_key" ON "Grade"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Position_code_key" ON "Position"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_employeeNo_key" ON "Employee"("employeeNo");

-- CreateIndex
CREATE INDEX "EmployeeAssignment_employeeId_validTo_idx" ON "EmployeeAssignment"("employeeId", "validTo");

-- CreateIndex
CREATE INDEX "EmployeeAssignment_validTo_idx" ON "EmployeeAssignment"("validTo");

-- CreateIndex
CREATE UNIQUE INDEX "PersonnelAction_docNo_key" ON "PersonnelAction"("docNo");

-- CreateIndex
CREATE UNIQUE INDEX "WageComponent_code_key" ON "WageComponent"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPeriod_code_key" ON "PayrollPeriod"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessType_code_key" ON "ProcessType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "WageTemplate_code_key" ON "WageTemplate"("code");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeePayrollProfile_employeeId_key" ON "EmployeePayrollProfile"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRegulation_code_key" ON "PayrollRegulation"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_runNo_key" ON "PayrollRun"("runNo");

-- CreateIndex
CREATE INDEX "PayrollRunLine_employeeId_idx" ON "PayrollRunLine"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRunLine_runId_employeeId_key" ON "PayrollRunLine"("runId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeLoan_letterNo_key" ON "EmployeeLoan"("letterNo");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollJournal_journalNo_key" ON "PayrollJournal"("journalNo");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollJournal_runId_key" ON "PayrollJournal"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountGroup_code_key" ON "AccountGroup"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Account_code_key" ON "Account"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PostingEvent_code_key" ON "PostingEvent"("code");

-- CreateIndex
CREATE UNIQUE INDEX "BenefitType_code_key" ON "BenefitType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "BenefitClaim_claimNo_key" ON "BenefitClaim"("claimNo");

-- CreateIndex
CREATE UNIQUE INDEX "Lookup_category_code_key" ON "Lookup"("category", "code");

-- CreateIndex
CREATE UNIQUE INDEX "AppUser_username_key" ON "AppUser"("username");

-- CreateIndex
CREATE UNIQUE INDEX "AccessGroup_code_key" ON "AccessGroup"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalTemplate_code_key" ON "ApprovalTemplate"("code");

-- AddForeignKey
ALTER TABLE "OrgUnit" ADD CONSTRAINT "OrgUnit_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "OrgUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgUnit" ADD CONSTRAINT "OrgUnit_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "Grade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_reportsToId_fkey" FOREIGN KEY ("reportsToId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAssignment" ADD CONSTRAINT "EmployeeAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAssignment" ADD CONSTRAINT "EmployeeAssignment_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAssignment" ADD CONSTRAINT "EmployeeAssignment_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAssignment" ADD CONSTRAINT "EmployeeAssignment_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "Grade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAssignment" ADD CONSTRAINT "EmployeeAssignment_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeFamily" ADD CONSTRAINT "EmployeeFamily_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeEducation" ADD CONSTRAINT "EmployeeEducation_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeExperience" ADD CONSTRAINT "EmployeeExperience_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisciplinaryRecord" ADD CONSTRAINT "DisciplinaryRecord_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonnelAction" ADD CONSTRAINT "PersonnelAction_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalLayer" ADD CONSTRAINT "ApprovalLayer_personnelActionId_fkey" FOREIGN KEY ("personnelActionId") REFERENCES "PersonnelAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalLayer" ADD CONSTRAINT "ApprovalLayer_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "AppUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WageTemplateItem" ADD CONSTRAINT "WageTemplateItem_wageTemplateId_fkey" FOREIGN KEY ("wageTemplateId") REFERENCES "WageTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WageTemplateItem" ADD CONSTRAINT "WageTemplateItem_wageComponentId_fkey" FOREIGN KEY ("wageComponentId") REFERENCES "WageComponent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeePayrollProfile" ADD CONSTRAINT "EmployeePayrollProfile_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeePayrollProfile" ADD CONSTRAINT "EmployeePayrollProfile_wageTemplateId_fkey" FOREIGN KEY ("wageTemplateId") REFERENCES "WageTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "PayrollPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_processTypeId_fkey" FOREIGN KEY ("processTypeId") REFERENCES "ProcessType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRunLine" ADD CONSTRAINT "PayrollRunLine_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRunLine" ADD CONSTRAINT "PayrollRunLine_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRunItem" ADD CONSTRAINT "PayrollRunItem_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "PayrollRunLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeLoan" ADD CONSTRAINT "EmployeeLoan_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanInstallment" ADD CONSTRAINT "LoanInstallment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "EmployeeLoan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeComponentAssignment" ADD CONSTRAINT "EmployeeComponentAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeComponentAssignment" ADD CONSTRAINT "EmployeeComponentAssignment_wageComponentId_fkey" FOREIGN KEY ("wageComponentId") REFERENCES "WageComponent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeComponentAssignment" ADD CONSTRAINT "EmployeeComponentAssignment_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "PayrollPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeComponentAssignment" ADD CONSTRAINT "EmployeeComponentAssignment_processTypeId_fkey" FOREIGN KEY ("processTypeId") REFERENCES "ProcessType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollJournalLine" ADD CONSTRAINT "PayrollJournalLine_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "PayrollJournal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_accountGroupId_fkey" FOREIGN KEY ("accountGroupId") REFERENCES "AccountGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenefitType" ADD CONSTRAINT "BenefitType_wageComponentId_fkey" FOREIGN KEY ("wageComponentId") REFERENCES "WageComponent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenefitClaim" ADD CONSTRAINT "BenefitClaim_benefitTypeId_fkey" FOREIGN KEY ("benefitTypeId") REFERENCES "BenefitType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenefitClaim" ADD CONSTRAINT "BenefitClaim_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenefitClaim" ADD CONSTRAINT "BenefitClaim_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "PayrollPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessGroupMember" ADD CONSTRAINT "AccessGroupMember_appUserId_fkey" FOREIGN KEY ("appUserId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessGroupMember" ADD CONSTRAINT "AccessGroupMember_accessGroupId_fkey" FOREIGN KEY ("accessGroupId") REFERENCES "AccessGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemporaryApprover" ADD CONSTRAINT "TemporaryApprover_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemporaryApprover" ADD CONSTRAINT "TemporaryApprover_delegateId_fkey" FOREIGN KEY ("delegateId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_appUserId_fkey" FOREIGN KEY ("appUserId") REFERENCES "AppUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_personnelActionId_fkey" FOREIGN KEY ("personnelActionId") REFERENCES "PersonnelAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;


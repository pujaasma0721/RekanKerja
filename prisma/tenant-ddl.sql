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
CREATE TABLE "CompanyOffice" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "phone" TEXT,
    "npwp" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyOffice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkLocation" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "officeId" TEXT,
    "address" TEXT,
    "city" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PositionLevel" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PositionLevel_pkey" PRIMARY KEY ("id")
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
    "positionLevelId" TEXT,

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
    "contractStart" TIMESTAMP(3),
    "contractEnd" TIMESTAMP(3),
    "renewalCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "orgUnitId" TEXT,
    "positionId" TEXT,
    "gradeId" TEXT,
    "positionLevelId" TEXT,
    "companyOfficeId" TEXT,
    "workLocationId" TEXT,

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
    "companyOfficeId" TEXT,
    "workLocationId" TEXT,

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
CREATE TABLE "ApprovalStructure" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "companyOfficeId" TEXT,
    "workLocationId" TEXT,
    "orgUnitId" TEXT,
    "positionId" TEXT,
    "gradeId" TEXT,
    "positionLevelId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalStructure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalStructureLevel" (
    "id" TEXT NOT NULL,
    "structureId" TEXT NOT NULL,
    "levelNo" INTEGER NOT NULL,
    "approverType" TEXT NOT NULL,
    "approverPositionId" TEXT,
    "approverEmployeeId" TEXT,
    "superiorLevel" INTEGER,
    "minAmount" DOUBLE PRECISION,
    "maxAmount" DOUBLE PRECISION,
    "note" TEXT,

    CONSTRAINT "ApprovalStructureLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalChain" (
    "id" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "structureId" TEXT,
    "employeeId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'InProgress',
    "currentLevel" INTEGER NOT NULL DEFAULT 1,
    "totalLevels" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ApprovalChain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalStep" (
    "id" TEXT NOT NULL,
    "chainId" TEXT NOT NULL,
    "levelNo" INTEGER NOT NULL,
    "approverType" TEXT NOT NULL,
    "approverLabel" TEXT NOT NULL,
    "approverEmployeeId" TEXT,
    "approverPositionCode" TEXT,
    "minAmount" DOUBLE PRECISION,
    "maxAmount" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'Waiting',
    "note" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "ApprovalStep_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "MinimumWage" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "companyOfficeId" TEXT,
    "label" TEXT NOT NULL,
    "monthlyAmount" DOUBLE PRECISION NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MinimumWage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" TEXT NOT NULL,
    "runNo" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "processTypeId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "slipPassword" BOOLEAN NOT NULL DEFAULT false,
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
    "umkWarning" BOOLEAN NOT NULL DEFAULT false,
    "umkJson" TEXT,

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
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeDocument" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "docNumber" TEXT,
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "notes" TEXT,
    "attachmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeDocument_pkey" PRIMARY KEY ("id")
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
    "passwordChangedAt" TIMESTAMP(3),

    CONSTRAINT "AppUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "appUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "kind" TEXT,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordPolicy" (
    "id" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "minLength" INTEGER NOT NULL DEFAULT 8,
    "maxLength" INTEGER NOT NULL DEFAULT 64,
    "requireUppercase" BOOLEAN NOT NULL DEFAULT true,
    "requireLowercase" BOOLEAN NOT NULL DEFAULT true,
    "requireNumber" BOOLEAN NOT NULL DEFAULT true,
    "requireSpecial" BOOLEAN NOT NULL DEFAULT true,
    "minUniqueChars" INTEGER NOT NULL DEFAULT 4,
    "maxRepeated" INTEGER NOT NULL DEFAULT 3,
    "maxSequential" INTEGER NOT NULL DEFAULT 3,
    "blockUsername" BOOLEAN NOT NULL DEFAULT true,
    "blockName" BOOLEAN NOT NULL DEFAULT true,
    "blockCommon" BOOLEAN NOT NULL DEFAULT true,
    "lifetimeDays" INTEGER NOT NULL DEFAULT 90,
    "warnDays" INTEGER NOT NULL DEFAULT 7,
    "historyCount" INTEGER NOT NULL DEFAULT 6,
    "maxFailedAttempts" INTEGER NOT NULL DEFAULT 5,
    "lockoutMinutes" INTEGER NOT NULL DEFAULT 15,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PasswordPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordHistory" (
    "id" TEXT NOT NULL,
    "appUserId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "setAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "setById" TEXT,

    CONSTRAINT "PasswordHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailConfig" (
    "id" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "smtpHost" TEXT NOT NULL DEFAULT '',
    "smtpPort" INTEGER NOT NULL DEFAULT 587,
    "smtpSecure" BOOLEAN NOT NULL DEFAULT false,
    "smtpUser" TEXT NOT NULL DEFAULT '',
    "smtpPassword" TEXT NOT NULL DEFAULT '',
    "fromEmail" TEXT NOT NULL DEFAULT '',
    "fromName" TEXT NOT NULL DEFAULT 'OneVity HRIS',
    "lastTestOk" BOOLEAN,
    "lastTestAt" TIMESTAMP(3),
    "lastTestMessage" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notifyEmployee" BOOLEAN NOT NULL DEFAULT true,
    "notifyApprover" BOOLEAN NOT NULL DEFAULT true,
    "notifyHrd" BOOLEAN NOT NULL DEFAULT false,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailLog" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "body" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "DataAccessRule" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "subjectType" TEXT NOT NULL,
    "appUserId" TEXT,
    "accessGroupId" TEXT,
    "role" TEXT,
    "companyOfficeId" TEXT,
    "workLocationId" TEXT,
    "orgUnitId" TEXT,
    "positionId" TEXT,
    "gradeId" TEXT,
    "positionLevelId" TEXT,
    "employmentStatus" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataAccessRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserMenuAccess" (
    "id" TEXT NOT NULL,
    "appUserId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'ALL',
    "menusJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserMenuAccess_pkey" PRIMARY KEY ("id")
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

-- CreateTable
CREATE TABLE "WorkDayType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#99CCFF',
    "category" TEXT NOT NULL DEFAULT 'Workday',
    "timeIn" TEXT,
    "timeOut" TEXT,
    "nextDay" BOOLEAN NOT NULL DEFAULT false,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "breakPaid" BOOLEAN NOT NULL DEFAULT false,
    "normalMinutes" INTEGER NOT NULL DEFAULT 0,
    "toleranceLateMinutes" INTEGER NOT NULL DEFAULT 0,
    "toleranceEarlyMinutes" INTEGER NOT NULL DEFAULT 0,
    "flexible" BOOLEAN NOT NULL DEFAULT false,
    "needOvertimeOrder" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkDayType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkSchedule" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cycleDays" INTEGER NOT NULL DEFAULT 7,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkScheduleDay" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "dayTypeId" TEXT NOT NULL,

    CONSTRAINT "WorkScheduleDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleAssignment" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "anchorMonday" TIMESTAMP(3) NOT NULL,
    "anchorSequence" INTEGER NOT NULL DEFAULT 1,
    "clockingRequired" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceClockLog" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'IN',
    "source" TEXT NOT NULL DEFAULT 'Manual',
    "note" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceClockLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceDaily" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "workDate" TIMESTAMP(3) NOT NULL,
    "dayTypeId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'Prepared',
    "status" TEXT NOT NULL DEFAULT 'Present',
    "presence" INTEGER NOT NULL DEFAULT 0,
    "checkIn" TIMESTAMP(3),
    "checkOut" TIMESTAMP(3),
    "lateMinutes" INTEGER NOT NULL DEFAULT 0,
    "earlyMinutes" INTEGER NOT NULL DEFAULT 0,
    "workMinutes" INTEGER NOT NULL DEFAULT 0,
    "normalMinutes" INTEGER NOT NULL DEFAULT 0,
    "absenceMinutes" INTEGER NOT NULL DEFAULT 0,
    "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,
    "paidFlag" BOOLEAN,
    "revised" BOOLEAN NOT NULL DEFAULT false,
    "revisedBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OvertimeOrder" (
    "id" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "overtimeDate" TIMESTAMP(3) NOT NULL,
    "timeFrom" TIMESTAMP(3) NOT NULL,
    "timeTo" TIMESTAMP(3) NOT NULL,
    "planMinutes" INTEGER NOT NULL DEFAULT 0,
    "actualMinutes" INTEGER NOT NULL DEFAULT 0,
    "verifiedMinutes" INTEGER NOT NULL DEFAULT 0,
    "dayCategory" TEXT NOT NULL DEFAULT 'Weekday',
    "rateMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "calculationTime" BOOLEAN NOT NULL DEFAULT true,
    "letterNo" TEXT,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "approverId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "paidRunNo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "workDayTypeId" TEXT,

    CONSTRAINT "OvertimeOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOffPermission" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "dateFrom" TIMESTAMP(3) NOT NULL,
    "dateTo" TIMESTAMP(3) NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT true,
    "timeFrom" TEXT,
    "timeTo" TEXT,
    "dayTypeId" TEXT,
    "paid" BOOLEAN NOT NULL DEFAULT true,
    "deductLeave" BOOLEAN NOT NULL DEFAULT true,
    "recurrence" TEXT,
    "reason" TEXT,
    "documentNote" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "approverId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOffPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceRule" (
    "id" TEXT NOT NULL,
    "roundingMinutes" INTEGER NOT NULL DEFAULT 5,
    "minOvertimeMinutes" INTEGER NOT NULL DEFAULT 30,
    "overtimeRoundingMinutes" INTEGER NOT NULL DEFAULT 30,
    "maxOvertimeHours" INTEGER NOT NULL DEFAULT 4,
    "maxOvertimeHoursMonthly" INTEGER,
    "nonClockingPolicy" TEXT NOT NULL DEFAULT 'AssumeNormal',
    "overtimeComponentCode" TEXT NOT NULL DEFAULT 'LEMBUR',
    "lateDeductionComponentCode" TEXT NOT NULL DEFAULT 'TLATE',
    "absenceDeductionComponentCode" TEXT NOT NULL DEFAULT 'TABS',
    "attendanceAllowanceComponentCode" TEXT NOT NULL DEFAULT 'TKEHADIRAN',
    "attendanceAllowanceAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lateDeductionPerHour" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "absenceDeductionPerDay" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HolidayDate" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'National',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HolidayDate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'DAY',
    "entitlement" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxPerRequest" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paid" BOOLEAN NOT NULL DEFAULT true,
    "cashable" BOOLEAN NOT NULL DEFAULT false,
    "periodMode" TEXT NOT NULL DEFAULT 'CALENDAR',
    "prorateMonthly" BOOLEAN NOT NULL DEFAULT false,
    "carryOverMax" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "waitingMonths" INTEGER NOT NULL DEFAULT 0,
    "allowAdvance" BOOLEAN NOT NULL DEFAULT false,
    "allowHalfDay" BOOLEAN NOT NULL DEFAULT true,
    "needDocs" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveBalance" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "carriedOver" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "adjustment" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cashed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "requestDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dateFrom" TIMESTAMP(3) NOT NULL,
    "sessionFrom" TEXT NOT NULL DEFAULT 'AM',
    "dateTo" TIMESTAMP(3) NOT NULL,
    "sessionTo" TEXT NOT NULL DEFAULT 'PM',
    "workingDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "balanceAtRequest" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "remainingAtRequest" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "backToWorkDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'Submitted',
    "source" TEXT NOT NULL DEFAULT 'Admin',
    "reason" TEXT,
    "note" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveEncashment" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "requestDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paymentDate" TIMESTAMP(3),
    "days" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Submitted',
    "periodCode" TEXT,
    "transferredRunNo" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveEncashment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MassLeave" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "letterNo" TEXT,
    "dateFrom" TIMESTAMP(3) NOT NULL,
    "dateTo" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "orgUnitName" TEXT,
    "includeSubOrg" BOOLEAN NOT NULL DEFAULT true,
    "excludeNonWorking" BOOLEAN NOT NULL DEFAULT true,
    "excludeConflicted" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "generated" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MassLeave_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TravelZone" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "overseas" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TravelZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TravelTemplate" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "settlementDay" INTEGER NOT NULL DEFAULT 14,
    "settlementMethod" TEXT NOT NULL DEFAULT 'Kas',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TravelTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TravelExpenseType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'GENERAL',
    "description" TEXT,
    "needDocs" BOOLEAN NOT NULL DEFAULT false,
    "limitAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unlimited" BOOLEAN NOT NULL DEFAULT false,
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "compWageCode" TEXT,
    "debitAccount" TEXT,
    "creditAccount" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TravelExpenseType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TravelBudget" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "totalBudget" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TravelBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TravelBudgetItem" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "costCenter" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "TravelBudgetItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TravelRequest" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "requestDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dateFrom" TIMESTAMP(3) NOT NULL,
    "dateTo" TIMESTAMP(3) NOT NULL,
    "templateId" TEXT NOT NULL,
    "costCenter" TEXT,
    "purpose" TEXT NOT NULL,
    "remark" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Submitted',
    "claimRequestedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TravelRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TravelDestination" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 1,
    "dateFrom" TIMESTAMP(3) NOT NULL,
    "dateTo" TIMESTAMP(3) NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'Indonesia',
    "zoneId" TEXT,
    "overseas" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,

    CONSTRAINT "TravelDestination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TravelAdvance" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Given',
    "givenAt" TIMESTAMP(3),

    CONSTRAINT "TravelAdvance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TravelClaim" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "requestId" TEXT,
    "employeeId" TEXT NOT NULL,
    "claimDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "templateId" TEXT NOT NULL,
    "costCenter" TEXT,
    "purpose" TEXT,
    "remark" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Submitted',
    "otherCompanyExp" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "exchangeLoss" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "payableEmployee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "payableCompany" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalSettlement" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "settlementMethod" TEXT NOT NULL DEFAULT 'Kas',
    "voucherNo" TEXT,
    "journalNo" TEXT,
    "journalDate" TIMESTAMP(3),
    "periodCode" TEXT,
    "transferredRunNo" TEXT,
    "paidRunNo" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TravelClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TravelClaimExpense" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "expenseCode" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'GENERAL',
    "expenseDate" TIMESTAMP(3),
    "description" TEXT,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "qty" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "guestName" TEXT,
    "overLimit" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TravelClaimExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalBenefitType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "needReceipt" BOOLEAN NOT NULL DEFAULT true,
    "limitRule" TEXT NOT NULL DEFAULT 'NOMINAL',
    "limitValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "wageCode" TEXT,
    "freqUnlimited" BOOLEAN NOT NULL DEFAULT false,
    "freqValue" INTEGER NOT NULL DEFAULT 0,
    "freqPeriod" TEXT NOT NULL DEFAULT 'YEAR',
    "pctCompany" INTEGER NOT NULL DEFAULT 100,
    "pctInsurance" INTEGER NOT NULL DEFAULT 0,
    "insuranceCompany" TEXT,
    "unusedRule" TEXT NOT NULL DEFAULT 'FORFEITED',
    "cashWageCode" TEXT,
    "maxCarryOver" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dependentEnabled" BOOLEAN NOT NULL DEFAULT true,
    "maxDependents" INTEGER NOT NULL DEFAULT 2,
    "maxChildAge" INTEGER NOT NULL DEFAULT 21,
    "depLimitRule" TEXT NOT NULL DEFAULT 'SHARED',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicalBenefitType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalProvider" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'HOSPITAL',
    "city" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicalProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalBalance" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "benefitAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "adjustmentAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "initialUsed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "usedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "depBenefitAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "depAdjustment" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "depUsed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "carriedOver" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicalBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalClaim" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "claimDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "letterNo" TEXT,
    "state" TEXT NOT NULL DEFAULT 'Draft',
    "forDependent" BOOLEAN NOT NULL DEFAULT false,
    "maxBenefitAt" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "usedAt" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalBill" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalReimburse" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalApproved" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalNonRe" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "statusLog" JSONB NOT NULL DEFAULT '[]',
    "settleDate" TIMESTAMP(3),
    "journalNo" TEXT,
    "journalDate" TIMESTAMP(3),
    "periodCode" TEXT,
    "paidRunNo" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "settledById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicalClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalClaimLine" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "treatedName" TEXT NOT NULL,
    "treatment" TEXT,
    "treatmentDate" TIMESTAMP(3),
    "receiptNo" TEXT,
    "physician" TEXT,
    "hospital" TEXT,
    "note" TEXT,
    "occupationalInjury" BOOLEAN NOT NULL DEFAULT false,
    "billAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reimburseAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "approvedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "nonReAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'IDR',

    CONSTRAINT "MedicalClaimLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalAdjustment" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "forDependent" BOOLEAN NOT NULL DEFAULT false,
    "amount" DOUBLE PRECISION NOT NULL,
    "adjustmentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "state" TEXT NOT NULL DEFAULT 'Submitted',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicalAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT NOT NULL DEFAULT 'employees',
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Webhook" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Webhook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookLog" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "responseStatus" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LetterTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "signatoryName" TEXT,
    "signatoryTitle" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LetterTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LetterDocument" (
    "id" TEXT NOT NULL,
    "refNo" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "personnelActionId" TEXT,
    "disciplinaryRecordId" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "metaJson" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "LetterDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LetterRequest" (
    "id" TEXT NOT NULL,
    "reqNo" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "purpose" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "letterDocumentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LetterRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offboarding" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "personnelActionId" TEXT,
    "lastDay" TIMESTAMP(3),
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "exitInterviewJson" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offboarding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OffboardingTask" (
    "id" TEXT NOT NULL,
    "offboardingId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "owner" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "notes" TEXT,

    CONSTRAINT "OffboardingTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_code_key" ON "Company"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyOffice_code_key" ON "CompanyOffice"("code");

-- CreateIndex
CREATE UNIQUE INDEX "WorkLocation_code_key" ON "WorkLocation"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PositionLevel_code_key" ON "PositionLevel"("code");

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
CREATE UNIQUE INDEX "ApprovalStructure_code_key" ON "ApprovalStructure"("code");

-- CreateIndex
CREATE INDEX "ApprovalStructure_docType_active_idx" ON "ApprovalStructure"("docType", "active");

-- CreateIndex
CREATE INDEX "ApprovalStructureLevel_structureId_levelNo_idx" ON "ApprovalStructureLevel"("structureId", "levelNo");

-- CreateIndex
CREATE INDEX "ApprovalChain_docType_status_idx" ON "ApprovalChain"("docType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalChain_docType_docId_key" ON "ApprovalChain"("docType", "docId");

-- CreateIndex
CREATE INDEX "ApprovalStep_chainId_levelNo_idx" ON "ApprovalStep"("chainId", "levelNo");

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
CREATE UNIQUE INDEX "MinimumWage_year_companyOfficeId_key" ON "MinimumWage"("year", "companyOfficeId");

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
CREATE INDEX "Attachment_entityType_entityId_idx" ON "Attachment"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "EmployeeDocument_employeeId_idx" ON "EmployeeDocument"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeDocument_expiresAt_idx" ON "EmployeeDocument"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AppUser_username_key" ON "AppUser"("username");

-- CreateIndex
CREATE INDEX "Notification_appUserId_createdAt_idx" ON "Notification"("appUserId", "createdAt");

-- CreateIndex
CREATE INDEX "PasswordHistory_appUserId_setAt_idx" ON "PasswordHistory"("appUserId", "setAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailTemplate_event_key" ON "EmailTemplate"("event");

-- CreateIndex
CREATE INDEX "EmailLog_createdAt_idx" ON "EmailLog"("createdAt");

-- CreateIndex
CREATE INDEX "EmailLog_event_idx" ON "EmailLog"("event");

-- CreateIndex
CREATE UNIQUE INDEX "AccessGroup_code_key" ON "AccessGroup"("code");

-- CreateIndex
CREATE UNIQUE INDEX "DataAccessRule_code_key" ON "DataAccessRule"("code");

-- CreateIndex
CREATE INDEX "DataAccessRule_subjectType_active_idx" ON "DataAccessRule"("subjectType", "active");

-- CreateIndex
CREATE UNIQUE INDEX "UserMenuAccess_appUserId_key" ON "UserMenuAccess"("appUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalTemplate_code_key" ON "ApprovalTemplate"("code");

-- CreateIndex
CREATE UNIQUE INDEX "WorkDayType_code_key" ON "WorkDayType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "WorkSchedule_code_key" ON "WorkSchedule"("code");

-- CreateIndex
CREATE UNIQUE INDEX "WorkScheduleDay_scheduleId_sequence_key" ON "WorkScheduleDay"("scheduleId", "sequence");

-- CreateIndex
CREATE INDEX "ScheduleAssignment_employeeId_validTo_idx" ON "ScheduleAssignment"("employeeId", "validTo");

-- CreateIndex
CREATE INDEX "AttendanceClockLog_employeeId_timestamp_idx" ON "AttendanceClockLog"("employeeId", "timestamp");

-- CreateIndex
CREATE INDEX "AttendanceClockLog_timestamp_idx" ON "AttendanceClockLog"("timestamp");

-- CreateIndex
CREATE INDEX "AttendanceDaily_workDate_idx" ON "AttendanceDaily"("workDate");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceDaily_employeeId_workDate_key" ON "AttendanceDaily"("employeeId", "workDate");

-- CreateIndex
CREATE UNIQUE INDEX "OvertimeOrder_orderNo_key" ON "OvertimeOrder"("orderNo");

-- CreateIndex
CREATE INDEX "OvertimeOrder_employeeId_overtimeDate_idx" ON "OvertimeOrder"("employeeId", "overtimeDate");

-- CreateIndex
CREATE INDEX "OvertimeOrder_status_idx" ON "OvertimeOrder"("status");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOffPermission_docNo_key" ON "WorkOffPermission"("docNo");

-- CreateIndex
CREATE INDEX "WorkOffPermission_employeeId_dateFrom_idx" ON "WorkOffPermission"("employeeId", "dateFrom");

-- CreateIndex
CREATE INDEX "WorkOffPermission_status_idx" ON "WorkOffPermission"("status");

-- CreateIndex
CREATE INDEX "HolidayDate_date_idx" ON "HolidayDate"("date");

-- CreateIndex
CREATE INDEX "HolidayDate_kind_idx" ON "HolidayDate"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "HolidayDate_date_name_key" ON "HolidayDate"("date", "name");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveType_code_key" ON "LeaveType"("code");

-- CreateIndex
CREATE INDEX "LeaveBalance_year_idx" ON "LeaveBalance"("year");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveBalance_employeeId_leaveTypeId_year_key" ON "LeaveBalance"("employeeId", "leaveTypeId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveRequest_docNo_key" ON "LeaveRequest"("docNo");

-- CreateIndex
CREATE INDEX "LeaveRequest_employeeId_dateFrom_idx" ON "LeaveRequest"("employeeId", "dateFrom");

-- CreateIndex
CREATE INDEX "LeaveRequest_status_idx" ON "LeaveRequest"("status");

-- CreateIndex
CREATE INDEX "LeaveRequest_year_idx" ON "LeaveRequest"("year");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveEncashment_docNo_key" ON "LeaveEncashment"("docNo");

-- CreateIndex
CREATE INDEX "LeaveEncashment_status_idx" ON "LeaveEncashment"("status");

-- CreateIndex
CREATE INDEX "LeaveEncashment_employeeId_idx" ON "LeaveEncashment"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "MassLeave_docNo_key" ON "MassLeave"("docNo");

-- CreateIndex
CREATE UNIQUE INDEX "TravelZone_code_key" ON "TravelZone"("code");

-- CreateIndex
CREATE UNIQUE INDEX "TravelTemplate_code_key" ON "TravelTemplate"("code");

-- CreateIndex
CREATE UNIQUE INDEX "TravelExpenseType_code_key" ON "TravelExpenseType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "TravelBudget_year_key" ON "TravelBudget"("year");

-- CreateIndex
CREATE UNIQUE INDEX "TravelRequest_docNo_key" ON "TravelRequest"("docNo");

-- CreateIndex
CREATE UNIQUE INDEX "TravelClaim_docNo_key" ON "TravelClaim"("docNo");

-- CreateIndex
CREATE UNIQUE INDEX "MedicalBenefitType_code_key" ON "MedicalBenefitType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "MedicalProvider_code_key" ON "MedicalProvider"("code");

-- CreateIndex
CREATE INDEX "MedicalBalance_year_idx" ON "MedicalBalance"("year");

-- CreateIndex
CREATE UNIQUE INDEX "MedicalBalance_employeeId_typeId_year_key" ON "MedicalBalance"("employeeId", "typeId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "MedicalClaim_docNo_key" ON "MedicalClaim"("docNo");

-- CreateIndex
CREATE INDEX "MedicalClaim_state_idx" ON "MedicalClaim"("state");

-- CreateIndex
CREATE INDEX "MedicalClaim_year_typeId_idx" ON "MedicalClaim"("year", "typeId");

-- CreateIndex
CREATE UNIQUE INDEX "MedicalAdjustment_docNo_key" ON "MedicalAdjustment"("docNo");

-- CreateIndex
CREATE INDEX "MedicalAdjustment_state_idx" ON "MedicalAdjustment"("state");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "WebhookLog_webhookId_createdAt_idx" ON "WebhookLog"("webhookId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LetterTemplate_key_key" ON "LetterTemplate"("key");

-- CreateIndex
CREATE UNIQUE INDEX "LetterDocument_refNo_key" ON "LetterDocument"("refNo");

-- CreateIndex
CREATE INDEX "LetterDocument_employeeId_category_idx" ON "LetterDocument"("employeeId", "category");

-- CreateIndex
CREATE INDEX "LetterDocument_personnelActionId_idx" ON "LetterDocument"("personnelActionId");

-- CreateIndex
CREATE UNIQUE INDEX "LetterRequest_reqNo_key" ON "LetterRequest"("reqNo");

-- CreateIndex
CREATE INDEX "LetterRequest_employeeId_status_idx" ON "LetterRequest"("employeeId", "status");

-- CreateIndex
CREATE INDEX "LetterRequest_status_createdAt_idx" ON "LetterRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Offboarding_employeeId_idx" ON "Offboarding"("employeeId");

-- CreateIndex
CREATE INDEX "Offboarding_status_idx" ON "Offboarding"("status");

-- CreateIndex
CREATE INDEX "OffboardingTask_offboardingId_idx" ON "OffboardingTask"("offboardingId");

-- AddForeignKey
ALTER TABLE "CompanyOffice" ADD CONSTRAINT "CompanyOffice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkLocation" ADD CONSTRAINT "WorkLocation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkLocation" ADD CONSTRAINT "WorkLocation_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "CompanyOffice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
ALTER TABLE "Position" ADD CONSTRAINT "Position_positionLevelId_fkey" FOREIGN KEY ("positionLevelId") REFERENCES "PositionLevel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "Grade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_positionLevelId_fkey" FOREIGN KEY ("positionLevelId") REFERENCES "PositionLevel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_companyOfficeId_fkey" FOREIGN KEY ("companyOfficeId") REFERENCES "CompanyOffice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_workLocationId_fkey" FOREIGN KEY ("workLocationId") REFERENCES "WorkLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
ALTER TABLE "EmployeeAssignment" ADD CONSTRAINT "EmployeeAssignment_companyOfficeId_fkey" FOREIGN KEY ("companyOfficeId") REFERENCES "CompanyOffice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAssignment" ADD CONSTRAINT "EmployeeAssignment_workLocationId_fkey" FOREIGN KEY ("workLocationId") REFERENCES "WorkLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
ALTER TABLE "ApprovalStructure" ADD CONSTRAINT "ApprovalStructure_companyOfficeId_fkey" FOREIGN KEY ("companyOfficeId") REFERENCES "CompanyOffice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalStructure" ADD CONSTRAINT "ApprovalStructure_workLocationId_fkey" FOREIGN KEY ("workLocationId") REFERENCES "WorkLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalStructure" ADD CONSTRAINT "ApprovalStructure_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalStructure" ADD CONSTRAINT "ApprovalStructure_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalStructure" ADD CONSTRAINT "ApprovalStructure_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "Grade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalStructure" ADD CONSTRAINT "ApprovalStructure_positionLevelId_fkey" FOREIGN KEY ("positionLevelId") REFERENCES "PositionLevel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalStructureLevel" ADD CONSTRAINT "ApprovalStructureLevel_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "ApprovalStructure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalStructureLevel" ADD CONSTRAINT "ApprovalStructureLevel_approverPositionId_fkey" FOREIGN KEY ("approverPositionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalStructureLevel" ADD CONSTRAINT "ApprovalStructureLevel_approverEmployeeId_fkey" FOREIGN KEY ("approverEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalChain" ADD CONSTRAINT "ApprovalChain_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "ApprovalStructure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalStep" ADD CONSTRAINT "ApprovalStep_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "ApprovalChain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalStep" ADD CONSTRAINT "ApprovalStep_approverEmployeeId_fkey" FOREIGN KEY ("approverEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WageTemplateItem" ADD CONSTRAINT "WageTemplateItem_wageTemplateId_fkey" FOREIGN KEY ("wageTemplateId") REFERENCES "WageTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WageTemplateItem" ADD CONSTRAINT "WageTemplateItem_wageComponentId_fkey" FOREIGN KEY ("wageComponentId") REFERENCES "WageComponent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeePayrollProfile" ADD CONSTRAINT "EmployeePayrollProfile_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeePayrollProfile" ADD CONSTRAINT "EmployeePayrollProfile_wageTemplateId_fkey" FOREIGN KEY ("wageTemplateId") REFERENCES "WageTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MinimumWage" ADD CONSTRAINT "MinimumWage_companyOfficeId_fkey" FOREIGN KEY ("companyOfficeId") REFERENCES "CompanyOffice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
ALTER TABLE "EmployeeDocument" ADD CONSTRAINT "EmployeeDocument_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDocument" ADD CONSTRAINT "EmployeeDocument_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "Attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_appUserId_fkey" FOREIGN KEY ("appUserId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordHistory" ADD CONSTRAINT "PasswordHistory_appUserId_fkey" FOREIGN KEY ("appUserId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataAccessRule" ADD CONSTRAINT "DataAccessRule_appUserId_fkey" FOREIGN KEY ("appUserId") REFERENCES "AppUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataAccessRule" ADD CONSTRAINT "DataAccessRule_accessGroupId_fkey" FOREIGN KEY ("accessGroupId") REFERENCES "AccessGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataAccessRule" ADD CONSTRAINT "DataAccessRule_companyOfficeId_fkey" FOREIGN KEY ("companyOfficeId") REFERENCES "CompanyOffice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataAccessRule" ADD CONSTRAINT "DataAccessRule_workLocationId_fkey" FOREIGN KEY ("workLocationId") REFERENCES "WorkLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataAccessRule" ADD CONSTRAINT "DataAccessRule_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataAccessRule" ADD CONSTRAINT "DataAccessRule_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataAccessRule" ADD CONSTRAINT "DataAccessRule_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "Grade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataAccessRule" ADD CONSTRAINT "DataAccessRule_positionLevelId_fkey" FOREIGN KEY ("positionLevelId") REFERENCES "PositionLevel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMenuAccess" ADD CONSTRAINT "UserMenuAccess_appUserId_fkey" FOREIGN KEY ("appUserId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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

-- AddForeignKey
ALTER TABLE "WorkScheduleDay" ADD CONSTRAINT "WorkScheduleDay_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "WorkSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkScheduleDay" ADD CONSTRAINT "WorkScheduleDay_dayTypeId_fkey" FOREIGN KEY ("dayTypeId") REFERENCES "WorkDayType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleAssignment" ADD CONSTRAINT "ScheduleAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleAssignment" ADD CONSTRAINT "ScheduleAssignment_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "WorkSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceClockLog" ADD CONSTRAINT "AttendanceClockLog_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceDaily" ADD CONSTRAINT "AttendanceDaily_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceDaily" ADD CONSTRAINT "AttendanceDaily_dayTypeId_fkey" FOREIGN KEY ("dayTypeId") REFERENCES "WorkDayType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OvertimeOrder" ADD CONSTRAINT "OvertimeOrder_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OvertimeOrder" ADD CONSTRAINT "OvertimeOrder_workDayTypeId_fkey" FOREIGN KEY ("workDayTypeId") REFERENCES "WorkDayType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOffPermission" ADD CONSTRAINT "WorkOffPermission_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOffPermission" ADD CONSTRAINT "WorkOffPermission_dayTypeId_fkey" FOREIGN KEY ("dayTypeId") REFERENCES "WorkDayType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveBalance" ADD CONSTRAINT "LeaveBalance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveBalance" ADD CONSTRAINT "LeaveBalance_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveEncashment" ADD CONSTRAINT "LeaveEncashment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveEncashment" ADD CONSTRAINT "LeaveEncashment_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MassLeave" ADD CONSTRAINT "MassLeave_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelBudgetItem" ADD CONSTRAINT "TravelBudgetItem_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "TravelBudget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelRequest" ADD CONSTRAINT "TravelRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelRequest" ADD CONSTRAINT "TravelRequest_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "TravelTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelDestination" ADD CONSTRAINT "TravelDestination_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TravelRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelDestination" ADD CONSTRAINT "TravelDestination_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "TravelZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelAdvance" ADD CONSTRAINT "TravelAdvance_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TravelRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelClaim" ADD CONSTRAINT "TravelClaim_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelClaim" ADD CONSTRAINT "TravelClaim_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TravelRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelClaim" ADD CONSTRAINT "TravelClaim_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "TravelTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelClaimExpense" ADD CONSTRAINT "TravelClaimExpense_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "TravelClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalBalance" ADD CONSTRAINT "MedicalBalance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalBalance" ADD CONSTRAINT "MedicalBalance_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "MedicalBenefitType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalClaim" ADD CONSTRAINT "MedicalClaim_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalClaim" ADD CONSTRAINT "MedicalClaim_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "MedicalBenefitType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalClaimLine" ADD CONSTRAINT "MedicalClaimLine_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "MedicalClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalAdjustment" ADD CONSTRAINT "MedicalAdjustment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalAdjustment" ADD CONSTRAINT "MedicalAdjustment_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "MedicalBenefitType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookLog" ADD CONSTRAINT "WebhookLog_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "Webhook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LetterDocument" ADD CONSTRAINT "LetterDocument_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LetterRequest" ADD CONSTRAINT "LetterRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offboarding" ADD CONSTRAINT "Offboarding_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OffboardingTask" ADD CONSTRAINT "OffboardingTask_offboardingId_fkey" FOREIGN KEY ("offboardingId") REFERENCES "Offboarding"("id") ON DELETE CASCADE ON UPDATE CASCADE;


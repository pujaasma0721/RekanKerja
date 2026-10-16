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
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "radiusMeters" INTEGER,
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
    "selfieRefUrl" TEXT,
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
    "baseSalary" TEXT,
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
    "prorateBasis" TEXT,
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
CREATE TABLE "WageComponentRule" (
    "id" TEXT NOT NULL,
    "wageComponentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "conditions" TEXT NOT NULL DEFAULT '[]',
    "actionType" TEXT NOT NULL DEFAULT 'SetAmount',
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WageComponentRule_pkey" PRIMARY KEY ("id")
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
    "ptkpSource" TEXT NOT NULL DEFAULT 'manual',
    "payrollDependentAllowed" BOOLEAN NOT NULL DEFAULT true,
    "bankName" TEXT,
    "bankAccount" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "EmployeePayrollProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeWageTemplateHistory" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "wageTemplateId" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "changeReason" TEXT NOT NULL DEFAULT 'Initial',
    "sourceDocNo" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeWageTemplateHistory_pkey" PRIMARY KEY ("id")
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
    "jkpEmployeeRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "jkpCompanyRate" DOUBLE PRECISION NOT NULL DEFAULT 0.0014,
    "jkpSalaryCap" DOUBLE PRECISION NOT NULL DEFAULT 5000000,
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
    "totalBruto" TEXT,
    "totalDeduction" TEXT,
    "totalTax" TEXT,
    "totalNet" TEXT,
    "notes" TEXT,
    "calculatedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRunLog" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "employeeId" TEXT,
    "employeeNo" TEXT,
    "employeeName" TEXT,
    "level" TEXT NOT NULL DEFAULT 'warning',
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollRunLog_pkey" PRIMARY KEY ("id")
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
    "bruto" TEXT,
    "deduction" TEXT,
    "taxRegular" TEXT,
    "taxIrregular" TEXT,
    "net" TEXT,
    "actualNetTax" TEXT,
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
    "amount" TEXT,
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
    "amount" TEXT NOT NULL,
    "installmentCount" INTEGER NOT NULL,
    "installmentAmount" TEXT NOT NULL DEFAULT '0',
    "interestRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "startPaymentDate" TIMESTAMP(3) NOT NULL,
    "purpose" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "paidAmount" TEXT NOT NULL DEFAULT '0',
    "outstanding" TEXT NOT NULL DEFAULT '0',
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
    "amount" TEXT NOT NULL,
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
    "amount" TEXT,
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
    "totalDebit" TEXT,
    "totalCredit" TEXT,
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
    "amount" TEXT,
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
CREATE TABLE "BenefitTypeRule" (
    "id" TEXT NOT NULL,
    "benefitTypeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "conditions" TEXT NOT NULL DEFAULT '[]',
    "actionType" TEXT NOT NULL DEFAULT 'SetLimit',
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BenefitTypeRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenefitClaim" (
    "id" TEXT NOT NULL,
    "claimNo" TEXT NOT NULL,
    "benefitTypeId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "claimDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amount" TEXT NOT NULL,
    "approvedAmount" TEXT NOT NULL DEFAULT '0',
    "description" TEXT,
    "documentsNote" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "limitUsed" TEXT NOT NULL DEFAULT '0',
    "limitRemaining" TEXT NOT NULL DEFAULT '0',
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
    "idleTimeoutMinutes" INTEGER NOT NULL DEFAULT 0,
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
    "fromName" TEXT NOT NULL DEFAULT 'RekanKerja HRIS',
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
    "selfieUrl" TEXT,
    "deviceId" TEXT,
    "faceVerified" BOOLEAN,
    "anomalyNotes" TEXT,
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
    "geofenceMode" TEXT NOT NULL DEFAULT 'Off',
    "geofenceMultiSite" BOOLEAN NOT NULL DEFAULT false,
    "selfieMode" TEXT NOT NULL DEFAULT 'off',
    "faceVerifyMode" TEXT NOT NULL DEFAULT 'off',
    "otCapMode" TEXT NOT NULL DEFAULT 'PP35',
    "otCapDayHours" INTEGER,
    "otCapWeekHours" INTEGER,
    "otWorkweekDays" INTEGER NOT NULL DEFAULT 5,
    "otBasisMode" TEXT NOT NULL DEFAULT 'BASE',
    "otBasisComponentCodes" TEXT,
    "fatigueMaxConsecutiveNights" INTEGER NOT NULL DEFAULT 4,
    "fatigueMinRestHours" INTEGER NOT NULL DEFAULT 12,
    "deviceApiKey" TEXT,
    "burnoutOtHoursMonthly" INTEGER NOT NULL DEFAULT 40,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpenShiftPost" (
    "id" TEXT NOT NULL,
    "workDate" TIMESTAMP(3) NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "dayTypeId" TEXT NOT NULL,
    "orgUnitName" TEXT,
    "slots" INTEGER NOT NULL DEFAULT 1,
    "filled" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpenShiftPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpenShiftClaim" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpenShiftClaim_pkey" PRIMARY KEY ("id")
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
    "noticeDays" INTEGER NOT NULL DEFAULT 0,
    "maxConsecutiveDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "blackoutDates" TEXT NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveTypeRule" (
    "id" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "conditions" TEXT NOT NULL DEFAULT '[]',
    "actionType" TEXT NOT NULL DEFAULT 'SetDays',
    "days" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveTypeRule_pkey" PRIMARY KEY ("id")
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
    "amount" TEXT NOT NULL DEFAULT '0',
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
CREATE TABLE "TravelCityRate" (
    "id" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'Indonesia',
    "overseas" BOOLEAN NOT NULL DEFAULT false,
    "zoneCode" TEXT,
    "uangHarian" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "plafonHotel" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TravelCityRate_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "TravelExpenseTypeRule" (
    "id" TEXT NOT NULL,
    "travelExpenseTypeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "conditions" TEXT NOT NULL DEFAULT '[]',
    "actionType" TEXT NOT NULL DEFAULT 'SetLimit',
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TravelExpenseTypeRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TravelBudget" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "totalBudget" TEXT NOT NULL DEFAULT '0',
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
    "amount" TEXT NOT NULL DEFAULT '0',
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
    "amount" TEXT NOT NULL DEFAULT '0',
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
    "otherCompanyExp" TEXT NOT NULL DEFAULT '0',
    "exchangeLoss" TEXT NOT NULL DEFAULT '0',
    "payableEmployee" TEXT NOT NULL DEFAULT '0',
    "payableCompany" TEXT NOT NULL DEFAULT '0',
    "totalSettlement" TEXT NOT NULL DEFAULT '0',
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
    "amount" TEXT NOT NULL DEFAULT '0',
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
    "needLetter" BOOLEAN NOT NULL DEFAULT false,
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
CREATE TABLE "MedicalBenefitTypeRule" (
    "id" TEXT NOT NULL,
    "medicalBenefitTypeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "conditions" TEXT NOT NULL DEFAULT '[]',
    "actionType" TEXT NOT NULL DEFAULT 'SetLimit',
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicalBenefitTypeRule_pkey" PRIMARY KEY ("id")
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
    "benefitAmount" TEXT NOT NULL DEFAULT '0',
    "adjustmentAmount" TEXT NOT NULL DEFAULT '0',
    "initialUsed" TEXT NOT NULL DEFAULT '0',
    "usedAmount" TEXT NOT NULL DEFAULT '0',
    "depBenefitAmount" TEXT NOT NULL DEFAULT '0',
    "depAdjustment" TEXT NOT NULL DEFAULT '0',
    "depUsed" TEXT NOT NULL DEFAULT '0',
    "carriedOver" TEXT NOT NULL DEFAULT '0',
    "prorateFactor" DOUBLE PRECISION,
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
    "prorateFactor" DOUBLE PRECISION,
    "maxBenefitAt" TEXT NOT NULL DEFAULT '0',
    "usedAt" TEXT NOT NULL DEFAULT '0',
    "totalBill" TEXT NOT NULL DEFAULT '0',
    "totalReimburse" TEXT NOT NULL DEFAULT '0',
    "totalApproved" TEXT NOT NULL DEFAULT '0',
    "totalNonRe" TEXT NOT NULL DEFAULT '0',
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
    "insState" TEXT NOT NULL DEFAULT 'NONE',
    "insRefNo" TEXT,
    "insAmount" TEXT NOT NULL DEFAULT '0',
    "insSubmittedAt" TIMESTAMP(3),
    "insPaidAt" TIMESTAMP(3),
    "insPaidAmount" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reversalOfId" TEXT,

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
    "billAmount" TEXT NOT NULL DEFAULT '0',
    "reimburseAmount" TEXT NOT NULL DEFAULT '0',
    "approvedAmount" TEXT NOT NULL DEFAULT '0',
    "nonReAmount" TEXT NOT NULL DEFAULT '0',
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "providerId" TEXT,

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
    "amount" TEXT NOT NULL,
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
    "status" TEXT NOT NULL DEFAULT 'delivered',
    "responseStatus" INTEGER,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "nextRetryAt" TIMESTAMP(3),
    "lastError" TEXT,
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
    "completedVia" TEXT,
    "notes" TEXT,

    CONSTRAINT "OffboardingTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Onboarding" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Onboarding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingTask" (
    "id" TEXT NOT NULL,
    "onboardingId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "owner" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "completedVia" TEXT,
    "notes" TEXT,

    CONSTRAINT "OnboardingTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MachineImportBatch" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "inserted" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "unknownEmployees" TEXT,
    "dateFrom" TIMESTAMP(3),
    "dateTo" TIMESTAMP(3),
    "importedById" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MachineImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Umum',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnouncementRead" (
    "id" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnnouncementRead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Lainnya',
    "serialNumber" TEXT,
    "notes" TEXT,
    "purchaseDate" TIMESTAMP(3),
    "value" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'Available',
    "location" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetAssignment" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "returnCondition" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftSwapRequest" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "swapDate" TIMESTAMP(3) NOT NULL,
    "requesterScheduleId" TEXT,
    "targetScheduleId" TEXT,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "appliedAssignment1" TEXT,
    "appliedAssignment2" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftSwapRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaConfig" (
    "id" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT NOT NULL DEFAULT 'Fonnte',
    "endpoint" TEXT NOT NULL DEFAULT '',
    "token" TEXT NOT NULL DEFAULT '',
    "sender" TEXT NOT NULL DEFAULT '',
    "lastTestOk" BOOLEAN,
    "lastTestAt" TIMESTAMP(3),
    "lastTestMessage" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaTemplate" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "body" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaLog" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "toPhone" TEXT NOT NULL,
    "body" TEXT,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoneyVault" (
    "id" TEXT NOT NULL,
    "salt" TEXT NOT NULL,
    "verifier" TEXT NOT NULL,
    "wrappedKey" TEXT NOT NULL,
    "dataKey" TEXT,
    "openUntil" TIMESTAMP(3),
    "openByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MoneyVault_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoneyViewGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "grantedBy" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "MoneyViewGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomReport" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "entity" TEXT NOT NULL,
    "fieldsJson" TEXT NOT NULL,
    "filtersJson" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhistleblowReport" (
    "id" TEXT NOT NULL,
    "ticketNo" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'ESS',
    "description" TEXT NOT NULL,
    "incidentDate" TIMESTAMP(3),
    "location" TEXT,
    "involvedHint" TEXT,
    "anonymous" BOOLEAN NOT NULL DEFAULT true,
    "reporterEmployeeId" TEXT,
    "reporterContact" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Baru',
    "assignedToId" TEXT,
    "followUpNote" TEXT,
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhistleblowReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignatureKey" (
    "id" TEXT NOT NULL,
    "appUserId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "encryptedPrivateKey" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'RSA-PSS-SHA256',
    "status" TEXT NOT NULL DEFAULT 'Active',
    "pinHash" TEXT,
    "pinSetAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedAt" TIMESTAMP(3),

    CONSTRAINT "SignatureKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignatureRecord" (
    "id" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "docRef" TEXT NOT NULL,
    "docHash" TEXT NOT NULL,
    "snapshotJson" TEXT NOT NULL DEFAULT '{}',
    "signature" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'RSA-PSS-SHA256',
    "signerAppUserId" TEXT NOT NULL,
    "signerName" TEXT NOT NULL,
    "signerRole" TEXT,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signerIp" TEXT,
    "signerUa" TEXT,
    "prevHash" TEXT NOT NULL,
    "ownHash" TEXT NOT NULL,

    CONSTRAINT "SignatureRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignatureChallenge" (
    "id" TEXT NOT NULL,
    "appUserId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'sign',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignatureChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiProviderConfig" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'builtin',
    "apiKey" TEXT,
    "baseUrl" TEXT,
    "model" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiProviderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiKnowledgeDoc" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiKnowledgeDoc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiChatMessage" (
    "id" TEXT NOT NULL,
    "appUserId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'assistant',
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectMessage" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DirectMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NonEmployeePartner" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "idType" TEXT NOT NULL DEFAULT 'npwp',
    "idNumber" TEXT,
    "address" TEXT,
    "serviceKind" TEXT NOT NULL DEFAULT 'Pekerjaan Bebas',
    "isCatering" BOOLEAN NOT NULL DEFAULT false,
    "bankName" TEXT,
    "bankAccount" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NonEmployeePartner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NonEmployeePayment" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "grossAmount" TEXT NOT NULL,
    "excludedNotes" TEXT,
    "excludedAmount" TEXT,
    "dpp" TEXT NOT NULL,
    "pph21" TEXT NOT NULL,
    "netAmount" TEXT NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "taxYear" INTEGER NOT NULL,
    "taxMonth" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "paidAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NonEmployeePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecruitmentMethod" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'External',
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecruitmentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdMediaType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdMediaType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmploymentAgency" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "contact" TEXT,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmploymentAgency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecruitmentCostItem" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecruitmentCostItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Skill" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "criteria" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequiredDocument" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fileType" TEXT,
    "mandatory" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequiredDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationCategory" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvaluationCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationScale" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ranking" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvaluationScale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlaGroup" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "days" INTEGER NOT NULL DEFAULT 30,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlaGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SelectionProcess" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "resultType" TEXT NOT NULL DEFAULT 'Qualitative',
    "appliesInternal" BOOLEAN NOT NULL DEFAULT true,
    "appliesExternal" BOOLEAN NOT NULL DEFAULT true,
    "minResultPass" DOUBLE PRECISION,
    "processOrder" INTEGER NOT NULL DEFAULT 1,
    "slaDays" INTEGER,
    "needAcknowledgement" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SelectionProcess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonnelRequisition" (
    "id" TEXT NOT NULL,
    "prNo" TEXT NOT NULL,
    "requestDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestedById" TEXT NOT NULL,
    "positionId" TEXT,
    "jobId" TEXT,
    "orgUnitId" TEXT,
    "companyOfficeId" TEXT,
    "requiredNo" INTEGER NOT NULL DEFAULT 1,
    "employmentStatus" TEXT NOT NULL DEFAULT 'Permanent',
    "preferredSource" TEXT,
    "earliestDate" TIMESTAMP(3),
    "latestDate" TIMESTAMP(3),
    "recruitmentOfficerId" TEXT,
    "reason" TEXT,
    "miscSpec" TEXT,
    "additionalQualification" TEXT,
    "salaryBudget" TEXT,
    "autoPostOpening" BOOLEAN NOT NULL DEFAULT false,
    "slaTargetDays" INTEGER,
    "replacedEmployeeId" TEXT,
    "rubricJson" TEXT,
    "planId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "decisionNote" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonnelRequisition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobOpportunity" (
    "id" TEXT NOT NULL,
    "refNo" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "preparedById" TEXT,
    "datePrepared" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "datePosted" TIMESTAMP(3),
    "content" TEXT,
    "contactPerson" TEXT,
    "lastAcceptDate" TIMESTAMP(3),
    "internalOnly" BOOLEAN NOT NULL DEFAULT false,
    "internalFirstUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobOpening" (
    "id" TEXT NOT NULL,
    "jobOpportunityId" TEXT NOT NULL,
    "prId" TEXT NOT NULL,
    "titleToShow" TEXT NOT NULL,
    "workLocationId" TEXT,
    "salaryMin" INTEGER,
    "salaryMax" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "salaryUnit" TEXT NOT NULL DEFAULT 'Monthly',
    "jobDescSummary" TEXT,
    "jobSpecSummary" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "postedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobOpening_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobOpeningMethod" (
    "id" TEXT NOT NULL,
    "jobOpportunityId" TEXT NOT NULL,
    "methodId" TEXT NOT NULL,
    "adMediaTypeId" TEXT,
    "agencyId" TEXT,
    "costItemId" TEXT,
    "plannedCost" TEXT,
    "actualCost" TEXT,
    "datePosted" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobOpeningMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Applicant" (
    "id" TEXT NOT NULL,
    "applicantNo" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "middleName" TEXT,
    "lastName" TEXT,
    "displayName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "blacklist" BOOLEAN NOT NULL DEFAULT false,
    "blacklistNote" TEXT,
    "blacklistAt" TIMESTAMP(3),
    "blacklistById" TEXT,
    "suspend" BOOLEAN NOT NULL DEFAULT false,
    "suspendNote" TEXT,
    "suspendUntil" TIMESTAMP(3),
    "statusLinkUsedAt" TIMESTAMP(3),
    "dateApplied" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dateAvailable" TIMESTAMP(3),
    "expectedSalary" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "salaryUnit" TEXT NOT NULL DEFAULT 'Monthly',
    "keepOnFileMonths" INTEGER NOT NULL DEFAULT 12,
    "keepOnFileUntil" TIMESTAMP(3),
    "source" TEXT,
    "referralNote" TEXT,
    "referralRewardNote" TEXT,
    "adMediaTypeId" TEXT,
    "agencyId" TEXT,
    "institutionName" TEXT,
    "referralEmployeeId" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "placeOfBirth" TEXT,
    "identityNo" TEXT,
    "birthDate" TIMESTAMP(3),
    "gender" TEXT,
    "maritalStatus" TEXT,
    "notes" TEXT,
    "highestEduLevel" TEXT,
    "highestGpa" DOUBLE PRECISION,
    "totalExpMonths" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Applicant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicantEducation" (
    "id" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "fieldOfStudy" TEXT,
    "institution" TEXT,
    "graduationYear" INTEGER,
    "gpa" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicantEducation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicantExperience" (
    "id" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "company" TEXT,
    "position" TEXT,
    "field" TEXT,
    "startYear" INTEGER,
    "endYear" INTEGER,
    "months" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicantExperience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicantSkill" (
    "id" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "level" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicantSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicantDocument" (
    "id" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "requiredDocumentId" TEXT,
    "title" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "attachmentId" TEXT,

    CONSTRAINT "ApplicantDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicantApplication" (
    "id" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "jobOpeningId" TEXT NOT NULL,
    "dateApplied" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'Received',
    "sourceNote" TEXT,
    "rejectionLetterNo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicantApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicApplication" (
    "id" TEXT NOT NULL,
    "jobOpeningId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "payloadJson" TEXT NOT NULL,
    "cvFileName" TEXT,
    "cvStoragePath" TEXT,
    "ipHash" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "rejectNote" TEXT,
    "consentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicantConsent" (
    "id" TEXT NOT NULL,
    "applicantId" TEXT,
    "purpose" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMP(3),
    "channel" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicantConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobCandidate" (
    "id" TEXT NOT NULL,
    "prId" TEXT NOT NULL,
    "applicantId" TEXT,
    "employeeId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'External',
    "status" TEXT NOT NULL DEFAULT 'Nominated',
    "fullName" TEXT NOT NULL,
    "nominatedById" TEXT,
    "nominatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateSelectionStep" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "selectionProcessId" TEXT NOT NULL,
    "seqNo" INTEGER NOT NULL,
    "planDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "performedById" TEXT,
    "performedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'Planned',
    "score" DOUBLE PRECISION,
    "result" TEXT,
    "comment" TEXT,
    "continueProcess" BOOLEAN NOT NULL DEFAULT true,
    "reportFileName" TEXT,
    "letterNo" TEXT,
    "meetingUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateSelectionStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScorecardTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "selectionProcessId" TEXT,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScorecardTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScorecardCompetency" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "anchorsJson" TEXT,
    "orderNo" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScorecardCompetency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateScorecard" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "selectionStepId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "evaluatorId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "recommendation" TEXT,
    "overallComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateScorecard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScorecardItem" (
    "id" TEXT NOT NULL,
    "scorecardId" TEXT NOT NULL,
    "competencyId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScorecardItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecruitmentLetter" (
    "id" TEXT NOT NULL,
    "letterNo" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "selectionStepId" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "metaJson" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "RecruitmentLetter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateOffer" (
    "id" TEXT NOT NULL,
    "offerNo" TEXT NOT NULL,
    "prId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "jobOpeningId" TEXT,
    "salary" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "salaryUnit" TEXT NOT NULL DEFAULT 'Monthly',
    "startDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "letterNo" TEXT,
    "note" TEXT,
    "sentAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "appointedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateAppointment" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "prId" TEXT NOT NULL,
    "appointmentDate" TIMESTAMP(3) NOT NULL,
    "positionId" TEXT,
    "orgUnitId" TEXT,
    "companyOfficeId" TEXT,
    "workLocationId" TEXT,
    "supervisorId" TEXT,
    "gradeId" TEXT,
    "employmentStatus" TEXT NOT NULL DEFAULT 'Permanent',
    "workShift" TEXT NOT NULL DEFAULT 'Regular',
    "letterNo" TEXT,
    "employeeId" TEXT,
    "onboardingId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Appointed',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateAppointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecruitmentPlan" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "seqNo" INTEGER NOT NULL DEFAULT 1,
    "positionId" TEXT,
    "positionTitle" TEXT NOT NULL,
    "companyOfficeId" TEXT,
    "targetA" INTEGER NOT NULL DEFAULT 0,
    "adjustB" INTEGER NOT NULL DEFAULT 0,
    "empD" INTEGER NOT NULL DEFAULT 0,
    "inE" INTEGER NOT NULL DEFAULT 0,
    "outF" INTEGER NOT NULL DEFAULT 0,
    "salaryBudget" TEXT,
    "basePeriod" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "note" TEXT,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecruitmentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecruitmentBudget" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "totalBudget" TEXT NOT NULL,
    "adjust" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecruitmentBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmpJobApplication" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "jobOpeningId" TEXT NOT NULL,
    "candidateId" TEXT,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmpJobApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnockoutQuestion" (
    "id" TEXT NOT NULL,
    "jobOpeningId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "expectedValue" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'Equals',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "orderNo" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnockoutQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationAnswer" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "answer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicationAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CvParseResult" (
    "id" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "storagePath" TEXT,
    "fieldsJson" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "model" TEXT,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CvParseResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateAiScore" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "rubricJson" TEXT NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "factorsJson" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "model" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedById" TEXT NOT NULL,

    CONSTRAINT "CandidateAiScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEndpoint" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "eventsJson" TEXT NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPref" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "inApp" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT true,
    "digest" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPref_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecruitmentSetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecruitmentSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EsignRequest" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "letterId" TEXT,
    "offerId" TEXT,
    "purpose" TEXT NOT NULL,
    "signerName" TEXT NOT NULL,
    "signerEmailEnc" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "otpHash" TEXT NOT NULL,
    "otpExpiresAt" TIMESTAMP(3) NOT NULL,
    "typedName" TEXT,
    "pdfSha256" TEXT,
    "requestedById" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EsignRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricSnapshot" (
    "id" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "dimsJson" TEXT,
    "value" DOUBLE PRECISION NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedReportView" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "view" TEXT NOT NULL,
    "filtersJson" TEXT NOT NULL,
    "schedule" TEXT NOT NULL DEFAULT 'none',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedReportView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSubjectRequest" (
    "id" TEXT NOT NULL,
    "applicantId" TEXT,
    "employeeId" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'New',
    "note" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "handledById" TEXT,
    "handledAt" TIMESTAMP(3),
    "resultNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataSubjectRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceSetting" (
    "id" TEXT NOT NULL,
    "docPrefixes" TEXT NOT NULL DEFAULT 'PER|PRB|PIP|MER',
    "defWeights" TEXT NOT NULL DEFAULT '70|20|10',
    "appealDays" INTEGER NOT NULL DEFAULT 7,
    "retentionYears" INTEGER NOT NULL DEFAULT 5,
    "okrEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerformanceSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KpiDefinition" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "polarity" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "dataSource" TEXT NOT NULL DEFAULT 'Manual',
    "sourceKey" TEXT,
    "description" TEXT,
    "metricText" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "versionNo" INTEGER NOT NULL DEFAULT 1,
    "effectiveYear" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "supersededById" TEXT,
    "changeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KpiDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Competency" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "levelsJson" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "versionNo" INTEGER NOT NULL DEFAULT 1,
    "effectiveYear" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "supersededById" TEXT,
    "changeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Competency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RatingScale" (
    "id" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "labelId" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,
    "minScore" DOUBLE PRECISION NOT NULL,
    "color" TEXT NOT NULL,
    "guideline" TEXT,

    CONSTRAINT "RatingScale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceTemplate" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weightsJson" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerformanceTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceTemplateItem" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "PerformanceTemplateItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceCycle" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cycleType" TEXT NOT NULL DEFAULT 'Annual',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "goalStart" TIMESTAMP(3),
    "goalEnd" TIMESTAMP(3),
    "midStart" TIMESTAMP(3),
    "midEnd" TIMESTAMP(3),
    "selfStart" TIMESTAMP(3),
    "selfEnd" TIMESTAMP(3),
    "mgrStart" TIMESTAMP(3),
    "mgrEnd" TIMESTAMP(3),
    "calibStart" TIMESTAMP(3),
    "calibEnd" TIMESTAMP(3),
    "publishAt" TIMESTAMP(3),
    "weightsJson" TEXT NOT NULL,
    "feedback360" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerformanceCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppraisalRecord" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "managerId" TEXT,
    "templateId" TEXT,
    "goalsCopiedFrom" TEXT,
    "kpiTotalWeight" DOUBLE PRECISION,
    "selfScore" DOUBLE PRECISION,
    "managerScore" DOUBLE PRECISION,
    "finalScore" DOUBLE PRECISION,
    "finalRating" INTEGER,
    "potentialBand" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'Enrolled',
    "acknowledgedAt" TIMESTAMP(3),
    "appealNote" TEXT,
    "appealStatus" TEXT,
    "appealDecidedBy" TEXT,
    "appealDecidedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppraisalRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppraisalKpi" (
    "id" TEXT NOT NULL,
    "appraisalId" TEXT NOT NULL,
    "kpiDefId" TEXT,
    "title" TEXT NOT NULL,
    "polarity" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "metricText" TEXT,
    "thresholdMin" DOUBLE PRECISION,
    "target" DOUBLE PRECISION NOT NULL,
    "stretchValue" DOUBLE PRECISION,
    "weight" DOUBLE PRECISION NOT NULL,
    "isCritical" BOOLEAN NOT NULL DEFAULT false,
    "dataSource" TEXT NOT NULL DEFAULT 'Manual',
    "autoValueJson" TEXT,
    "midActual" DOUBLE PRECISION,
    "finalActual" DOUBLE PRECISION,
    "evidenceJson" TEXT,
    "proposedBy" TEXT NOT NULL DEFAULT 'Manager',
    "origin" TEXT NOT NULL DEFAULT 'Fresh',
    "copiedFromId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppraisalKpi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppraisalCompetencyScore" (
    "id" TEXT NOT NULL,
    "appraisalId" TEXT NOT NULL,
    "competencyId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "selfScore" INTEGER,
    "comment" TEXT,
    "selfComment" TEXT,
    "aiAssisted" BOOLEAN NOT NULL DEFAULT false,
    "selfAiAssisted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AppraisalCompetencyScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckIn" (
    "id" TEXT NOT NULL,
    "appraisalId" TEXT NOT NULL,
    "heldAt" TIMESTAMP(3) NOT NULL,
    "agenda" TEXT,
    "notesJson" TEXT NOT NULL,
    "managerComment" TEXT,
    "nextCheckInAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'Planned',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback360" (
    "id" TEXT NOT NULL,
    "appraisalId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "reviewerType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Invited',
    "dueAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Feedback360_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback360Answer" (
    "id" TEXT NOT NULL,
    "feedbackId" TEXT NOT NULL,
    "competencyId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "aiAssisted" BOOLEAN NOT NULL DEFAULT false,
    "flaggedJson" TEXT,
    "moderated" TEXT,

    CONSTRAINT "Feedback360Answer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalibrationSession" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "heldAt" TIMESTAMP(3) NOT NULL,
    "participantsJson" TEXT NOT NULL,
    "chairId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalibrationSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalibrationDecision" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "appraisalId" TEXT NOT NULL,
    "oldScore" DOUBLE PRECISION,
    "newScore" DOUBLE PRECISION,
    "oldRating" INTEGER,
    "newRating" INTEGER,
    "potentialBand" INTEGER,
    "reason" TEXT NOT NULL,
    "decidedBy" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalibrationDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeritMatrix" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gridJson" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeritMatrix_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeritRecommendation" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "appraisalId" TEXT NOT NULL,
    "matrixId" TEXT,
    "bonusMonths" DOUBLE PRECISION,
    "bonusAmount" TEXT,
    "raisePct" DOUBLE PRECISION,
    "raiseAmount" TEXT,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "personnelActionId" TEXT,
    "appliedRunNo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeritRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipPlan" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "appraisalId" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "targetsJson" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "hrAdvisorId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "outcomeNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipCheckpoint" (
    "id" TEXT NOT NULL,
    "pipId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "achievementPct" DOUBLE PRECISION,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProbationEvaluation" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "onboardingId" TEXT,
    "cycleId" TEXT,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "criteriaJson" TEXT NOT NULL,
    "managerScore" DOUBLE PRECISION,
    "hrNote" TEXT,
    "recommendation" TEXT,
    "decisionDate" TIMESTAMP(3),
    "personnelActionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProbationEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OkrObjective" (
    "id" TEXT NOT NULL,
    "quarter" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ownerEmployeeId" TEXT NOT NULL,
    "alignToId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "weight" INTEGER NOT NULL DEFAULT 100,
    "closedScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OkrObjective_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OkrKeyResult" (
    "id" TEXT NOT NULL,
    "objectiveId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "polarity" TEXT NOT NULL DEFAULT 'HigherIsBetter',
    "baseline" DOUBLE PRECISION NOT NULL,
    "target" DOUBLE PRECISION NOT NULL,
    "current" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "weight" INTEGER NOT NULL DEFAULT 20,
    "confidence" TEXT NOT NULL DEFAULT 'Yellow',
    "note" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OkrKeyResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable (B4-BL — succession planning D-BL13–15)
CREATE TABLE "SuccessionPosition" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "critical" BOOLEAN NOT NULL DEFAULT true,
    "targetSuccessors" INTEGER NOT NULL DEFAULT 2,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SuccessionPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuccessorCandidate" (
    "id" TEXT NOT NULL,
    "successionPositionId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "readiness" TEXT NOT NULL,
    "suggested9Box" TEXT,
    "flightRisk" DOUBLE PRECISION,
    "devNotes" TEXT,
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SuccessorCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable (B5-BL — benchmark gaji pasar D-BL16/D-BL17)
CREATE TABLE "SalaryBenchmark" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "sourceLabel" TEXT NOT NULL,
    "gradeCode" TEXT,
    "positionId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "p25" DOUBLE PRECISION NOT NULL,
    "p50" DOUBLE PRECISION NOT NULL,
    "p75" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalaryBenchmark_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_code_key" ON "Company"("code");

-- CreateIndex (B5-BL — unique 3-kolom nullable = NULL-distinct di PG; guard duplikat null-aware di service benchmark)
CREATE UNIQUE INDEX "SalaryBenchmark_year_sourceLabel_gradeCode_positionId_key" ON "SalaryBenchmark"("year", "sourceLabel", "gradeCode", "positionId");

-- CreateIndex
CREATE INDEX "SalaryBenchmark_year_gradeCode_idx" ON "SalaryBenchmark"("year", "gradeCode");

-- AddForeignKey (B5-BL)
ALTER TABLE "SalaryBenchmark" ADD CONSTRAINT "SalaryBenchmark_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddColumn (B6-BL — link meeting video-call tahap seleksi; idempoten utk tenant
-- existing via scripts/migrate-recruitment-b6-wa-meeting.ts — INSERT kolom di
-- CREATE TABLE di atas menjadikan ALTER ini no-op pada provisioning tenant baru)
ALTER TABLE "CandidateSelectionStep" ADD COLUMN IF NOT EXISTS "meetingUrl" TEXT;

-- CreateTable (B7-BL — branding portal karier per tenant; row ABSEN = fallback
-- kode default — migrasi TIDAK menge-seed default)
CREATE TABLE "CareerSiteConfig" (
    "id" TEXT NOT NULL,
    "tenantSlug" TEXT NOT NULL,
    "brandColor" TEXT NOT NULL DEFAULT '#0f766e',
    "logoUrl" TEXT,
    "heroTitle" TEXT,
    "heroSub" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareerSiteConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (B7-BL)
CREATE UNIQUE INDEX "CareerSiteConfig_tenantSlug_key" ON "CareerSiteConfig"("tenantSlug");

-- AddColumn (B7-BL — magic-link cek status lamaran sekali-pakai; idempoten utk
-- tenant existing via scripts/migrate-recruitment-b7-status-link.ts — INSERT
-- kolom di CREATE TABLE di atas menjadikan ALTER ini no-op pada tenant baru)
ALTER TABLE "Applicant" ADD COLUMN IF NOT EXISTS "statusLinkUsedAt" TIMESTAMP(3);

-- AddColumn (B8-BL — referral tracker: referralNote = konteks/pesan perujuk;
-- referralRewardNote = catatan insentif MANUAL HR DI LUAR payroll §5. Idempoten
-- utk tenant existing via scripts/migrate-recruitment-b8-referral.ts — INSERT
-- kolom di CREATE TABLE di atas menjadikan ALTER ini no-op pada tenant baru)
ALTER TABLE "Applicant" ADD COLUMN IF NOT EXISTS "referralNote" TEXT;
ALTER TABLE "Applicant" ADD COLUMN IF NOT EXISTS "referralRewardNote" TEXT;

-- AddColumn (KPI-METRIC — Metric / Measure of Success: rubrik ukuran keberhasilan
-- per KPI, diisi saat penetapan target [snapshot AppraisalKpi] + default pustaka
-- [KpiDefinition]. Idempoten utk tenant existing via
-- scripts/migrate-kpi-metric-text.ts — INSERT kolom di CREATE TABLE di atas
-- menjadikan ALTER ini no-op pada provisioning tenant baru)
ALTER TABLE "KpiDefinition" ADD COLUMN IF NOT EXISTS "metricText" TEXT;
ALTER TABLE "AppraisalKpi" ADD COLUMN IF NOT EXISTS "metricText" TEXT;

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
CREATE INDEX "Employee_status_idx" ON "Employee"("status");

-- CreateIndex
CREATE INDEX "EmployeeAssignment_employeeId_validTo_idx" ON "EmployeeAssignment"("employeeId", "validTo");

-- CreateIndex
CREATE INDEX "EmployeeAssignment_validTo_idx" ON "EmployeeAssignment"("validTo");

-- CreateIndex
CREATE INDEX "EmployeeFamily_employeeId_idx" ON "EmployeeFamily"("employeeId");

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
CREATE INDEX "EmployeeWageTemplateHistory_employeeId_validFrom_idx" ON "EmployeeWageTemplateHistory"("employeeId", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRegulation_code_key" ON "PayrollRegulation"("code");

-- CreateIndex
CREATE UNIQUE INDEX "MinimumWage_year_companyOfficeId_key" ON "MinimumWage"("year", "companyOfficeId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_runNo_key" ON "PayrollRun"("runNo");

-- CreateIndex
CREATE INDEX "PayrollRun_periodId_processTypeId_idx" ON "PayrollRun"("periodId", "processTypeId");

-- CreateIndex
CREATE INDEX "PayrollRunLog_runId_idx" ON "PayrollRunLog"("runId");

-- CreateIndex
CREATE INDEX "PayrollRunLine_employeeId_idx" ON "PayrollRunLine"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRunLine_runId_employeeId_key" ON "PayrollRunLine"("runId", "employeeId");

-- CreateIndex
CREATE INDEX "PayrollRunItem_lineId_idx" ON "PayrollRunItem"("lineId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeLoan_letterNo_key" ON "EmployeeLoan"("letterNo");

-- CreateIndex
CREATE INDEX "EmployeeLoan_employeeId_status_idx" ON "EmployeeLoan"("employeeId", "status");

-- CreateIndex
CREATE INDEX "EmployeeComponentAssignment_periodId_processTypeId_kind_idx" ON "EmployeeComponentAssignment"("periodId", "processTypeId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollJournal_journalNo_key" ON "PayrollJournal"("journalNo");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollJournal_runId_key" ON "PayrollJournal"("runId");

-- CreateIndex
CREATE INDEX "PayrollJournalLine_journalId_idx" ON "PayrollJournalLine"("journalId");

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
CREATE INDEX "BenefitClaim_status_idx" ON "BenefitClaim"("status");

-- CreateIndex
CREATE INDEX "BenefitClaim_employeeId_idx" ON "BenefitClaim"("employeeId");

-- CreateIndex
CREATE INDEX "BenefitClaim_periodId_idx" ON "BenefitClaim"("periodId");

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
CREATE INDEX "AppUser_email_idx" ON "AppUser"("email");

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
CREATE INDEX "OpenShiftPost_workDate_idx" ON "OpenShiftPost"("workDate");

-- CreateIndex
CREATE INDEX "OpenShiftPost_status_idx" ON "OpenShiftPost"("status");

-- CreateIndex
CREATE UNIQUE INDEX "OpenShiftClaim_postId_employeeId_key" ON "OpenShiftClaim"("postId", "employeeId");

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
CREATE UNIQUE INDEX "TravelCityRate_city_key" ON "TravelCityRate"("city");

-- CreateIndex
CREATE UNIQUE INDEX "TravelTemplate_code_key" ON "TravelTemplate"("code");

-- CreateIndex
CREATE UNIQUE INDEX "TravelExpenseType_code_key" ON "TravelExpenseType"("code");

-- CreateIndex
CREATE INDEX "TravelExpenseTypeRule_travelExpenseTypeId_active_idx" ON "TravelExpenseTypeRule"("travelExpenseTypeId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "TravelBudget_year_key" ON "TravelBudget"("year");

-- CreateIndex
CREATE INDEX "TravelBudgetItem_budgetId_idx" ON "TravelBudgetItem"("budgetId");

-- CreateIndex
CREATE UNIQUE INDEX "TravelRequest_docNo_key" ON "TravelRequest"("docNo");

-- CreateIndex
CREATE INDEX "TravelRequest_employeeId_idx" ON "TravelRequest"("employeeId");

-- CreateIndex
CREATE INDEX "TravelRequest_status_idx" ON "TravelRequest"("status");

-- CreateIndex
CREATE INDEX "TravelRequest_requestDate_idx" ON "TravelRequest"("requestDate");

-- CreateIndex
CREATE INDEX "TravelRequest_status_employeeId_idx" ON "TravelRequest"("status", "employeeId");

-- CreateIndex
CREATE INDEX "TravelDestination_requestId_idx" ON "TravelDestination"("requestId");

-- CreateIndex
CREATE INDEX "TravelAdvance_requestId_idx" ON "TravelAdvance"("requestId");

-- CreateIndex
CREATE INDEX "TravelAdvance_status_idx" ON "TravelAdvance"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TravelClaim_docNo_key" ON "TravelClaim"("docNo");

-- CreateIndex
CREATE INDEX "TravelClaim_employeeId_idx" ON "TravelClaim"("employeeId");

-- CreateIndex
CREATE INDEX "TravelClaim_status_idx" ON "TravelClaim"("status");

-- CreateIndex
CREATE INDEX "TravelClaim_requestId_idx" ON "TravelClaim"("requestId");

-- CreateIndex
CREATE INDEX "TravelClaim_periodCode_idx" ON "TravelClaim"("periodCode");

-- CreateIndex
CREATE INDEX "TravelClaim_status_periodCode_idx" ON "TravelClaim"("status", "periodCode");

-- CreateIndex
CREATE INDEX "TravelClaimExpense_claimId_idx" ON "TravelClaimExpense"("claimId");

-- CreateIndex
CREATE INDEX "TravelClaimExpense_expenseCode_idx" ON "TravelClaimExpense"("expenseCode");

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
CREATE UNIQUE INDEX "MedicalClaim_reversalOfId_key" ON "MedicalClaim"("reversalOfId");

-- CreateIndex
CREATE INDEX "MedicalClaim_state_idx" ON "MedicalClaim"("state");

-- CreateIndex
CREATE INDEX "MedicalClaim_year_typeId_idx" ON "MedicalClaim"("year", "typeId");

-- CreateIndex
CREATE INDEX "MedicalClaim_employeeId_idx" ON "MedicalClaim"("employeeId");

-- CreateIndex
CREATE INDEX "MedicalClaimLine_providerId_idx" ON "MedicalClaimLine"("providerId");

-- CreateIndex
CREATE INDEX "MedicalClaimLine_receiptNo_idx" ON "MedicalClaimLine"("receiptNo");

-- CreateIndex
CREATE UNIQUE INDEX "MedicalAdjustment_docNo_key" ON "MedicalAdjustment"("docNo");

-- CreateIndex
CREATE INDEX "MedicalAdjustment_state_idx" ON "MedicalAdjustment"("state");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "WebhookLog_status_nextRetryAt_idx" ON "WebhookLog"("status", "nextRetryAt");

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

-- CreateIndex
CREATE INDEX "Onboarding_employeeId_idx" ON "Onboarding"("employeeId");

-- CreateIndex
CREATE INDEX "Onboarding_status_idx" ON "Onboarding"("status");

-- CreateIndex
CREATE INDEX "OnboardingTask_onboardingId_idx" ON "OnboardingTask"("onboardingId");

-- CreateIndex
CREATE INDEX "MachineImportBatch_importedAt_idx" ON "MachineImportBatch"("importedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Announcement_code_key" ON "Announcement"("code");

-- CreateIndex
CREATE INDEX "Announcement_publishedAt_idx" ON "Announcement"("publishedAt");

-- CreateIndex
CREATE INDEX "AnnouncementRead_employeeId_idx" ON "AnnouncementRead"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "AnnouncementRead_announcementId_employeeId_key" ON "AnnouncementRead"("announcementId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_code_key" ON "Asset"("code");

-- CreateIndex
CREATE INDEX "Asset_category_idx" ON "Asset"("category");

-- CreateIndex
CREATE INDEX "Asset_status_idx" ON "Asset"("status");

-- CreateIndex
CREATE INDEX "AssetAssignment_employeeId_idx" ON "AssetAssignment"("employeeId");

-- CreateIndex
CREATE INDEX "AssetAssignment_assetId_idx" ON "AssetAssignment"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftSwapRequest_code_key" ON "ShiftSwapRequest"("code");

-- CreateIndex
CREATE INDEX "ShiftSwapRequest_status_idx" ON "ShiftSwapRequest"("status");

-- CreateIndex
CREATE INDEX "ShiftSwapRequest_requesterId_idx" ON "ShiftSwapRequest"("requesterId");

-- CreateIndex
CREATE INDEX "ShiftSwapRequest_targetId_idx" ON "ShiftSwapRequest"("targetId");

-- CreateIndex
CREATE UNIQUE INDEX "WaTemplate_event_key" ON "WaTemplate"("event");

-- CreateIndex
CREATE INDEX "WaLog_createdAt_idx" ON "WaLog"("createdAt");

-- CreateIndex
CREATE INDEX "WaLog_event_idx" ON "WaLog"("event");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyViewGrant_userId_key" ON "MoneyViewGrant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomReport_code_key" ON "CustomReport"("code");

-- CreateIndex
CREATE INDEX "CustomReport_entity_idx" ON "CustomReport"("entity");

-- CreateIndex
CREATE UNIQUE INDEX "WhistleblowReport_ticketNo_key" ON "WhistleblowReport"("ticketNo");

-- CreateIndex
CREATE INDEX "WhistleblowReport_status_idx" ON "WhistleblowReport"("status");

-- CreateIndex
CREATE INDEX "WhistleblowReport_category_idx" ON "WhistleblowReport"("category");

-- CreateIndex
CREATE INDEX "WhistleblowReport_createdAt_idx" ON "WhistleblowReport"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SignatureKey_appUserId_key" ON "SignatureKey"("appUserId");

-- CreateIndex
CREATE INDEX "SignatureRecord_docType_docId_idx" ON "SignatureRecord"("docType", "docId");

-- CreateIndex
CREATE INDEX "SignatureRecord_signerAppUserId_idx" ON "SignatureRecord"("signerAppUserId");

-- CreateIndex
CREATE INDEX "SignatureRecord_signedAt_idx" ON "SignatureRecord"("signedAt");

-- CreateIndex
CREATE INDEX "SignatureChallenge_appUserId_createdAt_idx" ON "SignatureChallenge"("appUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AiKnowledgeDoc_active_idx" ON "AiKnowledgeDoc"("active");

-- CreateIndex
CREATE INDEX "AiChatMessage_appUserId_mode_createdAt_idx" ON "AiChatMessage"("appUserId", "mode", "createdAt");

-- CreateIndex
CREATE INDEX "DirectMessage_senderId_recipientId_createdAt_idx" ON "DirectMessage"("senderId", "recipientId", "createdAt");

-- CreateIndex
CREATE INDEX "DirectMessage_recipientId_readAt_idx" ON "DirectMessage"("recipientId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "NonEmployeePartner_code_key" ON "NonEmployeePartner"("code");

-- CreateIndex
CREATE INDEX "NonEmployeePartner_active_name_idx" ON "NonEmployeePartner"("active", "name");

-- CreateIndex
CREATE UNIQUE INDEX "NonEmployeePayment_docNo_key" ON "NonEmployeePayment"("docNo");

-- CreateIndex
CREATE INDEX "NonEmployeePayment_partnerId_paymentDate_idx" ON "NonEmployeePayment"("partnerId", "paymentDate");

-- CreateIndex
CREATE INDEX "NonEmployeePayment_taxYear_taxMonth_idx" ON "NonEmployeePayment"("taxYear", "taxMonth");

-- CreateIndex
CREATE INDEX "NonEmployeePayment_status_idx" ON "NonEmployeePayment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "RecruitmentMethod_code_key" ON "RecruitmentMethod"("code");

-- CreateIndex
CREATE UNIQUE INDEX "AdMediaType_code_key" ON "AdMediaType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "EmploymentAgency_code_key" ON "EmploymentAgency"("code");

-- CreateIndex
CREATE UNIQUE INDEX "RecruitmentCostItem_code_key" ON "RecruitmentCostItem"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Skill_code_key" ON "Skill"("code");

-- CreateIndex
CREATE UNIQUE INDEX "RequiredDocument_code_key" ON "RequiredDocument"("code");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationCategory_code_key" ON "EvaluationCategory"("code");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationScale_code_key" ON "EvaluationScale"("code");

-- CreateIndex
CREATE UNIQUE INDEX "SlaGroup_code_key" ON "SlaGroup"("code");

-- CreateIndex
CREATE UNIQUE INDEX "SelectionProcess_code_key" ON "SelectionProcess"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PersonnelRequisition_prNo_key" ON "PersonnelRequisition"("prNo");

-- CreateIndex
CREATE INDEX "PersonnelRequisition_status_requestDate_idx" ON "PersonnelRequisition"("status", "requestDate");

-- CreateIndex
CREATE INDEX "PersonnelRequisition_requestedById_idx" ON "PersonnelRequisition"("requestedById");

-- CreateIndex
CREATE INDEX "PersonnelRequisition_planId_idx" ON "PersonnelRequisition"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "JobOpportunity_refNo_key" ON "JobOpportunity"("refNo");

-- CreateIndex
CREATE INDEX "JobOpportunity_status_idx" ON "JobOpportunity"("status");

-- CreateIndex
CREATE INDEX "JobOpportunity_datePosted_idx" ON "JobOpportunity"("datePosted");

-- CreateIndex
CREATE INDEX "JobOpening_prId_idx" ON "JobOpening"("prId");

-- CreateIndex
CREATE INDEX "JobOpening_status_idx" ON "JobOpening"("status");

-- CreateIndex
CREATE UNIQUE INDEX "JobOpening_jobOpportunityId_prId_key" ON "JobOpening"("jobOpportunityId", "prId");

-- CreateIndex
CREATE INDEX "JobOpeningMethod_jobOpportunityId_idx" ON "JobOpeningMethod"("jobOpportunityId");

-- CreateIndex
CREATE UNIQUE INDEX "Applicant_applicantNo_key" ON "Applicant"("applicantNo");

-- CreateIndex
CREATE INDEX "Applicant_status_idx" ON "Applicant"("status");

-- CreateIndex
CREATE INDEX "Applicant_keepOnFileUntil_idx" ON "Applicant"("keepOnFileUntil");

-- CreateIndex
CREATE INDEX "Applicant_source_idx" ON "Applicant"("source");

-- CreateIndex
CREATE INDEX "ApplicantEducation_applicantId_idx" ON "ApplicantEducation"("applicantId");

-- CreateIndex
CREATE INDEX "ApplicantExperience_applicantId_idx" ON "ApplicantExperience"("applicantId");

-- CreateIndex
CREATE INDEX "ApplicantSkill_applicantId_idx" ON "ApplicantSkill"("applicantId");

-- CreateIndex
CREATE INDEX "ApplicantSkill_skillId_idx" ON "ApplicantSkill"("skillId");

-- CreateIndex
CREATE INDEX "ApplicantDocument_applicantId_idx" ON "ApplicantDocument"("applicantId");

-- CreateIndex
CREATE INDEX "ApplicantApplication_jobOpeningId_idx" ON "ApplicantApplication"("jobOpeningId");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicantApplication_applicantId_jobOpeningId_key" ON "ApplicantApplication"("applicantId", "jobOpeningId");

-- CreateIndex
CREATE INDEX "PublicApplication_status_submittedAt_idx" ON "PublicApplication"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "ApplicantConsent_applicantId_purpose_idx" ON "ApplicantConsent"("applicantId", "purpose");

-- CreateIndex
CREATE INDEX "JobCandidate_prId_status_idx" ON "JobCandidate"("prId", "status");

-- CreateIndex
CREATE INDEX "JobCandidate_employeeId_idx" ON "JobCandidate"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "JobCandidate_prId_applicantId_key" ON "JobCandidate"("prId", "applicantId");

-- CreateIndex
CREATE INDEX "CandidateSelectionStep_candidateId_status_idx" ON "CandidateSelectionStep"("candidateId", "status");

-- CreateIndex
CREATE INDEX "CandidateSelectionStep_status_dueDate_idx" ON "CandidateSelectionStep"("status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateSelectionStep_candidateId_selectionProcessId_seqNo_key" ON "CandidateSelectionStep"("candidateId", "selectionProcessId", "seqNo");

-- CreateIndex
CREATE INDEX "ScorecardTemplate_active_idx" ON "ScorecardTemplate"("active");

-- CreateIndex
CREATE INDEX "ScorecardCompetency_templateId_orderNo_idx" ON "ScorecardCompetency"("templateId", "orderNo");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateScorecard_selectionStepId_evaluatorId_key" ON "CandidateScorecard"("selectionStepId", "evaluatorId");

-- CreateIndex
CREATE UNIQUE INDEX "ScorecardItem_scorecardId_competencyId_key" ON "ScorecardItem"("scorecardId", "competencyId");

-- CreateIndex
CREATE UNIQUE INDEX "RecruitmentLetter_letterNo_key" ON "RecruitmentLetter"("letterNo");

-- CreateIndex
CREATE INDEX "RecruitmentLetter_candidateId_issuedAt_idx" ON "RecruitmentLetter"("candidateId", "issuedAt");

-- CreateIndex
CREATE INDEX "RecruitmentLetter_kind_issuedAt_idx" ON "RecruitmentLetter"("kind", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateOffer_offerNo_key" ON "CandidateOffer"("offerNo");

-- CreateIndex
CREATE INDEX "CandidateOffer_status_expiryDate_idx" ON "CandidateOffer"("status", "expiryDate");

-- CreateIndex
CREATE INDEX "CandidateOffer_prId_idx" ON "CandidateOffer"("prId");

-- CreateIndex
CREATE INDEX "CandidateOffer_candidateId_idx" ON "CandidateOffer"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateAppointment_offerId_key" ON "CandidateAppointment"("offerId");

-- CreateIndex
CREATE INDEX "CandidateAppointment_prId_idx" ON "CandidateAppointment"("prId");

-- CreateIndex
CREATE INDEX "CandidateAppointment_employeeId_idx" ON "CandidateAppointment"("employeeId");

-- CreateIndex
CREATE INDEX "RecruitmentPlan_period_idx" ON "RecruitmentPlan"("period");

-- CreateIndex
CREATE INDEX "RecruitmentPlan_status_idx" ON "RecruitmentPlan"("status");

-- CreateIndex
CREATE UNIQUE INDEX "RecruitmentBudget_period_key" ON "RecruitmentBudget"("period");

-- CreateIndex
CREATE INDEX "EmpJobApplication_employeeId_idx" ON "EmpJobApplication"("employeeId");

-- CreateIndex
CREATE INDEX "EmpJobApplication_jobOpeningId_idx" ON "EmpJobApplication"("jobOpeningId");

-- CreateIndex
CREATE UNIQUE INDEX "EmpJobApplication_employeeId_jobOpeningId_key" ON "EmpJobApplication"("employeeId", "jobOpeningId");

-- CreateIndex
CREATE INDEX "KnockoutQuestion_jobOpeningId_idx" ON "KnockoutQuestion"("jobOpeningId");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationAnswer_applicationId_questionId_key" ON "ApplicationAnswer"("applicationId", "questionId");

-- CreateIndex
CREATE INDEX "CvParseResult_applicantId_idx" ON "CvParseResult"("applicantId");

-- CreateIndex
CREATE INDEX "CandidateAiScore_candidateId_generatedAt_idx" ON "CandidateAiScore"("candidateId", "generatedAt");

-- CreateIndex
CREATE INDEX "WebhookEndpoint_active_idx" ON "WebhookEndpoint"("active");

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_nextRetryAt_idx" ON "WebhookDelivery"("status", "nextRetryAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPref_employeeId_key" ON "NotificationPref"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "RecruitmentSetting_key_key" ON "RecruitmentSetting"("key");

-- CreateIndex
CREATE UNIQUE INDEX "EsignRequest_token_key" ON "EsignRequest"("token");

-- CreateIndex
CREATE INDEX "EsignRequest_status_idx" ON "EsignRequest"("status");

-- CreateIndex
CREATE INDEX "MetricSnapshot_metric_period_idx" ON "MetricSnapshot"("metric", "period");

-- CreateIndex
CREATE UNIQUE INDEX "MetricSnapshot_metric_period_dimsJson_key" ON "MetricSnapshot"("metric", "period", "dimsJson");

-- CreateIndex
CREATE INDEX "SavedReportView_ownerId_idx" ON "SavedReportView"("ownerId");

-- CreateIndex
CREATE INDEX "DataSubjectRequest_status_dueAt_idx" ON "DataSubjectRequest"("status", "dueAt");

-- CreateIndex
CREATE INDEX "DataSubjectRequest_applicantId_idx" ON "DataSubjectRequest"("applicantId");

-- CreateIndex
CREATE INDEX "DataSubjectRequest_employeeId_idx" ON "DataSubjectRequest"("employeeId");

-- CreateIndex
CREATE INDEX "KpiDefinition_category_active_idx" ON "KpiDefinition"("category", "active");

-- CreateIndex
CREATE INDEX "KpiDefinition_status_idx" ON "KpiDefinition"("status");

-- CreateIndex
CREATE UNIQUE INDEX "KpiDefinition_code_versionNo_key" ON "KpiDefinition"("code", "versionNo");

-- CreateIndex
CREATE INDEX "Competency_kind_active_idx" ON "Competency"("kind", "active");

-- CreateIndex
CREATE INDEX "Competency_status_idx" ON "Competency"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Competency_code_versionNo_key" ON "Competency"("code", "versionNo");

-- CreateIndex
CREATE UNIQUE INDEX "RatingScale_value_key" ON "RatingScale"("value");

-- CreateIndex
CREATE UNIQUE INDEX "RatingScale_minScore_key" ON "RatingScale"("minScore");

-- CreateIndex
CREATE UNIQUE INDEX "PerformanceTemplate_code_key" ON "PerformanceTemplate"("code");

-- CreateIndex
CREATE INDEX "PerformanceTemplateItem_templateId_idx" ON "PerformanceTemplateItem"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "PerformanceCycle_code_key" ON "PerformanceCycle"("code");

-- CreateIndex
CREATE INDEX "PerformanceCycle_status_periodEnd_idx" ON "PerformanceCycle"("status", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "AppraisalRecord_docNo_key" ON "AppraisalRecord"("docNo");

-- CreateIndex
CREATE INDEX "AppraisalRecord_employeeId_idx" ON "AppraisalRecord"("employeeId");

-- CreateIndex
CREATE INDEX "AppraisalRecord_cycleId_status_idx" ON "AppraisalRecord"("cycleId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AppraisalRecord_cycleId_employeeId_key" ON "AppraisalRecord"("cycleId", "employeeId");

-- CreateIndex
CREATE INDEX "AppraisalKpi_appraisalId_idx" ON "AppraisalKpi"("appraisalId");

-- CreateIndex
CREATE UNIQUE INDEX "AppraisalCompetencyScore_appraisalId_competencyId_key" ON "AppraisalCompetencyScore"("appraisalId", "competencyId");

-- CreateIndex
CREATE INDEX "CheckIn_appraisalId_heldAt_idx" ON "CheckIn"("appraisalId", "heldAt");

-- CreateIndex
CREATE UNIQUE INDEX "Feedback360_appraisalId_reviewerId_reviewerType_key" ON "Feedback360"("appraisalId", "reviewerId", "reviewerType");

-- CreateIndex
CREATE INDEX "Feedback360Answer_feedbackId_competencyId_idx" ON "Feedback360Answer"("feedbackId", "competencyId");
CREATE INDEX "Feedback360Answer_moderated_idx" ON "Feedback360Answer"("moderated");

-- CreateIndex
CREATE INDEX "CalibrationSession_cycleId_idx" ON "CalibrationSession"("cycleId");

-- CreateIndex
CREATE INDEX "CalibrationDecision_appraisalId_idx" ON "CalibrationDecision"("appraisalId");

-- CreateIndex
CREATE UNIQUE INDEX "MeritMatrix_code_key" ON "MeritMatrix"("code");

-- CreateIndex
CREATE UNIQUE INDEX "MeritRecommendation_docNo_key" ON "MeritRecommendation"("docNo");

-- CreateIndex
CREATE UNIQUE INDEX "MeritRecommendation_appraisalId_key" ON "MeritRecommendation"("appraisalId");

-- CreateIndex
CREATE UNIQUE INDEX "PipPlan_docNo_key" ON "PipPlan"("docNo");

-- CreateIndex
CREATE INDEX "PipPlan_employeeId_status_idx" ON "PipPlan"("employeeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PipCheckpoint_pipId_seq_key" ON "PipCheckpoint"("pipId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "ProbationEvaluation_docNo_key" ON "ProbationEvaluation"("docNo");

-- CreateIndex
CREATE INDEX "ProbationEvaluation_employeeId_status_idx" ON "ProbationEvaluation"("employeeId", "status");

-- CreateIndex
CREATE INDEX "ProbationEvaluation_dueDate_idx" ON "ProbationEvaluation"("dueDate");

-- CreateIndex
CREATE INDEX "OkrObjective_quarter_status_idx" ON "OkrObjective"("quarter", "status");

-- CreateIndex
CREATE INDEX "OkrObjective_ownerEmployeeId_idx" ON "OkrObjective"("ownerEmployeeId");

-- CreateIndex
CREATE INDEX "OkrKeyResult_objectiveId_idx" ON "OkrKeyResult"("objectiveId");

-- CreateIndex (B4-BL — succession)
CREATE UNIQUE INDEX "SuccessionPosition_positionId_key" ON "SuccessionPosition"("positionId");

-- CreateIndex
CREATE INDEX "SuccessorCandidate_employeeId_idx" ON "SuccessorCandidate"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "SuccessorCandidate_successionPositionId_employeeId_key" ON "SuccessorCandidate"("successionPositionId", "employeeId");

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
ALTER TABLE "WageComponentRule" ADD CONSTRAINT "WageComponentRule_wageComponentId_fkey" FOREIGN KEY ("wageComponentId") REFERENCES "WageComponent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WageTemplateItem" ADD CONSTRAINT "WageTemplateItem_wageTemplateId_fkey" FOREIGN KEY ("wageTemplateId") REFERENCES "WageTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WageTemplateItem" ADD CONSTRAINT "WageTemplateItem_wageComponentId_fkey" FOREIGN KEY ("wageComponentId") REFERENCES "WageComponent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeePayrollProfile" ADD CONSTRAINT "EmployeePayrollProfile_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeePayrollProfile" ADD CONSTRAINT "EmployeePayrollProfile_wageTemplateId_fkey" FOREIGN KEY ("wageTemplateId") REFERENCES "WageTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeWageTemplateHistory" ADD CONSTRAINT "EmployeeWageTemplateHistory_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeWageTemplateHistory" ADD CONSTRAINT "EmployeeWageTemplateHistory_wageTemplateId_fkey" FOREIGN KEY ("wageTemplateId") REFERENCES "WageTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MinimumWage" ADD CONSTRAINT "MinimumWage_companyOfficeId_fkey" FOREIGN KEY ("companyOfficeId") REFERENCES "CompanyOffice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "PayrollPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_processTypeId_fkey" FOREIGN KEY ("processTypeId") REFERENCES "ProcessType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRunLog" ADD CONSTRAINT "PayrollRunLog_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
ALTER TABLE "BenefitTypeRule" ADD CONSTRAINT "BenefitTypeRule_benefitTypeId_fkey" FOREIGN KEY ("benefitTypeId") REFERENCES "BenefitType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
ALTER TABLE "OpenShiftClaim" ADD CONSTRAINT "OpenShiftClaim_postId_fkey" FOREIGN KEY ("postId") REFERENCES "OpenShiftPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenShiftClaim" ADD CONSTRAINT "OpenShiftClaim_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveTypeRule" ADD CONSTRAINT "LeaveTypeRule_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
ALTER TABLE "TravelExpenseTypeRule" ADD CONSTRAINT "TravelExpenseTypeRule_travelExpenseTypeId_fkey" FOREIGN KEY ("travelExpenseTypeId") REFERENCES "TravelExpenseType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
ALTER TABLE "MedicalBenefitTypeRule" ADD CONSTRAINT "MedicalBenefitTypeRule_medicalBenefitTypeId_fkey" FOREIGN KEY ("medicalBenefitTypeId") REFERENCES "MedicalBenefitType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalBalance" ADD CONSTRAINT "MedicalBalance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalBalance" ADD CONSTRAINT "MedicalBalance_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "MedicalBenefitType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalClaim" ADD CONSTRAINT "MedicalClaim_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalClaim" ADD CONSTRAINT "MedicalClaim_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "MedicalBenefitType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalClaim" ADD CONSTRAINT "MedicalClaim_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "MedicalClaim"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalClaimLine" ADD CONSTRAINT "MedicalClaimLine_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "MedicalClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalClaimLine" ADD CONSTRAINT "MedicalClaimLine_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "MedicalProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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

-- AddForeignKey
ALTER TABLE "Onboarding" ADD CONSTRAINT "Onboarding_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingTask" ADD CONSTRAINT "OnboardingTask_onboardingId_fkey" FOREIGN KEY ("onboardingId") REFERENCES "Onboarding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementRead" ADD CONSTRAINT "AnnouncementRead_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementRead" ADD CONSTRAINT "AnnouncementRead_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetAssignment" ADD CONSTRAINT "AssetAssignment_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetAssignment" ADD CONSTRAINT "AssetAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftSwapRequest" ADD CONSTRAINT "ShiftSwapRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftSwapRequest" ADD CONSTRAINT "ShiftSwapRequest_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NonEmployeePayment" ADD CONSTRAINT "NonEmployeePayment_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "NonEmployeePartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonnelRequisition" ADD CONSTRAINT "PersonnelRequisition_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonnelRequisition" ADD CONSTRAINT "PersonnelRequisition_planId_fkey" FOREIGN KEY ("planId") REFERENCES "RecruitmentPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonnelRequisition" ADD CONSTRAINT "PersonnelRequisition_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonnelRequisition" ADD CONSTRAINT "PersonnelRequisition_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonnelRequisition" ADD CONSTRAINT "PersonnelRequisition_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonnelRequisition" ADD CONSTRAINT "PersonnelRequisition_companyOfficeId_fkey" FOREIGN KEY ("companyOfficeId") REFERENCES "CompanyOffice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonnelRequisition" ADD CONSTRAINT "PersonnelRequisition_recruitmentOfficerId_fkey" FOREIGN KEY ("recruitmentOfficerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonnelRequisition" ADD CONSTRAINT "PersonnelRequisition_replacedEmployeeId_fkey" FOREIGN KEY ("replacedEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobOpportunity" ADD CONSTRAINT "JobOpportunity_preparedById_fkey" FOREIGN KEY ("preparedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobOpening" ADD CONSTRAINT "JobOpening_jobOpportunityId_fkey" FOREIGN KEY ("jobOpportunityId") REFERENCES "JobOpportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobOpening" ADD CONSTRAINT "JobOpening_prId_fkey" FOREIGN KEY ("prId") REFERENCES "PersonnelRequisition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobOpening" ADD CONSTRAINT "JobOpening_workLocationId_fkey" FOREIGN KEY ("workLocationId") REFERENCES "WorkLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobOpeningMethod" ADD CONSTRAINT "JobOpeningMethod_jobOpportunityId_fkey" FOREIGN KEY ("jobOpportunityId") REFERENCES "JobOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobOpeningMethod" ADD CONSTRAINT "JobOpeningMethod_methodId_fkey" FOREIGN KEY ("methodId") REFERENCES "RecruitmentMethod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobOpeningMethod" ADD CONSTRAINT "JobOpeningMethod_adMediaTypeId_fkey" FOREIGN KEY ("adMediaTypeId") REFERENCES "AdMediaType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobOpeningMethod" ADD CONSTRAINT "JobOpeningMethod_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "EmploymentAgency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobOpeningMethod" ADD CONSTRAINT "JobOpeningMethod_costItemId_fkey" FOREIGN KEY ("costItemId") REFERENCES "RecruitmentCostItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Applicant" ADD CONSTRAINT "Applicant_adMediaTypeId_fkey" FOREIGN KEY ("adMediaTypeId") REFERENCES "AdMediaType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Applicant" ADD CONSTRAINT "Applicant_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "EmploymentAgency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Applicant" ADD CONSTRAINT "Applicant_referralEmployeeId_fkey" FOREIGN KEY ("referralEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicantEducation" ADD CONSTRAINT "ApplicantEducation_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "Applicant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicantExperience" ADD CONSTRAINT "ApplicantExperience_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "Applicant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicantSkill" ADD CONSTRAINT "ApplicantSkill_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "Applicant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicantSkill" ADD CONSTRAINT "ApplicantSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicantDocument" ADD CONSTRAINT "ApplicantDocument_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "Applicant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicantDocument" ADD CONSTRAINT "ApplicantDocument_requiredDocumentId_fkey" FOREIGN KEY ("requiredDocumentId") REFERENCES "RequiredDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicantDocument" ADD CONSTRAINT "ApplicantDocument_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "Attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicantApplication" ADD CONSTRAINT "ApplicantApplication_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "Applicant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicantApplication" ADD CONSTRAINT "ApplicantApplication_jobOpeningId_fkey" FOREIGN KEY ("jobOpeningId") REFERENCES "JobOpening"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicApplication" ADD CONSTRAINT "PublicApplication_jobOpeningId_fkey" FOREIGN KEY ("jobOpeningId") REFERENCES "JobOpening"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicApplication" ADD CONSTRAINT "PublicApplication_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicantConsent" ADD CONSTRAINT "ApplicantConsent_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "Applicant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobCandidate" ADD CONSTRAINT "JobCandidate_prId_fkey" FOREIGN KEY ("prId") REFERENCES "PersonnelRequisition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobCandidate" ADD CONSTRAINT "JobCandidate_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "Applicant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobCandidate" ADD CONSTRAINT "JobCandidate_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobCandidate" ADD CONSTRAINT "JobCandidate_nominatedById_fkey" FOREIGN KEY ("nominatedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateSelectionStep" ADD CONSTRAINT "CandidateSelectionStep_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "JobCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateSelectionStep" ADD CONSTRAINT "CandidateSelectionStep_selectionProcessId_fkey" FOREIGN KEY ("selectionProcessId") REFERENCES "SelectionProcess"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateSelectionStep" ADD CONSTRAINT "CandidateSelectionStep_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScorecardTemplate" ADD CONSTRAINT "ScorecardTemplate_selectionProcessId_fkey" FOREIGN KEY ("selectionProcessId") REFERENCES "SelectionProcess"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScorecardCompetency" ADD CONSTRAINT "ScorecardCompetency_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ScorecardTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateScorecard" ADD CONSTRAINT "CandidateScorecard_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "JobCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateScorecard" ADD CONSTRAINT "CandidateScorecard_selectionStepId_fkey" FOREIGN KEY ("selectionStepId") REFERENCES "CandidateSelectionStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateScorecard" ADD CONSTRAINT "CandidateScorecard_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ScorecardTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateScorecard" ADD CONSTRAINT "CandidateScorecard_evaluatorId_fkey" FOREIGN KEY ("evaluatorId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScorecardItem" ADD CONSTRAINT "ScorecardItem_scorecardId_fkey" FOREIGN KEY ("scorecardId") REFERENCES "CandidateScorecard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScorecardItem" ADD CONSTRAINT "ScorecardItem_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "ScorecardCompetency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentLetter" ADD CONSTRAINT "RecruitmentLetter_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "JobCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentLetter" ADD CONSTRAINT "RecruitmentLetter_selectionStepId_fkey" FOREIGN KEY ("selectionStepId") REFERENCES "CandidateSelectionStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateOffer" ADD CONSTRAINT "CandidateOffer_prId_fkey" FOREIGN KEY ("prId") REFERENCES "PersonnelRequisition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateOffer" ADD CONSTRAINT "CandidateOffer_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "JobCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateOffer" ADD CONSTRAINT "CandidateOffer_jobOpeningId_fkey" FOREIGN KEY ("jobOpeningId") REFERENCES "JobOpening"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateOffer" ADD CONSTRAINT "CandidateOffer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateAppointment" ADD CONSTRAINT "CandidateAppointment_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "CandidateOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateAppointment" ADD CONSTRAINT "CandidateAppointment_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "JobCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateAppointment" ADD CONSTRAINT "CandidateAppointment_prId_fkey" FOREIGN KEY ("prId") REFERENCES "PersonnelRequisition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateAppointment" ADD CONSTRAINT "CandidateAppointment_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateAppointment" ADD CONSTRAINT "CandidateAppointment_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateAppointment" ADD CONSTRAINT "CandidateAppointment_companyOfficeId_fkey" FOREIGN KEY ("companyOfficeId") REFERENCES "CompanyOffice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateAppointment" ADD CONSTRAINT "CandidateAppointment_workLocationId_fkey" FOREIGN KEY ("workLocationId") REFERENCES "WorkLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateAppointment" ADD CONSTRAINT "CandidateAppointment_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateAppointment" ADD CONSTRAINT "CandidateAppointment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentPlan" ADD CONSTRAINT "RecruitmentPlan_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentPlan" ADD CONSTRAINT "RecruitmentPlan_companyOfficeId_fkey" FOREIGN KEY ("companyOfficeId") REFERENCES "CompanyOffice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmpJobApplication" ADD CONSTRAINT "EmpJobApplication_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmpJobApplication" ADD CONSTRAINT "EmpJobApplication_jobOpeningId_fkey" FOREIGN KEY ("jobOpeningId") REFERENCES "JobOpening"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmpJobApplication" ADD CONSTRAINT "EmpJobApplication_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "JobCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnockoutQuestion" ADD CONSTRAINT "KnockoutQuestion_jobOpeningId_fkey" FOREIGN KEY ("jobOpeningId") REFERENCES "JobOpening"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationAnswer" ADD CONSTRAINT "ApplicationAnswer_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "ApplicantApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationAnswer" ADD CONSTRAINT "ApplicationAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "KnockoutQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CvParseResult" ADD CONSTRAINT "CvParseResult_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "Applicant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CvParseResult" ADD CONSTRAINT "CvParseResult_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateAiScore" ADD CONSTRAINT "CandidateAiScore_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "JobCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateAiScore" ADD CONSTRAINT "CandidateAiScore_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPref" ADD CONSTRAINT "NotificationPref_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EsignRequest" ADD CONSTRAINT "EsignRequest_letterId_fkey" FOREIGN KEY ("letterId") REFERENCES "RecruitmentLetter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EsignRequest" ADD CONSTRAINT "EsignRequest_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "CandidateOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EsignRequest" ADD CONSTRAINT "EsignRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedReportView" ADD CONSTRAINT "SavedReportView_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSubjectRequest" ADD CONSTRAINT "DataSubjectRequest_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "Applicant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSubjectRequest" ADD CONSTRAINT "DataSubjectRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSubjectRequest" ADD CONSTRAINT "DataSubjectRequest_handledById_fkey" FOREIGN KEY ("handledById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceTemplateItem" ADD CONSTRAINT "PerformanceTemplateItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "PerformanceTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppraisalRecord" ADD CONSTRAINT "AppraisalRecord_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "PerformanceCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppraisalRecord" ADD CONSTRAINT "AppraisalRecord_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppraisalRecord" ADD CONSTRAINT "AppraisalRecord_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppraisalKpi" ADD CONSTRAINT "AppraisalKpi_appraisalId_fkey" FOREIGN KEY ("appraisalId") REFERENCES "AppraisalRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppraisalKpi" ADD CONSTRAINT "AppraisalKpi_kpiDefId_fkey" FOREIGN KEY ("kpiDefId") REFERENCES "KpiDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppraisalCompetencyScore" ADD CONSTRAINT "AppraisalCompetencyScore_appraisalId_fkey" FOREIGN KEY ("appraisalId") REFERENCES "AppraisalRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppraisalCompetencyScore" ADD CONSTRAINT "AppraisalCompetencyScore_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "Competency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_appraisalId_fkey" FOREIGN KEY ("appraisalId") REFERENCES "AppraisalRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback360" ADD CONSTRAINT "Feedback360_appraisalId_fkey" FOREIGN KEY ("appraisalId") REFERENCES "AppraisalRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback360" ADD CONSTRAINT "Feedback360_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback360Answer" ADD CONSTRAINT "Feedback360Answer_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "Feedback360"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback360Answer" ADD CONSTRAINT "Feedback360Answer_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "Competency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalibrationSession" ADD CONSTRAINT "CalibrationSession_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "PerformanceCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalibrationDecision" ADD CONSTRAINT "CalibrationDecision_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CalibrationSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalibrationDecision" ADD CONSTRAINT "CalibrationDecision_appraisalId_fkey" FOREIGN KEY ("appraisalId") REFERENCES "AppraisalRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeritRecommendation" ADD CONSTRAINT "MeritRecommendation_appraisalId_fkey" FOREIGN KEY ("appraisalId") REFERENCES "AppraisalRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeritRecommendation" ADD CONSTRAINT "MeritRecommendation_matrixId_fkey" FOREIGN KEY ("matrixId") REFERENCES "MeritMatrix"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipPlan" ADD CONSTRAINT "PipPlan_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipPlan" ADD CONSTRAINT "PipPlan_appraisalId_fkey" FOREIGN KEY ("appraisalId") REFERENCES "AppraisalRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipPlan" ADD CONSTRAINT "PipPlan_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipCheckpoint" ADD CONSTRAINT "PipCheckpoint_pipId_fkey" FOREIGN KEY ("pipId") REFERENCES "PipPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProbationEvaluation" ADD CONSTRAINT "ProbationEvaluation_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProbationEvaluation" ADD CONSTRAINT "ProbationEvaluation_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "PerformanceCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OkrObjective" ADD CONSTRAINT "OkrObjective_ownerEmployeeId_fkey" FOREIGN KEY ("ownerEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OkrObjective" ADD CONSTRAINT "OkrObjective_alignToId_fkey" FOREIGN KEY ("alignToId") REFERENCES "OkrObjective"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OkrKeyResult" ADD CONSTRAINT "OkrKeyResult_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "OkrObjective"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OkrKeyResult" ADD CONSTRAINT "OkrKeyResult_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;


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
    -- T5-TA-FIX (D-7): klasifikasi berbayar eksplisit (WorkOffPermission.paid /
    -- LeaveType.paid) — recapPeriod membaca kolom ini, fallback notes utk baris lama.
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

-- CreateTable (T9-HOLIDAY)
CREATE TABLE "HolidayDate" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'National',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HolidayDate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (T9-HOLIDAY)
CREATE UNIQUE INDEX "HolidayDate_date_name_key" ON "HolidayDate"("date", "name");
CREATE INDEX "HolidayDate_date_idx" ON "HolidayDate"("date");
CREATE INDEX "HolidayDate_kind_idx" ON "HolidayDate"("kind");


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


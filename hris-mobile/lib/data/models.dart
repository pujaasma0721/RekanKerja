import 'package:flutter/material.dart';

/// ============ Model data seluruh modul ESS OneVity ============
/// Field lama dipertahankan agar seed demo tetap kompatibel;
/// field opsional (nullable / default) = data dari backend live
/// (https://onevity.sayone.my.id) — lihat lib/data/onevity_api.dart.

class FamilyMember {
  final String name;
  final String relation;
  final DateTime? birthDate;
  FamilyMember(this.name, this.relation, this.birthDate);
}

class EmployeeDoc {
  final String name;
  final String type;
  final DateTime uploadedAt;
  EmployeeDoc(this.name, this.type, this.uploadedAt);
}

class Employee {
  final String id;
  final String employeeNo;
  final String fullName;
  final String nickname;
  final String email;
  final String phone;
  final String position;
  final String unit;
  final String office;
  final String grade;
  final String employmentStatus;
  final String manager;
  final DateTime joinDate;
  final List<FamilyMember> family;
  final List<EmployeeDoc> documents;

  // ---- tambahan dari backend live (/api/onevity/ess/me) ----
  final String? photoUrl;
  final String? companyName;
  final String? levelCode;
  final String? taxId; // NPWP (rahasia — tampil dengan mode privasi)
  final String? bpjsHealth;
  final String? bpjsEmpSkill;

  Employee({
    required this.id,
    required this.employeeNo,
    required this.fullName,
    required this.nickname,
    required this.email,
    required this.phone,
    required this.position,
    required this.unit,
    required this.office,
    required this.grade,
    required this.employmentStatus,
    required this.manager,
    required this.joinDate,
    this.family = const [],
    this.documents = const [],
    this.photoUrl,
    this.companyName,
    this.levelCode,
    this.taxId,
    this.bpjsHealth,
    this.bpjsEmpSkill,
  });
}

/// Workspace (tenant) SaaS OneVity — pilihan setelah login
/// bila satu akun menjadi anggota lebih dari satu perusahaan.
class Workspace {
  final String id;
  final String name;
  final String? companyCode;
  final String? slug;
  final String role;
  Workspace(this.id, this.name, this.companyCode, this.slug, this.role);
}

enum AttendanceStatus { present, late, absent, leave, holiday, weekend, workoff }

class AttendanceRecord {
  final DateTime date;
  final TimeOfDay? checkIn;
  final TimeOfDay? checkOut;
  final AttendanceStatus status;
  final int overtimeMinutes;
  final String? location;

  // ---- tambahan dari backend live ----
  final String? dayTypeCode;
  final int lateMinutes;
  final int earlyMinutes;
  final int workMinutes;

  AttendanceRecord(
    this.date,
    this.checkIn,
    this.checkOut,
    this.status, {
    this.overtimeMinutes = 0,
    this.location,
    this.dayTypeCode,
    this.lateMinutes = 0,
    this.earlyMinutes = 0,
    this.workMinutes = 0,
  });
}

/// Ringkasan presensi satu bulan dari backend.
class AttendanceSummary {
  final int present, late, absent, off, onLeave, workoff;
  final double overtimeHours;
  const AttendanceSummary({
    this.present = 0,
    this.late = 0,
    this.absent = 0,
    this.off = 0,
    this.onLeave = 0,
    this.workoff = 0,
    this.overtimeHours = 0,
  });
}

class LeaveBalance {
  final String type;
  final int entitled;
  final int used;

  // ---- tambahan dari backend live ----
  final String? typeId;
  final String? code;
  final String? unit;
  final double? available;
  final int applied;

  LeaveBalance(this.type, this.entitled, this.used, {
    this.typeId,
    this.code,
    this.unit,
    this.available,
    this.applied = 0,
  });

  double get sisa => available ?? (entitled - used).toDouble();
}

class ApprovalStep {
  final String role;
  final String name;
  final String status; // approved | pending | rejected | submitted
  ApprovalStep(this.role, this.name, this.status);
}

class LeaveRequest {
  final String id;
  final String type;
  final DateTime from;
  final DateTime to;
  final int days;
  final String reason;
  final String status;
  final DateTime submittedAt;
  final List<ApprovalStep> steps;

  // ---- tambahan dari backend live ----
  final String? docNo;
  final String? typeId;
  final String? currentApprover;

  LeaveRequest({
    required this.id,
    required this.type,
    required this.from,
    required this.to,
    required this.days,
    required this.reason,
    required this.status,
    required this.submittedAt,
    this.steps = const [],
    this.docNo,
    this.typeId,
    this.currentApprover,
  });
}

class PayComponent {
  final String name;
  final int amount;
  final bool isDeduction;
  final String note;
  PayComponent(this.name, this.amount, {this.isDeduction = false, this.note = ''});
}

class Payslip {
  final int year;
  final int month;
  final int thp;
  final int gross;
  final int tax;
  final List<PayComponent> components;

  // ---- tambahan dari backend live ----
  final String? lineId;
  final String? periodName;
  final String? status; // Confirmed | Paid
  final DateTime? paidAt;
  final int? totalDeductions;
  final String? employeeName;

  Payslip(this.year, this.month, this.thp, this.gross, this.tax, this.components, {
    this.lineId,
    this.periodName,
    this.status,
    this.paidAt,
    this.totalDeductions,
    this.employeeName,
  });

  List<PayComponent> get penghasilan => components.where((c) => !c.isDeduction).toList();
  List<PayComponent> get potongan => components.where((c) => c.isDeduction).toList();

  String get labelPeriode => periodName ?? '';
}

class Claim {
  final String id;
  final String type;
  final String provider;
  final String description;
  final DateTime date;
  final int amount;
  final String status;
  final List<ApprovalStep> steps;

  // ---- tambahan dari backend live ----
  final String? docNo;
  final int? approvedAmount;
  final DateTime? submittedAt;
  final bool isTravel;
  final int? advanceAmount; // uang muka (travel)
  final int? settlementAmount; // pertanggungjawaban (travel)

  Claim(this.id, this.type, this.provider, this.description, this.date, this.amount, this.status, this.steps, {
    this.docNo,
    this.approvedAmount,
    this.submittedAt,
    this.isTravel = false,
    this.advanceAmount,
    this.settlementAmount,
  });
}

enum RequestKind { overtime, workoff, swap, travel }

class MyRequest {
  final String id;
  final RequestKind kind;
  final DateTime date;
  final String title;
  final String detail;
  final String status;
  final DateTime submittedAt;

  // ---- tambahan dari backend live ----
  final String? docNo;

  MyRequest(this.id, this.kind, this.date, this.title, this.detail, this.status, this.submittedAt, {this.docNo});
}

class LetterTemplate {
  final String key;
  final String name;
  final String? description;
  LetterTemplate(this.key, this.name, this.description);
}

class LetterRequest {
  final String id;
  final String type;
  final String purpose;
  final String status;
  final DateTime requestedAt;

  // ---- tambahan dari backend live ----
  final String? reqNo;
  final String? templateKey;
  final String? notes;
  final String? letterRefNo;
  final DateTime? issuedAt;
  final String? rejectReason;

  LetterRequest(this.id, this.type, this.purpose, this.status, this.requestedAt, {
    this.reqNo,
    this.templateKey,
    this.notes,
    this.letterRefNo,
    this.issuedAt,
    this.rejectReason,
  });
}

class Announcement {
  final String id;
  final String title;
  final String body;
  final String category;
  final String author;
  final DateTime publishedAt;
  final bool pinned;

  // ---- tambahan dari backend live ----
  final String? code;
  final bool readByMe;
  final int totalReads;

  Announcement(this.id, this.title, this.body, this.category, this.author, this.publishedAt, this.pinned, {
    this.code,
    this.readByMe = false,
    this.totalReads = 0,
  });
}

class AssetItem {
  final String id;
  final String name;
  final String code;
  final String serial;
  final String category;
  final DateTime assignedAt;
  final String status;

  // ---- tambahan dari backend live ----
  final DateTime? dueAt;
  final DateTime? returnedAt;
  final String? returnCondition;
  final String? notes;
  final int? value;

  AssetItem(this.id, this.name, this.code, this.serial, this.category, this.assignedAt, this.status, {
    this.dueAt,
    this.returnedAt,
    this.returnCondition,
    this.notes,
    this.value,
  });
}

class WhistleblowReport {
  final String id;
  final String ticket;
  final String category;
  final String description;
  final DateTime submittedAt;
  final String status;
  WhistleblowReport(this.id, this.ticket, this.category, this.description, this.submittedAt, this.status);
}

class SwapOffer {
  final String id;
  final DateTime myDate;
  final String myShift;
  final String colleague;
  final DateTime colleagueDate;
  final String colleagueShift;
  final String status;

  // ---- tambahan dari backend live ----
  final String? code;
  final String? reason;
  final String? decisionNote;

  SwapOffer(this.id, this.myDate, this.myShift, this.colleague, this.colleagueDate, this.colleagueShift, this.status, {
    this.code,
    this.reason,
    this.decisionNote,
  });
}

/// Kandidat rekan tukar shift (backend live: GET /ess/swap?date=).
class SwapCandidate {
  final String employeeId;
  final String employeeNo;
  final String fullName;
  final String? unitName;
  final String dayTypeName;
  final String timeLabel;
  const SwapCandidate({
    required this.employeeId,
    required this.employeeNo,
    required this.fullName,
    this.unitName,
    required this.dayTypeName,
    required this.timeLabel,
  });
}

/// Jadwal saya di tanggal tertentu (backend live).
class SwapMyShift {
  final String? scheduleName;
  final String? dayTypeName;
  final String? timeIn;
  final String? timeOut;
  final bool hasAssignment;
  final bool clockingRequired;
  final String? holidayName;
  const SwapMyShift({
    this.scheduleName,
    this.dayTypeName,
    this.timeIn,
    this.timeOut,
    this.hasAssignment = false,
    this.clockingRequired = false,
    this.holidayName,
  });

  String get label =>
      scheduleName ??
      (holidayName != null ? 'Libur — $holidayName' : (dayTypeName ?? 'Tidak ada jadwal'));
}

class AppNotification {
  final String id;
  final String title;
  final String body;
  final DateTime at;
  final String kind;
  bool read;
  AppNotification(this.id, this.title, this.body, this.at, this.kind, this.read);
}

class ShiftSchedule {
  final DateTime date;
  final String shift;
  final String time;
  ShiftSchedule(this.date, this.shift, this.time);
}

/// KPI dashboard dari backend live (/ess/dashboard).
class DashboardKpi {
  final double leaveAvailable;
  final int pendingMine;
  final int waitingApproval;
  final int present;
  final int late;
  final int absent;
  final double overtimeHoursMonth;
  const DashboardKpi({
    this.leaveAvailable = 0,
    this.pendingMine = 0,
    this.waitingApproval = 0,
    this.present = 0,
    this.late = 0,
    this.absent = 0,
    this.overtimeHoursMonth = 0,
  });
}

/// Hasil satu langkah proses login / cek sesi.
enum LoginStage { done, mfaRequired, pickTenant, error }

class LoginResult {
  final LoginStage stage;
  final String? error;
  final String? mfaToken;
  final List<Workspace> workspaces;
  final Workspace? tenant;
  const LoginResult(this.stage, {this.error, this.mfaToken, this.workspaces = const [], this.tenant});
}

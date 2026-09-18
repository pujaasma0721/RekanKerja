import 'package:flutter/material.dart';

/// ============ Model data seluruh modul ESS OneVity ============

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
  });
}

enum AttendanceStatus { present, late, absent, leave, holiday, weekend }

class AttendanceRecord {
  final DateTime date;
  final TimeOfDay? checkIn;
  final TimeOfDay? checkOut;
  final AttendanceStatus status;
  final int overtimeMinutes;
  final String? location;
  AttendanceRecord(this.date, this.checkIn, this.checkOut, this.status, {this.overtimeMinutes = 0, this.location});
}

class LeaveBalance {
  final String type;
  final int entitled;
  final int used;
  LeaveBalance(this.type, this.entitled, this.used);
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
  Payslip(this.year, this.month, this.thp, this.gross, this.tax, this.components);

  List<PayComponent> get penghasilan => components.where((c) => !c.isDeduction).toList();
  List<PayComponent> get potongan => components.where((c) => c.isDeduction).toList();
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
  Claim(this.id, this.type, this.provider, this.description, this.date, this.amount, this.status, this.steps);
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
  MyRequest(this.id, this.kind, this.date, this.title, this.detail, this.status, this.submittedAt);
}

class LetterRequest {
  final String id;
  final String type;
  final String purpose;
  final String status;
  final DateTime requestedAt;
  LetterRequest(this.id, this.type, this.purpose, this.status, this.requestedAt);
}

class Announcement {
  final String id;
  final String title;
  final String body;
  final String category;
  final String author;
  final DateTime publishedAt;
  final bool pinned;
  Announcement(this.id, this.title, this.body, this.category, this.author, this.publishedAt, this.pinned);
}

class AssetItem {
  final String id;
  final String name;
  final String code;
  final String serial;
  final String category;
  final DateTime assignedAt;
  final String status;
  AssetItem(this.id, this.name, this.code, this.serial, this.category, this.assignedAt, this.status);
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
  SwapOffer(this.id, this.myDate, this.myShift, this.colleague, this.colleagueDate, this.colleagueShift, this.status);
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

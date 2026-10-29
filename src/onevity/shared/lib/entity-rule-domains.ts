// OneVity — Task 33: REGISTRI DOMAIN ATURAN PARAMETER (lintas modul).
// Konfigurasi deklaratif murni (client+server) — dipakai:
//   · shared/api/entity-rules.ts (CRUD + opsi + simulasi per domain)
//   · shared/components/entity-rules-dialog.tsx (UI generik)
// Domain "wage" memakai API & dialog khusus payroll (Task 32 — formula
// preview khusus); registri ini mencakup 4 domain baru.
export type RuleDomain = "leave" | "medical" | "travel" | "benefit";

export interface RuleActionDef {
  value: string;
  label: string;
  labelEn: string;
  hint: string;
  hintEn: string;
}

export interface EntityRuleDomainDef {
  key: RuleDomain;
  /** Nama objek yang diatur (tampil di judul dialog). */
  label: string;
  labelEn: string;
  /** Nama master entitas (cth. "Jenis Cuti"). */
  entityLabel: string;
  entityLabelEn: string;
  /** Field nilai di tabel rule: days | amount. */
  valueField: "days" | "amount";
  /** Label nilai utk input (cth. "Hari", "Rp"). */
  valueLabel: string;
  valueLabelEn: string;
  /** Label nilai dasar entitas utk header dialog. */
  baseLabel: string;
  baseLabelEn: string;
  /** Field entity: nilai dasar yang di-rule-kan. */
  entityBase: string;
  /** Menu-key guard aksi CRUD (create/update/delete). */
  menuKey: string;
  actions: RuleActionDef[];
}

const MONEY_ACTIONS: RuleActionDef[] = [
  { value: "SetLimit", label: "Tetapkan Limit", labelEn: "Set Limit", hint: "limit menjadi nilai ini", hintEn: "limit becomes this value" },
  { value: "AddLimit", label: "Tambah / Kurangi", labelEn: "Add / Subtract", hint: "nilai ditambahkan ke limit dasar (boleh negatif)", hintEn: "value added to base limit (may be negative)" },
  { value: "Multiply", label: "Kalikan", labelEn: "Multiply", hint: "limit dasar dikali faktor (cth. 1.5)", hintEn: "base limit times factor (e.g. 1.5)" },
];

export const ENTITY_RULE_DOMAINS: Record<RuleDomain, EntityRuleDomainDef> = {
  leave: {
    key: "leave",
    label: "Aturan Diferensiasi Entitlement Cuti",
    labelEn: "Leave Entitlement Differentiation Rules",
    entityLabel: "Jenis Cuti",
    entityLabelEn: "Leave Type",
    valueField: "days",
    valueLabel: "Hari",
    valueLabelEn: "Days",
    baseLabel: "Entitlement dasar",
    baseLabelEn: "Base entitlement",
    entityBase: "entitlement",
    menuKey: "leave:leave-type",
    actions: [
      { value: "SetDays", label: "Tetapkan Hari", labelEn: "Set Days", hint: "entitlement menjadi nilai ini", hintEn: "entitlement becomes this value" },
      { value: "AddDays", label: "Tambah / Kurangi", labelEn: "Add / Subtract", hint: "nilai ditambahkan ke entitlement dasar (boleh negatif)", hintEn: "value added to base entitlement (may be negative)" },
      { value: "Multiply", label: "Kalikan", labelEn: "Multiply", hint: "entitlement dasar dikali faktor", hintEn: "base entitlement times factor" },
    ],
  },
  medical: {
    key: "medical",
    label: "Aturan Diferensiasi Plafon Medis",
    labelEn: "Medical Limit Differentiation Rules",
    entityLabel: "Jenis Benefit Medis",
    entityLabelEn: "Medical Benefit Type",
    valueField: "amount",
    valueLabel: "Rp",
    valueLabelEn: "Rp",
    baseLabel: "Plafon dasar",
    baseLabelEn: "Base limit",
    entityBase: "limitValue",
    menuKey: "medical:medical-benefit-type",
    actions: MONEY_ACTIONS,
  },
  travel: {
    key: "travel",
    label: "Aturan Diferensiasi Limit Biaya Travel",
    labelEn: "Travel Expense Limit Differentiation Rules",
    entityLabel: "Jenis Biaya Travel",
    entityLabelEn: "Travel Expense Type",
    valueField: "amount",
    valueLabel: "Rp",
    valueLabelEn: "Rp",
    baseLabel: "Limit dasar",
    baseLabelEn: "Base limit",
    entityBase: "limitAmount",
    menuKey: "travel:travel-templates",
    actions: MONEY_ACTIONS,
  },
  benefit: {
    key: "benefit",
    label: "Aturan Diferensiasi Limit Klaim Benefit",
    labelEn: "Benefit Claim Limit Differentiation Rules",
    entityLabel: "Jenis Benefit",
    entityLabelEn: "Benefit Type",
    valueField: "amount",
    valueLabel: "Rp",
    valueLabelEn: "Rp",
    baseLabel: "Limit dasar",
    baseLabelEn: "Base limit",
    entityBase: "maxClaimAmount",
    menuKey: "payroll:benefits",
    actions: MONEY_ACTIONS,
  },
};

export function isRuleDomain(v: string): v is RuleDomain {
  return v === "leave" || v === "medical" || v === "travel" || v === "benefit";
}

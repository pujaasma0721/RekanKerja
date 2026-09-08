// OneVity — Task 32/33: aturan diferensiasi KOMPONEN UPAH (payroll).
// Core katalog parameter + matcher kini BERBAGAI di seluruh modul:
// src/onevity/shared/lib/parameter-rules.ts (leave/medical/travel/benefit
// memakainya juga). File ini re-export + label aksi spesifik payroll.
export {
  parseConditions, matchCondition, matchConditions, matchFirstRule,
  applyRuleValue, applyRuleAmount, describeCondition,
  validateConditions, RuleValidationError,
} from "@/onevity/shared/lib/parameter-rules";
export type {
  RuleCondition, RuleContext, RuleParamDef, EntityRuleLite, ComponentRuleLite,
} from "@/onevity/shared/lib/parameter-rules";
export { RULE_PARAMS, RULE_PARAM_BY_KEY, RULE_OP_LABEL } from "@/onevity/shared/lib/parameter-rules";

import type { EntityRuleLite } from "@/onevity/shared/lib/parameter-rules";

/** Aksi besaran komponen upah — value = amount (Rp). */
export const RULE_ACTION_LABEL: Record<string, { label: string; labelEn: string; hint: string; hintEn: string }> = {
  SetAmount: { label: "Tetapkan Besaran", labelEn: "Set Amount", hint: "besaran menjadi nilai ini", hintEn: "amount becomes this value" },
  AddAmount: { label: "Tambah / Kurangi", labelEn: "Add / Subtract", hint: "nilai ditambahkan ke besaran dasar (boleh negatif)", hintEn: "value added to base amount (may be negative)" },
  Multiply: { label: "Kalikan", labelEn: "Multiply", hint: "besaran dasar dikali faktor (cth. 1.5)", hintEn: "base amount times factor (e.g. 1.5)" },
};

/** Normalisasi rule wage → lite (field amount → value). */
export function toWageRuleLite(r: {
  id: string; name: string; priority: number; conditions: string;
  actionType: string; amount: number; active: boolean; createdAt: Date | string;
}): EntityRuleLite {
  return {
    id: r.id, name: r.name, priority: r.priority, conditions: r.conditions,
    actionType: r.actionType, value: r.amount, active: r.active, createdAt: r.createdAt,
  };
}

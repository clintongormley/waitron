import type { ModuleConfigurationTransfer } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { isRoleList, reasonShapeFault, type ReasonShapeField } from "./policy.js";
import { REASON_KINDS, type ReasonKind } from "./schema/reasons.js";
import "./errors.js";

const REASON_COLUMNS: Record<ReasonShapeField, string> = {
  actions: "actions",
  applyRoles: "apply_roles",
  approverRoles: "approver_roles",
  maxPercentBp: "max_percent",
  maxAmount: "max_amount",
};

function refuse(field: string): never {
  throw new AppError("setup.request_invalid", { field });
}

/** A list column as the export writes it: the JSON text the column stores. */
function textList(value: unknown, field: string): string[] {
  if (typeof value !== "string") refuse(field);
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    refuse(field);
  }
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) refuse(field);
  return parsed as string[];
}

/**
 * Refuses a reason of an unknown kind or one {@link reasonShapeFault} faults, settings whose bill
 * approvers {@link isRoleList} does not accept, and a bundle that leaves the venue no switched-on
 * Void reason asking for a note, as the operations keep one (A758 D27). A Void reason that passes
 * can cancel. The export writes booleans as 0 and 1.
 */
function validateAdjustmentsConfiguration(
  tables: Readonly<Record<string, readonly Record<string, unknown>[]>>,
): void {
  const reasons = tables.adjustment_reasons ?? [];
  for (const row of reasons) {
    if (!(REASON_KINDS as readonly unknown[]).includes(row.kind)) {
      refuse("adjustment_reasons.kind");
    }
    const fault = reasonShapeFault({
      kind: row.kind as ReasonKind,
      actions: textList(row.actions, "adjustment_reasons.actions"),
      applyRoles: textList(row.apply_roles, "adjustment_reasons.apply_roles"),
      approverRoles: textList(row.approver_roles, "adjustment_reasons.approver_roles"),
      maxPercentBp: (row.max_percent ?? null) as number | null,
      maxAmount: row.max_amount ?? null,
    });
    if (fault !== null) refuse(`adjustment_reasons.${REASON_COLUMNS[fault]}`);
  }
  if (!reasons.some((row) => row.kind === "void" && row.active === 1 && row.note_required === 1)) {
    refuse("adjustment_reasons");
  }
  for (const row of tables.adjustment_settings ?? []) {
    const field = "adjustment_settings.bill_approver_roles";
    if (!isRoleList(textList(row.bill_approver_roles, field))) refuse(field);
  }
}

export const ADJUSTMENTS_CONFIGURATION_TRANSFER = {
  kind: "tables",
  tables: [{ name: "adjustment_reasons" }, { name: "adjustment_settings" }],
  validate: validateAdjustmentsConfiguration,
} as const satisfies ModuleConfigurationTransfer;

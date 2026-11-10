import type { ModuleConfigurationTransfer } from "@waitron/module";
import { AppError, REASON_KINDS, type ReasonKind } from "@waitron/shared";
import { reasonShapeFault, type ReasonShapeField } from "./policy.js";
import { MAX_REASON_NAME_LENGTH } from "./reason-limits.js";
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

/** A JSON column as the export writes it: the JSON text the column stores. */
function parsedJson(value: unknown, field: string): unknown {
  if (typeof value !== "string") refuse(field);
  try {
    return JSON.parse(value);
  } catch {
    refuse(field);
  }
}

function textList(value: unknown, field: string): string[] {
  const parsed = parsedJson(value, field);
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) refuse(field);
  return parsed as string[];
}

function checkNames(value: unknown): void {
  const field = "adjustment_reasons.names";
  const parsed = parsedJson(value, field);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) refuse(field);
  const texts = Object.values(parsed);
  if (texts.some((text) => typeof text !== "string" || text.length > MAX_REASON_NAME_LENGTH)) {
    refuse(field);
  }
}

/** A copied list must retain a Void reason asking for a note, as operations do. */
function validateAdjustmentsConfiguration(
  tables: Readonly<Record<string, readonly Record<string, unknown>[]>>,
): void {
  const reasons = tables.adjustment_reasons ?? [];
  for (const row of reasons) {
    if (!(REASON_KINDS as readonly unknown[]).includes(row.kind)) {
      refuse("adjustment_reasons.kind");
    }
    if (typeof row.name !== "string" || row.name.length > MAX_REASON_NAME_LENGTH) {
      refuse("adjustment_reasons.name");
    }
    checkNames(row.names);
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
  if (!reasons.some((row) => row.kind === "void" && row.note_required === 1)) {
    refuse("adjustment_reasons");
  }
}

export const ADJUSTMENTS_CONFIGURATION_TRANSFER = {
  kind: "tables",
  tables: [{ name: "adjustment_reasons" }],
  validate: validateAdjustmentsConfiguration,
} as const satisfies ModuleConfigurationTransfer;

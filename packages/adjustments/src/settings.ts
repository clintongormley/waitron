import { defineSettingsDocument, readSettings, saveSettings, type Transaction } from "@waitron/db";
import type { PersonRoleValue } from "@waitron/identity";
import {
  centsToDecimal,
  compareDecimal,
  decimal,
  decimalToCents,
  type Decimal,
} from "@waitron/shared";
import { isRoleList } from "./policy.js";

export interface AdjustmentSettings {
  /** What comps may take off one bill before someone on `billApproverRoles` must approve; null is
   * no limit. */
  maxBillComp: Decimal | null;
  billApproverRoles: PersonRoleValue[];
}

export const DEFAULT_BILL_APPROVER_ROLES: readonly PersonRoleValue[] = ["manager", "admin"];
export interface AdjustmentsDocument {
  maxBillComp: number | null;
  billApproverRoles: PersonRoleValue[];
}
export const ADJUSTMENTS_SETTINGS = defineSettingsDocument<AdjustmentsDocument>({
  module: "adjustments",
  version: 1,
  transfers: true,
  defaults: () => ({ maxBillComp: null, billApproverRoles: [...DEFAULT_BILL_APPROVER_ROLES] }),
  parse(doc) {
    if (typeof doc !== "object" || doc === null || Array.isArray(doc))
      return { ok: false, field: "doc" };
    const value = doc as Record<string, unknown>;
    for (const key of Object.keys(value)) {
      if (key !== "maxBillComp" && key !== "billApproverRoles") return { ok: false, field: key };
    }
    if (
      value.maxBillComp !== null &&
      (typeof value.maxBillComp !== "number" ||
        !Number.isSafeInteger(value.maxBillComp) ||
        value.maxBillComp <= 0)
    )
      return { ok: false, field: "maxBillComp" };
    if (
      !Array.isArray(value.billApproverRoles) ||
      !value.billApproverRoles.every((role) => typeof role === "string") ||
      !isRoleList(value.billApproverRoles)
    )
      return { ok: false, field: "billApproverRoles" };
    return {
      ok: true,
      doc: {
        maxBillComp: value.maxBillComp as number | null,
        billApproverRoles: [...value.billApproverRoles],
      },
    };
  },
});
export type AdjustmentSettingsRead = AdjustmentSettings & { revision: number };

export async function readAdjustmentSettings(tx: Transaction): Promise<AdjustmentSettingsRead> {
  const { doc, revision } = await readSettings(tx, ADJUSTMENTS_SETTINGS);
  return {
    maxBillComp: doc.maxBillComp === null ? null : centsToDecimal(doc.maxBillComp),
    billApproverRoles: doc.billApproverRoles,
    revision,
  };
}

/** Replaces the venue's settings. An amount that is not a positive count of whole cents, or an
 * approver list that is empty, repeats a role or names none, is the caller's bug: the route screens
 * both first. */
export async function saveAdjustmentSettings(
  tx: Transaction,
  settings: AdjustmentSettings,
  change: { expectedRevision: number; personId: string | null },
): Promise<AdjustmentSettingsRead> {
  const { maxBillComp, billApproverRoles } = settings;
  if (
    maxBillComp !== null &&
    (compareDecimal(maxBillComp, decimal("0")) <= 0 ||
      compareDecimal(centsToDecimal(decimalToCents(maxBillComp)), maxBillComp) !== 0)
  ) {
    throw new RangeError("maxBillComp is not a positive amount in whole cents");
  }
  if (!isRoleList(billApproverRoles)) {
    throw new RangeError("billApproverRoles is not a non-empty list of distinct roles");
  }
  const { revision, doc } = await saveSettings(tx, ADJUSTMENTS_SETTINGS, {
    ...change,
    doc: {
      maxBillComp: maxBillComp === null ? null : decimalToCents(maxBillComp),
      billApproverRoles,
    },
  });
  return {
    maxBillComp: doc.maxBillComp === null ? null : centsToDecimal(doc.maxBillComp),
    billApproverRoles: doc.billApproverRoles,
    revision,
  };
}

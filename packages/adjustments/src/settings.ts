import { nowIso, type Transaction } from "@waitron/db";
import type { PersonRoleValue } from "@waitron/identity";
import {
  centsToDecimal,
  compareDecimal,
  decimal,
  decimalToCents,
  type Decimal,
} from "@waitron/shared";
import { isRoleList } from "./policy.js";
import { DEFAULT_BILL_APPROVER_ROLES, adjustmentSettings } from "./schema/settings.js";

export interface AdjustmentSettings {
  /** What comps may take off one bill before someone on `billApproverRoles` must approve; null is
   * no limit. */
  maxBillComp: Decimal | null;
  billApproverRoles: PersonRoleValue[];
}

/** The venue's settings; no row reads as no limit, approved past by managers and admins. */
export async function readAdjustmentSettings(tx: Transaction): Promise<AdjustmentSettings> {
  const [row] = await tx
    .select({
      maxBillComp: adjustmentSettings.maxBillComp,
      billApproverRoles: adjustmentSettings.billApproverRoles,
    })
    .from(adjustmentSettings);
  if (row === undefined) {
    return { maxBillComp: null, billApproverRoles: [...DEFAULT_BILL_APPROVER_ROLES] };
  }
  return {
    maxBillComp: row.maxBillComp === null ? null : centsToDecimal(row.maxBillComp),
    billApproverRoles: row.billApproverRoles,
  };
}

/** Replaces the venue's settings. An amount that is not a positive count of whole cents, or an
 * approver list that is empty, repeats a role or names none, is the caller's bug: the route screens
 * both first. */
export async function saveAdjustmentSettings(
  tx: Transaction,
  settings: AdjustmentSettings,
): Promise<AdjustmentSettings> {
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
  const values = {
    maxBillComp: maxBillComp === null ? null : decimalToCents(maxBillComp),
    billApproverRoles,
    updatedAt: nowIso(),
  };
  await tx
    .insert(adjustmentSettings)
    .values({ id: 1, ...values })
    .onConflictDoUpdate({ target: adjustmentSettings.id, set: values });
  return {
    maxBillComp: maxBillComp === null ? null : centsToDecimal(values.maxBillComp!),
    billApproverRoles,
  };
}

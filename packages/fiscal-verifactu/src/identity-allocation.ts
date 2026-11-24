import type { ActivationResult, FiscalAllocation, RecoveryApproval } from "./allocation-types.js";
import type { verifactuIdentities } from "./schema/verifactu-identities.js";

export interface IdentityAllocation {
  environment: string;
  eventKey: string;
  allocationKey: string;
  allocation: FiscalAllocation;
  approval: RecoveryApproval;
  bases: readonly { readonly code: string; readonly purpose: string }[];
  result: ActivationResult;
}

export function allocationOf(
  row: typeof verifactuIdentities.$inferSelect,
): IdentityAllocation | undefined {
  if (row.eventKey === null) return undefined;
  // The allocation CHECK holds all seven columns to the same nullability.
  return {
    environment: row.environment!,
    eventKey: row.eventKey,
    allocationKey: row.allocationKey!,
    allocation: row.allocation!,
    approval: row.approval!,
    bases: row.bases!,
    result: row.result!,
  };
}

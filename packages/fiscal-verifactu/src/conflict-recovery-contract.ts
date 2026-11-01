import type { FiscalAllocation, RecoveryApproval } from "./allocation-envelope.js";
import type { ActivationResult } from "./schema/allocations.js";

export interface ConflictAllocationInput {
  allocation: FiscalAllocation;
  approval: RecoveryApproval;
}

export function parseConflictActivation(value: unknown): ActivationResult | null {
  const exact = (item: unknown, keys: readonly string[]): item is Record<string, unknown> =>
    typeof item === "object" &&
    item !== null &&
    !Array.isArray(item) &&
    Reflect.ownKeys(item).length === keys.length &&
    keys.every((key) => Object.hasOwn(item, key));
  const text = (item: unknown): item is string =>
    typeof item === "string" && item.trim().length > 0 && item.length <= 256;
  if (
    !exact(value, ["activationEventId", "sifId", "series"]) ||
    !text(value.activationEventId) ||
    !text(value.sifId) ||
    !Array.isArray(value.series) ||
    !value.series.every(
      (entry: unknown) =>
        exact(entry, ["id", "code", "purpose"]) &&
        text(entry.id) &&
        text(entry.code) &&
        text(entry.purpose),
    )
  )
    return null;
  return structuredClone(value) as unknown as ActivationResult;
}

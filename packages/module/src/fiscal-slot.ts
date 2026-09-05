import { AppError } from "@waitron/shared";
import type { FiscalContribution } from "@waitron/fiscal";
import type { WaitronModule } from "./module.js";
import "./errors.js";

/**
 * The fiscal slot: exactly one of `modules` (the ENABLED set) declares a `fiscal` contribution.
 * `stamped` is the node's `filing_module` — non-null and different from the candidate's id means the
 * node was provisioned under another regime, whose records this one cannot take back; null (a bare
 * fixture node) skips the check.
 */
export function fiscalSlot(
  modules: readonly WaitronModule[],
  stamped: string | null,
): FiscalContribution {
  const candidates = modules.filter((m) => m.fiscal !== undefined);
  if (candidates.length === 0) throw new AppError("module.fiscal_slot_empty", {});
  if (candidates.length > 1) {
    throw new AppError("module.fiscal_slot_ambiguous", {
      candidates: candidates.map((m) => m.name),
    });
  }
  const slot = candidates[0]!.fiscal!;
  if (stamped !== null && stamped !== slot.id) {
    throw new AppError("module.fiscal_slot_mismatch", { stamped, enabled: slot.id });
  }
  return slot;
}

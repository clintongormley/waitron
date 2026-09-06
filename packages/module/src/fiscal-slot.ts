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
  // Collect the CONTRIBUTIONS, not the modules: pairing each with its owner's name here is what lets
  // the checks below read `only.fiscal` without a non-null assertion.
  const candidates = modules.flatMap((m) =>
    m.fiscal === undefined ? [] : [{ name: m.name, fiscal: m.fiscal }],
  );
  const [only] = candidates;
  if (only === undefined) throw new AppError("module.fiscal_slot_empty", {});
  if (candidates.length > 1) {
    throw new AppError("module.fiscal_slot_ambiguous", {
      candidates: candidates.map((c) => c.name),
    });
  }
  if (stamped !== null && stamped !== only.fiscal.id) {
    throw new AppError("module.fiscal_slot_mismatch", { stamped, enabled: only.fiscal.id });
  }
  return only.fiscal;
}

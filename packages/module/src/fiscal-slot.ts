import { AppError } from "@waitron/shared";
import type { FiscalContribution } from "@waitron/fiscal";
import type { ModuleConfig } from "./config.js";
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

/**
 * Build the ModuleConfig a venue provisions and boots under, forcing the fiscal slot onto exactly the
 * member whose contribution `id` equals `filingId` (the value `resolveFiscalModules(territory).filing`
 * returns). Starting from `base` (the operator's overrides, or empty), it sets EVERY fiscal-slot
 * member's override — the matching one `true`, every other `false` — so the territory is authoritative
 * for the slot and no default-on or operator toggle can leave two members enabled (`fiscal_slot_ambiguous`
 * at boot) or emit a second fiscal seed at provision. Non-fiscal overrides in `base` are carried through
 * untouched. Generic: it iterates `m.fiscal?.id` and names no module.
 *
 * A `filingId` no slot member declares leaves every fiscal member `false` (an empty slot) — the caller's
 * `fiscalSlot` then refuses it rather than provisioning under no regime.
 */
export function selectFiscalModule(
  modules: readonly WaitronModule[],
  filingId: string,
  base: ModuleConfig,
): ModuleConfig {
  const overrides = new Map(base.overrides);
  for (const m of modules) {
    if (m.fiscal !== undefined) overrides.set(m.name, m.fiscal.id === filingId);
  }
  return { overrides };
}

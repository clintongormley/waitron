import { AppError } from "@waitron/shared";
import type { FiscalContribution } from "@waitron/fiscal";
import type { ModuleConfig } from "./config.js";
import type { WaitronModule } from "./module.js";
import "./errors.js";

/**
 * Exactly one of the ENABLED `modules` declares a `fiscal` contribution. `stamped` is the node's
 * `filing_module`: a different id means the node was provisioned under another regime; null skips the
 * check.
 */
export function fiscalSlot(
  modules: readonly WaitronModule[],
  stamped: string | null,
): FiscalContribution {
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
 * `base` with EVERY fiscal-slot member's override set — `true` for the one whose id is `filingId`,
 * `false` for the rest — so the territory, not a default or an operator toggle, decides the slot. An
 * unknown `filingId` leaves the slot empty, which `fiscalSlot` refuses.
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

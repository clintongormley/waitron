import { AppError } from "@waitron/shared";
import "@waitron/fiscal"; // side-effect: registers fiscal.regime_not_implemented on ErrorParams

/**
 * A territory's fiscal module set: a filing module (Veri*Factu / TicketBAI / …) and a tax module
 * (IVA / IGIC / IPSI / …), independent because a territory can mix them (Canarias files under
 * Veri*Factu with IGIC; the Basque Country uses TicketBAI with IVA-foral — spec D3, FAQ §§21,23).
 * `filing` is written to `sales.fiscal_backend` and selects the FiscalBackend.
 */
export interface FiscalModules {
  filing: string;
  tax: string;
}

/**
 * Free-text territory → module set, data-driven (a registry, not a fixed enum) so a territory's
 * rules can change without a schema change (spec D3, Open Question 1: config-registry now, a
 * time-effective table later). Only `"ES-common"` is populated (spec D4); every other territory
 * resolves to no implemented set and is REFUSED — the input half of D4's defence-in-depth.
 *
 * This registry lives in @waitron/provisioning, not @waitron/fiscal, on purpose: the literals
 * "verifactu" and "iva" trip @waitron/fiscal's no-regime-vocabulary guard and the english-only
 * guard respectively (`iva` is in the fiscal module's own vocabulary, packages/fiscal-verifactu).
 * @waitron/provisioning is not a generic package (english-only.ts's GENERIC_PACKAGES), so the scan
 * never reaches it.
 */
const REGISTRY: Record<string, FiscalModules> = {
  // Frozen at definition: resolveFiscalModules returns the live entry and is public API (index.ts),
  // so freezing stops a future caller mutating this shared process-global config. No consumer
  // mutates it today, so this is guard-only — no behaviour change.
  "ES-common": Object.freeze({ filing: "verifactu", tax: "iva" }),
};

/** The territories the registry resolves — exported so a guard can enumerate the real set. */
export const FISCAL_TERRITORIES: readonly string[] = Object.keys(REGISTRY);

export function resolveFiscalModules(territory: string): FiscalModules {
  const modules = REGISTRY[territory];
  if (modules === undefined) {
    throw new AppError("fiscal.regime_not_implemented", { territory });
  }
  return modules;
}

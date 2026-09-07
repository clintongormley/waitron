import { AppError } from "@waitron/shared";
import "@waitron/fiscal"; // side-effect: registers fiscal.regime_not_implemented on ErrorParams

/**
 * A territory's fiscal module set: a filing module (Veri*Factu / TicketBAI / …) and a tax model
 * (VAT / GST / …), independent because a territory can mix them (the Canary Islands file under
 * Veri*Factu with the Canary indirect tax; the Basque Country uses TicketBAI with foral VAT — spec
 * D3, FAQ §§21,23). `filing` is written to `sales.fiscal_backend` and selects the FiscalBackend.
 * `tax` is the generic tax MODEL — the fiscal module supplies the rates and the localised display
 * label (e.g. «IVA» in Spain); nothing calculates tax from this value yet (see backlog).
 */
export interface FiscalModules {
  filing: string;
  tax: string;
}

/**
 * Free-text territory → module set, data-driven (a registry, not a fixed enum) so a territory's
 * rules can change without a schema change (spec D3, Open Question 1: config-registry now, a
 * time-effective table later). Two territories are populated: `"ES-common"` (Veri*Factu + VAT, spec
 * D4) and `"GB-vat"` (the no-regime filing module `none`, which records nothing). Every OTHER
 * territory resolves to no implemented set and is REFUSED — the input half of D4's defence-in-depth.
 * `resolveFiscalModules(...).filing` names a fiscal contribution `id` the composition root maps to a
 * descriptor (`ALL_MODULES.find((m) => m.fiscal?.id === filing)`); `scripts/module-seams.test.ts`
 * pins that every populated `filing` names an enabled slot member.
 *
 * The registry names its modules by string `id` (never by importing a regime package), so it stays
 * in @waitron/provisioning — where its consumers live and where `module-seams.test.ts` forbids
 * importing `@waitron/composition`. The english-only guard now scans provisioning production and
 * this passes honestly: `"verifactu"` is a proper noun (not in the forbidden set) and `"vat"`/`"none"`
 * are English; the no-regime-vocabulary guard scans only packages/fiscal, so the `"verifactu"`
 * literal here is out of its reach.
 */
const REGISTRY: Record<string, FiscalModules> = {
  // Frozen at definition: resolveFiscalModules returns the live entry and is public API (index.ts),
  // so freezing stops a future caller mutating this shared process-global config. No consumer
  // mutates it today, so this is guard-only — no behaviour change.
  "ES-common": Object.freeze({ filing: "verifactu", tax: "vat" }),
  // A no-regime territory: `filing: "none"` selects the `fiscal-none` slot member (records nothing).
  // `tax: "none"` is a placeholder — `nodes.tax_module` is stamped and COPIED during mirror adoption
  // (apps/server/src/adopt.ts, reserved-identity.ts) but is not used to CALCULATE tax anywhere today —
  // not a UK VAT decision. The string is country-prefixed (`venue-plan.ts` requires `fiscalTerritory`
  // start with `<country>-`), so a UK venue is `country: "GB"`, `fiscalTerritory: "GB-vat"`.
  "GB-vat": Object.freeze({ filing: "none", tax: "none" }),
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

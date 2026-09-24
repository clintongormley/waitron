import type { FiscalContribution } from "@waitron/fiscal";
import { selectFiscalModule, type ModuleConfig, type WaitronModule } from "@waitron/module";
import { resolveFiscalModules } from "./fiscal-modules.js";

/**
 * What a venue's TERRITORY selects for the fiscal slot, derived once so the setup-api provision
 * handler, the `venue` CLI and boot's `venueModuleConfig` cannot drift on which module it picks.
 */
export interface VenueFiscalSelection {
  /** The `ModuleConfig` a venue provisions and boots under: `base` with every fiscal-slot member's
   * override forced, so no default-on or operator toggle can leave two enabled. */
  config: ModuleConfig;
  /** The fiscal contribution the territory's `filing` id names, or `undefined` when no slot member in
   * `modules` declares it. */
  contribution: FiscalContribution | undefined;
}

/**
 * Throws `fiscal.regime_not_implemented` for an unimplemented territory, the same code `planVenue`
 * raises. `base` defaults to empty because the CLI and setup-api have no operator `modules.json` at
 * provision.
 */
export function venueFiscalSelection(
  modules: readonly WaitronModule[],
  territory: string,
  base: ModuleConfig = { overrides: new Map() },
): VenueFiscalSelection {
  const filing = resolveFiscalModules(territory).filing;
  return {
    config: selectFiscalModule(modules, filing, base),
    contribution: modules.find((m) => m.fiscal?.id === filing)?.fiscal,
  };
}

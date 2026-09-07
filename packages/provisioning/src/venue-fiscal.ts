import type { FiscalContribution } from "@waitron/fiscal";
import { selectFiscalModule, type ModuleConfig, type WaitronModule } from "@waitron/module";
import { resolveFiscalModules } from "./fiscal-modules.js";

/**
 * The single derivation of "what does a venue's TERRITORY select for the fiscal slot" — both halves
 * of it, from one `resolveFiscalModules(territory).filing`, so the three tenant-creation paths (the
 * setup-api provision handler, the `venue` CLI, and boot's `venueModuleConfig`) cannot drift on which
 * module the territory picks. It used to be re-derived at each, and a dev-setup bug came from exactly
 * that divergence.
 */
export interface VenueFiscalSelection {
  /** The `ModuleConfig` a venue provisions and boots under: `base` with EVERY fiscal-slot member's
   * override forced (the territory's `filing` module `true`, every other slot member `false`), so the
   * slot resolves to exactly one member (`fiscalSlot`) and no default-on or operator toggle can leave
   * two enabled. Non-fiscal overrides in `base` are carried through untouched. */
  config: ModuleConfig;
  /** The fiscal contribution the territory's `filing` id names, or `undefined` when no slot member in
   * `modules` declares it. The provision handler reaches its `provisioningSecret` seat through this. */
  contribution: FiscalContribution | undefined;
}

/**
 * Resolve the fiscal slot from a venue's `territory` (authoritative, design §4). `filing` is
 * `resolveFiscalModules(territory).filing`, resolved ONCE — so this throws
 * `fiscal.regime_not_implemented` for an unimplemented territory, before either half is built, the
 * same code `planVenue` raises. `base` defaults to an empty config (the CLI and setup-api have no
 * operator `modules.json` at provision); boot threads its operator base through.
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

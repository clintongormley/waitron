import { AppError } from "@waitron/shared";
import { FISCAL_TERRITORIES, findFiscalModules, type FiscalModules } from "@waitron/country-packs";
import "@waitron/fiscal"; // side-effect: registers fiscal.regime_not_implemented on ErrorParams

/**
 * Convert the browser-safe country registry's optional lookup into provisioning's domain error.
 * Persisted territory ids still select fiscal contributions; the country pack only owns the
 * territory-to-id mapping and never imports a fiscal implementation.
 */
export function resolveFiscalModules(territory: string): FiscalModules {
  const modules = findFiscalModules(territory);
  if (modules === undefined) {
    throw new AppError("fiscal.regime_not_implemented", { territory });
  }
  return modules;
}

export { FISCAL_TERRITORIES };
export type { FiscalModules };

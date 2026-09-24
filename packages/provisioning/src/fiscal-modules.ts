import { AppError } from "@waitron/shared";
import { FISCAL_TERRITORIES, findFiscalModules, type FiscalModules } from "@waitron/country-packs";
import "@waitron/fiscal"; // side-effect: registers fiscal.regime_not_implemented on ErrorParams

export function resolveFiscalModules(territory: string): FiscalModules {
  const modules = findFiscalModules(territory);
  if (modules === undefined) {
    throw new AppError("fiscal.regime_not_implemented", { territory });
  }
  return modules;
}

export { FISCAL_TERRITORIES };
export type { FiscalModules };

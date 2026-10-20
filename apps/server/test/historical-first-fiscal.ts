import type { WaitronModule } from "@waitron/module";
import { FISCAL_INITIAL_SETUP } from "@waitron/fiscal-verifactu/src/initial-setup.js";

// Retained signed documents use their original parser; operation dispatch stays on the supplied module.
export function historicalFirstFiscalDocuments(modules: readonly WaitronModule[]) {
  return modules.map((module) =>
    module.name === "fiscal-verifactu"
      ? {
          ...module,
          provisioning: { ...module.provisioning, initialSetup: FISCAL_INITIAL_SETUP },
        }
      : module,
  );
}

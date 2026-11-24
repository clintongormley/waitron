import type { WaitronModule } from "@waitron/module";
import type { HistoricalAllocationPaths } from "@waitron/fiscal-verifactu/src/allocation-configuration.js";
import {
  configureHistoricalInitialSetup,
  FISCAL_INITIAL_SETUP,
} from "@waitron/fiscal-verifactu/src/initial-setup.js";

// Retained signed documents use their original parser; operation dispatch stays on the supplied module.
export function historicalFirstFiscalDocuments(
  modules: readonly WaitronModule[],
  paths: HistoricalAllocationPaths = {},
) {
  return modules.map<WaitronModule>((module) =>
    module.name === "fiscal-verifactu"
      ? {
          ...module,
          provisioning: {
            ...module.provisioning,
            initialSetup: {
              ...FISCAL_INITIAL_SETUP,
              configure: (host) => configureHistoricalInitialSetup(host, paths),
            },
          },
        }
      : module,
  );
}

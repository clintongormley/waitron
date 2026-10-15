import { FISCAL_INITIAL_SETUP } from "./initial-setup.js";
import type { ModuleProvisioning } from "@waitron/module";
import { ALLOCATED_FISCAL_SEED } from "./allocated-lifecycle.js";
import { ALLOCATED_FISCAL_STANDBY } from "./allocated-standby.js";
import { FISCAL_THROWAWAY_ALLOCATION } from "./throwaway-allocation.js";

export { WAITRON_ID_SISTEMA } from "./software.js";

export const FISCAL_PROVISIONING: ModuleProvisioning = {
  seed: ALLOCATED_FISCAL_SEED,
  initialSetup: FISCAL_INITIAL_SETUP,
  standby: ALLOCATED_FISCAL_STANDBY,
  throwawayAllocation: FISCAL_THROWAWAY_ALLOCATION,
};

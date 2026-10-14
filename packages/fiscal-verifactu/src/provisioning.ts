import type { ModuleProvisioning } from "@waitron/module";
import { ALLOCATED_FISCAL_SEED } from "./allocated-lifecycle.js";
import { ALLOCATED_FISCAL_STANDBY } from "./allocated-standby.js";

export { WAITRON_ID_SISTEMA } from "./software.js";

export const FISCAL_PROVISIONING: ModuleProvisioning = {
  seed: ALLOCATED_FISCAL_SEED,
  standby: ALLOCATED_FISCAL_STANDBY,
};

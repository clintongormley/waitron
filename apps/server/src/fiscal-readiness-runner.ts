import { submitFiscalReadiness as submit } from "@waitron/provisioning";
import { systemClock } from "./till-backend.js";

export { fiscalReadinessDatabaseKey, fiscalReadinessInput } from "@waitron/provisioning";

export function submitFiscalReadiness(args: Omit<Parameters<typeof submit>[0], "clock">) {
  return submit({ ...args, clock: systemClock });
}

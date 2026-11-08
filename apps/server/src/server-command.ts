import { ALL_MODULES } from "@waitron/composition";
import { checkFiscalSettings, type CheckOutput } from "./producer-check.js";

/** Runs a command named on the server program's command line and answers its exit status. */
export function runServerCommand(command: string, out: CheckOutput): 0 | 1 {
  if (command === "check-producer") return checkFiscalSettings(ALL_MODULES, out);
  out.error(`unknown command: ${command}`);
  return 1;
}

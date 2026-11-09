import { ALL_MODULES } from "@waitron/composition";
import { checkFiscalSettings, type CheckOutput } from "./producer-check.js";

/**
 * Runs the command given on the server program's command line and answers its exit status. Nothing
 * typed is printed, because an argument can carry a secret.
 */
export function runServerCommand(args: readonly string[], out: CheckOutput): 0 | 1 | 2 {
  if (args.length === 1 && args[0] === "check-producer") {
    return checkFiscalSettings(ALL_MODULES, out);
  }
  out.error("usage: waitron-server [check-producer]");
  return 2;
}

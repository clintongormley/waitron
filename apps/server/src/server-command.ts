import { ALL_MODULES } from "@waitron/composition";
import { builtRelease } from "@waitron/shared";
import { declarationRoot, readDeclarationFolder } from "./declaration-pages.js";
import { checkFiscalSettings, type CheckOutput } from "./producer-check.js";
import { checkRelease } from "./release-command.js";

/**
 * Runs the command given on the server program's command line and answers its exit status. Nothing
 * typed is printed, because an argument can carry a secret.
 */
export async function runServerCommand(
  args: readonly string[],
  out: CheckOutput,
): Promise<0 | 1 | 2> {
  if (args.length === 1 && args[0] === "check-producer") {
    return checkFiscalSettings(ALL_MODULES, out);
  }
  if (args.length === 2 && args[0] === "check-release") {
    return checkRelease(
      args[1]!,
      builtRelease(),
      await readDeclarationFolder(declarationRoot()),
      out,
    );
  }
  out.error("usage: waitron-server [check-producer | check-release <version>]");
  return 2;
}

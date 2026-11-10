import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Node loads the main module by its real path, so argv[1] spelled through a symlink must be resolved too.
export function isMainScript(moduleUrl, argvPath = process.argv[1]) {
  if (!argvPath) return false;
  try {
    return realpathSync(argvPath) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

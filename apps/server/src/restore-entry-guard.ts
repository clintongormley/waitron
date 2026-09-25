import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { AppError } from "@waitron/shared";
import { resolveSafeEntryPath } from "./state-secrets.js";
import "./errors.js";

/**
 * Returns the absolute path an archive entry may be written to, or throws
 * `restore.unsafe_entry_path`. An authentic archive proves its bytes, never that its entry names
 * stay inside `destRoot`.
 *
 * `destRoot` must already exist, for `realpath`. A caller looping over many entries may pass
 * `realDestRoot` computed once.
 */
export async function assertSafeEntryName(
  name: string,
  destRoot: string,
  realDestRoot?: string,
): Promise<string> {
  const realRoot = realDestRoot ?? (await realpath(resolve(destRoot)));
  return resolveSafeEntryPath(name, destRoot, realRoot, () => {
    throw new AppError("restore.unsafe_entry_path", { name });
  });
}

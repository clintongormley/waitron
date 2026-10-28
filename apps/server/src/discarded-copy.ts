import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  createFirstSetupBackupWorkspace,
  isEmptiedTombstone,
  type FirstSetupRoots,
} from "@waitron/provisioning";

async function bytesUnder(path: string): Promise<number> {
  const stats = await lstat(path);
  if (!stats.isDirectory()) return stats.size;
  let total = 0;
  for (const name of await readdir(path)) total += await bytesUnder(join(path, name));
  return total;
}

/**
 * The bytes a backup recovery that Start again discarded still holds; null when the journal's last
 * record is not an abandon, or the copy has been emptied. `isEmptiedTombstone` refuses a copy holding
 * anything but files and folders, as the start's emptying does, so the walk meets no link.
 */
export async function discardedCopyBytes(roots: FirstSetupRoots): Promise<number | null> {
  const last = (await createFirstSetupBackupWorkspace(roots).readChain()).at(-1);
  if (last?.phase !== "abandoned") return null;
  const id = last.target.recoveryId;
  if (await isEmptiedTombstone(roots, id)) return null;
  return await bytesUnder(join(roots.stateDir, "first-setup-resolutions", "backup-recovery", id));
}

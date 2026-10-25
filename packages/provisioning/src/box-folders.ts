import { lstat } from "node:fs/promises";
import { join } from "node:path";
import type { FirstSetupRoots } from "./first-setup-resolution-inspection.js";
import { canonicalFirstSetupDirectory } from "./first-setup-resolution.js";
import { firstSetupAnchorFor, insideFirstSetupWorkspace } from "./first-setup-workspace.js";
import {
  insideBackupRepairTarget,
  resolveFirstSetupBackupWorkspace,
} from "./first-setup-backup-workspace.js";
import { AppError } from "@waitron/shared";
import "./errors.js";

export async function boxFolders(roots: FirstSetupRoots): Promise<FirstSetupRoots> {
  const repair = await resolveFirstSetupBackupWorkspace(roots);
  if (repair.kind !== "absent") return repair.target.anchor;
  const venueDir = await canonicalFirstSetupDirectory(roots.venueDir);
  // Only a workspace carries this file, so an anchor whose workspace is selected stays its own
  // folders; anything but a clean "missing" goes to firstSetupAnchorFor, which refuses it.
  const workspace = await lstat(join(venueDir, "first-setup-workspace.json")).then(
    () => true,
    (error: NodeJS.ErrnoException) => error.code !== "ENOENT",
  );
  if (workspace) return firstSetupAnchorFor(roots);
  const folders = { stateDir: await canonicalFirstSetupDirectory(roots.stateDir), venueDir };
  if (
    Object.values(folders).some(
      (dir) => insideFirstSetupWorkspace(dir) || insideBackupRepairTarget(dir),
    )
  )
    throw new AppError("setup.attempt_uncertain", {});
  return folders;
}

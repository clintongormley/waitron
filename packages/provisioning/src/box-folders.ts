import type { FirstSetupRoots } from "./first-setup-resolution-inspection.js";
import { canonicalFirstSetupDirectory } from "./first-setup-resolution.js";
import { insideFirstSetupWorkspace } from "./first-setup-workspace.js";
import {
  insideBackupRepairTarget,
  resolveFirstSetupBackupWorkspace,
} from "./first-setup-backup-workspace.js";
import { AppError } from "@waitron/shared";
import "./errors.js";

export async function boxFolders(roots: FirstSetupRoots): Promise<FirstSetupRoots> {
  const repair = await resolveFirstSetupBackupWorkspace(roots);
  if (repair.kind !== "absent") return repair.target.anchor;
  const folders = {
    stateDir: await canonicalFirstSetupDirectory(roots.stateDir),
    venueDir: await canonicalFirstSetupDirectory(roots.venueDir),
  };
  if (
    Object.values(folders).some(
      (dir) => insideFirstSetupWorkspace(dir) || insideBackupRepairTarget(dir),
    )
  )
    throw new AppError("setup.attempt_uncertain", {});
  return folders;
}

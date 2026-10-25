import { AppError } from "@waitron/shared";
import { lstat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { canonicalFirstSetupDirectory } from "./first-setup-resolution.js";
import "./errors.js";

// What an earlier Waitron's Start again left behind; nothing reads them now (A1042, D4).
const LEGACY_NAMES = [
  "first-setup-selection.json",
  "first-setup-retirement.json",
  "first-setup-workspace.json",
  "first-setup-workspaces",
] as const;

export function insideFirstSetupWorkspace(dir: string): boolean {
  return basename(dirname(dirname(dir))) === "first-setup-workspaces";
}

export async function assertNoLegacyFirstSetupWorkspace(roots: {
  stateDir: string;
  venueDir: string;
}): Promise<void> {
  let legacy: boolean;
  try {
    const venueDir = await canonicalFirstSetupDirectory(roots.venueDir);
    const stateDir = await canonicalFirstSetupDirectory(roots.stateDir);
    legacy = insideFirstSetupWorkspace(venueDir);
    for (const dir of new Set([venueDir, stateDir]))
      for (const name of LEGACY_NAMES)
        legacy ||= await lstat(join(dir, name)).then(
          () => true,
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return false;
            throw error;
          },
        );
  } catch {
    throw new AppError("setup.attempt_uncertain", {});
  }
  if (legacy) throw new AppError("setup.workspace_unsupported", {});
}

import type { WaitronModule } from "@waitron/module";
import type { ArchiveEntry } from "./backup-archive.js";
import type { BackupManifest } from "./backup-manifest.js";
import { OPTIONAL_BACKUP_STATE, collectOptionalStateFiles } from "./backup-optional-state.js";
import { collectModuleNonDbState } from "./backup-sources.js";
import { collectStateSecrets } from "./state-secrets.js";

/** Everything a backup archive carries besides its manifest and the database copy, read off disk. */
export interface StateParts {
  readonly nonDbState: ArchiveEntry[];
  readonly secrets: Record<string, string>;
  readonly optionalState: Record<string, string>;
}

/** Throws `recovery.state_incomplete` when a `RECOVERY_FILES` path is missing; a missing optional
 * file is skipped. */
export async function collectStateParts(deps: {
  readonly stateDir: string;
  readonly modules: readonly WaitronModule[];
  readonly resolvers: Record<string, string>;
}): Promise<StateParts> {
  const [secrets, nonDbState, optionalState] = await Promise.all([
    collectStateSecrets(deps.stateDir),
    collectModuleNonDbState(deps.modules, deps.resolvers),
    collectOptionalStateFiles(deps.stateDir, OPTIONAL_BACKUP_STATE),
  ]);
  return { nonDbState, secrets, optionalState };
}

/**
 * The archive's entries in their one order, shared by the archive and the sealed state row
 * (`dump` null). Optional state goes under `secrets/` too, because the restore writes every
 * `secrets/` entry back under the state folder.
 */
export function assembleArchiveEntries(
  manifest: BackupManifest,
  dump: Uint8Array | null,
  parts: StateParts,
): ArchiveEntry[] {
  return [
    { name: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest)) },
    ...(dump === null ? [] : [{ name: "db.dump", bytes: dump }]),
    ...parts.nonDbState,
    ...Object.entries(parts.secrets).map(([path, contents]) => ({
      name: `secrets/${path}`,
      bytes: Buffer.from(contents),
    })),
    ...Object.entries(parts.optionalState).map(([name, contents]) => ({
      name: `secrets/${name}`,
      bytes: Buffer.from(contents),
    })),
  ];
}

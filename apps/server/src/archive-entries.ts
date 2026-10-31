import type { ArchiveReadBudget } from "./archive-read-budget.js";
import type { WaitronModule } from "@waitron/module";
import type { ArchiveEntry } from "./backup-archive.js";
import type { BackupManifest } from "./backup-manifest.js";
import { OPTIONAL_BACKUP_STATE, collectOptionalStateFiles } from "./backup-optional-state.js";
import { collectModuleNonDbState } from "./backup-sources.js";
import { collectStateSecrets } from "./state-secrets.js";
import { readModulePreparationHistory, readDurableHostJson } from "@waitron/provisioning";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

/** Everything a backup archive carries besides its manifest and the database copy, read off disk. */
export interface StateParts {
  readonly nodeDump: Uint8Array;
  readonly nonDbState: ArchiveEntry[];
  readonly secrets: Record<string, string>;
  readonly optionalState: Record<string, string>;
}

/** Throws `recovery.state_incomplete` when a `RECOVERY_FILES` path is missing; a missing optional
 * file is skipped. */
export async function collectStateParts(
  deps: {
    readonly stateDir: string;
    readonly venueDir?: string;
    readonly modules: readonly WaitronModule[];
    readonly resolvers: Record<string, string>;
    readonly snapshotNode: () => Promise<Uint8Array>;
  },
  budget?: ArchiveReadBudget,
): Promise<StateParts> {
  // Every part settles before any failure is thrown, so a caller's clean-up of the node copy's
  // folder never runs while the copy is still writing into it.
  const [node, secrets, nonDbState, optionalState] = await Promise.allSettled([
    deps.snapshotNode(),
    collectStateSecrets(deps.stateDir, budget),
    collectModuleNonDbState(deps.modules, deps.resolvers, budget, {
      read: (module) =>
        readModulePreparationHistory(
          { stateDir: deps.stateDir, venueDir: deps.venueDir ?? deps.stateDir },
          module,
        ),
      readRetained: async (name) => {
        const value = await readDurableHostJson(join(deps.stateDir, name), 1024 * 1024);
        return value === null ? [] : [value];
      },
    }),
    collectOptionalStateFiles(deps.stateDir, OPTIONAL_BACKUP_STATE, budget),
  ]);
  const parts: StateParts = {
    nodeDump: valueOf(node),
    secrets: valueOf(secrets),
    nonDbState: valueOf(nonDbState),
    optionalState: valueOf(optionalState),
  };
  budget?.addEntry("node.dump", parts.nodeDump.length);
  return parts;
}

function valueOf<T>(part: PromiseSettledResult<T>): T {
  if (part.status === "rejected") throw part.reason;
  return part.value;
}

/** A whole copy of node.db, taken through a scratch folder under `parent` that is removed after. */
export function snapshotNodeDatabase(
  node: { archiveTo(path: string): Promise<void> },
  parent: string,
): () => Promise<Uint8Array> {
  return async () => {
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const scratch = await mkdtemp(join(parent, "waitron-node-copy-"));
    try {
      const path = join(scratch, "node.db");
      await node.archiveTo(path);
      return await readFile(path);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  };
}

/**
 * The archive's entries in their one order; a null `dump` leaves out `db.dump`. Optional state goes
 * under `secrets/` too, because the restore writes every `secrets/` entry back under the state folder.
 */
export function assembleArchiveEntries(
  manifest: BackupManifest,
  dump: Uint8Array | null,
  parts: StateParts,
): ArchiveEntry[] {
  return [
    { name: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest)) },
    ...(dump === null ? [] : [{ name: "db.dump", bytes: dump }]),
    // Not copied with db.dump: a change spanning both files between the two copies is in only one.
    { name: "node.dump", bytes: parts.nodeDump },
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

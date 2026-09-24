import { eq } from "drizzle-orm";
import { nodeSealedState, withTransaction, type Database, type Transaction } from "@waitron/db";
import type { WaitronModule } from "@waitron/module";
import { codeOf } from "@waitron/server-kit";
import { assembleArchiveEntries, collectStateParts } from "./archive-entries.js";
import { decryptArtifact, encryptArtifactAsync } from "./artifact-cipher.js";
import { packArchive, unpackArchive, type ArchiveEntry } from "./backup-archive.js";
import { buildManifest, type BackupManifest } from "./backup-manifest.js";
import type { DeploymentEnvironment } from "./config.js";
import type { Logger } from "./logger.js";

/** The archive's entries without the database copy, in the archive's order. */
export async function collectSealedEntries(deps: {
  readonly stateDir: string;
  readonly modules: readonly WaitronModule[];
  readonly resolvers: Record<string, string>;
  readonly manifest: BackupManifest;
}): Promise<ArchiveEntry[]> {
  return assembleArchiveEntries(deps.manifest, null, await collectStateParts(deps));
}

/** Packed and locked exactly as an archive is, so one key and one reader open both. */
export async function sealNodeState(
  entries: ArchiveEntry[],
  recoveryKey: string,
): Promise<Uint8Array> {
  return encryptArtifactAsync(packArchive(entries), recoveryKey);
}

/** Throws `recovery.passphrase_invalid` for a wrong key or altered bytes, and
 * `backup.artifact_invalid` for bytes that are not a sealed frame. */
export function unsealNodeState(sealed: Uint8Array, recoveryKey: string): ArchiveEntry[] {
  return unpackArchive(decryptArtifact(sealed, recoveryKey));
}

export async function writeSealedStateRow(
  tx: Transaction,
  nodeId: string,
  sealed: Uint8Array,
  at: Date,
): Promise<void> {
  await tx
    .insert(nodeSealedState)
    .values({ nodeId, sealed, updatedAt: at })
    .onConflictDoUpdate({ target: nodeSealedState.nodeId, set: { sealed, updatedAt: at } });
}

export async function readSealedStateRow(
  tx: Transaction,
  nodeId: string,
): Promise<Uint8Array | null> {
  const rows = await tx
    .select({ sealed: nodeSealedState.sealed })
    .from(nodeSealedState)
    .where(eq(nodeSealedState.nodeId, nodeId));
  return rows[0]?.sealed ?? null;
}

/** A system error's code (`EACCES`, `ENOSPC`) is a fixed symbol; its message carries the path. */
function failureFields(err: unknown): Record<string, string> {
  const errno = (err as { code?: unknown } | null)?.code;
  return typeof errno === "string" && /^E[A-Z0-9]+$/.test(errno)
    ? { errorCode: codeOf(err), errno }
    : { errorCode: codeOf(err) };
}

export type SealedStateOutcome = "sealed" | "no_key" | "failed";

export interface SealedStateDeps {
  readonly db: Database;
  readonly nodeId: string;
  readonly stateDir: string;
  readonly modules: readonly WaitronModule[];
  readonly resolvers: Record<string, string>;
  readonly environment: DeploymentEnvironment;
  /** Read afresh on every refresh, so a rotated key locks the next row. */
  readonly readRecoveryKey: () => Promise<string | undefined>;
  readonly now: () => Date;
  readonly log: Logger;
}

export interface SealedStateRefresher {
  refresh(): Promise<SealedStateOutcome>;
}

/**
 * Re-reads the state files and the key and rewrites this node's row.
 *
 * Refreshes run one at a time, in call order: run side by side, a refresh holding an older key
 * could land after a newer one, leaving a row only a superseded key opens.
 *
 * Never rejects. A refresh that throws before its write commits answers "failed" and leaves the
 * previous row as it was. The outcome is settled before anything is logged, so a logger that
 * throws changes neither the outcome nor the row.
 */
export function createSealedStateRefresher(deps: SealedStateDeps): SealedStateRefresher {
  type Attempt = readonly [SealedStateOutcome, Parameters<Logger>];
  const attempt = async (): Promise<Attempt> => {
    try {
      const recoveryKey = await deps.readRecoveryKey();
      if (recoveryKey === undefined) {
        return ["no_key", ["info", "backup.sealed_state_skipped", { reason: "no_recovery_key" }]];
      }
      const now = deps.now();
      const manifest = await buildManifest({
        db: deps.db,
        modules: deps.modules,
        environment: deps.environment,
        now,
      });
      const entries = await collectSealedEntries({
        stateDir: deps.stateDir,
        modules: deps.modules,
        resolvers: deps.resolvers,
        manifest,
      });
      // Sealed before the transaction opens, so the write lock is not held across the derivation.
      const sealed = await sealNodeState(entries, recoveryKey);
      await withTransaction(deps.db, (tx) => writeSealedStateRow(tx, deps.nodeId, sealed, now));
      return ["sealed", ["info", "backup.sealed_state_refreshed", { entries: entries.length }]];
    } catch (err) {
      return ["failed", ["warn", "backup.sealed_state_failed", failureFields(err)]];
    }
  };
  const once = async (): Promise<SealedStateOutcome> => {
    const [outcome, line] = await attempt();
    try {
      deps.log(...line);
    } catch {
      // Logging is best effort; the outcome already stands.
    }
    return outcome;
  };
  let tail: Promise<SealedStateOutcome> = Promise.resolve("sealed");
  return {
    refresh: () => {
      // Reached only when building a failure's log fields throws, as reading an unreadable `code`
      // does; without it one rejection would reject every later refresh in the chain unrun.
      tail = tail.then(once).catch((): SealedStateOutcome => "failed");
      return tail;
    },
  };
}

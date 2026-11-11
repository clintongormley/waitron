import type { JobDefinition } from "./job-runner.js";
import { join } from "node:path";
import { SCRATCH_DIR } from "@waitron/store";
import { eq } from "drizzle-orm";
import {
  nodeSealedState,
  withTransaction,
  type Database,
  type NodeDatabase,
  type Transaction,
} from "@waitron/db";
import type { WaitronModule } from "@waitron/module";
import { codeOf } from "@waitron/server-kit";
import {
  assembleArchiveEntries,
  collectStateParts,
  snapshotNodeDatabase,
} from "./archive-entries.js";
import { decryptArtifact, encryptArtifactAsync } from "./artifact-cipher.js";
import { packArchive, unpackArchive, type ArchiveEntry } from "./backup-archive.js";
import { buildManifest, type BackupManifest } from "./backup-manifest.js";
import { startFailureCode } from "./boot-failure.js";
import type { DeploymentEnvironment } from "./config.js";
import { errnoOf } from "./errno.js";
import type { Logger } from "./logger.js";

/** The archive's entries without the database copy, in the archive's order. */
export async function collectSealedEntries(deps: {
  readonly stateDir: string;
  readonly venueDir?: string;
  readonly modules: readonly WaitronModule[];
  readonly resolvers: Record<string, string>;
  readonly snapshotNode: () => Promise<Uint8Array>;
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

function failureFields(err: unknown): Record<string, string> {
  const errno = errnoOf(err);
  return errno === undefined ? { errorCode: codeOf(err) } : { errorCode: codeOf(err), errno };
}

export type SealedStateOutcome = "sealed" | "no_key" | "failed";

/**
 * Since when this node's refreshes have failed, read by `sealedStateAlertSource`: the first
 * failure's time, kept across repeats; null again after a refresh that seals, or that finds no
 * recovery key, when no row is expected at all. `errorCode` is the latest failure's cause as
 * `startFailureCode` names it, null whenever `failedSince` is.
 */
export interface SealedStateStatus {
  failedSince: string | null;
  errorCode: string | null;
}

export interface SealedStateDeps {
  readonly db: Database;
  readonly node: NodeDatabase;
  readonly nodeId: string;
  readonly stateDir: string;
  readonly venueDir?: string;
  readonly modules: readonly WaitronModule[];
  readonly resolvers: Record<string, string>;
  readonly environment: DeploymentEnvironment;
  /** Read afresh on every refresh, so a rotated key locks the next row. */
  readonly readRecoveryKey: () => Promise<string | undefined>;
  readonly now: () => Date;
  readonly log: Logger;
  readonly status: SealedStateStatus;
}

export interface SealedStateRefresher {
  refresh(): Promise<SealedStateOutcome>;
  /** Settles once no refresh is running or waiting; never rejects. */
  settled(): Promise<void>;
}

/**
 * Re-reads the state files and the key and rewrites this node's row.
 *
 * Refreshes run one at a time, in call order: run side by side, a refresh holding an older key
 * could land after a newer one, leaving a row only a superseded key opens. A request made while one
 * runs waits for it, and every further request joins that waiting one: it has not read anything
 * yet, so it seals whatever all of them asked it to.
 *
 * Never rejects. A refresh that throws before its write commits answers "failed" and leaves the
 * previous row as it was. The outcome is settled before anything is logged, so a logger that
 * throws changes neither the outcome nor the row.
 */
export function createSealedStateRefresher(deps: SealedStateDeps): SealedStateRefresher {
  type Attempt = readonly [SealedStateOutcome, Parameters<Logger>, string | null];
  type Result = readonly [SealedStateOutcome, string | null];
  const causeOf = async (err: unknown): Promise<string> => {
    try {
      return await startFailureCode(err, [deps.stateDir, deps.venueDir ?? deps.stateDir]);
    } catch {
      return "unknown";
    }
  };
  const attempt = async (): Promise<Attempt> => {
    try {
      const recoveryKey = await deps.readRecoveryKey();
      if (recoveryKey === undefined) {
        return [
          "no_key",
          ["info", "backup.sealed_state_skipped", { reason: "no_recovery_key" }],
          null,
        ];
      }
      const now = deps.now();
      const manifest = await buildManifest({
        db: deps.db,
        node: deps.node,
        modules: deps.modules,
        environment: deps.environment,
        now,
      });
      const entries = await collectSealedEntries({
        stateDir: deps.stateDir,
        venueDir: deps.venueDir,
        modules: deps.modules,
        resolvers: deps.resolvers,
        snapshotNode: snapshotNodeDatabase(deps.node, join(deps.stateDir, SCRATCH_DIR)),
        manifest,
      });
      // Sealed before the transaction opens, so the write lock is not held across the derivation.
      const sealed = await sealNodeState(entries, recoveryKey);
      await withTransaction(deps.db, (tx) => writeSealedStateRow(tx, deps.nodeId, sealed, now));
      return [
        "sealed",
        ["info", "backup.sealed_state_refreshed", { entries: entries.length }],
        null,
      ];
    } catch (err) {
      const cause = await causeOf(err);
      return ["failed", ["warn", "backup.sealed_state_failed", failureFields(err)], cause];
    }
  };
  const once = async (): Promise<Result> => {
    const [outcome, line, cause] = await attempt();
    try {
      deps.log(...line);
    } catch {
      // Logging is best effort; the outcome already stands.
    }
    return [outcome, cause];
  };
  const record = ([outcome, cause]: Result): SealedStateOutcome => {
    if (outcome !== "failed") deps.status.failedSince = null;
    else deps.status.failedSince ??= deps.now().toISOString();
    deps.status.errorCode = cause;
    return outcome;
  };
  let running: Promise<SealedStateOutcome> | undefined;
  let waiting: Promise<SealedStateOutcome> | undefined;
  const start = (): Promise<SealedStateOutcome> => {
    // Reached only when building a failure's log fields throws, as reading an unreadable `code`
    // does; without it the refresh would reject.
    const run = Promise.resolve()
      .then(once)
      .catch((): Result => ["failed", "unknown"])
      .then(record);
    running = run;
    const clear = () => {
      if (running === run) running = undefined;
    };
    run.then(clear, clear);
    return run;
  };
  return {
    refresh: () => {
      if (waiting !== undefined) return waiting;
      if (running === undefined) return start();
      const next = () => {
        waiting = undefined;
        return start();
      };
      waiting = running.then(next, next);
      return waiting;
    },
    settled: async () => {
      for (let pending = waiting ?? running; pending !== undefined; pending = waiting ?? running)
        await pending.catch(() => {});
    },
  };
}

export function sealedStateJob(
  refresher: SealedStateRefresher,
  unsubscribe: () => void,
): JobDefinition {
  return {
    name: "backups.sealed_state",
    applies: () => true,
    pass: async () => ({ nextDueAt: null, degraded: (await refresher.refresh()) === "failed" }),
    minSleepMs: 1_000,
    maxSleepMs: 24 * 60 * 60 * 1_000,
    firstPassAfterMs: 24 * 60 * 60 * 1_000,
    backoff: { firstMs: 60_000, maxMs: 3_600_000 },
    ownFailureAlert: "backup.sealed_state_failed",
    onStop: async () => {
      unsubscribe();
      await refresher.refresh();
      await refresher.settled();
    },
  };
}

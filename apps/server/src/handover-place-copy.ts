import { existsSync } from "node:fs";
import { chmod, copyFile, open, rename, rm, rmdir, type FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { lockVenueDatabase, withNodeTransaction, type NodeDatabase } from "@waitron/db";
import { parseIndicator, type RetainedRevision } from "@waitron/handover";
import type { SignedMembershipDocument } from "@waitron/membership";
import { mergeModulePreparationRevisions } from "@waitron/provisioning";
import { appendHandoverEventTx, readHandoverEvent } from "@waitron/node-db";
import { AppError, isAppError, sqliteFailureOf } from "@waitron/shared";
import { NODE_FILE, SIDE_FILE_SUFFIXES, VENUE_FILE } from "@waitron/store";
import { litestreamMetaDir } from "@waitron/stream/litestream.js";
import { deleteBackupRoomNote } from "./backup-room-note.js";
import { errnoOf } from "./errno.js";
import { acceptedCopyPath } from "./handover-acceptance.js";
import { digestFileIfPresent } from "./handover-capture.js";
import { oldBoxStillMain } from "./handover-chart.js";
import { destinationOperationFolders, HANDOVER_EVENT, waitHandoverTx } from "./handover-store.js";
import type { Logger } from "./logger.js";
import { isReadableChart } from "./membership-trust.js";
import { INCOMING_SUFFIX, VENUE_FILE_MODE } from "./restore.js";
import { reachDisk } from "./sync-path.js";
import "./errors.js";

export type PlacementAtStart =
  | { readonly kind: "nothing" }
  /** An operation awaits placing on a box that is not a mirror, whose database is never replaced. */
  | { readonly kind: "left_alone"; readonly operationId: string }
  /** The old database holds a chart with another main box, and placing would delete that chart. */
  | { readonly kind: "source_no_longer_main"; readonly operationId: string }
  /**
   * The accepted copy is in place and `copy_placed` is not recorded. `swapped` says whether this
   * call replaced the file or found it already there.
   */
  | { readonly kind: "copy_placed_owed"; readonly operationId: string; readonly swapped: boolean };

const NOTHING: PlacementAtStart = { kind: "nothing" };

/** The file steps of placing, which tests replace to fail or kill one. */
export interface PlacementSteps {
  readonly copyFile: (from: string, to: string) => Promise<void>;
  readonly chmod: (path: string, mode: number) => Promise<void>;
  readonly rm: (path: string, options: { recursive?: boolean; force: boolean }) => Promise<void>;
  readonly rename: (from: string, to: string) => Promise<void>;
  readonly reachDisk: (path: string) => Promise<void>;
}

interface AwaitingPlacement {
  readonly operationId: string;
  readonly sourceNodeId: string;
  readonly mode: string | null;
  readonly indicatorText: string;
}

/**
 * Runs before anything opens the store, so it reads `node.db` alone and read-only: a read-only open
 * leaves a crashed box's `-wal` as it found it for the store to recover.
 */
function readAwaitingPlacement(nodePath: string, nodeId: string): AwaitingPlacement | null {
  const node = new DatabaseSync(nodePath, { readOnly: true });
  try {
    const hasTable = node
      .prepare("select 1 from sqlite_master where name = 'node_handover_operations'")
      .get();
    if (hasTable === undefined) return null;
    const operation = node
      .prepare(
        "select operation_id, source_node_id from node_handover_operations where node_id = ? and role = 'destination' and state = 'filing_assumed'",
      )
      .get(nodeId) as { operation_id: string; source_node_id: string } | undefined;
    if (operation === undefined) return null;
    const operationId = operation.operation_id;
    const event = node.prepare(
      "select envelope from node_handover_events where node_id = ? and operation_id = ? and kind = ? order by rowid limit 1",
    );
    if (event.get(nodeId, operationId, HANDOVER_EVENT.copyPlaced) !== undefined) return null;
    const indicator = event.get(nodeId, operationId, HANDOVER_EVENT.finalState) as
      { envelope: string | null } | undefined;
    // A fault in Waitron: `acceptFinalCopy` stores the indicator in the transaction that accepts.
    if (indicator?.envelope == null) {
      throw new Error(`the operation ${operationId} has no stored indicator`);
    }
    const mode = node.prepare("select mode from node_mode where node_id = ?").get(nodeId) as
      { mode: string } | undefined;
    return {
      operationId,
      sourceNodeId: operation.source_node_id,
      mode: mode?.mode ?? null,
      indicatorText: indicator.envelope,
    };
  } finally {
    node.close();
  }
}

/**
 * The chart's stored text, or `null` when the file holds none. Read-only like `node.db` above, for
 * the same reason: it may hold the only record of the chart, in a `-wal` the store recovers.
 */
function chartTextIn(databasePath: string): string | null {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const hasTable = database
      .prepare("select 1 from sqlite_master where name = 'node_membership'")
      .get();
    if (hasTable === undefined) return null;
    const row = database.prepare("select document from node_membership where id = 1").get() as
      { document: string } | undefined;
    return row?.document ?? null;
  } finally {
    database.close();
  }
}

/**
 * Whether the old database holds a chart this box must not delete by placing. A file or chart this
 * cannot read is no reason to stay: it would keep a box on a damaged database with the old box
 * stopped, and the placed copy's own chart still has to pass before anything activates. The copy's
 * own chart is not news either: it is what a crash leaves here once an open has changed the placed
 * file's bytes.
 */
function holdsMovedOnChart(
  livePath: string,
  acceptedPath: string,
  awaiting: AwaitingPlacement,
  log: Logger,
): boolean {
  const { operationId, sourceNodeId } = awaiting;
  try {
    const text = chartTextIn(livePath);
    if (text === null) return false;
    const document: unknown = JSON.parse(text);
    if (document === null) return false;
    if (!isReadableChart(document)) throw new Error("not a readable chart");
    if (oldBoxStillMain(document as SignedMembershipDocument, sourceNodeId)) return false;
    return !acceptedCopyHolds(acceptedPath, text);
  } catch (error) {
    log("warn", "handover-place-copy.old_chart_unreadable", {
      operationId,
      error: String(error),
    });
    return false;
  }
}

/** Whether the accepted copy holds this very chart. One that cannot be read holds none. */
function acceptedCopyHolds(acceptedPath: string, chartText: string): boolean {
  try {
    return chartTextIn(acceptedPath) === chartText;
  } catch {
    return false;
  }
}

/** Opened and read, not only looked up: what cannot be read stops the start, as a digest would. */
async function sizeIfPresent(path: string): Promise<number | null> {
  let handle: FileHandle;
  try {
    handle = await open(path, "r");
  } catch (error) {
    if (errnoOf(error) === "ENOENT") return null;
    throw error;
  }
  try {
    await handle.read(Buffer.alloc(1), 0, 1, 0);
    return (await handle.stat()).size;
  } finally {
    await handle.close();
  }
}

/**
 * A lost selection could let this box pick a minute the old box already used, so the start stops
 * rather than place the copy without them, while the live database is still as it was.
 */
async function mergeSelections(
  merge: typeof mergeModulePreparationRevisions,
  stateDir: string,
  revisions: readonly RetainedRevision[],
): Promise<void> {
  try {
    await merge({ stateDir }, revisions);
  } catch (error) {
    if (isAppError(error) && error.code === "setup.attempt_invalid") {
      throw new AppError("handover.preparation_state_unusable", {});
    }
    throw error;
  }
}

/**
 * The old file goes in one rename, so `venue.db` is there at every moment. The set-aside folder
 * `restoreDatabase` uses leaves a moment with none, and a start that finds that refuses
 * `restore.database_set_aside`, or takes the box to first setup's repair page, before this function
 * can run again.
 */
async function swapIn(steps: PlacementSteps, accepted: string, venueDir: string): Promise<void> {
  const live = join(venueDir, VENUE_FILE);
  const incoming = `${live}${INCOMING_SUFFIX}`;
  try {
    await steps.copyFile(accepted, incoming);
    await steps.chmod(incoming, VENUE_FILE_MODE);
    await steps.reachDisk(incoming);
    await steps.rm(litestreamMetaDir(live), { recursive: true, force: true });
    // The real open replays an old -wal into the main file beside it, so it goes first, and its
    // removal goes to the disk ahead of the rename.
    for (const suffix of SIDE_FILE_SUFFIXES) {
      await steps.rm(`${live}${suffix}`, { force: true });
    }
    await steps.reachDisk(venueDir);
    await steps.rename(incoming, live);
  } catch (error) {
    // The step's own failure is the one to report, not a failed tidy-up after it.
    await rm(incoming, { force: true }).catch(() => {});
    throw error;
  }
}

/**
 * Places the copy this spare accepted as its live `venue.db` once the old box has given up filing.
 * `node.db` is never changed: the caller records `copy_placed` at its first node handle, and only
 * then removes `accepted.db`, which until then is what a repeat of this places from. A live file
 * equal to the indicator's digest is taken as already placed, and any open changes the file's
 * bytes (a placed copy opened before the event was recorded is placed again, with nothing lost).
 */
export async function placeAcceptedCopyAtStart(args: {
  venueDir: string;
  stateDir: string;
  nodeId: string;
  log: Logger;
  /** Tests inject failures here; production passes nothing. */
  fs?: Partial<PlacementSteps>;
  merge?: typeof mergeModulePreparationRevisions;
  /** Told how many bytes the copy needs, once the steps that write begin. */
  onWriting?: (neededBytes: number) => void;
}): Promise<PlacementAtStart> {
  const { venueDir, stateDir, nodeId, log, fs, merge = mergeModulePreparationRevisions } = args;
  const steps: PlacementSteps = { copyFile, chmod, rm, rename, reachDisk, ...fs };
  const nodePath = join(venueDir, NODE_FILE);
  // Before the lock, whose hold makes the folder: a box with no node.db may not have one yet.
  if (!existsSync(nodePath)) return NOTHING;
  const hold = await lockVenueDatabase(venueDir);
  try {
    const awaiting = readAwaitingPlacement(nodePath, nodeId);
    if (awaiting === null) return NOTHING;
    const { operationId } = awaiting;
    if (awaiting.mode !== "mirror") {
      log("warn", "handover-place-copy.left_alone", { operationId, mode: awaiting.mode });
      return { kind: "left_alone", operationId };
    }
    const indicator = parseIndicator(
      (JSON.parse(awaiting.indicatorText) as { body?: unknown }).body,
    );
    const { sha256, bytes } = indicator.snapshot;
    const live = join(venueDir, VENUE_FILE);
    const liveSize = await sizeIfPresent(live);
    // A whole venue's file, and one of another size cannot have this digest.
    if (liveSize === bytes && (await digestFileIfPresent(live))?.sha256 === sha256) {
      // A crashed run may have renamed and not flushed, and `copy_placed` is recorded next.
      await steps.reachDisk(venueDir);
      return { kind: "copy_placed_owed", operationId, swapped: false };
    }

    const accepted = acceptedCopyPath(stateDir, operationId);
    // No server runs while this holds the lock, so no chart can arrive between this read and the swap.
    if (liveSize !== null && holdsMovedOnChart(live, accepted, awaiting, log)) {
      log("warn", "handover-place-copy.source_no_longer_main", { operationId });
      return { kind: "source_no_longer_main", operationId };
    }
    const held = await digestFileIfPresent(accepted);
    if (held === null) throw new AppError("handover.accepted_copy_missing", {});
    // Checked here as well as at acceptance: the file sat on this disk since, and the old box has
    // given up filing, so what is placed now is what this box files from.
    if (held.sha256 !== sha256) throw new AppError("handover.copy_mismatch", {});

    args.onWriting?.(bytes);
    await mergeSelections(
      merge,
      stateDir,
      // `parseIndicator` refuses an indicator whose row for this file lacks them.
      indicator.nodeLocal
        .filter((row) => row.item === "module-preparation-state.json")
        .flatMap((row) => row.revisions!),
    );
    await deleteBackupRoomNote(stateDir);
    await swapIn(steps, accepted, venueDir);
    // `copy_placed` is recorded next: it must never reach the disk ahead of the swap it reports.
    await steps.reachDisk(venueDir);
    log("info", "handover-place-copy.placed", { operationId });
    return { kind: "copy_placed_owed", operationId, swapped: true };
  } finally {
    hold.release();
  }
}

/**
 * {@link placeAcceptedCopyAtStart} as a start runs it. A disk out of room while it writes becomes
 * `handover.placement_no_room`: free space read after the failure cannot name it, as the partial
 * copy is gone by then. Any other file step that failed becomes `handover.placement_failed`. An
 * ENOSPC with no copy to make, and a failure reading `node.db`, stay themselves.
 */
export async function placeAcceptedCopyForStart(
  args: Parameters<typeof placeAcceptedCopyAtStart>[0],
): Promise<PlacementAtStart> {
  let neededBytes: number | undefined;
  try {
    return await placeAcceptedCopyAtStart({
      ...args,
      onWriting: (bytes) => {
        neededBytes = bytes;
      },
    });
  } catch (error) {
    const errno = errnoOf(error);
    if (errno === "ENOSPC" && neededBytes !== undefined) {
      args.log("error", "handover-place-copy.no_room", { neededBytes });
      throw new AppError("handover.placement_no_room", { neededBytes });
    }
    if (errno === undefined || errno === "ENOSPC" || sqliteFailureOf(error) !== null) throw error;
    const reason = (error as Error).message;
    args.log("error", "handover-place-copy.failed", { errno, reason });
    throw new AppError("handover.placement_failed", { errno }, { reason });
  }
}

/** A failure is logged: it must not stop a box that holds its copy from starting. */
async function removeAcceptedCopy(
  stateDir: string,
  operationId: string,
  log: Logger,
): Promise<void> {
  const accepted = acceptedCopyPath(stateDir, operationId);
  try {
    await rm(accepted, { force: true });
    // The folder may hold this operation's other files, which are not this step's to remove.
    await rmdir(dirname(accepted)).catch((error: unknown) => {
      if (errnoOf(error) !== "ENOTEMPTY") throw error;
    });
  } catch (error) {
    log("error", "handover-place-copy.remove_failed", { operationId, errno: errnoOf(error) });
  }
}

/**
 * For a start with no copy to place: a crash between recording `copy_placed` and the removal, or a
 * removal that failed, leaves a whole venue's copy nothing reads. Judged by the event, so this holds
 * at whichever state the operation has reached since.
 */
export async function removePlacedCopies(args: {
  node: NodeDatabase;
  nodeId: string;
  stateDir: string;
  log: Logger;
}): Promise<void> {
  const { node, nodeId, stateDir, log } = args;
  try {
    for await (const { operationId } of destinationOperationFolders({ node, nodeId }, stateDir)) {
      const placed = await readHandoverEvent(node, nodeId, operationId, HANDOVER_EVENT.copyPlaced);
      if (placed !== null) await removeAcceptedCopy(stateDir, operationId, log);
    }
  } catch (error) {
    log("error", "handover-place-copy.sweep_failed", { error: String(error) });
  }
}

/**
 * The event goes first: a crash before the removal leaves a file {@link removePlacedCopies} removes,
 * and the other order would leave a repeat of placing with nothing to place from.
 */
export async function recordCopyPlaced(args: {
  node: NodeDatabase;
  nodeId: string;
  stateDir: string;
  operationId: string;
  log: Logger;
}): Promise<void> {
  const { node, nodeId, stateDir, operationId, log } = args;
  await withNodeTransaction(node, async (tx) => {
    await appendHandoverEventTx(tx, {
      nodeId,
      operationId,
      kind: HANDOVER_EVENT.copyPlaced,
      detail: {},
      envelope: null,
    });
    // The chart that ended a wait can arrive with no duty running to clear it, as the box is off.
    await waitHandoverTx(tx, nodeId, operationId, null);
  });
  await removeAcceptedCopy(stateDir, operationId, log);
}

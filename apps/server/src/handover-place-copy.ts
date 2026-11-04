import { createReadStream, existsSync } from "node:fs";
import { copyFile, open, rm } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { lockVenueDatabase } from "@waitron/db";
import { parseIndicator, type RetainedRevision } from "@waitron/handover";
import { mergeModulePreparationRevisions } from "@waitron/provisioning";
import { AppError, isAppError } from "@waitron/shared";
import { NODE_FILE, VENUE_FILE } from "@waitron/store";
import { deleteBackupRoomNote } from "./backup-room-note.js";
import { errnoOf } from "./errno.js";
import { acceptedCopyPath } from "./handover-acceptance.js";
import { digestBytes, FINAL_STATE_EVENT } from "./handover-capture.js";
import type { Logger } from "./logger.js";
import { restoreDatabase, type PlacementFs } from "./restore.js";
import "./errors.js";

/** The `node_handover_events.kind` recording that the accepted copy is the live database. */
export const COPY_PLACED_EVENT = "copy_placed";

export type PlacementAtStart =
  | { readonly kind: "nothing" }
  /** An operation awaits placing on a box that is not a mirror, whose database is never replaced. */
  | { readonly kind: "left_alone"; readonly operationId: string }
  /**
   * The accepted copy is in place and `copy_placed` is not recorded. `swapped` says whether this
   * call replaced the file or found it already there.
   */
  | { readonly kind: "copy_placed_owed"; readonly operationId: string; readonly swapped: boolean };

const NOTHING: PlacementAtStart = { kind: "nothing" };

interface AwaitingPlacement {
  readonly operationId: string;
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
        "select operation_id from node_handover_operations where node_id = ? and role = 'destination' and state = 'filing_assumed'",
      )
      .get(nodeId) as { operation_id: string } | undefined;
    if (operation === undefined) return null;
    const operationId = operation.operation_id;
    const event = node.prepare(
      "select envelope from node_handover_events where node_id = ? and operation_id = ? and kind = ? order by rowid limit 1",
    );
    if (event.get(nodeId, operationId, COPY_PLACED_EVENT) !== undefined) return null;
    const indicator = event.get(nodeId, operationId, FINAL_STATE_EVENT) as
      { envelope: string | null } | undefined;
    // A fault in Waitron: `acceptFinalCopy` stores the indicator in the transaction that accepts.
    if (indicator?.envelope == null) {
      throw new Error(`the operation ${operationId} has no stored indicator`);
    }
    const mode = node.prepare("select mode from node_mode where node_id = ?").get(nodeId) as
      { mode: string } | undefined;
    return { operationId, mode: mode?.mode ?? null, indicatorText: indicator.envelope };
  } finally {
    node.close();
  }
}

async function digestOf(path: string): Promise<string | null> {
  try {
    return (await digestBytes(createReadStream(path))).sha256;
  } catch (error) {
    if (errnoOf(error) === "ENOENT") return null;
    throw error;
  }
}

async function reachDisk(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
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
  fs?: PlacementFs;
  merge?: typeof mergeModulePreparationRevisions;
}): Promise<PlacementAtStart> {
  const { venueDir, stateDir, nodeId, log, fs, merge = mergeModulePreparationRevisions } = args;
  const nodePath = join(venueDir, NODE_FILE);
  // Before the lock, whose hold makes the folder: a box with no node.db may not have one yet.
  if (!existsSync(nodePath)) return NOTHING;
  const hold = await lockVenueDatabase(venueDir);
  try {
    const awaiting = readAwaitingPlacement(nodePath, nodeId);
    if (awaiting === null) return NOTHING;
    const { operationId } = awaiting;
    if (awaiting.mode !== "mirror") {
      log("warn", "handover.place_copy.left_alone", { operationId, mode: awaiting.mode });
      return { kind: "left_alone", operationId };
    }
    const indicator = parseIndicator(
      (JSON.parse(awaiting.indicatorText) as { body?: unknown }).body,
    );
    const { sha256 } = indicator.snapshot;
    if ((await digestOf(join(venueDir, VENUE_FILE))) === sha256) {
      return { kind: "copy_placed_owed", operationId, swapped: false };
    }

    const accepted = acceptedCopyPath(stateDir, operationId);
    const held = await digestOf(accepted);
    if (held === null) throw new AppError("handover.accepted_copy_missing", {});
    // Checked here as well as at acceptance: the file sat on this disk since, and the old box has
    // given up filing, so what is placed now is what this box files from.
    if (held !== sha256) throw new AppError("handover.copy_mismatch", {});

    await mergeSelections(
      merge,
      stateDir,
      // `parseIndicator` refuses an indicator whose row for this file lacks them.
      indicator.nodeLocal
        .filter((row) => row.item === "module-preparation-state.json")
        .flatMap((row) => row.revisions!),
    );
    await deleteBackupRoomNote(stateDir);
    // `restoreDatabase` moves its source away, and `accepted.db` must outlive a crash in the swap.
    const temporary = `${accepted}.placing`;
    try {
      await (fs?.copyFile ?? copyFile)(accepted, temporary);
      await reachDisk(temporary);
      await restoreDatabase({
        databasePath: temporary,
        venueDir,
        stateDir,
        log,
        ...(fs === undefined ? {} : { fs }),
      });
      // `copy_placed` is recorded next: it must never reach the disk ahead of the swap it reports.
      await reachDisk(venueDir);
    } finally {
      await rm(temporary, { force: true });
    }
    log("info", "handover.place_copy.placed", { operationId });
    return { kind: "copy_placed_owed", operationId, swapped: true };
  } finally {
    hold.release();
  }
}

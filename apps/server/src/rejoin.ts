import "./errors.js"; // register rejoin.* on the shared registry (reachability convention)
import { AppError } from "@waitron/shared";
import { readNodeMembership, type Database } from "@waitron/db";
import { isFencedStanding, servingPrimaryNodeId, standingOf } from "@waitron/membership";
import type { DrainProgress } from "@waitron/sync";
import type { Logger } from "./logger.js";

export interface RejoinDeps {
  /** App-DB connection for the PRE-WIPE reads (`node_membership`). Must be closed by the caller (via
   * `closePreWipe`) BEFORE the wipe runs — the FORCE drop terminates any connection still on the
   * target db. */
  readonly appDb: Database;
  /** THIS node's own id (config.till.nodeId) — the standing to check in the held chart. */
  readonly nodeId: string;
  /** The carrier-keyed drain reader (the caller assembles `withTenant(syncDb, tenantId, tx =>
   * readDrainProgress(tx, { selfNodeId, carrierNodeId, enrolments: ALL_SYNC_ENROLMENTS }))`), or
   * `undefined` when the held document names no carrier → `rejoin.no_carrier`. */
  readonly readDrainProgress: (() => Promise<DrainProgress>) | undefined;
  /** Close the pre-wipe pools (`appDb` + the sync pool the drain reader used). Called AFTER the last
   * guard and BEFORE `wipeDatabase` — the FORCE drop terminates any connection still on the target db,
   * so ours must be gone first. */
  readonly closePreWipe: () => Promise<void>;
  /** Discard + recreate the target db (Task 2 `dropAndCreateDatabase`, bound to the maintenance conn +
   * db name). */
  readonly wipeDatabase: () => Promise<void>;
  /** Restore the baseline with `skipSecrets:true` (BR-3 `restoreFromArtifact`, Task 1). */
  readonly restore: () => Promise<void>;
  readonly log: Logger;
}

export interface RejoinResult {
  readonly restored: true;
  /** The serving-primary the node will stream from after the restore, from the held chart. */
  readonly carrierNodeId: string;
}

/**
 * Rejoin a fenced, fully-drained returned ex-primary as a clean secondary (spec §4): WIPE the local
 * database and RESTORE the carrier's baseline, discarding the stale local state. Ordered guards —
 * `not_fenced` → `no_carrier` → `not_drained` — refuse LOUD before anything irreversible, the same
 * "abort-before-write" discipline `retire.ts` uses; none of `closePreWipe`/`wipeDatabase`/`restore`
 * runs if any guard rejects.
 *
 * There is deliberately NO `carrier_changed` guard (unlike `retireSelf`): retire's drain reader is
 * bound at BOOT and can go stale against a later failover, but rejoin reads the held document once here
 * and the caller keys `readDrainProgress` on the carrier from that SAME read, so no stale-carrier gap
 * exists (spec §4).
 *
 * On success: close our own connections to the target db, then wipe, then restore (NEVER the reverse —
 * a restore before the wipe would apply the baseline onto stale rows), then return the carrier the node
 * will stream from.
 */
export async function rejoinAsSecondary(deps: RejoinDeps): Promise<RejoinResult> {
  const held = await readNodeMembership(deps.appDb);
  const standing = held === null ? undefined : standingOf(held, deps.nodeId);

  // 1. Not fenced: a serving-primary/serving-secondary node, a node absent from the chart, or no held
  // document at all — none may be wiped. A serving node is still trading and could hold un-shipped rows.
  if (!isFencedStanding(standing)) {
    throw new AppError("rejoin.not_fenced", {});
  }

  // 2. No carrier: fenced, but the held chart names no serving-primary to have drained onto and to
  // stream from. Signalled by an `undefined` drain reader OR an `undefined` carrier in the chart;
  // guarding both refuses fail-safe and narrows `carrier` to a string. `held` is non-null here (a null
  // held gives standing `undefined`, which is not fenced → thrown above).
  const carrier = servingPrimaryNodeId(held!);
  if (carrier === undefined || deps.readDrainProgress === undefined) {
    throw new AppError("rejoin.no_carrier", {});
  }

  // 3. Not drained: gate on the disposal guard's `drained` BOOLEAN only, never a seq comparison (the
  // MAX/MIN legitimately differ while drained — see @waitron/sync's readDrainProgress). Refuse before
  // the wipe: a node must not be wiped while rows it originated are still un-shipped.
  const progress = await deps.readDrainProgress();
  if (!progress.drained) {
    throw new AppError("rejoin.not_drained", {});
  }
  deps.log("info", "rejoin.drained", { carrierNodeId: carrier });

  // Close our own connections to the target db BEFORE the FORCE drop (which would otherwise terminate
  // them out from under us). Everything the guards needed has been read by now.
  await deps.closePreWipe();
  await deps.wipeDatabase();
  deps.log("info", "rejoin.wiped", {});
  await deps.restore();
  deps.log("info", "rejoin.restored", { carrierNodeId: carrier });
  return { restored: true, carrierNodeId: carrier };
}

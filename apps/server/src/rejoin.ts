import "./errors.js"; // register rejoin.* on the shared registry (reachability convention)
import { AppError } from "@waitron/shared";
import {
  isFencedStanding,
  servingPrimaryNodeId,
  standingOf,
  type SignedMembershipDocument,
} from "@waitron/membership";
import { isDrained, type SlotDrain } from "@waitron/sync";
import type { Logger } from "./logger.js";

export interface RejoinDeps {
  /** The held `node_membership` document, read ONCE by the caller BEFORE the wipe. Threaded in (rather
   * than re-read here) so the standing guards check the SAME chart the caller keyed `readSlotDrain` on
   * — no second read can slip a membership rewrite between the drain-reader carrier and the guard (a
   * stale-carrier false-`drained` on the irreversible path). `null` = no held document → not fenced. */
  readonly held: SignedMembershipDocument | null;
  /** THIS node's own id (config.till.nodeId) — the standing to check in the held chart. */
  readonly nodeId: string;
  /** The native slot-drain reader keyed on the CARRIER's slot on this node
   * (`readSlotDrain(migrationsDb, subscriptionName(env, carrierNodeId))`), or `undefined` when the held
   * document names no carrier → `rejoin.no_carrier`. Never consulted on the `acceptLoss` path. */
  readonly readSlotDrain: (() => Promise<SlotDrain>) | undefined;
  /** The fence-LSN watermark this node recorded when it fenced (Ruling C2), read from
   *  `deployment.fence_lsn`, or `null` for a dead/never-fenced box. `null` refuses `rejoin.not_drained`
   *  UNLESS `acceptLoss` — the drain guard is `isDrained(d, fenceLsn) && !d.active`. */
  readonly fenceLsn: string | null;
  /** The operator's `--accept-loss` override (spec §4.2 step 2): a dead box that cannot prove its drain
   * is wiped anyway, the operator accepting any un-shipped tail. Bypasses EVERY drain/standing guard. */
  readonly acceptLoss: boolean;
  /** Close the pre-wipe pools (the app + owner/migrator pools the caller opened and the slot reader
   * used). Called AFTER the last guard and BEFORE `wipeDatabase` — the FORCE drop terminates any
   * connection still on the target db, so ours must be gone first. */
  readonly closePreWipe: () => Promise<void>;
  /** Discard + recreate the target db, re-migrate it migrator-owned, and clear `trading.env` so the
   * NEXT boot comes up in SETUP mode and the operator re-adopts from the connect screen (spec §4.4).
   * NO artifact restore and NO slot drop — the wipe's `DROP DATABASE … WITH (FORCE)` reclaims the
   * inactive slot for free (probe F / Ruling I3). */
  readonly wipeDatabase: () => Promise<void>;
  readonly log: Logger;
}

export interface RejoinResult {
  readonly wiped: true;
  /** The serving-primary this node drained onto (from the held chart), or `null` on the `--accept-loss`
   * path where no drain was verified. Informational — the wiped box re-adopts from setup, it does not
   * stream from a carrier here. */
  readonly carrierNodeId: string | null;
}

/**
 * Rejoin a fenced, fully-drained returned ex-primary as a clean secondary (spec §4): WIPE the local
 * database, recreate + re-migrate it, and clear `trading.env` so the next boot enters SETUP mode and
 * the operator re-adopts from the connect screen. There is NO artifact restore (Ruling I3): the tail
 * is already on the carrier, and a wiped box re-adopts the carrier's baseline natively.
 *
 * Ordered guards — `not_fenced` → `no_carrier` → `carrier_attached` → `not_drained` — refuse LOUD
 * before anything irreversible (the "abort-before-write" discipline `retire.ts` uses); none of
 * `closePreWipe`/`wipeDatabase` runs if any guard rejects. The drain guard is the fence-LSN watermark
 * (Ruling C2, spec §4.1): the carrier's slot on this node is INACTIVE (`!active` — the carrier disabled
 * its subscription only after it read drained) AND its `confirmed_flush_lsn` has passed the fence LSN
 * this node recorded when it fenced — both monotone, so a fenced box that keeps writing session WAL
 * cannot decay the compare (probe E). NO slot drop of our own: the wipe's `DROP DATABASE FORCE`
 * reclaims the inactive slot (probe F).
 *
 * There is deliberately NO `carrier_changed` guard (unlike `retireSelf`): the caller reads the held
 * document once and threads that SAME document in as `deps.held`, keying `readSlotDrain` on the carrier
 * from it — so the guards and the drain reader see one chart and no stale-carrier gap exists (spec §4).
 *
 * `--accept-loss` (dead-box path, spec §4.2 step 2): a box that cannot prove its drain (no fence LSN,
 * or the carrier unreachable) is wiped anyway, the operator having accepted the loss of any un-shipped
 * tail. It bypasses EVERY drain/standing guard — the slot reader is never consulted — but still closes
 * our own connections before the FORCE drop.
 */
export async function rejoinAsSecondary(deps: RejoinDeps): Promise<RejoinResult> {
  // --accept-loss short-circuits the whole guard ladder (dead-box path, spec §4.2 step 2): the operator
  // has accepted losing any tail that never reached the carrier, so no drain proof is required. We still
  // close our own connections before the FORCE drop, then wipe.
  if (deps.acceptLoss) {
    deps.log("warn", "rejoin.accept_loss", {});
    await deps.closePreWipe();
    await deps.wipeDatabase();
    deps.log("info", "rejoin.wiped", {});
    return { wiped: true, carrierNodeId: null };
  }

  const held = deps.held;
  const standing = held === null ? undefined : standingOf(held, deps.nodeId);

  // 1. Not fenced: a serving-primary/serving-secondary node, a node absent from the chart, or no held
  // document at all — none may be wiped. A serving node is still trading and could hold un-shipped rows.
  if (!isFencedStanding(standing)) {
    throw new AppError("rejoin.not_fenced", {});
  }

  // 2. No carrier: fenced, but the held chart names no serving-primary to have drained onto. Signalled
  // by an `undefined` carrier in the chart OR an `undefined` slot reader; guarding both refuses
  // fail-safe and narrows `carrier` to a string. `held` is non-null here (a null held gives standing
  // `undefined`, not fenced → thrown above).
  const carrier = servingPrimaryNodeId(held!);
  if (carrier === undefined || deps.readSlotDrain === undefined) {
    throw new AppError("rejoin.no_carrier", {});
  }

  // 3. The fence-LSN drain guard (Ruling C2), refused BEFORE the wipe: a node must not be wiped while
  // rows it originated are still un-shipped, or they are lost (CLAUDE.md §5). Two monotone halves:
  //   (a) carrier still ATTACHED — the slot is `active`, the drain window is open. `rejoin.carrier_attached`.
  //   (b) NOT drained — the slot is detached but `confirmed_flush_lsn < fence_lsn` (or the fence LSN is
  //       unset, which without --accept-loss is not drainable). `rejoin.not_drained`.
  const drain = await deps.readSlotDrain();
  if (drain.active) {
    throw new AppError("rejoin.carrier_attached", {});
  }
  if (deps.fenceLsn === null || !isDrained(drain, deps.fenceLsn)) {
    throw new AppError("rejoin.not_drained", {});
  }
  deps.log("info", "rejoin.drained", { carrierNodeId: carrier });

  // Close our own connections to the target db BEFORE the FORCE drop (which would otherwise terminate
  // them out from under us). Everything the guards needed has been read by now.
  await deps.closePreWipe();
  await deps.wipeDatabase();
  deps.log("info", "rejoin.wiped", { carrierNodeId: carrier });
  return { wiped: true, carrierNodeId: carrier };
}

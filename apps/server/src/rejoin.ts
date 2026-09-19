import "./errors.js"; // register rejoin.* on the shared registry (reachability convention)
import { AppError } from "@waitron/shared";
import {
  isFencedStanding,
  servingPrimaryNodeId,
  standingOf,
  type SignedMembershipDocument,
} from "@waitron/membership";
import type { Logger } from "./logger.js";

export interface RejoinDeps {
  /** The held `node_membership` document, read ONCE by the caller BEFORE the wipe. Threaded in rather
   * than re-read here, so no second read can slip a membership rewrite in between the caller's own read
   * and the guards on the irreversible path. `null` = no held document → not fenced. */
  readonly held: SignedMembershipDocument | null;
  /** THIS node's own id (config.till.nodeId) — the standing to check in the held chart. */
  readonly nodeId: string;
  /** The operator's `--accept-loss` override. It waives NOTHING today: the drain confirmation it used to
   * waive was the PostgreSQL fence-LSN watermark, removed with the rest of the replication machinery, and
   * the failover mechanism that replaces it has not landed. The flag is kept so the operator's explicit
   * acknowledgement — and the `rejoin.accept_loss` warning it logs — survives the switch. `not_fenced`
   * and `no_carrier` were always enforced regardless of it, and still are. */
  readonly acceptLoss: boolean;
  /** Close the pre-wipe pools (the app + owner/migrator pools the caller opened). Called AFTER the last
   * guard and BEFORE `wipeDatabase` — the FORCE drop terminates any connection still on the target db,
   * so ours must be gone first. */
  readonly closePreWipe: () => Promise<void>;
  /** Discard + recreate the target db, re-migrate it migrator-owned, and clear `trading.env` so the
   * NEXT boot comes up in SETUP mode and the operator re-adopts from the connect screen (spec §4.4).
   * NO artifact restore (Ruling I3). */
  readonly wipeDatabase: () => Promise<void>;
  readonly log: Logger;
}

export interface RejoinResult {
  readonly wiped: true;
  /** The serving-primary named in the held chart — the carrier this node drained onto and will re-adopt
   * from. Always present: both the guarded and the `--accept-loss` paths pass the `no_carrier` guard, so
   * a carrier is known even when the drain confirmation was waived. Informational — the wiped box
   * re-adopts from setup, it does not stream from a carrier here. */
  readonly carrierNodeId: string;
}

/**
 * Rejoin a fenced returned ex-primary as a clean secondary (spec §4): WIPE the local database, recreate
 * + re-migrate it, and clear `trading.env` so the next boot enters SETUP mode and the operator re-adopts
 * from the connect screen. There is NO artifact restore (Ruling I3).
 *
 * Ordered guards — `not_fenced` → `no_carrier` — refuse LOUD before anything irreversible (the
 * "abort-before-write" discipline `retire.ts` uses); neither `closePreWipe` nor `wipeDatabase` runs if a
 * guard rejects. There is deliberately no `carrier_changed` guard (unlike `retireSelf`): the caller reads
 * the held document once and threads that SAME document in as `deps.held`, so the guards see one chart.
 *
 * WHAT IS GONE, stated so nobody assumes it: this used to confirm, before wiping, that every row this
 * node originated had reached the carrier — a PostgreSQL fence-LSN watermark against the carrier's
 * replication slot. That machinery is deleted and its replacement has not landed, so rejoin now wipes
 * without any such confirmation. `not_fenced` is the guard that still stops it destroying a live
 * primary's un-shipped fiscal rows (CLAUDE.md §5); `no_carrier` still requires a surviving primary to
 * re-adopt from. A returning dead box is fenced by the boot membership reconciliation BEFORE the
 * operator runs rejoin, so a fenced standing is reachable.
 */
export async function rejoinAsSecondary(deps: RejoinDeps): Promise<RejoinResult> {
  const held = deps.held;
  const standing = held === null ? undefined : standingOf(held, deps.nodeId);

  // 1. Not fenced — ENFORCED even under `--accept-loss`: a serving-primary/serving-secondary node, a
  // node absent from the chart, or no held document at all — none may be wiped, or the irreversible
  // wipe could destroy a live primary's un-shipped fiscal rows (CLAUDE.md §5). See the header for why
  // a fenced standing is always reachable for a legitimate rejoin.
  if (!isFencedStanding(standing)) {
    throw new AppError("rejoin.not_fenced", {});
  }

  // 2. No carrier — ENFORCED even under `--accept-loss`: fenced, but the held chart names no
  // serving-primary to re-adopt from. `held` is non-null here (a null held gives standing `undefined`,
  // not fenced → thrown above).
  const carrier = servingPrimaryNodeId(held!);
  if (carrier === undefined) {
    throw new AppError("rejoin.no_carrier", {});
  }

  // The operator's acknowledgement, kept as a log line: there is no drain confirmation left for it to
  // waive (see the header).
  if (deps.acceptLoss) {
    deps.log("warn", "rejoin.accept_loss", { carrierNodeId: carrier });
  }

  // Close our own connections to the target db BEFORE the FORCE drop (which would otherwise terminate
  // them out from under us). Everything the guards needed has been read by now.
  await deps.closePreWipe();
  await deps.wipeDatabase();
  deps.log("info", "rejoin.wiped", { carrierNodeId: carrier });
  return { wiped: true, carrierNodeId: carrier };
}

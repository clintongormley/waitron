import "./errors.js";
import { AppError } from "@waitron/shared";
import {
  isFencedStanding,
  servingPrimaryNodeId,
  standingOf,
  type SignedMembershipDocument,
} from "@waitron/membership";
import type { Logger } from "./logger.js";

export interface RejoinDeps {
  /** Read once by the caller before the wipe, so the guards and the caller see one chart. `null` is
   * not fenced. */
  readonly held: SignedMembershipDocument | null;
  readonly nodeId: string;
  /** `--accept-loss` waives nothing: it only logs `rejoin.accept_loss`. Both guards still hold. */
  readonly acceptLoss: boolean;
  /** Called after the last guard and before `wipeDatabase`. */
  readonly closePreWipe: () => Promise<void>;
  /** Must leave the next boot in setup mode, where the operator re-adopts. */
  readonly wipeDatabase: () => Promise<void>;
  readonly log: Logger;
}

export interface RejoinResult {
  readonly wiped: true;
  /** The serving primary in the held chart. Informational: the wiped box re-adopts from setup. */
  readonly carrierNodeId: string;
}

/**
 * Wipes a fenced returned ex-primary so it can re-adopt as a clean secondary. Both guards refuse
 * before anything irreversible runs.
 *
 * WHAT IS GONE, stated so nobody assumes it: rejoin wipes without confirming that every row this
 * node originated reached the carrier. `not_fenced` is what stops it destroying a live primary's
 * unfiled fiscal rows (CLAUDE.md §5).
 */
export async function rejoinAsSecondary(deps: RejoinDeps): Promise<RejoinResult> {
  const held = deps.held;
  const standing = held === null ? undefined : standingOf(held, deps.nodeId);

  // A serving node, a node absent from the chart, or no held document at all is never wiped.
  if (!isFencedStanding(standing)) {
    throw new AppError("rejoin.not_fenced", {});
  }

  // `held` is non-null here: a null one has no standing, refused above.
  const carrier = servingPrimaryNodeId(held!);
  if (carrier === undefined) {
    throw new AppError("rejoin.no_carrier", {});
  }

  if (deps.acceptLoss) {
    deps.log("warn", "rejoin.accept_loss", { carrierNodeId: carrier });
  }

  await deps.closePreWipe();
  await deps.wipeDatabase();
  deps.log("info", "rejoin.wiped", { carrierNodeId: carrier });
  return { wiped: true, carrierNodeId: carrier };
}

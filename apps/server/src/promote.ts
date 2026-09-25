import "./errors.js";
import { AppError } from "@waitron/shared";
import {
  persistNodeMembershipIfNewerTx,
  readNodeMembership,
  readStandardSeriesId,
  setDeploymentModeTx,
  setSingletonRoleTx,
  withTransaction,
  writeNodeMembershipTx,
  type Database,
  type Transaction,
} from "@waitron/db";
import {
  isFencedStanding,
  nextStandings,
  standingOf,
  type SignedMembershipDocument,
} from "@waitron/membership";
import type { KeyRing } from "@waitron/credentials";
import { refreshDeploymentHolders, type DeploymentHolders } from "./deployment-holders.js";
import { mintNextMembershipDocument } from "./membership-mint.js";
import type { Logger } from "./logger.js";

/**
 * The operator's attestation that the old node is powered off or demoted to sell-only. Software
 * cannot verify a partitioned peer; without it, two submitters under one NIF could coexist.
 */
export interface FenceAttestation {
  readonly oldNodeNeutralised: boolean;
}

export interface PromotionResult {
  readonly alreadyPrimary: boolean;
}

export interface PromoteDeps {
  readonly db: Database;
  readonly holders: DeploymentHolders;
  readonly log: Logger;
  readonly ring: KeyRing;
  readonly nodeId: string;
}

// Throws before any state change, so a refused promote leaves the node as it was.
export function assertFenced(attestation: FenceAttestation): void {
  if (attestation.oldNodeNeutralised !== true) {
    throw new AppError("promotion.fence_not_attested", {});
  }
}

/**
 * Refuses a node its own held document marks fenced (`sell-only`/`evicted`): it was superseded, and
 * promoting it in place would resume submitter duties on a superseded chain, two submitters under
 * one NIF. A fenced node returns via wipe-and-restore. Throws before any state change. Distinct from
 * `assertFenced`, which checks the operator's attestation about the OLD node.
 */
export function assertNotFenced(held: SignedMembershipDocument | null, nodeId: string): void {
  const standing = held === null ? undefined : standingOf(held, nodeId);
  if (isFencedStanding(standing)) {
    throw new AppError("promotion.node_fenced", { standing });
  }
}

/**
 * Local secondary to primary: the node already sells, so this claims the singleton duties only.
 * Idempotent: an already-primary node is a no-op. The checks and the mint run before the one
 * transaction that flips `singleton_role` and writes the new membership document together, so a
 * crash cannot leave a primary with no document.
 */
export async function promoteLocalSecondaryToPrimary(
  deps: PromoteDeps,
  attestation: FenceAttestation,
): Promise<PromotionResult> {
  assertFenced(attestation);

  // Fresh state, so a re-run after a half-completed promote sees what landed.
  await refreshDeploymentHolders(deps.db, deps.nodeId, deps.holders);

  if (deps.holders.mode.current === "mirror") {
    // Refused with a clean code; the `(mirror, primary)` CHECK is only the backstop.
    throw new AppError("promotion.not_a_local_secondary", { mode: deps.holders.mode.current });
  }
  if (deps.holders.singletonRole.current === "primary") {
    return { alreadyPrimary: true };
  }

  const held = await readNodeMembership(deps.db);
  assertNotFenced(held, deps.nodeId);
  const document = await mintNextMembershipDocument(
    { db: deps.db, ring: deps.ring },
    {
      heldDocument: held,
      nodes: nextStandings(held?.body.nodes ?? [], deps.nodeId),
      signerNodeId: deps.nodeId,
    },
  );

  // The point of no return: the role flip and the document commit together or not at all.
  await withTransaction(deps.db, async (tx) => {
    await setSingletonRoleTx(tx, deps.nodeId, "primary");
    await writeNodeMembershipTx(tx, document);
  });

  // If this refresh throws after the commit, the process keeps the stale holder until a re-run or a
  // restart; a re-run takes the already-primary return, so the term is never bumped twice.
  await refreshDeploymentHolders(deps.db, deps.nodeId, deps.holders);

  deps.log("info", "promotion.completed", { target: "local_secondary" });
  return { alreadyPrimary: false };
}

export interface MirrorPromotionResult extends PromotionResult {
  /** This node's own reserved series, disjoint from the old primary's, now in trading.env. */
  readonly seriesId: string;
}

export interface MirrorPromoteDeps extends PromoteDeps {
  /**
   * Called BEFORE the point of no return. A corrected `seriesId` is inert while the node is still a
   * read-only mirror, so writing it early is safe if the promote then aborts, and a process crash
   * between the two can never boot the node primary on the old primary's series. Power loss still
   * can: `writeFileAtomic` does not fsync.
   */
  readonly persistTradingEnv: (seriesId: string) => Promise<void>;
}

/**
 * One transaction, ordered for `node_roles_role_valid_ck`: `mode` first, so the transient pair is
 * `(primary, secondary)` and never the forbidden `(mirror, primary)`. A refused term-guarded write
 * means a concurrent gossip adoption already landed a term at least as high; the throw rolls the whole flip
 * back rather than regress the org chart.
 */
export async function commitMirrorPromotionTx(
  tx: Transaction,
  nodeId: string,
  document: SignedMembershipDocument,
): Promise<void> {
  await setDeploymentModeTx(tx, nodeId, "primary");
  await setSingletonRoleTx(tx, nodeId, "primary");
  const accepted = await persistNodeMembershipIfNewerTx(tx, document);
  if (!accepted) {
    const current = await readNodeMembership(tx);
    throw new AppError("promotion.membership_superseded", {
      heldTerm: current?.body.term ?? -1,
      mintedTerm: document.body.term,
    });
  }
}

/**
 * Mirror to primary, on the identity reserved at adopt: no fiscal identity is minted here. The
 * checks, the mint and `persistTradingEnv` run before `commitMirrorPromotionTx`, so a failure there
 * leaves the mirror as it was. The caller restarts only on `{ alreadyPrimary: false }`.
 */
export async function promoteMirrorToPrimary(
  deps: MirrorPromoteDeps,
  attestation: FenceAttestation,
): Promise<MirrorPromotionResult> {
  assertFenced(attestation);

  await refreshDeploymentHolders(deps.db, deps.nodeId, deps.holders);
  // Also what an already-primary re-run returns.
  const seriesId = await readStandardSeriesId(deps.db, deps.nodeId);

  if (deps.holders.mode.current === "primary") {
    return { alreadyPrimary: true, seriesId };
  }

  const held = await readNodeMembership(deps.db);
  assertNotFenced(held, deps.nodeId);
  const document = await mintNextMembershipDocument(
    { db: deps.db, ring: deps.ring },
    {
      heldDocument: held,
      nodes: nextStandings(held?.body.nodes ?? [], deps.nodeId),
      signerNodeId: deps.nodeId,
    },
  );

  // Before the point of no return: see `MirrorPromoteDeps.persistTradingEnv`.
  await deps.persistTradingEnv(seriesId);

  await withTransaction(deps.db, async (tx) => {
    await commitMirrorPromotionTx(tx, deps.nodeId, document);
  });

  await refreshDeploymentHolders(deps.db, deps.nodeId, deps.holders);
  deps.log("info", "promotion.completed", { target: "mirror" });
  return { alreadyPrimary: false, seriesId };
}

import "./errors.js";
import { AppError, isAppError } from "@waitron/shared";
import {
  persistNodeMembershipIfNewerTx,
  readLiveSeriesIdTx,
  nodes,
  readNodeMembership,
  readStandardSeriesId,
  requireStamp,
  withNodeTransaction,
  withTransaction,
  writeNodeMembershipTx,
  type Database,
  type NodeDatabase,
  type Transaction,
} from "@waitron/db";
import { setPrimaryRoleTx } from "@waitron/node-db";
import { codeOf } from "@waitron/server-kit";
import {
  isFencedStanding,
  nextStandings,
  standingOf,
  type SignedMembershipDocument,
} from "@waitron/membership";
import type { KeyRing } from "@waitron/credentials";
import { eq } from "drizzle-orm";
import {
  moduleOperationFor,
  snapshotModuleOperations,
  withPreparedModuleOperations,
  type ModuleOperations,
  type ProvisionedNode,
  type WaitronModule,
} from "@waitron/module";
import { locationId as brandLocationId, nodeId as brandNodeId } from "@waitron/shared";
import { refreshDeploymentHolders, type DeploymentHolders } from "./deployment-holders.js";
import { mintNextMembershipDocument } from "./membership-mint.js";
import { assertHeldDocumentReadable, assertHeldDocumentTrusted } from "./membership-trust.js";
import { finishPromotedRole } from "./promoted-role.js";
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
  readonly node: NodeDatabase;
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
 * `assertFenced`, which checks the operator's attestation about the OLD node. A held document too
 * broken to read is refused `membership.held_untrusted` first.
 */
export function assertNotFenced(held: SignedMembershipDocument | null, nodeId: string): void {
  assertHeldDocumentReadable(held);
  const standing = held === null ? undefined : standingOf(held, nodeId);
  if (isFencedStanding(standing)) {
    throw new AppError("promotion.node_fenced", { standing });
  }
}

/**
 * Writes this node's primary role to node.db after the venue save has committed. The role follows
 * the venue save rather than sharing its transaction because the two live in different files; a
 * failure here is logged and rethrown, and each caller decides what it means. A role left behind is
 * finished from the committed chart by `finishPromotedRole`, at the next call or the next start.
 */
async function writePrimaryRole(deps: PromoteDeps): Promise<void> {
  try {
    await withNodeTransaction(deps.node, (tx) => setPrimaryRoleTx(tx, deps.nodeId));
  } catch (error) {
    // An engine refusal carries no code of ours, so its message is logged too. These statements
    // write only the mode, the role and the node id, so the message can hold nothing secret.
    deps.log("warn", "promotion.role_write_failed", {
      errorCode: codeOf(error),
      ...(isAppError(error)
        ? {}
        : { error: error instanceof Error ? error.message : String(error) }),
    });
    throw error;
  }
}

function roleRepairDeps(deps: PromoteDeps) {
  return { venue: deps.db, node: deps.node, ring: deps.ring, nodeId: deps.nodeId, log: deps.log };
}

/**
 * Local secondary to primary: the node already sells, so this claims the singleton duties only.
 * Idempotent: an already-primary node is a no-op. The checks and the mint run before the venue
 * transaction that writes the new membership document; the role in node.db follows it. A failed
 * role write rejects, because this runs in-process with no restart, so returning normally would
 * report a promotion the running box does not act on; a second call finishes that role without
 * minting another term.
 */
export async function promoteLocalSecondaryToPrimary(
  deps: PromoteDeps,
  attestation: FenceAttestation,
): Promise<PromotionResult> {
  assertFenced(attestation);

  // Fresh state, so a re-run after a half-completed promote sees what landed.
  await refreshDeploymentHolders(deps.node, deps.nodeId, deps.holders);
  if ((await finishPromotedRole(roleRepairDeps(deps))) === "finished") {
    await refreshDeploymentHolders(deps.node, deps.nodeId, deps.holders);
    deps.log("info", "promotion.completed", { target: "local_secondary" });
    return { alreadyPrimary: false };
  }

  if (deps.holders.mode.current === "mirror") {
    // Refused with a clean code; the `(mirror, primary)` CHECK is only the backstop.
    throw new AppError("promotion.not_a_local_secondary", { mode: deps.holders.mode.current });
  }
  if (deps.holders.singletonRole.current === "primary") {
    return { alreadyPrimary: true };
  }

  const held = await readNodeMembership(deps.db);
  assertNotFenced(held, deps.nodeId);
  // A held chart no stored key vouches for comes from a fault in Waitron, a Cloud peer, or, in a
  // venue of three or more boxes after two promotions, a main box that no key this box trusts
  // vouched for. The backlog records the last two.
  await assertHeldDocumentTrusted(deps, held);
  const document = await mintNextMembershipDocument(
    { db: deps.db, node: deps.node, ring: deps.ring },
    {
      heldDocument: held,
      nodes: nextStandings(held?.body.nodes ?? [], deps.nodeId),
      signerNodeId: deps.nodeId,
    },
  );

  // venue.db is saved first and node.db follows, as two transactions: the role lives in its own file.
  await withTransaction(deps.db, async (tx) => {
    await requireStamp(tx);
    await writeNodeMembershipTx(tx, document);
  });
  await writePrimaryRole(deps);

  // If this refresh throws after the commit, the process keeps the stale holder until a re-run or a
  // restart; a re-run takes the already-primary return, so the term is never bumped twice.
  await refreshDeploymentHolders(deps.node, deps.nodeId, deps.holders);

  deps.log("info", "promotion.completed", { target: "local_secondary" });
  return { alreadyPrimary: false };
}

export interface MirrorPromotionResult extends PromotionResult {
  /** The standard series validated for this node. */
  readonly seriesId: string;
}

export interface MirrorPromoteDeps extends PromoteDeps {
  readonly persistTradingEnv: () => Promise<void>;
  readonly modules?: readonly WaitronModule[];
  readonly moduleOperations?: ModuleOperations;
  readonly withModuleOperations?: PromotionOperationRunner;
}

export type PromotionOperationRunner = (
  context: {
    readonly db: Database;
    readonly nodeDb: NodeDatabase;
    readonly node: ProvisionedNode;
  },
  run: (tx: Transaction, operations: ModuleOperations) => Promise<string>,
) => Promise<string>;

/**
 * The venue part of a mirror promotion. A refused term-guarded write means a concurrent gossip
 * adoption already landed a term at least as high; the throw rolls the whole venue save back rather
 * than regress the org chart, and the role in node.db is never written.
 */
export async function commitMirrorPromotionTx(
  tx: Transaction,
  document: SignedMembershipDocument,
): Promise<void> {
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
 * The module activation, trading-series checks and membership document share one venue
 * transaction, which first refuses an unstamped venue.db; the role in node.db follows it. The
 * caller restarts only on `{ alreadyPrimary: false }`, and still does when the role write fails:
 * the start that follows finishes the role from the committed chart, and so does a second call.
 */
export async function promoteMirrorToPrimary(
  deps: MirrorPromoteDeps,
  attestation: FenceAttestation,
): Promise<MirrorPromotionResult> {
  assertFenced(attestation);
  const supplied = snapshotModuleOperations(deps.moduleOperations);

  await refreshDeploymentHolders(deps.node, deps.nodeId, deps.holders);
  if ((await finishPromotedRole(roleRepairDeps(deps))) === "finished") {
    await refreshDeploymentHolders(deps.node, deps.nodeId, deps.holders);
    deps.log("info", "promotion.completed", { target: "mirror" });
    return { alreadyPrimary: false, seriesId: await readStandardSeriesId(deps.db, deps.nodeId) };
  }

  if (deps.holders.mode.current === "primary") {
    const seriesId = await readStandardSeriesId(deps.db, deps.nodeId);
    await withTransaction(deps.db, (tx) => readLiveSeriesIdTx(tx, deps.nodeId, "full"));
    return { alreadyPrimary: true, seriesId };
  }

  const [stored] = await deps.db
    .select({ locationId: nodes.locationId })
    .from(nodes)
    .where(eq(nodes.id, deps.nodeId));
  if (stored === undefined) throw new AppError("node.not_found", { id: deps.nodeId });
  const node = { nodeId: brandNodeId(deps.nodeId), locationId: brandLocationId(stored.locationId) };

  const held = await readNodeMembership(deps.db);
  assertNotFenced(held, deps.nodeId);
  // A held chart no stored key vouches for comes from a fault in Waitron, a Cloud peer, or, in a
  // venue of three or more boxes after two promotions, a main box that no key this box trusts
  // vouched for. The backlog records the last two.
  await assertHeldDocumentTrusted(deps, held);
  const document = await mintNextMembershipDocument(
    { db: deps.db, node: deps.node, ring: deps.ring },
    {
      heldDocument: held,
      nodes: nextStandings(held?.body.nodes ?? [], deps.nodeId),
      signerNodeId: deps.nodeId,
    },
  );

  const run = async (tx: Transaction, suppliedOperations = supplied): Promise<string> => {
    await requireStamp(tx);
    const operations = snapshotModuleOperations(suppliedOperations);
    for (const m of deps.modules ?? []) {
      const activate = m.provisioning?.standby?.activate;
      if (activate === undefined) continue;
      const operation = moduleOperationFor(operations, m.name, node.nodeId, "promote");
      await activate(tx, node, operation);
      moduleOperationFor(operations, m.name, node.nodeId, "promote");
    }
    const series = await readLiveSeriesIdTx(tx, node.nodeId, "standard");
    await readLiveSeriesIdTx(tx, node.nodeId, "full");
    await deps.persistTradingEnv();
    await commitMirrorPromotionTx(tx, document);
    for (const m of deps.modules ?? []) {
      if (m.provisioning?.standby?.activate !== undefined)
        moduleOperationFor(operations, m.name, node.nodeId, "promote");
    }
    return series;
  };
  const seriesId =
    deps.withModuleOperations === undefined
      ? await withPreparedModuleOperations(
          deps.modules ?? [],
          supplied,
          node.nodeId,
          "promote",
          (ready) => withTransaction(deps.db, (tx) => run(tx, ready)),
        )
      : await deps.withModuleOperations({ db: deps.db, nodeDb: deps.node, node }, run);

  // venue.db is saved first and node.db follows, as two transactions: the role lives in its own file.
  const roleWritten = await writePrimaryRole(deps).then(
    () => true,
    () => false,
  );
  // After a failed write the holders keep the mirror pair read above, and no node.db read may stand
  // between the committed venue save and the restart.
  if (roleWritten) {
    await refreshDeploymentHolders(deps.node, deps.nodeId, deps.holders);
    deps.log("info", "promotion.completed", { target: "mirror" });
  }
  return { alreadyPrimary: false, seriesId };
}

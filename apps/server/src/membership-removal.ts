import "./errors.js";
import { inArray } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { codeOf } from "@waitron/server-kit";
import {
  recordActivity,
  nodes,
  persistNodeMembershipIfNewerTx,
  readNodeMembership,
  withNodeTransaction,
  withTransaction,
  type Database,
  type NodeDatabase,
  type NodeTransaction,
  type Transaction,
} from "@waitron/db";
import {
  evictNode,
  servingPrimaryNodeId,
  type MembershipNode,
  type NodeStanding,
  type SignedMembershipDocument,
} from "@waitron/membership";
import { deletePairLinkTx, type KeyRing } from "@waitron/credentials";
import { readOpenHandoverOperation, readPairLink } from "@waitron/node-db";
import { MAX_CHART_WRITE_ROUNDS, mintNextMembershipDocument } from "./membership-mint.js";
import type { Logger } from "./logger.js";

type ChartRefusal =
  | "membership.node_not_found"
  | "membership.not_primary"
  | "membership.node_is_primary"
  | "membership.node_has_served"
  | "membership.standby_joined"
  | "membership.node_not_removed";

export type RemovalVerdict =
  | { readonly kind: "removable"; readonly node: MembershipNode }
  | { readonly kind: "already_removed" }
  | Refused;

export type ClearanceVerdict =
  { readonly kind: "clearable" } | { readonly kind: "already_cleared" } | Refused;

/**
 * Whether the serving primary may remove `targetNodeId` from its chart. The rule: the target is
 * `serving-secondary`, and one that finished joining (it has a `nodes` row) only once `declared`.
 */
export function judgeRemoval(
  held: SignedMembershipDocument | null,
  selfNodeId: string,
  targetNodeId: string,
  targetHasNodeRow: boolean,
  declared: boolean,
): RemovalVerdict {
  const found = locate(held, selfNodeId, targetNodeId);
  if (found.kind === "refused") return found;
  if (found.kind === "cleared") return { kind: "already_removed" };
  const target = found.node;
  switch (target.standing) {
    case "evicted":
      return { kind: "already_removed" };
    case "serving-primary":
      return refused("membership.node_is_primary");
    case "sell-only":
      return refused("membership.node_has_served");
    case "serving-secondary":
      return targetHasNodeRow && !declared
        ? refused("membership.standby_joined")
        : { kind: "removable", node: target };
  }
}

/**
 * Whether the serving primary may clear `targetNodeId`: only a machine the chart lists `evicted`.
 * Clearing moves its id from `nodes`, where it takes one of MAX_NODES places, to `revoked`, where
 * `standingOf` still answers `evicted` for it, so every check that reads a standing refuses a
 * cleared machine as it refuses a removed one — on a node whose held chart contains the clearing.
 */
export function judgeClearance(
  held: SignedMembershipDocument | null,
  selfNodeId: string,
  targetNodeId: string,
): ClearanceVerdict {
  const found = locate(held, selfNodeId, targetNodeId);
  if (found.kind === "refused") return found;
  if (found.kind === "cleared") return { kind: "already_cleared" };
  switch (found.node.standing) {
    case "evicted":
      return { kind: "clearable" };
    case "serving-primary":
      return refused("membership.node_is_primary");
    case "serving-secondary":
    case "sell-only":
      return refused("membership.node_not_removed");
  }
}

type Refused = { readonly kind: "refused"; readonly code: ChartRefusal };

/** The checks removal and clearance share: the chart lists the target, and this node serves it. */
function locate(
  held: SignedMembershipDocument | null,
  selfNodeId: string,
  targetNodeId: string,
):
  | Refused
  | { readonly kind: "cleared" }
  | { readonly kind: "listed"; readonly node: MembershipNode } {
  const node = held?.body.nodes.find((n) => n.nodeId === targetNodeId);
  const cleared = held?.body.revoked?.includes(targetNodeId) === true;
  if (held === null || (node === undefined && !cleared)) {
    return refused("membership.node_not_found");
  }
  if (servingPrimaryNodeId(held) !== selfNodeId) return refused("membership.not_primary");
  return node === undefined ? { kind: "cleared" } : { kind: "listed", node };
}

function refused(code: ChartRefusal): Refused {
  return { kind: "refused", code };
}

async function nodeIdsWithRows(
  db: Database | Transaction,
  ids: readonly string[],
): Promise<Set<string>> {
  const rows = await db
    .select({ id: nodes.id })
    .from(nodes)
    .where(inArray(nodes.id, [...ids]));
  return new Set(rows.map((r) => r.id));
}

export interface ServerListing {
  readonly term: number | null;
  readonly nodes: readonly {
    readonly nodeId: string;
    readonly contactUrl: string;
    readonly standing: NodeStanding;
    readonly isSelf: boolean;
    readonly removable: boolean;
    readonly canClear: boolean;
    readonly requiresRetirementConfirmation: boolean;
  }[];
}

export async function listServers(db: Database, selfNodeId: string): Promise<ServerListing> {
  const held = await readNodeMembership(db);
  if (held === null) return { term: null, nodes: [] };
  const withRows = await nodeIdsWithRows(
    db,
    held.body.nodes.map((n) => n.nodeId),
  );
  return {
    term: held.body.term,
    nodes: held.body.nodes.map((n) => ({
      nodeId: n.nodeId,
      contactUrl: n.contactUrl,
      standing: n.standing,
      isSelf: n.nodeId === selfNodeId,
      removable:
        judgeRemoval(held, selfNodeId, n.nodeId, withRows.has(n.nodeId), true).kind === "removable",
      canClear: judgeClearance(held, selfNodeId, n.nodeId).kind === "clearable",
      requiresRetirementConfirmation:
        n.standing === "serving-secondary" && withRows.has(n.nodeId) && n.nodeId !== selfNodeId,
    })),
  };
}

export interface RemovalDeps {
  readonly db: Database;
  readonly node: NodeDatabase;
  readonly ring: KeyRing;
  /** This node: the chart's signer, and the one that must be its serving primary. */
  readonly nodeId: string;
  readonly log: Logger;
}

export interface RemovalResult {
  /** False when the node was already evicted and nothing was written. */
  readonly removed: boolean;
  readonly term: number;
}

/**
 * One round's decision, from the chart it read: nothing to write, or the next chart's machines and
 * revoked list plus what to write beside it in the chart's own transaction.
 */
type ChartRound<T> =
  | { readonly write: false; readonly result: T }
  | {
      readonly write: true;
      readonly nodes: readonly MembershipNode[];
      readonly revoked?: readonly string[];
      /** Runs after the chart is written, in its transaction; a throw rolls both back. */
      readonly record: (tx: Transaction, term: number) => Promise<void>;
      readonly committed: (term: number) => T;
    };

/**
 * Reads the held chart, asks `decide` what to do, mints the next chart this node signs and writes
 * it term-guarded with `record` in one transaction. A lost guard means another chart landed first:
 * re-read and decide again, never force.
 */
async function writeChartInRounds<T>(
  deps: RemovalDeps,
  decide: (held: SignedMembershipDocument | null) => Promise<ChartRound<T>>,
): Promise<T> {
  for (let round = 1; round <= MAX_CHART_WRITE_ROUNDS; round += 1) {
    const held = await readNodeMembership(deps.db);
    const next = await decide(held);
    if (!next.write) return next.result;

    const document = await mintNextMembershipDocument(
      { db: deps.db, node: deps.node, ring: deps.ring },
      {
        heldDocument: held,
        nodes: next.nodes,
        signerNodeId: deps.nodeId,
        // Unchecked: removal and clearing are the stated exception on `readNodeMembership`.
        verifyHeld: "none",
        revoked: next.revoked,
      },
    );
    const term = document.body.term;
    const committed = await withTransaction(deps.db, async (tx) => {
      if (!(await persistNodeMembershipIfNewerTx(tx, document))) return false;
      await next.record(tx, term);
      return true;
    });
    if (committed) return next.committed(term);
  }
  throw new AppError("membership.write_contended", { attempts: MAX_CHART_WRITE_ROUNDS });
}

/**
 * Marks a standby `evicted` in a new chart this node signs, records the removal in the same
 * transaction, then deletes this box's pair link if it names the standby. node.db's lock is held
 * from before the chart is read, through the handover check and the chart commit, to the link
 * delete; venue.db commits first, so a run stopped between the two deletes the link when it is run
 * again. Every refusal throws before anything commits.
 */
export async function removeStandby(
  deps: RemovalDeps,
  args: {
    readonly targetNodeId: string;
    readonly personId: string;
    /** Both retirement declarations were made; required for a standby that finished joining. */
    readonly declared?: boolean;
  },
): Promise<RemovalResult> {
  const declared = args.declared === true;
  return withNodeTransaction(deps.node, async (nodeTx) => {
    const result = await writeRemoval(deps, nodeTx, args, declared);
    await unlinkTx(nodeTx, deps, args.targetNodeId);
    return result;
  });
}

function writeRemoval(
  deps: RemovalDeps,
  nodeTx: NodeTransaction,
  args: { readonly targetNodeId: string; readonly personId: string },
  declared: boolean,
): Promise<RemovalResult> {
  return writeChartInRounds<RemovalResult>(deps, async (held) => {
    const withRows = await nodeIdsWithRows(deps.db, [args.targetNodeId]);
    const verdict = judgeRemoval(
      held,
      deps.nodeId,
      args.targetNodeId,
      withRows.has(args.targetNodeId),
      declared,
    );
    if (verdict.kind === "refused") throw new AppError(verdict.code, {});
    // `held` is non-null past `judgeRemoval`: a null chart is refused as not found.
    if (verdict.kind === "already_removed") {
      return { write: false, result: { removed: false, term: held!.body.term } };
    }
    const open = await readOpenHandoverOperation(nodeTx, deps.nodeId);
    if (
      open !== null &&
      (open.sourceNodeId === args.targetNodeId || open.destinationNodeId === args.targetNodeId)
    ) {
      throw new AppError("handover.operation_in_progress", { operationId: open.operationId });
    }
    return {
      write: true,
      nodes: evictNode(held!.body.nodes, args.targetNodeId),
      record: async (tx, term) => {
        // Checked again under the write lock: the check above ran outside this transaction.
        if (!declared && (await nodeIdsWithRows(tx, [args.targetNodeId])).has(args.targetNodeId)) {
          throw new AppError("membership.standby_joined", {});
        }
        await recordActivity(tx, {
          kind: "membership.node_removed",
          subjectId: args.targetNodeId,
          personId: args.personId,
          data: { contactUrl: verdict.node.contactUrl, term },
        });
      },
      committed: (term) => {
        deps.log("info", "membership.node_removed", {
          nodeId: args.targetNodeId,
          term,
          personId: args.personId,
        });
        return { removed: true, term };
      },
    };
  });
}

/** Deletes this box's pair link when it names `targetNodeId`; an active link is left alone. */
async function unlinkTx(
  tx: NodeTransaction,
  deps: { readonly nodeId: string; readonly log: Logger },
  targetNodeId: string,
): Promise<void> {
  if ((await readPairLink(tx, deps.nodeId))?.peerNodeId !== targetNodeId) return;
  await deletePairLinkTx(tx, deps.nodeId);
  deps.log("info", "membership.pair_link_deleted", { nodeId: targetNodeId });
}

/** Reloads the stream after a Remove or Clear answer; a failure is logged, never answered. */
export async function reloadAfterRemoval(
  deps: { readonly log: Logger; readonly reloadStream: () => Promise<void> },
  targetNodeId: string,
): Promise<void> {
  try {
    await deps.reloadStream();
  } catch (error) {
    deps.log("warn", "membership.stream_reload_failed", {
      nodeId: targetNodeId,
      errorCode: codeOf(error),
    });
  }
}

export interface ClearanceResult {
  /** False when the machine was already cleared and nothing was written. */
  readonly cleared: boolean;
  readonly term: number;
}

/**
 * Moves a removed (`evicted`) machine from the chart's `nodes` to its `revoked` list in a new chart
 * this node signs, freeing its place, and records the clearance in the same transaction, then
 * deletes this box's pair link if it names the machine, under node.db's lock as `removeStandby`
 * does. A full revoked list is refused by the mint (`membership.cleared_list_full`) before anything
 * commits.
 */
export async function clearRemovedMachine(
  deps: RemovalDeps,
  args: { readonly targetNodeId: string; readonly personId: string },
): Promise<ClearanceResult> {
  return withNodeTransaction(deps.node, async (nodeTx) => {
    const result = await writeClearance(deps, args);
    await unlinkTx(nodeTx, deps, args.targetNodeId);
    return result;
  });
}

function writeClearance(
  deps: RemovalDeps,
  args: { readonly targetNodeId: string; readonly personId: string },
): Promise<ClearanceResult> {
  return writeChartInRounds<ClearanceResult>(deps, async (held) => {
    const verdict = judgeClearance(held, deps.nodeId, args.targetNodeId);
    if (verdict.kind === "refused") throw new AppError(verdict.code, {});
    // `held` is non-null past `judgeClearance`: a null chart is refused as not found.
    if (verdict.kind === "already_cleared") {
      return { write: false, result: { cleared: false, term: held!.body.term } };
    }
    return {
      write: true,
      nodes: held!.body.nodes.filter((n) => n.nodeId !== args.targetNodeId),
      revoked: [...(held!.body.revoked ?? []), args.targetNodeId],
      record: async (tx, term) => {
        await recordActivity(tx, {
          kind: "membership.node_cleared",
          subjectId: args.targetNodeId,
          personId: args.personId,
          data: { term },
        });
      },
      committed: (term) => {
        deps.log("info", "membership.node_cleared", {
          nodeId: args.targetNodeId,
          term,
          personId: args.personId,
        });
        return { cleared: true, term };
      },
    };
  });
}

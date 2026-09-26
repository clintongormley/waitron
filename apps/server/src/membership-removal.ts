import "./errors.js";
import { inArray } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import {
  membershipClearances,
  membershipRemovals,
  nodes,
  persistNodeMembershipIfNewerTx,
  readNodeMembership,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import {
  evictNode,
  servingPrimaryNodeId,
  type MembershipNode,
  type NodeStanding,
  type SignedMembershipDocument,
} from "@waitron/membership";
import type { KeyRing } from "@waitron/credentials";
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
 * `serving-secondary` and this database holds no `nodes` row with its id — a standby that never
 * finished joining.
 *
 * The rule's gap: a remote standby that DID finish writes its `nodes` row in its OWN database
 * (`insertReservedNodeTx`, via `establishReservedStandbyIdentity`, which only that machine's own
 * boot runs: `runFinishAdoption`), not in this one, and today no adopt can finish at all
 * (`PendingAdoption` in `finish-adoption.ts`). So every remote `serving-secondary` reads as
 * never-finished here. Removing one marks it `evicted` in this node's chart, so tills stop routing
 * to it; the removed machine acts on that only if it reads this chart.
 */
export function judgeRemoval(
  held: SignedMembershipDocument | null,
  selfNodeId: string,
  targetNodeId: string,
  targetHasNodeRow: boolean,
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
      return targetHasNodeRow
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
        judgeRemoval(held, selfNodeId, n.nodeId, withRows.has(n.nodeId)).kind === "removable",
      canClear: judgeClearance(held, selfNodeId, n.nodeId).kind === "clearable",
    })),
  };
}

export interface RemovalDeps {
  readonly db: Database;
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
      { db: deps.db, ring: deps.ring },
      {
        heldDocument: held,
        nodes: next.nodes,
        signerNodeId: deps.nodeId,
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
 * Marks a never-joined standby `evicted` in a new chart this node signs, and records the removal in
 * the same transaction. Every refusal throws before anything commits.
 */
export async function removeUnjoinedStandby(
  deps: RemovalDeps,
  args: { readonly targetNodeId: string; readonly personId: string },
): Promise<RemovalResult> {
  return writeChartInRounds<RemovalResult>(deps, async (held) => {
    const withRows = await nodeIdsWithRows(deps.db, [args.targetNodeId]);
    const verdict = judgeRemoval(
      held,
      deps.nodeId,
      args.targetNodeId,
      withRows.has(args.targetNodeId),
    );
    if (verdict.kind === "refused") throw new AppError(verdict.code, {});
    // `held` is non-null past `judgeRemoval`: a null chart is refused as not found.
    if (verdict.kind === "already_removed") {
      return { write: false, result: { removed: false, term: held!.body.term } };
    }
    return {
      write: true,
      nodes: evictNode(held!.body.nodes, args.targetNodeId),
      record: async (tx, term) => {
        // Checked again under the write lock: the check above ran outside this transaction.
        if ((await nodeIdsWithRows(tx, [args.targetNodeId])).has(args.targetNodeId)) {
          throw new AppError("membership.standby_joined", {});
        }
        await tx.insert(membershipRemovals).values({
          removedNodeId: args.targetNodeId,
          contactUrl: verdict.node.contactUrl,
          personId: args.personId,
          term,
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

export interface ClearanceResult {
  /** False when the machine was already cleared and nothing was written. */
  readonly cleared: boolean;
  readonly term: number;
}

/**
 * Moves a removed (`evicted`) machine from the chart's `nodes` to its `revoked` list in a new chart
 * this node signs, freeing its place, and records the clearance in the same transaction. A full
 * revoked list is refused by the mint (`membership.chart_too_large`) before anything commits.
 */
export async function clearRemovedMachine(
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
        await tx.insert(membershipClearances).values({
          clearedNodeId: args.targetNodeId,
          personId: args.personId,
          term,
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

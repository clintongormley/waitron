import "./errors.js";
import { inArray } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import {
  membershipRemovals,
  nodes,
  persistNodeMembershipIfNewerTx,
  readNodeMembership,
  withTransaction,
  type Database,
} from "@waitron/db";
import {
  evictNode,
  servingPrimaryNodeId,
  type MembershipNode,
  type NodeStanding,
  type SignedMembershipDocument,
} from "@waitron/membership";
import type { KeyRing } from "@waitron/credentials";
import { mintNextMembershipDocument } from "./membership-mint.js";
import type { Logger } from "./logger.js";

type RemovalRefusal =
  | "membership.node_not_found"
  | "membership.not_primary"
  | "membership.node_is_primary"
  | "membership.node_has_served"
  | "membership.standby_joined";

export type RemovalVerdict =
  | { readonly kind: "removable"; readonly node: MembershipNode }
  | { readonly kind: "already_removed" }
  | { readonly kind: "refused"; readonly code: RemovalRefusal };

/**
 * Whether the serving primary may remove `targetNodeId` from its chart. The rule: the target is
 * `serving-secondary` and this database holds no `nodes` row with its id — a standby that never
 * finished joining.
 *
 * The rule's gap: a remote standby that DID finish writes its `nodes` row in its OWN database
 * (`insertReservedNodeTx`, via `establishReservedStandbyIdentity`, which only that machine's own
 * boot runs: `runFinishAdoption`), not in this one, and today no adopt can finish at all
 * (`PendingAdoption` in `finish-adoption.ts`). So every remote `serving-secondary` reads as
 * never-finished here. Removing a machine that did join, or served, would take a working failover
 * target out of the list tills reroute by, and fence it.
 */
export function judgeRemoval(
  held: SignedMembershipDocument | null,
  selfNodeId: string,
  targetNodeId: string,
  targetHasNodeRow: boolean,
): RemovalVerdict {
  const target = held?.body.nodes.find((n) => n.nodeId === targetNodeId);
  if (held === null || target === undefined) return refused("membership.node_not_found");
  if (servingPrimaryNodeId(held) !== selfNodeId) return refused("membership.not_primary");
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

function refused(code: RemovalRefusal): RemovalVerdict {
  return { kind: "refused", code };
}

async function nodeIdsWithRows(db: Database, ids: readonly string[]): Promise<Set<string>> {
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

// A round is lost only to a writer that committed a newer term.
const MAX_CHART_WRITE_ROUNDS = 8;

/**
 * Marks a never-joined standby `evicted` in a new chart this node signs, and records the removal in
 * the same transaction. Every refusal throws before anything is written.
 */
export async function removeUnjoinedStandby(
  deps: RemovalDeps,
  args: { readonly targetNodeId: string; readonly personId: string },
): Promise<RemovalResult> {
  for (let round = 1; round <= MAX_CHART_WRITE_ROUNDS; round += 1) {
    const held = await readNodeMembership(deps.db);
    const withRows = await nodeIdsWithRows(deps.db, [args.targetNodeId]);
    const verdict = judgeRemoval(
      held,
      deps.nodeId,
      args.targetNodeId,
      withRows.has(args.targetNodeId),
    );
    if (verdict.kind === "refused") throw new AppError(verdict.code, {});
    // `held` is non-null past `judgeRemoval`: a null chart is refused as not found.
    if (verdict.kind === "already_removed") return { removed: false, term: held!.body.term };

    const document = await mintNextMembershipDocument(
      { db: deps.db, ring: deps.ring },
      {
        heldDocument: held,
        nodes: evictNode(held!.body.nodes, args.targetNodeId),
        signerNodeId: deps.nodeId,
      },
    );
    const term = document.body.term;
    const committed = await withTransaction(deps.db, async (tx) => {
      if (!(await persistNodeMembershipIfNewerTx(tx, document))) return false;
      await tx.insert(membershipRemovals).values({
        nodeId: args.targetNodeId,
        contactUrl: verdict.node.contactUrl,
        personId: args.personId,
        term,
      });
      return true;
    });
    if (committed) {
      deps.log("info", "membership.node_removed", {
        nodeId: args.targetNodeId,
        term,
        personId: args.personId,
      });
      return { removed: true, term };
    }
  }
  throw new AppError("membership.write_contended", { attempts: MAX_CHART_WRITE_ROUNDS });
}

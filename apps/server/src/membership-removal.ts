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
import { readOpenHandoverOperation, readPairLink, readPinnedPrimaryKey } from "@waitron/node-db";
import { MAX_CHART_WRITE_ROUNDS, mintNextMembershipDocument } from "./membership-mint.js";
import type { Logger } from "./logger.js";
import { openFacts, refuseReturnOutstanding } from "./return-abandoned.js";
import {
  activationsBySource,
  holdsCompletedReturnFrom,
  returnsCompletedAt,
} from "./return-completion.js";
import type { BackupStatus } from "./backup-status.js";
import { readResetOrders, resetRefusal } from "./reset-order.js";

type ChartRefusal =
  | "membership.node_not_found"
  | "membership.not_primary"
  | "membership.node_is_primary"
  | "handover.return_outstanding"
  | "handover.operation_in_progress"
  | "membership.reset_statement_required"
  | "membership.standby_joined"
  | "membership.node_not_removed";

export type RemovalVerdict =
  | { readonly kind: "removable"; readonly node: MembershipNode }
  | { readonly kind: "already_removed" }
  | Refused;

export type ClearanceVerdict =
  { readonly kind: "clearable" } | { readonly kind: "already_cleared" } | Refused;

/** What removing a box depends on beyond the chart. */
export interface RemovalFacts {
  /** An open takeover here still waits for this box to return its invoice records. */
  readonly returnOutstanding: boolean;
  /** This box's open handover operation names this box, as its source or its destination. */
  readonly inOpenOperation: boolean;
  /** This venue holds a completed return from this box. */
  readonly returnCompleted: boolean;
  /** The person stated that the box has been reset or will never be switched on again. */
  readonly resetStatement: boolean;
}

/**
 * Whether the serving primary may remove `targetNodeId` from its chart. The rule: no return from it
 * is outstanding here and no open handover here names it; a `serving-secondary` that finished joining (it has a `nodes` row) only once
 * `declared`; a former main box (`sell-only`) once its return is complete here or the person states
 * it is reset or will never be switched on again, because a former main box switched on again with
 * its data could sell beside this one.
 */
export function judgeRemoval(
  held: SignedMembershipDocument | null,
  selfNodeId: string,
  targetNodeId: string,
  targetHasNodeRow: boolean,
  declared: boolean,
  facts: RemovalFacts,
): RemovalVerdict {
  const found = locate(held, selfNodeId, targetNodeId);
  if (found.kind === "refused") return found;
  if (found.kind === "cleared") return { kind: "already_removed" };
  const target = found.node;
  if (target.standing === "evicted") return { kind: "already_removed" };
  if (target.standing === "serving-primary") return refused("membership.node_is_primary");
  if (facts.returnOutstanding) return refused("handover.return_outstanding");
  if (target.standing === "sell-only" && !facts.returnCompleted && !facts.resetStatement) {
    return refused("membership.reset_statement_required");
  }
  if (target.standing === "serving-secondary" && targetHasNodeRow && !declared) {
    return refused("membership.standby_joined");
  }
  if (facts.inOpenOperation) return refused("handover.operation_in_progress");
  return { kind: "removable", node: target };
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
    readonly returnOutstanding: boolean;
    /** A former main box whose removal needs the reset statement: no return from it is held. */
    readonly needsResetStatement: boolean;
    /** This box has ordered the box to reset. */
    readonly reset: null | "ordered";
    /**
     * This box would accept Wipe and remove for the box, the order that does not accept the
     * loss: an order already stands, or this venue holds the box's completed return.
     */
    readonly canReset: boolean;
    /** The scenario of the takeover from the box: the one whose return completed, else the latest. */
    readonly returnScenario: "controlled" | "emergency" | null;
    /** For a box this venue holds a completed return from, whether the records it returned are on a backup. */
    readonly recoveredRecordsBackup: RecoveredRecordsBackup | null;
  }[];
}

/**
 * `backed-up`: a destination's last backup started after this box recorded the latest return from
 * the box complete, so its copy holds the returned records.
 * `no-backups`: backups are not set up, or their settings could not be used.
 * `awaiting-backup` otherwise, including when either time is unknown here or the status could
 * not be read.
 */
export type RecoveredRecordsBackup = "backed-up" | "awaiting-backup" | "no-backups";

function recoveredRecordsBackup(
  completedAt: Date | null | undefined,
  backup: BackupStatus | null,
): RecoveredRecordsBackup {
  if (backup?.configured === false) return "no-backups";
  if (completedAt == null || backup === null) return "awaiting-backup";
  const after = backup.destinations.some(
    (d) =>
      d.lastBackupStartedAt !== null && Date.parse(d.lastBackupStartedAt) > completedAt.getTime(),
  );
  return after ? "backed-up" : "awaiting-backup";
}

export async function listServers(
  db: Database,
  node: NodeDatabase,
  selfNodeId: string,
  readBackup?: () => Promise<BackupStatus>,
): Promise<ServerListing> {
  const held = await readNodeMembership(db);
  if (held === null) return { term: null, nodes: [] };
  const withRows = await nodeIdsWithRows(
    db,
    held.body.nodes.map((n) => n.nodeId),
  );
  const open = await readOpenHandoverOperation(node, selfNodeId);
  const activations = await activationsBySource(db);
  const orders = await readResetOrders(node, selfNodeId);
  const pinned = (await readPinnedPrimaryKey(node, selfNodeId))?.primaryNodeId ?? null;
  const completedAt = await returnsCompletedAt(db, node, selfNodeId);
  // Read only when a listed box has a completed return; an unreadable status counts as unknown.
  let backup: BackupStatus | null = null;
  if (
    readBackup !== undefined &&
    held.body.nodes.some((n) => activations.get(n.nodeId)?.returnCompleted === true)
  ) {
    try {
      backup = await readBackup();
    } catch {
      backup = null;
    }
  }
  return {
    term: held.body.term,
    nodes: held.body.nodes.map((n) => {
      const activation = activations.get(n.nodeId);
      const order = orders.get(n.nodeId) ?? null;
      const facts = {
        ...openFacts(open, n.nodeId),
        returnCompleted: activation?.returnCompleted === true,
      };
      const judge = (resetStatement: boolean) =>
        judgeRemoval(held, selfNodeId, n.nodeId, withRows.has(n.nodeId), true, {
          ...facts,
          resetStatement,
        });
      return {
        nodeId: n.nodeId,
        contactUrl: n.contactUrl,
        standing: n.standing,
        isSelf: n.nodeId === selfNodeId,
        removable: judge(true).kind === "removable",
        canClear: judgeClearance(held, selfNodeId, n.nodeId).kind === "clearable",
        requiresRetirementConfirmation:
          n.standing === "serving-secondary" && withRows.has(n.nodeId) && n.nodeId !== selfNodeId,
        returnOutstanding: facts.returnOutstanding,
        needsResetStatement: refusalOf(judge(false)) === "membership.reset_statement_required",
        reset: order === null ? null : "ordered",
        // orderReset's test without the loss: a standing order is answered as it stands, else
        // holdsCompletedReturnFrom, which reads this same activationsBySource field.
        canReset:
          resetRefusal(held, selfNodeId, n.nodeId, open, pinned) === null &&
          (order !== null || facts.returnCompleted),
        returnScenario: activation?.scenario ?? null,
        recoveredRecordsBackup: facts.returnCompleted
          ? recoveredRecordsBackup(completedAt.get(n.nodeId), backup)
          : null,
      };
    }),
  };
}

function refusalOf(verdict: RemovalVerdict): ChartRefusal | null {
  return verdict.kind === "refused" ? verdict.code : null;
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
 * again.
 */
export async function removeStandby(
  deps: RemovalDeps,
  args: {
    readonly targetNodeId: string;
    readonly personId: string;
    /** Both retirement declarations were made; required for a standby that finished joining. */
    readonly declared?: boolean;
    /** The person stated the box is reset or will never be switched on again. */
    readonly resetStatement?: boolean;
    /** Also clear the box from the list in the same chart, as Clear from list does. */
    readonly clear?: boolean;
  },
): Promise<RemovalResult> {
  const declared = args.declared === true;
  return withNodeTransaction(deps.node, async (nodeTx) => {
    const result = await writeRemoval(
      deps,
      nodeTx,
      args,
      declared,
      args.resetStatement === true,
      args.clear === true,
    );
    await unlinkTx(nodeTx, deps, args.targetNodeId);
    return result;
  });
}

function writeRemoval(
  deps: RemovalDeps,
  nodeTx: NodeTransaction,
  args: { readonly targetNodeId: string; readonly personId: string },
  declared: boolean,
  resetStatement: boolean,
  clear: boolean,
): Promise<RemovalResult> {
  return writeChartInRounds<RemovalResult>(deps, async (held) => {
    const withRows = await nodeIdsWithRows(deps.db, [args.targetNodeId]);
    const open = await readOpenHandoverOperation(nodeTx, deps.nodeId);
    const verdict = judgeRemoval(
      held,
      deps.nodeId,
      args.targetNodeId,
      withRows.has(args.targetNodeId),
      declared,
      {
        ...openFacts(open, args.targetNodeId),
        returnCompleted: await holdsCompletedReturnFrom(deps.db, args.targetNodeId),
        resetStatement,
      },
    );
    if (verdict.kind === "refused") {
      if (verdict.code === "handover.return_outstanding") refuseReturnOutstanding(open!);
      if (verdict.code === "handover.operation_in_progress") {
        throw new AppError(verdict.code, { operationId: open!.operationId });
      }
      throw new AppError(verdict.code, {});
    }
    // `held` is non-null past `judgeRemoval`: a null chart is refused as not found.
    if (verdict.kind === "already_removed") {
      return { write: false, result: { removed: false, term: held!.body.term } };
    }
    return {
      write: true,
      ...(clear
        ? {
            nodes: held!.body.nodes.filter((n) => n.nodeId !== args.targetNodeId),
            revoked: [...(held!.body.revoked ?? []), args.targetNodeId],
          }
        : { nodes: evictNode(held!.body.nodes, args.targetNodeId) }),
      record: async (tx, term) => {
        // Checked again under the write lock: the check above ran outside this transaction.
        if (
          verdict.node.standing === "serving-secondary" &&
          !declared &&
          (await nodeIdsWithRows(tx, [args.targetNodeId])).has(args.targetNodeId)
        ) {
          throw new AppError("membership.standby_joined", {});
        }
        await recordActivity(tx, {
          kind: "membership.node_removed",
          subjectId: args.targetNodeId,
          personId: args.personId,
          data: { contactUrl: verdict.node.contactUrl, term },
        });
        if (clear) {
          await recordActivity(tx, {
            kind: "membership.node_cleared",
            subjectId: args.targetNodeId,
            personId: args.personId,
            data: { term },
          });
        }
      },
      committed: (term) => {
        const fields = { nodeId: args.targetNodeId, term, personId: args.personId };
        deps.log("info", "membership.node_removed", fields);
        if (clear) deps.log("info", "membership.node_cleared", fields);
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

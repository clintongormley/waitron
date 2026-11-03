import { and, eq, inArray } from "drizzle-orm";
import type { KeyRing } from "@waitron/credentials";
import {
  nodes,
  persistNodeMembershipIfNewer,
  readMembershipTrustSet,
  readNodeMembership,
  withNodeTransaction,
  type Database,
  type NodeDatabase,
} from "@waitron/db";
import { servingPrimaryNodeId, type SignedMembershipDocument } from "@waitron/membership";
import {
  nodeHandoverOperations,
  readHandoverRestriction,
  readOpenHandoverOperation,
  recordHandoverRestrictionTx,
} from "@waitron/node-db";
import {
  askPeerStatus,
  checkPeersAtStart,
  persistingAccept,
  type PeerAnswer,
  type StartCheckResult,
} from "./boot-peer-check.js";
import { peerKeyOf, signAsThisBox } from "./handover-signing.js";
import { advanceHandover } from "./handover-store.js";
import type { Logger } from "./logger.js";

const START_CHECK_TIMEOUT_MS = 5000;

/** A destination that reached `activated`: this state or one only reachable after it. */
const ACTIVATED_OR_LATER = [
  "activated",
  "return_pending",
  "return_complete",
  "return_abandoned",
] as const;

interface NodeDeps {
  node: NodeDatabase;
  nodeId: string;
}

/**
 * Filled by Task 5.8b once `handover_activations` exists: a destination operation left at
 * `filing_assumed` or `emergency_declared` on a box that is no longer a mirror is recorded
 * `activated`. Runs before `readActivatedFrom`, so that operation's source is in the set.
 */
export const finishInterruptedActivation: (deps: NodeDeps) => Promise<void> = () =>
  Promise.resolve();

/**
 * The repairs a non-mirror box makes before it asks its peers. A source operation still at
 * `prepared` never stepped down (the stepdown writes the next state and the restriction in one
 * node transaction, `handover-stepdown.ts` `writeRestriction`, and a restriction sends the start to
 * the restricted start before this), so no copy of it can have been accepted: it closes as
 * `abandoned`.
 */
export async function repairAtStart(deps: NodeDeps): Promise<void> {
  const open = await readOpenHandoverOperation(deps.node, deps.nodeId);
  if (open !== null && open.role === "source" && open.state === "prepared")
    await advanceHandover(deps, open.operationId, "abandoned", {
      reason: "restarted_before_stepdown",
    });
  await finishInterruptedActivation(deps);
}

/** The source of every operation this box activated as destination, open or closed. */
export async function readActivatedFrom(
  node: NodeDatabase,
  nodeId: string,
): Promise<ReadonlySet<string>> {
  const rows = await node
    .select({ sourceNodeId: nodeHandoverOperations.sourceNodeId })
    .from(nodeHandoverOperations)
    .where(
      and(
        eq(nodeHandoverOperations.nodeId, nodeId),
        eq(nodeHandoverOperations.role, "destination"),
        inArray(nodeHandoverOperations.state, [...ACTIVATED_OR_LATER]),
      ),
    );
  return new Set(rows.map((r) => r.sourceNodeId));
}

async function joined(db: Database, nodeId: string): Promise<boolean> {
  const rows = await db.select({ id: nodes.id }).from(nodes).where(eq(nodes.id, nodeId));
  return rows.length > 0;
}

/**
 * Whom a superseded box names: the serving primary of the chart it now holds, unless that is this
 * box (a peer's takeover can arrive before its chart), then the first peer whose own operation
 * stopped this box. `null` takes Ruling R7's path: no restriction, and the held chart decides.
 */
export function successorAfterCheck(
  held: SignedMembershipDocument | null,
  nodeId: string,
  answers: readonly PeerAnswer[],
): string | null {
  const primary = held === null ? undefined : servingPrimaryNodeId(held);
  if (primary !== undefined && primary !== nodeId) return primary;
  return answers.find((a) => a.answer === "F" && a.byOperation)?.nodeId ?? null;
}

export interface StartPeerCheckDeps {
  db: Database;
  node: NodeDatabase;
  ring: KeyRing;
  nodeId: string;
  /** Used for this box's own address only when the held chart has no entry for it. */
  advertisedOrigin: string;
  log: Logger;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export interface StartPeerCheckOutcome {
  result: StartCheckResult;
  /** For `superseded`, the box the restriction names, or `null` (see `successorAfterCheck`). */
  successorNodeId: string | null;
}

/** The start check on a non-mirror box, with the real transport, trust and stores. */
export async function runStartPeerCheck(deps: StartPeerCheckDeps): Promise<StartPeerCheckOutcome> {
  const { db, node, ring, nodeId } = deps;
  const timeoutMs = deps.timeoutMs ?? START_CHECK_TIMEOUT_MS;
  const [held, trustSet, activatedFrom, open] = await Promise.all([
    readNodeMembership(db),
    readMembershipTrustSet(db),
    readActivatedFrom(node, nodeId),
    readOpenHandoverOperation(node, nodeId),
  ]);
  const ownEntry = held?.body.nodes.find((n) => n.nodeId === nodeId);
  let answers: readonly PeerAnswer[] = [];
  let keyOf: Promise<(id: string) => string | undefined> | undefined;
  const result = await checkPeersAtStart({
    held,
    nodeId,
    ownOrigin: ownEntry?.contactUrl ?? deps.advertisedOrigin,
    joined: (id) => joined(db, id),
    activatedFrom,
    ask: async (peer) => {
      // Read only when a peer is asked: a box whose chart lists no other box needs no key.
      keyOf ??= peerKeyOf({ db, node, ring, nodeId });
      return askPeerStatus({
        sign: (body) => signAsThisBox({ node, ring, nodeId }, "query", body),
        publicKeyOf: await keyOf,
        ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
        timeoutMs,
      })(peer);
    },
    accept: persistingAccept({
      held,
      trustSet,
      persist: (doc) => persistNodeMembershipIfNewer(db, doc),
    }),
    openOperation: open !== null && open.role === "source",
    timeoutMs,
    onAnswers: (a) => (answers = a),
  });
  deps.log("info", "handover.start_check", {
    result,
    peers: answers.map(({ nodeId: id, answer, counted }) => ({ nodeId: id, answer, counted })),
  });
  return {
    result,
    successorNodeId:
      result === "superseded"
        ? successorAfterCheck(await readNodeMembership(db), nodeId, answers)
        : null,
  };
}

/** Writes nothing when a restriction is already recorded: nothing may rewrite one. */
export async function recordSupersededAtStart(
  deps: NodeDeps,
  successorNodeId: string,
  membershipTerm: number,
): Promise<void> {
  await withNodeTransaction(deps.node, async (tx) => {
    if ((await readHandoverRestriction(tx, deps.nodeId)) !== null) return;
    await recordHandoverRestrictionTx(tx, {
      nodeId: deps.nodeId,
      operationId: null,
      kind: "superseded",
      successorNodeId,
      membershipTerm,
    });
  });
}

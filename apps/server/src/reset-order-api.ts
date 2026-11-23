import "./errors.js";
import type { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import {
  liveBackupQuery,
  readNodeMembership,
  recordActivity,
  withNodeTransaction,
  withTransaction,
} from "@waitron/db";
import { verifyEnvelope } from "@waitron/handover";
import { canonicalize, servingPrimaryNodeId, type CanonicalValue } from "@waitron/membership";
import { appendHandoverEventTx, nodeHandoverEvents, readPinnedPrimaryKey } from "@waitron/node-db";
import { codeOf, createErrorBoundary, readJsonBody } from "@waitron/server-kit";
import { MalformedHoldingsError } from "@waitron/module";
import type { BackupQuery } from "@waitron/store";
import { AppError, isAppError } from "@waitron/shared";
import { peerKeyOf, signAsThisBox } from "./handover-signing.js";
import type { Logger } from "./logger.js";
import { assertHeldDocumentReadable, assertHeldDocumentTrusted } from "./membership-trust.js";
import { reloadAfterRemoval, removeStandby } from "./membership-removal.js";
import { emergencyCopyFrom } from "./handover-intervals.js";
import { readHoldings } from "./old-box-holdings.js";
import { peerBodyLimit } from "./peer-route-limits.js";
import { raiseSetAsideOnReset } from "./reset-alert.js";
import { readResetOrderFor, readResetOrderOperation } from "./reset-order.js";
import { returnDigest, returnVenue, type ReturnRecordsDeps } from "./return-records.js";

/** The old box's acknowledgement: it has saved its reset and set aside `lacking` if `setAside`. */
export interface ResetAcknowledgement {
  readonly orderId: string;
  readonly setAside: boolean;
  /** Per module, the other boxes' chains this box lacked and the old box set aside. */
  readonly lacking: Readonly<Record<string, readonly CanonicalValue[]>>;
}

export interface ResetOrderApiDeps extends ReturnRecordsDeps {
  reloadStream(): Promise<void>;
}

const ACKNOWLEDGED = "reset_acknowledged";

function refuse(reason: string): never {
  throw new AppError("handover.reset_query_refused", { reason });
}

const isRecord = (value: CanonicalValue | undefined): value is Record<string, CanonicalValue> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The acknowledgement, whose `lacking` names only modules with the seat, each chain an object. */
function readAck(
  deps: ResetOrderApiDeps,
  value: CanonicalValue | undefined,
): ResetAcknowledgement | undefined {
  if (value === undefined) return undefined;
  if (
    !isRecord(value) ||
    typeof value.orderId !== "string" ||
    typeof value.setAside !== "boolean" ||
    !isRecord(value.lacking) ||
    !Object.entries(value.lacking).every(
      ([name, chains]) =>
        deps.modules.find((m) => m.name === name)?.handover?.lacking !== undefined &&
        Array.isArray(chains) &&
        chains.every(isRecord),
    )
  )
    refuse("request");
  return value as unknown as ResetAcknowledgement;
}

/** Verifies the old box's signed `reset-query` as the return route verifies a batch. */
async function checkedQuery(deps: ResetOrderApiDeps, raw: unknown) {
  const chart = await readNodeMembership(deps.db);
  await assertHeldDocumentTrusted(deps, chart);
  assertHeldDocumentReadable(chart);
  const verified = verifyEnvelope<CanonicalValue>(raw, "reset-query", await peerKeyOf(deps, chart));
  if (!verified.valid) refuse("signature");
  const { body, signerNodeId: source } = verified;
  if (!isRecord(body)) refuse("request");
  const pinned = await readPinnedPrimaryKey(deps.node, deps.nodeId);
  const venue = await returnVenue(deps);
  if (
    pinned?.primaryNodeId !== source ||
    body.sourceNodeId !== source ||
    body.destinationNodeId !== deps.nodeId ||
    chart === null ||
    servingPrimaryNodeId(chart) !== deps.nodeId ||
    chart.body.revoked?.includes(source) ||
    venue === null ||
    body.venue === undefined ||
    canonicalize(body.venue) !== canonicalize(venue)
  )
    refuse("binding");
  if (chart.body.nodes.find((n) => n.nodeId === source)?.standing !== "sell-only") {
    refuse("standing");
  }
  if (
    typeof body.nonce !== "string" ||
    body.nonce.length === 0 ||
    body.nonce.length > 64 ||
    !isRecord(body.holdings)
  )
    refuse("request");
  return { nonce: body.nonce, holdings: body.holdings, ack: readAck(deps, body.ack), source };
}

/**
 * Per module that fills the seat, which of `holdings` this box lacks, asked only while an order
 * stands (`ordered`): the seats read every chain's records, on the box that is selling.
 */
async function lackingFor(
  deps: ResetOrderApiDeps,
  query: BackupQuery,
  holdings: Record<string, CanonicalValue>,
  ordered: boolean,
): Promise<Record<string, CanonicalValue[]>> {
  const lacking: Record<string, CanonicalValue[]> = {};
  for (const [name, held] of Object.entries(holdings)) {
    const seat = deps.modules.find((m) => m.name === name)?.handover?.lacking;
    if (seat === undefined) refuse("module");
    if (!ordered) continue;
    try {
      lacking[name] = await seat(query, held);
    } catch (error) {
      if (error instanceof MalformedHoldingsError) refuse("holdings");
      throw error;
    }
  }
  return lacking;
}

/**
 * Records the acknowledgement and removes and clears the box as the person who ordered the reset. Under
 * node.db's lock, an order already acknowledged there writes nothing more; otherwise venue.db
 * commits first, its entry's id and its alert keyed by the order, so a retry after a node.db
 * failure writes no second entry or alert and repairs node.db.
 */
async function acknowledge(
  deps: ResetOrderApiDeps,
  log: Logger,
  source: string,
  ack: ResetAcknowledgement,
  holdings: Record<string, CanonicalValue>,
): Promise<void> {
  const order = await readResetOrderOperation(deps.node, deps.nodeId, source, ack.orderId);
  if (order === undefined) refuse("order");
  const { personId } = order;
  await withNodeTransaction(deps.node, async (nodeTx) => {
    const [acknowledged] = await nodeTx
      .select({ id: nodeHandoverEvents.eventId })
      .from(nodeHandoverEvents)
      .where(
        and(
          eq(nodeHandoverEvents.nodeId, deps.nodeId),
          eq(nodeHandoverEvents.kind, ACKNOWLEDGED),
          sql`json_extract(${nodeHandoverEvents.detail}, '$.orderId') = ${ack.orderId}`,
        ),
      )
      .limit(1);
    if (acknowledged !== undefined) return;
    // This box's own comparison, not the ack's list: that was taken before a loss order's extra
    // return pass. Made under node.db's lock, so it sees what a return committed under it.
    const lacking = ack.setAside
      ? await lackingFor(deps, liveBackupQuery(deps.db), holdings, true)
      : {};
    await withTransaction(deps.db, async (tx) => {
      await recordActivity(tx, {
        id: returnDigest({ kind: "handover.reset_acknowledged", orderId: ack.orderId }),
        kind: "handover.reset_acknowledged",
        subjectId: source,
        personId,
        data: ack,
      });
      if (Object.values(lacking).some((chains) => chains.length > 0))
        await raiseSetAsideOnReset(tx, {
          nodeId: source,
          orderId: ack.orderId,
          at: deps.now?.() ?? new Date(),
        });
    });
    await appendHandoverEventTx(nodeTx, {
      nodeId: deps.nodeId,
      operationId: order.operationId,
      kind: ACKNOWLEDGED,
      detail: { targetNodeId: source, orderId: ack.orderId, setAside: ack.setAside },
      envelope: null,
    });
  });
  const removal = { db: deps.db, node: deps.node, ring: deps.ring, nodeId: deps.nodeId, log };
  const args = { targetNodeId: source, personId, resetStatement: true };
  try {
    try {
      await removeStandby(removal, { ...args, clear: true });
    } catch (error) {
      // A full cleared list leaves the box removed, with a "Removed" row.
      if (!isAppError(error) || error.code !== "membership.cleared_list_full") throw error;
      await removeStandby(removal, args);
    }
  } catch (error) {
    // The row keeps "Wipe asked" and Remove from venue.
    if (!isAppError(error)) throw error;
    log("warn", "reset-order.removal_refused", { nodeId: source, errorCode: error.code });
    return;
  }
  await reloadAfterRemoval({ log, reloadStream: deps.reloadStream }, source);
}

/** This box's summary for the answer; left out when it cannot be read, so an order still goes. */
async function ownHoldings(
  deps: ResetOrderApiDeps,
  log: Logger,
  source: string,
): Promise<{ holdings?: Record<string, CanonicalValue> }> {
  try {
    return { holdings: await readHoldings(deps.db, deps.modules) };
  } catch (error) {
    log("warn", "reset-order.holdings_unread", { nodeId: source, errorCode: codeOf(error) });
    return {};
  }
}

/** The copy's latest change for the answer; left out when it cannot be read, so an order still goes. */
async function copyTime(
  deps: ResetOrderApiDeps,
  log: Logger,
  source: string,
): Promise<{ lastChangeAtMs?: number | null }> {
  try {
    const copy = await emergencyCopyFrom(deps.db, source);
    return copy === null ? {} : { lastChangeAtMs: copy.lastChangeAtMs };
  } catch (error) {
    log("warn", "reset-order.copy_unread", { nodeId: source, errorCode: codeOf(error) });
    return {};
  }
}

/** `POST /api/node/reset-order`: a replaced old main box asks whether it is ordered to reset. */
export function mountResetOrderApi(app: Hono, deps: ResetOrderApiDeps, log: Logger): void {
  const run = createErrorBoundary(
    {
      "handover.reset_query_refused": 409,
      "membership.held_untrusted": 409,
    },
    "reset-order.failed",
  );
  app.use("/api/node/reset-order", peerBodyLimit(262144));
  app.post("/api/node/reset-order", (c) =>
    run(c, log, async () => {
      const raw = await readJsonBody<unknown>(c);
      const { nonce, holdings, ack, source } = await checkedQuery(deps, raw);
      // Read before the acknowledgement, which writes no order and is refused unless one stands.
      const order = await readResetOrderFor(deps.node, deps.nodeId, source);
      const lacking = await lackingFor(deps, liveBackupQuery(deps.db), holdings, order !== null);
      if (ack !== undefined) await acknowledge(deps, log, source, ack, holdings);
      c.header("Cache-Control", "no-store");
      return c.json(
        await signAsThisBox(deps, "reset-order", {
          nonce,
          sourceNodeId: source,
          order: order === null ? null : { orderId: order.orderId, acceptLoss: order.acceptLoss },
          lacking,
          ...(await ownHoldings(deps, log, source)),
          ...(await copyTime(deps, log, source)),
        }),
        200,
      );
    }),
  );
}

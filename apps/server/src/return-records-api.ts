import { peerBodyLimit } from "./peer-route-limits.js";
import { and, desc, eq } from "drizzle-orm";
import { readOpenHandoverOperation } from "@waitron/node-db";
import { BEFORE_ACTIVATION } from "@waitron/handover";
import { recordReturnBatchTx, returnCompletedFor } from "./return-completion.js";
import { advanceHandoverTx } from "./handover-store.js";
import { AppError } from "@waitron/shared";
import type { Hono } from "hono";
import {
  handoverActivations,
  readNodeMembership,
  withNodeTransaction,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { canonicalize, type CanonicalValue } from "@waitron/membership";
import { createErrorBoundary, readJsonBody, type Logger } from "@waitron/server-kit";
import { signAsThisBox } from "./handover-signing.js";
import { returnDigest, type ReturnRecordsDeps } from "./return-records.js";
import {
  acceptedReturnFingerprints,
  checkedReturn,
  mountReturnClashAcceptance,
  refuseReturn,
  retainReturnClashes,
} from "./return-clash-acceptance.js";
import "./errors.js";

export function mountReturnRecordsApi(
  app: Hono,
  deps: ReturnRecordsDeps & {
    requireWritable(): void;
    wake(): void;
  },
  log: Logger,
): void {
  const run = createErrorBoundary(
    {
      "handover.return_refused": 409,
      "membership.held_untrusted": 409,
      "node.read_only": 409,
      "fiscal.return_clock_ahead": 409,
      "fiscal.return_record_clash": 409,
      "attendance.return_entry_clash": 409,
      "attendance.return_entry_invalid": 409,
    },
    "return-records.failed",
  );
  mountReturnClashAcceptance(app, deps, log);
  app.use("/api/node/return-records", peerBodyLimit(524288));
  app.post("/api/node/return-records", (c) =>
    run(c, log, async () => {
      const raw = await readJsonBody<unknown>(c);
      const { body, seat, chart, source } = await checkedReturn(deps, raw);
      const outcome = await withNodeTransaction(deps.node, async (node) => {
        const operation = await readOpenHandoverOperation(node, deps.nodeId);
        const awaitingReturn =
          operation?.state === "activated" || operation?.state === "return_pending";
        const result = await withTransaction(deps.db, async (tx) => {
          deps.requireWritable();
          const held = await readNodeMembership(tx);
          if (
            canonicalize(held as unknown as CanonicalValue) !==
            canonicalize(chart as unknown as CanonicalValue)
          )
            return refuseReturn("membership changed");
          // Another box's records: no clash is asked or kept, and no takeover step moves.
          if (body.part === "others") {
            const now = deps.now?.() ?? new Date();
            const complete = await seat.receive(tx, source, body.payload!, now, [], {
              destinationNodeId: deps.nodeId,
            });
            return typeof complete === "boolean" ? { others: complete } : complete;
          }
          const accepted = await acceptedReturnFingerprints(deps, body, tx);
          const complete = await seat.receive(
            tx,
            source,
            body.payload!,
            deps.now?.() ?? new Date(),
            accepted,
          );
          if (typeof complete !== "boolean") return complete;
          const open =
            operation?.role === "destination" && operation.sourceNodeId === source
              ? operation
              : undefined;
          // With no open takeover from this box, a late return still proves it came back, so it is
          // recorded against this box's latest activation from it; no node.db state moves.
          const takeover = open
            ? await matchingActivation(tx, open.operationId, source, deps.nodeId)
            : await latestActivation(tx, source, deps.nodeId);
          if (takeover !== undefined && complete)
            await recordReturnBatchTx(tx, {
              operationId: takeover,
              inventory: body.inventory as string,
              index: body.index as number,
              count: body.count as number,
              digest: returnDigest({ module: body.module!, payload: body.payload! }),
            });
          return {
            complete,
            takeover,
            open: open !== undefined,
            // Only read while the takeover waits for its return, the one time the answer is used;
            // otherwise the check would read every recorded batch for nothing.
            returned:
              open !== undefined &&
              awaitingReturn &&
              takeover !== undefined &&
              (await returnCompletedFor(tx, takeover)),
            clashes: complete ? [] : ((await seat.inspect?.(tx, source, body.payload!)) ?? []),
          };
        });
        if ("refusal" in result) return result;
        if (result.others !== undefined) return result.others;
        // Venue facts commit first; an unanswered batch is resent if retaining its evidence fails.
        await retainReturnClashes(deps, node, raw, body, result.clashes);
        const state = operation?.state;
        // Venue saved the activation but node.db has not yet: no receipt, so the old box resends
        // once this operation is activated and the replay takes the steps below.
        if (result.open && BEFORE_ACTIVATION.some((step) => step === state))
          return "before activation";
        // A failure here sends no receipt, so the old box resends and the replay takes these steps.
        if (result.open && result.takeover !== undefined && awaitingReturn) {
          await advanceHandoverTx(node, deps.nodeId, result.takeover, "return_pending", {});
          if (result.returned)
            await advanceHandoverTx(node, deps.nodeId, result.takeover, "return_complete", {});
        }
        return result.complete;
      });
      deps.wake();
      // A refusal must not undo facts the venue transaction has already accounted for.
      if (outcome === "before activation") refuseReturn("activating");
      if (typeof outcome !== "boolean") throw new AppError(outcome.refusal, outcome.params ?? {});
      const digest = returnDigest({ module: body.module!, payload: body.payload! });
      c.header("Cache-Control", "no-store");
      return c.json(
        await signAsThisBox(deps, "return-receipt", {
          venue: body.venue!,
          sourceNodeId: body.sourceNodeId!,
          destinationNodeId: deps.nodeId,
          inventory: body.inventory,
          index: body.index,
          nonce: body.nonce,
          ...(body.part === undefined ? {} : { part: body.part }),
          digest,
          accounted: outcome,
        }),
        200,
      );
    }),
  );
}

async function matchingActivation(
  tx: Transaction,
  operationId: string,
  sourceNodeId: string,
  destinationNodeId: string,
): Promise<string | undefined> {
  const [activation] = await tx
    .select({ operationId: handoverActivations.operationId })
    .from(handoverActivations)
    .where(
      and(
        eq(handoverActivations.operationId, operationId),
        eq(handoverActivations.sourceNodeId, sourceNodeId),
        eq(handoverActivations.destinationNodeId, destinationNodeId),
      ),
    );
  return activation?.operationId;
}

async function latestActivation(
  tx: Transaction,
  sourceNodeId: string,
  destinationNodeId: string,
): Promise<string | undefined> {
  const [activation] = await tx
    .select({ operationId: handoverActivations.operationId })
    .from(handoverActivations)
    .where(
      and(
        eq(handoverActivations.sourceNodeId, sourceNodeId),
        eq(handoverActivations.destinationNodeId, destinationNodeId),
      ),
    )
    .orderBy(desc(handoverActivations.activatedAt), desc(handoverActivations.operationId))
    .limit(1);
  return activation?.operationId;
}

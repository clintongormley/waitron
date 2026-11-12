import { AppError } from "@waitron/shared";
import type { Hono } from "hono";
import { readNodeMembership, withNodeTransaction, withTransaction } from "@waitron/db";
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
    },
    "return-records.failed",
  );
  mountReturnClashAcceptance(app, deps, log);
  app.post("/api/node/return-records", (c) =>
    run(c, log, async () => {
      const raw = await readJsonBody<unknown>(c);
      const { body, seat, chart, source } = await checkedReturn(deps, raw);
      const outcome = await withNodeTransaction(deps.node, async (node) => {
        const result = await withTransaction(deps.db, async (tx) => {
          deps.requireWritable();
          const held = await readNodeMembership(tx);
          if (
            canonicalize(held as unknown as CanonicalValue) !==
            canonicalize(chart as unknown as CanonicalValue)
          )
            return refuseReturn("membership changed");
          const accepted = await acceptedReturnFingerprints(deps, body, tx);
          const complete = await seat.receive(
            tx,
            source,
            body.payload!,
            deps.now?.() ?? new Date(),
            accepted,
          );
          if (typeof complete !== "boolean") return complete;
          return {
            complete,
            clashes: complete ? [] : ((await seat.inspect?.(tx, source, body.payload!)) ?? []),
          };
        });
        if ("refusal" in result) return result;
        // Venue facts commit first; an unanswered batch is resent if retaining its evidence fails.
        await retainReturnClashes(deps, node, raw, body, result.clashes);
        return result.complete;
      });
      deps.wake();
      // A refusal must not undo facts the venue transaction has already accounted for.
      if (typeof outcome !== "boolean") throw new AppError(outcome.refusal, {});
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
          digest,
          accounted: outcome,
        }),
        200,
      );
    }),
  );
}

import type { Hono } from "hono";
import { readNodeMembership, withTransaction } from "@waitron/db";
import { verifyEnvelope } from "@waitron/handover";
import { canonicalize, type CanonicalValue } from "@waitron/membership";
import { readPinnedPrimaryKey } from "@waitron/node-db";
import { createErrorBoundary, readJsonBody, type Logger } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { peerKeyOf, signAsThisBox } from "./handover-signing.js";
import { assertHeldDocumentReadable, assertHeldDocumentTrusted } from "./membership-trust.js";
import { returnDigest, returnVenue, type ReturnRecordsDeps } from "./return-records.js";
import "./errors.js";

export function mountReturnRecordsApi(
  app: Hono,
  deps: ReturnRecordsDeps & {
    requireWritable(): void;
    wake(): void;
  },
  log: Logger,
): void {
  const inventories = new Map<
    string,
    { inventory: string; count: number; digests: Map<number, string>; ok: boolean }
  >();
  const run = createErrorBoundary(
    { "handover.return_refused": 409, "membership.held_untrusted": 409, "node.read_only": 409 },
    "return-records.failed",
  );
  const refuse = (reason: string): never => {
    throw new AppError("handover.return_refused", { reason });
  };
  app.post("/api/node/return-records", (c) =>
    run(c, log, async () => {
      const raw = await readJsonBody<unknown>(c);
      const chart = await readNodeMembership(deps.db);
      await assertHeldDocumentTrusted(deps, chart);
      assertHeldDocumentReadable(chart);
      const verified = verifyEnvelope<Record<string, CanonicalValue>>(
        raw,
        "return-batch",
        await peerKeyOf(deps, chart),
      );
      if (!verified.valid) return refuse("signature");
      const body = verified.body;
      const pinned = await readPinnedPrimaryKey(deps.node, deps.nodeId);
      if (
        pinned?.primaryNodeId !== verified.signerNodeId ||
        body.sourceNodeId !== verified.signerNodeId ||
        body.destinationNodeId !== deps.nodeId ||
        chart?.body.nodes.find((row) => row.standing === "serving-primary")?.nodeId !==
          deps.nodeId ||
        !chart.body.nodes.some(
          (row) => row.nodeId === verified.signerNodeId && row.standing !== "evicted",
        ) ||
        chart.body.revoked?.includes(verified.signerNodeId) ||
        canonicalize(body.venue!) !== canonicalize(await returnVenue(deps))
      )
        return refuse("binding");
      if (
        body.payload === undefined ||
        typeof body.inventory !== "string" ||
        !/^[a-f0-9]{64}$/.test(body.inventory) ||
        typeof body.nonce !== "string" ||
        body.nonce.length > 64 ||
        typeof body.index !== "number" ||
        !Number.isSafeInteger(body.index) ||
        body.index < 0 ||
        typeof body.count !== "number" ||
        !Number.isSafeInteger(body.count) ||
        body.count <= body.index ||
        Buffer.byteLength(JSON.stringify(body.payload)) > 256 * 1024
      )
        return refuse("batch");
      const seat = deps.modules.find((module) => module.name === body.module)?.handover
        ?.returnRecords;
      if (!seat || body.payload === undefined) return refuse("module");
      const accounted = await withTransaction(deps.db, async (tx) => {
        deps.requireWritable();
        const held = await readNodeMembership(tx);
        if (
          canonicalize(held as unknown as CanonicalValue) !==
          canonicalize(chart as unknown as CanonicalValue)
        )
          return refuse("membership changed");
        return seat.receive(tx, verified.signerNodeId, body.payload!, deps.now?.() ?? new Date());
      });
      deps.wake();
      if (body.index === 0 || inventories.get(verified.signerNodeId)?.inventory !== body.inventory)
        inventories.set(verified.signerNodeId, {
          inventory: body.inventory,
          count: body.count,
          digests: new Map(),
          ok: true,
        });
      const progress = inventories.get(verified.signerNodeId)!;
      if (progress.count !== body.count) return refuse("inventory");
      const digest = returnDigest({ module: body.module!, payload: body.payload! });
      progress.digests.set(body.index, digest);
      progress.ok &&= accounted;
      const complete =
        progress.ok &&
        progress.digests.size === progress.count &&
        returnDigest(
          [...progress.digests.entries()].sort(([a], [b]) => a - b).map(([, value]) => value),
        ) === body.inventory;
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
          accounted,
          complete,
        }),
        200,
      );
    }),
  );
}

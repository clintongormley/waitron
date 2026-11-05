import { randomUUID } from "node:crypto";
import { mkdir, open, readdir, rename, rm, type FileHandle } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Readable } from "node:stream";
import type { Context, Hono } from "hono";
import { withNodeTransaction, type NodeDatabase, type NodeTransaction } from "@waitron/db";
import {
  envelopeDigest,
  verifyEnvelope,
  type FinalStateIndicator,
  type HandoverBinding,
} from "@waitron/handover";
import type { CanonicalValue } from "@waitron/membership";
import { readHandoverOperation, type HandoverOperation } from "@waitron/node-db";
import { createErrorBoundary, readRawJsonBody } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { errnoOf } from "./errno.js";
import {
  isOperationsBinding,
  offeredAuthoriser,
  type RelinquishmentBody,
} from "./handover-acceptance.js";
import {
  CAPTURE_REFUSAL_STATUS,
  captureFinalCopy,
  digestBytes,
  finalCopyPath,
  readFinalState,
  steppedDownBinding,
  type CaptureDeps,
} from "./handover-capture.js";
import { peerKeyOf, signAsThisBox } from "./handover-signing.js";
import { advanceHandoverTx, findHandoverEnvelope, HANDOVER_EVENT } from "./handover-store.js";
import type { Logger } from "./logger.js";
import { verifiedPeerQuery, type PeerQueryPurpose } from "./peer-status-api.js";
import "./errors.js";

const STATUS = {
  ...CAPTURE_REFUSAL_STATUS,
  "handover.peer_unknown": 403,
  "handover.request_invalid": 400,
  "handover.operation_unknown": 404,
  "handover.final_copy_changed": 409,
  "handover.indicator_mismatch": 409,
  "handover.summary_failed": 500,
} as const;

/**
 * Refuses unless the request's `query` is signed by the destination this box stored for the
 * path's operation, and names that same operation and this route's purpose in its body.
 */
async function authorise(
  c: Context,
  deps: CaptureDeps,
  operationId: string,
  purpose: PeerQueryPurpose,
): Promise<void> {
  const { signerNodeId, query } = await verifiedPeerQuery(c, { ...deps, db: deps.venue });
  // A query without the operation, like the one every start sends, must not unlock the copy.
  if (query.operationId !== operationId) {
    throw new AppError("handover.request_invalid", { field: "operationId" });
  }
  if (query.purpose !== purpose) {
    throw new AppError("handover.request_invalid", { field: "purpose" });
  }
  const operation = await readHandoverOperation(deps.node, deps.nodeId, operationId);
  if (operation === null) throw new AppError("handover.operation_unknown", { operationId });
  if (signerNodeId !== operation.destinationNodeId) {
    throw new AppError("handover.peer_unknown", {});
  }
}

/** The file at `path`, opened, when its bytes are the ones the indicator names. */
async function openIfMatching(
  path: string,
  snapshot: FinalStateIndicator["snapshot"],
): Promise<FileHandle | null> {
  let handle: FileHandle;
  try {
    handle = await open(path, "r");
  } catch (error) {
    if (errnoOf(error) === "ENOENT") return null;
    throw error;
  }
  try {
    const reading = handle.createReadStream({ start: 0, autoClose: false });
    // It stays tied to the handle after this read, so a close failing later reaches it as an
    // error, which would end the process if nothing listened. The read's own failures still throw.
    reading.on("error", () => {});
    const held = await digestBytes(reading);
    if (held.sha256 === snapshot.sha256 && held.bytes === snapshot.bytes) return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
  await handle.close();
  return null;
}

/** This process's retakes, by copy path, run one at a time. */
const retakes = new Map<string, Promise<unknown>>();

function inRetakeTurn<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const turn = (retakes.get(path) ?? Promise.resolve()).then(fn, fn);
  const settled = turn.catch(() => {});
  retakes.set(path, settled);
  void settled.then(() => {
    if (retakes.get(path) === settled) retakes.delete(path);
  });
  return turn;
}

/**
 * The final copy, opened, holding exactly the bytes the indicator names. A copy that went missing
 * or changed is taken again from venue.db, which yields the same bytes while venue.db is
 * unchanged; the retaken file replaces it only when it matches, so the path never holds a copy
 * the indicator does not describe.
 */
async function openFinalCopy(
  deps: CaptureDeps,
  operationId: string,
  snapshot: FinalStateIndicator["snapshot"],
): Promise<FileHandle> {
  const path = finalCopyPath(deps.stateDir, operationId);
  const held = await openIfMatching(path, snapshot);
  if (held !== null) return held;
  return inRetakeTurn(path, async () => {
    const retaken = await openIfMatching(path, snapshot);
    if (retaken !== null) return retaken;
    // Retakes in this process take turns (inRetakeTurn), so no retake file found here belongs
    // to a retake still running in this process.
    await mkdir(dirname(path), { recursive: true });
    await removeLeftoverRetakes(path);
    return retake(deps, operationId, path, snapshot);
  });
}

async function removeLeftoverRetakes(path: string): Promise<void> {
  const prefix = `${basename(path)}.retake-`;
  for (const name of await readdir(dirname(path))) {
    if (name.startsWith(prefix)) await rm(join(dirname(path), name), { force: true });
  }
}

async function retake(
  deps: CaptureDeps,
  operationId: string,
  path: string,
  snapshot: FinalStateIndicator["snapshot"],
): Promise<FileHandle> {
  const retakePath = `${path}.retake-${randomUUID()}`;
  try {
    await deps.venue.archiveTo(retakePath);
    const handle = await openIfMatching(retakePath, snapshot);
    if (handle === null) throw new AppError("handover.final_copy_changed", { operationId });
    try {
      await rename(retakePath, path);
    } catch (error) {
      await handle.close();
      throw error;
    }
    return handle;
  } catch (error) {
    await rm(retakePath, { force: true });
    throw error;
  }
}

/** The operation and its binding, when `raw` is an acceptance its destination signed for it. */
async function acceptanceOf(
  deps: CaptureDeps,
  operationId: string,
  raw: unknown,
): Promise<{ operation: HandoverOperation; binding: HandoverBinding; indicatorDigest: string }> {
  const verdict = verifyEnvelope<unknown>(
    raw,
    "acceptance",
    await peerKeyOf({ ...deps, db: deps.venue }),
  );
  if (!verdict.valid) {
    if (verdict.reason === "malformed" || verdict.reason === "wrong_purpose") {
      throw new AppError("handover.request_invalid", { field: "envelope" });
    }
    throw new AppError("handover.peer_unknown", {});
  }
  const operation = await readHandoverOperation(deps.node, deps.nodeId, operationId);
  if (operation === null) throw new AppError("handover.operation_unknown", { operationId });
  if (verdict.signerNodeId !== operation.destinationNodeId) {
    throw new AppError("handover.peer_unknown", {});
  }
  const binding = await steppedDownBinding(deps, operationId);
  const { body } = verdict;
  const fields = (typeof body === "object" && body !== null ? body : {}) as {
    binding?: unknown;
    indicatorDigest?: unknown;
  };
  if (typeof fields.indicatorDigest !== "string") {
    throw new AppError("handover.request_invalid", { field: "body" });
  }
  if (!isOperationsBinding(fields.binding, operation)) {
    throw new AppError("handover.indicator_mismatch", { field: "binding" });
  }
  return { operation, binding, indicatorDigest: fields.indicatorDigest };
}

/**
 * The stored relinquishment for an acceptance of this box's stored indicator, recording it the
 * first time. It is answered as the text stored, so every repeat, across restarts, is the same
 * bytes, and a repeat needs no write.
 */
async function relinquishFiling(
  deps: CaptureDeps,
  operationId: string,
  raw: unknown,
): Promise<string> {
  const { operation, binding, indicatorDigest } = await acceptanceOf(deps, operationId, raw);
  const indicator = await readFinalState(deps.node, deps.nodeId, operationId);
  if (indicator === null) {
    throw new AppError("handover.indicator_mismatch", { field: HANDOVER_EVENT.finalState });
  }
  const held = envelopeDigest(indicator);
  if (indicatorDigest !== held) {
    throw new AppError("handover.indicator_mismatch", { field: "indicatorDigest" });
  }
  const stored = await readRelinquishment(deps, operationId);
  if (stored !== null) return stored;
  const relinquishment = await signAsThisBox(deps, "relinquishment", {
    binding: binding as unknown as CanonicalValue,
    indicatorDigest: held,
    acceptanceDigest: envelopeDigest(raw as Parameters<typeof envelopeDigest>[0]),
    filingAssignedTo: operation.destinationNodeId,
    authorisedBy: await offeredAuthoriser(deps, operationId),
  } satisfies RelinquishmentBody);
  return withNodeTransaction(deps.node, async (tx) => {
    // Checked again inside the write: another post may have recorded one since the read above.
    const recorded = await readRelinquishment({ node: tx, nodeId: deps.nodeId }, operationId);
    if (recorded !== null) return recorded;
    const row = await readHandoverOperation(tx, deps.nodeId, operationId);
    if (row?.state !== "source_stepped_down") {
      throw new AppError("handover.not_stepped_down", { operationId });
    }
    await advanceHandoverTx(
      tx,
      deps.nodeId,
      operationId,
      "filing_relinquished",
      {},
      relinquishment,
    );
    // Read back so the first answer is the stored text too.
    return (await readRelinquishment({ node: tx, nodeId: deps.nodeId }, operationId))!;
  });
}

function readRelinquishment(
  deps: { node: NodeDatabase | NodeTransaction; nodeId: string },
  operationId: string,
): Promise<string | null> {
  return findHandoverEnvelope(deps, operationId, HANDOVER_EVENT.filingRelinquished);
}

/**
 * `POST /api/node/handover/:operationId/indicator` and `…/final-copy` — the box this stepped-down
 * box handed over to fetches the signed final-state indicator and the venue.db copy it describes.
 * `…/acceptance` — that box hands back its signed acceptance of the copy, and this box gives up
 * filing to it. Mounted only in the restricted start: before the restart the old process can still
 * write venue.db, so a copy taken then could describe a file that later changes. Nothing here
 * lifts the restriction.
 */
export function mountHandoverSourceApi(app: Hono, deps: CaptureDeps, log: Logger): void {
  const run = createErrorBoundary(STATUS, "handover-source.failed");

  app.post("/api/node/handover/:operationId/indicator", (c) =>
    run(c, log, async () => {
      const operationId = c.req.param("operationId");
      await authorise(c, deps, operationId, "indicator");
      return c.json(await captureFinalCopy(deps, operationId), 200);
    }),
  );

  app.post("/api/node/handover/:operationId/final-copy", (c) =>
    run(c, log, async () => {
      const connection = c.req.raw.signal;
      const operationId = c.req.param("operationId");
      await authorise(c, deps, operationId, "final-copy");
      const { snapshot } = (await captureFinalCopy(deps, operationId)).body;
      const handle = await openFinalCopy(deps, operationId, snapshot);
      const stream = Readable.toWeb(handle.createReadStream({ start: 0 })) as ReadableStream;
      // Node ends the process when it collects an open file handle, and a connection lost before
      // the answer is written leaves nothing to read or cancel this stream, which would close it.
      const closeFile = () => {
        handle.close().catch((error: unknown) => {
          log("error", "handover-source.close_failed", { operationId, errno: errnoOf(error) });
        });
      };
      if (connection.aborted) closeFile();
      else connection.addEventListener("abort", closeFile);
      return c.body(stream, 200, {
        "content-type": "application/octet-stream",
        "content-length": String(snapshot.bytes),
      });
    }),
  );

  app.post("/api/node/handover/:operationId/acceptance", (c) =>
    run(c, log, async () => {
      const raw = await readRawJsonBody<unknown>(c);
      const text = await relinquishFiling(deps, c.req.param("operationId"), raw);
      return c.body(text, 200, { "content-type": "application/json" });
    }),
  );
}

import { randomUUID } from "node:crypto";
import { mkdir, open, readdir, rename, rm, type FileHandle } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Readable } from "node:stream";
import type { Context, Hono } from "hono";
import type { FinalStateIndicator } from "@waitron/handover";
import { readHandoverOperation } from "@waitron/node-db";
import { createErrorBoundary } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import {
  CAPTURE_REFUSAL_STATUS,
  captureFinalCopy,
  digestBytes,
  finalCopyPath,
  type CaptureDeps,
} from "./handover-capture.js";
import type { Logger } from "./logger.js";
import { verifiedPeerQuery } from "./peer-status-api.js";
import "./errors.js";

const STATUS = {
  ...CAPTURE_REFUSAL_STATUS,
  "handover.peer_unknown": 403,
  "handover.request_invalid": 400,
  "handover.operation_unknown": 404,
  "handover.final_copy_changed": 409,
  "handover.summary_failed": 500,
} as const;

/**
 * Refuses unless the request's `query` is signed by the destination this box stored for the
 * path's operation, and names that same operation in its body.
 */
async function authorise(c: Context, deps: CaptureDeps, operationId: string): Promise<void> {
  const { signerNodeId, query } = await verifiedPeerQuery(c, { ...deps, db: deps.venue });
  // A query without the operation, like the one every start sends, must not unlock the copy.
  if (query.operationId !== operationId) {
    throw new AppError("handover.request_invalid", { field: "operationId" });
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
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    const held = await digestBytes(handle.createReadStream({ start: 0, autoClose: false }));
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
    // One process owns the state folder and its retakes take turns, so any retake file found
    // here was left by a run that stopped part way.
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
  } finally {
    await rm(retakePath, { force: true });
  }
}

/**
 * `POST /api/node/handover/:operationId/indicator` and `…/final-copy` — the box this stepped-down
 * box handed over to fetches the signed final-state indicator and the venue.db copy it describes.
 * Mounted only in the restricted start: before the restart the old process can still write
 * venue.db, so a copy taken then could describe a file that later changes.
 */
export function mountHandoverSourceApi(app: Hono, deps: CaptureDeps, log: Logger): void {
  const run = createErrorBoundary(STATUS, "handover-source.failed");

  app.post("/api/node/handover/:operationId/indicator", (c) =>
    run(c, log, async () => {
      const operationId = c.req.param("operationId");
      await authorise(c, deps, operationId);
      return c.json(await captureFinalCopy(deps, operationId), 200);
    }),
  );

  app.post("/api/node/handover/:operationId/final-copy", (c) =>
    run(c, log, async () => {
      const operationId = c.req.param("operationId");
      await authorise(c, deps, operationId);
      const { snapshot } = (await captureFinalCopy(deps, operationId)).body;
      const handle = await openFinalCopy(deps, operationId, snapshot);
      const stream = Readable.toWeb(handle.createReadStream({ start: 0 })) as ReadableStream;
      return c.body(stream, 200, {
        "content-type": "application/octet-stream",
        "content-length": String(snapshot.bytes),
      });
    }),
  );
}

import type { Context } from "hono";
import { withNodeTransaction, type NodeDatabase } from "@waitron/db";
import type { HandoverBinding } from "@waitron/handover";
import { codeOf } from "@waitron/server-kit";
import { recordHandoverRestrictionTx } from "@waitron/node-db";
import type { BackgroundDuties } from "./background-duties.js";
import type { HandoverGate } from "./handover-gate.js";
import { advanceHandoverTx } from "./handover-store.js";
import { SHUTDOWN_DEADLINE_MS } from "./run-server.js";
import type { Logger } from "./logger.js";

export const HANDOVER_ADMITTED_WORK_LIMIT_MS = 180_000;

const ALLOWED_EXACT = new Set(["GET /health", "GET /api/node", "POST /api/node/peer-status"]);
const HANDOVER_READ = /^\/api\/node\/handover\/[^/]+$/;

/** What a stepped-down box still answers while it waits to restart. */
export function STEPDOWN_ALLOWED(c: Context): boolean {
  const { method, path } = c.req;
  return ALLOWED_EXACT.has(`${method} ${path}`) || (method === "GET" && HANDOVER_READ.test(path));
}

export interface StepDownDeps {
  node: NodeDatabase;
  nodeId: string;
  gate: HandoverGate;
  duties: BackgroundDuties;
  /** The started server's graceful close: background work, the listener, requests, the store. */
  close: () => Promise<void>;
  /** The restart promotion uses. */
  restart: () => void;
  log: Logger;
}

export interface StepDownRequest {
  binding: HandoverBinding;
  kind: "handed-over" | "superseded";
  /** The request asking for the stepdown, as the gate counted it. */
  self: Context;
}

export interface StepDownResult {
  restarting: true;
  replayed: boolean;
}

export async function stepDown(
  deps: StepDownDeps,
  request: StepDownRequest,
): Promise<StepDownResult> {
  const { binding, kind, self } = request;
  // The restriction is written before the answer, so a lost answer leaves the box stepped down.
  await withNodeTransaction(deps.node, async (tx) => {
    if (kind === "handed-over") {
      await advanceHandoverTx(tx, deps.nodeId, binding.operationId, "source_stepped_down", {});
    }
    await recordHandoverRestrictionTx(tx, {
      nodeId: deps.nodeId,
      operationId: binding.operationId,
      kind,
      successorNodeId: binding.destinationNodeId,
      membershipTerm: binding.membership.term,
    });
  });
  // Only a stepdown closes the gate, and the write above refuses any other binding.
  if (deps.gate.isClosed()) return { restarting: true, replayed: true };
  try {
    deps.gate.close({ allowed: STEPDOWN_ALLOWED, self });
    signalDuties(deps.duties);
  } finally {
    setTimeout(() => void afterAnswer(deps), 0);
  }
  return { restarting: true, replayed: false };
}

/** Every duty is told even when one throws; the first throw is rethrown after. */
function signalDuties(duties: BackgroundDuties): void {
  const failures: unknown[] = [];
  for (const duty of duties.aborts) {
    try {
      duty.abort();
    } catch (error) {
      failures.push(error);
    }
  }
  for (const closer of duties.closers) {
    if (closer.atStepdown !== true) continue;
    try {
      // The close awaits this same promise later; catching here only keeps it from being unhandled.
      void Promise.resolve(closer.close()).catch(() => {});
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw failures[0];
}

async function afterAnswer(deps: StepDownDeps): Promise<void> {
  try {
    const { remaining } = await deps.gate.settled(HANDOVER_ADMITTED_WORK_LIMIT_MS);
    for (const cut of remaining) deps.log("warn", "handover.admitted_work_cut", cut);
    await closeWithin(deps, SHUTDOWN_DEADLINE_MS);
  } catch (error) {
    deps.log("error", "handover.stepdown_close_failed", { errorCode: codeOf(error) });
  } finally {
    deps.restart();
  }
}

/** The same bound a SIGTERM's shutdown has, so a close that never settles still restarts the box. */
async function closeWithin(deps: StepDownDeps, limitMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cut = new Promise<"cut">((resolve) => {
    timer = setTimeout(() => resolve("cut"), limitMs);
  });
  try {
    if ((await Promise.race([deps.close(), cut])) === "cut") {
      deps.log("warn", "handover.stepdown_close_timeout", { deadlineMs: limitMs });
    }
  } finally {
    clearTimeout(timer);
  }
}

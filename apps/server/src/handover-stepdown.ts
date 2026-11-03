import type { Context } from "hono";
import { withNodeTransaction, type NodeDatabase, type NodeTransaction } from "@waitron/db";
import { bindingFingerprint, type HandoverBinding } from "@waitron/handover";
import { codeOf } from "@waitron/server-kit";
import {
  readHandoverOperation,
  readHandoverRestriction,
  recordHandoverRestrictionTx,
} from "@waitron/node-db";
import { AppError } from "@waitron/shared";
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

export type StepDownRequest =
  | {
      binding: HandoverBinding;
      kind: "handed-over" | "superseded";
      /** The request asking for the stepdown, as the gate counted it. */
      self: Context;
    }
  | {
      /** A supersession learnt from a newer chart alone, under no operation. */
      binding?: undefined;
      kind: "superseded";
      successorNodeId: string;
      membershipTerm: number;
      self: Context;
    };

export interface StepDownResult {
  restarting: true;
  replayed: boolean;
}

/** Each server's stepdown write, kept so a replay answers only once it has committed. */
const writes = new WeakMap<HandoverGate, Promise<void>>();

export async function stepDown(
  deps: StepDownDeps,
  request: StepDownRequest,
): Promise<StepDownResult> {
  // A conflicting request is refused here, with nothing stopped and no restart.
  await assertMatchesStored(deps.node, deps.nodeId, request);
  const first = writes.get(deps.gate);
  if (first !== undefined) {
    await first;
    await assertMatchesStored(deps.node, deps.nodeId, request);
    return { restarting: true, replayed: true };
  }
  // Told to stop before the write: from here no drain claims another batch, though one already
  // claimed is still sent.
  let signalFailure: { error: unknown } | null = null;
  try {
    deps.gate.close({ allowed: STEPDOWN_ALLOWED, self: request.self });
    signalDuties(deps.duties);
  } catch (error) {
    signalFailure = { error };
  }
  const write = writeRestriction(deps, request);
  writes.set(deps.gate, write);
  write.catch(() => {});
  try {
    // The restriction is written before the answer, so a lost answer leaves the box stepped down.
    // A failed write leaves the box neither filing nor stepped down, so it restarts too.
    await write;
  } finally {
    setTimeout(() => void afterAnswer(deps), 0);
  }
  if (signalFailure !== null) throw signalFailure.error;
  return { restarting: true, replayed: false };
}

async function writeRestriction(deps: StepDownDeps, request: StepDownRequest): Promise<void> {
  await withNodeTransaction(deps.node, async (tx) => {
    if (request.kind === "handed-over") {
      const { binding } = request;
      // Checked again inside the write: another request may have begun since the read above.
      await assertBindingTx(tx, deps.nodeId, binding);
      await advanceHandoverTx(tx, deps.nodeId, binding.operationId, "source_stepped_down", {});
    }
    await recordHandoverRestrictionTx(tx, restrictionRow(deps.nodeId, request));
  });
}

function restrictionRow(nodeId: string, request: StepDownRequest) {
  if (request.binding === undefined) {
    return {
      nodeId,
      operationId: null,
      kind: request.kind,
      successorNodeId: request.successorNodeId,
      membershipTerm: request.membershipTerm,
    };
  }
  const { binding, kind } = request;
  return {
    nodeId,
    operationId: binding.operationId,
    kind,
    successorNodeId: binding.destinationNodeId,
    membershipTerm: binding.membership.term,
  };
}

/** The refusals the write would give, read without writing. */
async function assertMatchesStored(
  node: NodeDatabase,
  nodeId: string,
  request: StepDownRequest,
): Promise<void> {
  if (request.kind === "handed-over") await assertBindingTx(node, nodeId, request.binding);
  const stored = await readHandoverRestriction(node, nodeId);
  if (stored === null) return;
  const wanted = restrictionRow(nodeId, request);
  if (
    stored.operationId !== wanted.operationId ||
    stored.kind !== wanted.kind ||
    stored.successorNodeId !== wanted.successorNodeId ||
    stored.membershipTerm !== wanted.membershipTerm
  ) {
    throw new AppError("handover.restriction_conflict", {});
  }
}

/** The operation is selected by id alone, so the rest of the binding is checked against its own. */
async function assertBindingTx(
  tx: NodeTransaction | NodeDatabase,
  nodeId: string,
  binding: HandoverBinding,
): Promise<void> {
  const operation = await readHandoverOperation(tx, nodeId, binding.operationId);
  if (operation !== null && operation.fingerprint !== bindingFingerprint(binding)) {
    throw new AppError("handover.operation_conflict", { operationId: binding.operationId });
  }
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

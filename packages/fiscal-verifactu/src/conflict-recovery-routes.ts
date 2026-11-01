import "./errors.js";
import type { Hono } from "hono";
import type { LiveModuleOperationScope, ModuleRouteContext } from "@waitron/module";
import { createErrorBoundary, readJsonBody, type Logger } from "@waitron/server-kit";
import { AppError, hasCode, isAppError } from "@waitron/shared";
import { readActiveConflicts, type ConflictRef } from "./conflict-evidence.js";
import {
  conflictSourceId,
  readCommittedConflictSwitch,
  recoverActiveConflict,
} from "./conflict-recovery.js";
import {
  parseConflictPreparation,
  parseConflictRequest,
  type ConflictPreparationResult,
  type ConflictRequest,
  type ConflictResult,
} from "./conflict-recovery-contract.js";

function refuse(reason: string): never {
  throw new AppError("sif.allocation_invalid", { reason });
}
function publicPreparation(value: unknown): ConflictPreparationResult {
  if (typeof value !== "object" || value === null) return refuse("event_mismatch");
  const v = value as Record<string, unknown>;
  const projected =
    "boxInstantMs" in v
      ? { id: v.id, boxInstantMs: v.boxInstantMs, expiresInMs: v.expiresInMs }
      : "clock" in v
        ? { id: v.id, clock: v.clock }
        : v.status === "waiting"
          ? { status: v.status, targetMs: v.targetMs, remainingMs: v.remainingMs }
          : v.status === "selected"
            ? { status: v.status, identity: v.identity, input: v.input }
            : { status: v.status, identity: v.identity };
  return parseConflictPreparation(projected) ?? refuse("event_mismatch");
}
function sameRef(a: ConflictRef, b: ConflictRef) {
  return a.registroId === b.registroId && a.caseId === b.caseId && a.sifId === b.sifId;
}
async function execute(
  scope: LiveModuleOperationScope,
  request: ConflictRequest,
  client: { onBox: boolean },
): Promise<ConflictResult> {
  const { binding, authority } = scope;
  const conflict = request.conflict;
  const facts = await scope.commit(async (tx) => {
    const committed =
      conflict === undefined
        ? null
        : await readCommittedConflictSwitch(
            tx,
            scope.node,
            binding,
            conflict,
            authority,
            request.command.kind === "activate" ? request.command.input : undefined,
          );
    const active = await readActiveConflicts(tx, scope.node.nodeId);
    if (
      conflict !== undefined &&
      committed === null &&
      !active.some((row) => sameRef(row, conflict))
    )
      refuse("conflict_not_active");
    return { committed, active };
  });
  if (request.command.kind === "status") {
    if (facts.committed !== null)
      return {
        kind: "status",
        active: facts.active,
        event: { kind: "committed", result: facts.committed },
      };
    if (conflict === undefined)
      return { kind: "status", active: facts.active, event: { kind: "none" } };
    const event = await scope.operations.recovery?.(
      { binding, authority },
      { action: "status" },
      client,
    );
    if (
      typeof event !== "object" ||
      event === null ||
      !("kind" in event) ||
      (event.kind !== "none" && event.kind !== "restart-required")
    )
      return refuse("event_mismatch");
    return { kind: "status", active: facts.active, event: { kind: event.kind } };
  }
  if (!request.oldMachineOffline) return refuse("old_machine_active");
  if (!request.noParallelRecovery) return refuse("parallel_recovery");
  if (facts.committed !== null) return { kind: "committed", result: facts.committed };
  if (request.command.kind === "activate")
    return {
      kind: "committed",
      result: await recoverActiveConflict(scope, {
        binding,
        conflict: conflict!,
        input: request.command.input,
      }),
    };
  if (scope.operations.recovery === undefined) return refuse("outside_confirmation_missing");
  return {
    kind: "prepared",
    value: publicPreparation(
      await scope.operations.recovery({ binding, authority }, request.command.proposal, client),
    ),
  };
}
export function mountConflictRecovery(app: Hono, ctx: ModuleRouteContext, log: Logger): void {
  const bridge = ctx.liveOperations;
  if (bridge === undefined) return;
  const boundary = createErrorBoundary(
    {
      "recovery.rate_limited": 429,
      "promotion.break_glass_invalid": 401,
      "authorization.not_permitted": 403,
      "node.read_only": 409,
      "sif.allocation_invalid": 409,
    },
    "fiscal-conflict.failed",
  );
  app.post("/api/module-recovery/fiscal-verifactu/conflict", (c) => {
    c.header("Cache-Control", "no-store");
    return boundary(c, log, () => {
      bridge.requireHttps(c);
      return bridge.withAdmission(async () => {
        const request = parseConflictRequest(await readJsonBody<unknown>(c));
        if (request === null)
          return c.json(
            {
              error: { code: "sif.allocation_invalid", params: { reason: "malformed_allocation" } },
            },
            400,
          );
        const binding = {
          module: "fiscal-verifactu",
          action: "conflict-switch",
          eventId: request.eventId,
          sourceId:
            request.conflict === undefined ? "conflict-status" : conflictSourceId(request.conflict),
          targetNodeId: bridge.node.nodeId,
        };
        try {
          return c.json(
            await bridge.run(
              binding,
              request.recoveryKey,
              {
                oldMachineOffline: request.oldMachineOffline,
                noParallelRecovery: request.noParallelRecovery,
              },
              (scope) => execute(scope, request, bridge.client(c)),
            ),
          );
        } catch (error) {
          if (
            isAppError(error) &&
            hasCode(error, "sif.allocation_invalid") &&
            error.params.reason === "reauthentication_required"
          )
            return c.json({ error: { code: error.code, params: error.params } }, 401);
          throw error;
        }
      });
    });
  });
}

import "./errors.js";
import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Database, NodeDatabase } from "@waitron/db";
import type { HandoverState } from "@waitron/handover";
import { personIdForLoginEmail } from "@waitron/identity";
import type { OperationBinding } from "@waitron/module";
import { readHandoverEvent, readHandoverOperation, type HandoverOperation } from "@waitron/node-db";
import { createErrorBoundary, readJsonBody } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { COPY_PLACED_EVENT } from "./handover-place-copy.js";
import type { Logger } from "./logger.js";
import { requireNodeOperationHttps } from "./node-operation-https.js";
import type { createNodeOperationPreparation } from "./node-operation-preparation.js";
import { parseStandbyOperationInput } from "./recovery-module-operation.js";
import { requestFromBox } from "./request-from-box.js";

export interface HandoverPreparationDeps {
  node: NodeDatabase;
  nodeId: string;
  appDb: Database;
  nodePreparation: ReturnType<typeof createNodeOperationPreparation>;
  /** Whether a request came from a browser on the box itself; tests replace it. */
  requestFromBox?: (c: Context) => boolean;
}

const STATUS: Record<string, ContentfulStatusCode> = {
  "password.invalid": 401,
  "authorization.not_permitted": 403,
  "handover.request_invalid": 400,
  "handover.operation_unknown": 404,
  "handover.step_out_of_order": 409,
  "module.operation_invalid": 400,
};

// A refusal's params are logged, and this route takes any caller's text.
const OPERATION_ID_MAX_LENGTH = 64;

const BEFORE_ACTIVATION: ReadonlySet<HandoverState> = new Set<HandoverState>([
  "filing_assumed",
  "emergency_declared",
]);

/** Every step of one operation takes this from here: `contextKey` does not cover the last field. */
export function handoverPromotionContext(operation: Pick<HandoverOperation, "scenario">): {
  oldNodeNeutralised: true;
  noParallelRecovery: true;
  oldMachineRelinquished: boolean;
} {
  return {
    oldNodeNeutralised: true,
    noParallelRecovery: true,
    oldMachineRelinquished: operation.scenario === "controlled",
  };
}

/**
 * The stored operation, once it may name a new identity. At `filing_assumed` the old `venue.db`
 * is still live until the restart places the accepted copy, and anything written now would be
 * replaced with it.
 */
export async function readOperationReadyToPromote(
  deps: Pick<HandoverPreparationDeps, "node" | "nodeId">,
  operationId: string,
): Promise<HandoverOperation> {
  const operation = await readHandoverOperation(deps.node, deps.nodeId, operationId);
  if (operation === null) throw new AppError("handover.operation_unknown", { operationId });
  const ready =
    BEFORE_ACTIVATION.has(operation.state) &&
    (operation.state !== "filing_assumed" ||
      (await readHandoverEvent(deps.node, deps.nodeId, operationId, COPY_PLACED_EVENT)) !== null);
  if (!ready)
    throw new AppError("handover.step_out_of_order", { from: operation.state, to: "activated" });
  return operation;
}

/** The module keys its allocation on `eventId` and records `sourceId` in an append-only approval. */
export function assertBindingNamesOperation(
  binding: OperationBinding,
  operation: Pick<HandoverOperation, "operationId" | "sourceNodeId">,
  nodeId: string,
): void {
  if (
    binding.action !== "promote" ||
    binding.targetNodeId !== nodeId ||
    binding.eventId !== operation.operationId ||
    binding.sourceId !== operation.sourceNodeId
  )
    throw new AppError("module.operation_invalid", { module: binding.module });
}

/** Only these three fields reach the sign-in, so no break-glass secret or person id can. */
async function signInCredentials(
  db: Database,
  signIn: unknown,
): Promise<{ personId: string; password: unknown; totp: unknown }> {
  if (typeof signIn !== "object" || signIn === null) throw new AppError("password.invalid", {});
  const { email, password, totp } = signIn as Record<string, unknown>;
  if (typeof email !== "string") throw new AppError("password.invalid", {});
  return { personId: await personIdForLoginEmail(db, email), password, totp };
}

/** `POST /api/node/handover/:operationId/preparation`: the browser's clock check and minute name. */
export function mountHandoverPreparationApi(
  app: Hono,
  deps: HandoverPreparationDeps,
  log: Logger = () => {},
): void {
  const run = createErrorBoundary(STATUS, "handover-preparation.failed");

  app.post("/api/node/handover/:operationId/preparation", (c) =>
    run(c, log, async () => {
      c.header("Cache-Control", "no-store");
      requireNodeOperationHttps(c);
      const operationId = c.req.param("operationId");
      if (operationId.length > OPERATION_ID_MAX_LENGTH)
        throw new AppError("handover.request_invalid", { field: "operationId" });
      const body = await readJsonBody<{
        moduleOperation?: unknown;
        signIn?: unknown;
        proposal?: unknown;
      }>(c);
      const operation = await readOperationReadyToPromote(deps, operationId);
      const moduleOperation = parseStandbyOperationInput(body.moduleOperation);
      if (moduleOperation === null)
        throw new AppError("module.operation_invalid", { module: "unknown" });
      assertBindingNamesOperation(moduleOperation.binding, operation, deps.nodeId);
      const credentials = await signInCredentials(deps.appDb, body.signIn);
      const onBox = (deps.requestFromBox ?? requestFromBox)(c);
      return c.json(
        await deps.nodePreparation.prepare(
          moduleOperation.binding,
          credentials,
          handoverPromotionContext(operation),
          body.proposal,
          { onBox },
          // The password check takes long enough for the operation to move on.
          async () => {
            await readOperationReadyToPromote(deps, operationId);
          },
        ),
      );
    }),
  );
}

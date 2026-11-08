import "./errors.js";
import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError, isAppError } from "@waitron/shared";
import { withTransaction, type Database, type NodeDatabase } from "@waitron/db";
import {
  authorizeManager,
  checkManagerPassword,
  endManagementSession,
  loginManagerById,
  type TotpKeyRing,
} from "@waitron/identity";
import { BEFORE_ACTIVATION } from "@waitron/handover";
import type { WaitronModule } from "@waitron/module";
import { readOpenHandoverOperation } from "@waitron/node-db";
import { parseStandbyOperationInput } from "./recovery-module-operation.js";
import { promotionTurn } from "./handover-promotion-turn.js";
import { withPromotionModuleOperation } from "./promotion-operation.js";
import type { FenceAttestation, PromotionOperationRunner } from "./promote.js";
import { verifyBreakGlass } from "./break-glass.js";
import { createErrorBoundary, readJsonBody } from "@waitron/server-kit";
import { isUuid } from "./till-session.js";
import { CHART_MINT_REFUSALS } from "./membership-mint.js";
import type { Logger } from "./logger.js";
import { requireNodeOperationHttps } from "./node-operation-https.js";
import type { createNodeOperationPreparation } from "./node-operation-preparation.js";
import { requestFromBox } from "./request-from-box.js";
import { HELD_DOCUMENT_REFUSALS } from "./membership-trust.js";
import { createPasswordThrottle } from "./password-throttle.js";

/**
 * `restarting` is true only for a real mirror-to-primary promote, which reboots the node; the
 * operator UI polls for it to come back on that flag.
 */
export interface PromoteRunResult {
  alreadyPrimary: boolean;
  restarting: boolean;
}

export interface PromoteApiDeps {
  appDb: Database;
  /** This box's node.db, which holds the recovery-key check. */
  nodeDb: NodeDatabase;
  /** This node's id — whose break-glass verifier is checked. */
  nodeId: string;
  /** Unlocks a stored authenticator secret, so an admin who has one can sign in. */
  credentialKeyRing: TotpKeyRing;
  modules?: readonly WaitronModule[];
  nodePreparation?: ReturnType<typeof createNodeOperationPreparation>;
  /** Whether a request came from a browser on the box itself; tests replace it. */
  requestFromBox?: (c: Context) => boolean;
  run: (
    attestation: FenceAttestation,
    operation?: PromotionOperationRunner,
  ) => Promise<PromoteRunResult>;
}

const STATUS: Record<string, ContentfulStatusCode> = {
  "password.invalid": 401,
  "password.throttled": 429,
  "promotion.break_glass_invalid": 401,
  "authorization.not_permitted": 403,
  "promotion.fence_not_attested": 400,
  "promotion.node_fenced": 409,
  "promotion.membership_superseded": 409,
  "handover.operation_in_progress": 409,
  ...CHART_MINT_REFUSALS,
  ...HELD_DOCUMENT_REFUSALS,
};

// Only these two answers: a request body must never be able to claim the old box relinquished.
const preparationContext = (body: {
  oldNodeNeutralised?: unknown;
  noParallelRecovery?: unknown;
}) => ({
  oldNodeNeutralised: body.oldNodeNeutralised,
  noParallelRecovery: body.noParallelRecovery,
});

export function mountPromoteApi(app: Hono, deps: PromoteApiDeps, log: Logger = () => {}): void {
  const run = createErrorBoundary(STATUS, "promotion.failed");
  const throttle = createPasswordThrottle();
  const withAttempt = async <T>(
    body: {
      personId?: unknown;
      breakGlass?: unknown;
      moduleOperation?: unknown;
      noParallelRecovery?: unknown;
    },
    perform: () => Promise<T>,
  ): Promise<T> => {
    const prepared =
      body.moduleOperation !== undefined &&
      deps.nodePreparation !== undefined &&
      body.noParallelRecovery !== undefined;
    const recoveryKey = typeof body.breakGlass === "string" || (prepared && "breakGlass" in body);
    if (recoveryKey) return perform();
    const key = typeof body.personId === "string" ? `person:${body.personId}` : "missing-person";
    const finish = throttle.begin(key);
    try {
      const result = await perform();
      finish("success");
      return result;
    } catch (error) {
      finish(isAppError(error) && error.code === "password.invalid" ? "invalid" : "error");
      throw error;
    }
  };

  const refuseWhileTakingOver = async (): Promise<void> => {
    const open = await readOpenHandoverOperation(deps.nodeDb, deps.nodeId);
    // From `activated` on this box is already the main box, where a promote only reports status.
    if (open?.role === "destination" && BEFORE_ACTIVATION.includes(open.state))
      throw new AppError("handover.operation_in_progress", { operationId: open.operationId });
  };

  app.post("/management-api/promote/preparation", (c) =>
    run(c, log, async () => {
      c.header("Cache-Control", "no-store");
      requireNodeOperationHttps(c);
      const body = await readJsonBody<{
        moduleOperation?: unknown;
        proposal?: unknown;
        oldNodeNeutralised?: unknown;
        noParallelRecovery?: unknown;
        personId?: unknown;
        password?: unknown;
        totp?: unknown;
        breakGlass?: unknown;
      }>(c);
      const operation = parseStandbyOperationInput(body.moduleOperation);
      if (
        operation === null ||
        operation.binding.action !== "promote" ||
        deps.nodePreparation === undefined
      )
        throw new AppError("module.operation_invalid", {
          module: operation?.binding.module ?? "unknown",
        });
      const onBox = (deps.requestFromBox ?? requestFromBox)(c);
      return c.json(
        await withAttempt(body, () =>
          deps.nodePreparation!.prepare(
            operation.binding,
            body,
            preparationContext(body),
            body.proposal,
            { onBox },
            // No turn: preparing changes no mode, and the promote that follows checks again.
            refuseWhileTakingOver,
          ),
        ),
      );
    }),
  );

  app.post("/management-api/promote", (c) =>
    run(c, log, async () => {
      const turn = promotionTurn(deps.nodeDb);
      const afterSignIn = async (): Promise<void> => {
        turn.claim();
        await refuseWhileTakingOver();
      };
      try {
        const body = await readJsonBody<{
          oldNodeNeutralised?: unknown;
          noParallelRecovery?: unknown;
          personId?: string;
          password?: string;
          totp?: string;
          breakGlass?: string;
          moduleOperation?: unknown;
        }>(c);

        return await withAttempt(body, async () => {
          if (body.moduleOperation !== undefined) {
            const operation = parseStandbyOperationInput(body.moduleOperation);
            if (operation === null)
              throw new AppError("module.operation_invalid", { module: "unknown" });
            if (deps.nodePreparation !== undefined && body.noParallelRecovery !== undefined) {
              c.header("Cache-Control", "no-store");
              requireNodeOperationHttps(c);
              const result = await deps.nodePreparation.withPromotion(
                operation,
                body,
                preparationContext(body),
                (_modules, runner) =>
                  deps.run({ oldNodeNeutralised: body.oldNodeNeutralised === true }, runner),
                afterSignIn,
              );
              return c.json(result);
            }
            const result = await withPromotionModuleOperation(
              {
                db: deps.appDb,
                node: deps.nodeDb,
                nodeId: deps.nodeId,
                credentialKeyRing: deps.credentialKeyRing,
                modules: deps.modules ?? [],
              },
              operation,
              body,
              (runner) =>
                deps.run({ oldNodeNeutralised: body.oldNodeNeutralised === true }, runner),
              afterSignIn,
            );
            return c.json(result);
          }

          // A present break-glass secret is authoritative: a wrong one is refused here, never downgraded
          // to the login path.
          if (typeof body.breakGlass === "string") {
            if (!(await verifyBreakGlass(deps.nodeDb, deps.nodeId, body.breakGlass))) {
              throw new AppError("promotion.break_glass_invalid", {});
            }
            await afterSignIn();
          } else if (
            typeof body.personId === "string" &&
            isUuid(body.personId) &&
            typeof body.password === "string" &&
            (body.totp === undefined || typeof body.totp === "string")
          ) {
            const { personId, password, totp } = body;
            const checked = await checkManagerPassword(deps.appDb, { personId }, password);
            await withTransaction(deps.appDb, async (tx) => {
              const session = await loginManagerById(tx, {
                personId,
                password,
                totp,
                totpKeyRing: deps.credentialKeyRing,
                checked,
              });
              await authorizeManager(tx, {
                managementSessionId: session.token,
                permission: "node.promote",
              });
              await endManagementSession(tx, session.token);
              // Inside the transaction, so a refusal here leaves no session row behind.
              await afterSignIn();
            });
          } else {
            // The same code a wrong password gets, so the response never says which field failed.
            throw new AppError("password.invalid", {});
          }

          const result = await deps.run({ oldNodeNeutralised: body.oldNodeNeutralised === true });
          return c.json(result);
        });
      } finally {
        turn.release();
      }
    }),
  );
}

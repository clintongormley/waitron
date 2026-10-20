import "./errors.js";
import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError } from "@waitron/shared";
import { withTransaction, type Database } from "@waitron/db";
import {
  authorizeManager,
  checkManagerPassword,
  endManagementSession,
  loginManagerById,
  type TotpKeyRing,
} from "@waitron/identity";
import type { WaitronModule } from "@waitron/module";
import { parseStandbyOperationInput } from "./recovery-module-operation.js";
import { withPromotionModuleOperation } from "./promotion-operation.js";
import type { FenceAttestation, PromotionOperationRunner } from "./promote.js";
import { verifyBreakGlass } from "./break-glass.js";
import { createErrorBoundary, readJsonBody } from "@waitron/server-kit";
import { isUuid } from "./till-session.js";
import { CHART_MINT_REFUSALS } from "./membership-mint.js";
import type { Logger } from "./logger.js";
import { TLSSocket } from "node:tls";
import type { createNodeOperationPreparation } from "./node-operation-preparation.js";

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
  /** This node's id — whose break-glass verifier is checked. */
  nodeId: string;
  /** Unlocks a stored authenticator secret, so an admin who has one can sign in. */
  credentialKeyRing: TotpKeyRing;
  modules?: readonly WaitronModule[];
  nodePreparation?: ReturnType<typeof createNodeOperationPreparation>;
  run: (
    attestation: FenceAttestation,
    operation?: PromotionOperationRunner,
  ) => Promise<PromoteRunResult>;
}

const STATUS: Record<string, ContentfulStatusCode> = {
  "password.invalid": 401,
  "promotion.break_glass_invalid": 401,
  "authorization.not_permitted": 403,
  "promotion.fence_not_attested": 400,
  "promotion.node_fenced": 409,
  "promotion.membership_superseded": 409,
  ...CHART_MINT_REFUSALS,
};

function requireNodeOperationHttps(c: Context): void {
  const socket = (c.env as { incoming?: { socket?: unknown } } | undefined)?.incoming?.socket;
  const origin = c.req.header("Origin"),
    site = c.req.header("Sec-Fetch-Site");
  if (
    !(socket instanceof TLSSocket) ||
    !socket.encrypted ||
    (origin !== undefined && origin !== new URL(c.req.url).origin) ||
    (site !== undefined && !["same-origin", "none"].includes(site))
  )
    throw new AppError("authorization.not_permitted", { permission: "node.promote" });
}

export function mountPromoteApi(app: Hono, deps: PromoteApiDeps, log: Logger = () => {}): void {
  const run = createErrorBoundary(STATUS, "promotion.failed");

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
      return c.json(
        await deps.nodePreparation.prepare(operation.binding, body, body, body.proposal),
      );
    }),
  );

  app.post("/management-api/promote", (c) =>
    run(c, log, async () => {
      const body = await readJsonBody<{
        oldNodeNeutralised?: unknown;
        noParallelRecovery?: unknown;
        personId?: string;
        password?: string;
        totp?: string;
        breakGlass?: string;
        moduleOperation?: unknown;
      }>(c);

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
            body,
            (_modules, runner) =>
              deps.run({ oldNodeNeutralised: body.oldNodeNeutralised === true }, runner),
          );
          return c.json(result);
        }
        const result = await withPromotionModuleOperation(
          {
            db: deps.appDb,
            nodeId: deps.nodeId,
            credentialKeyRing: deps.credentialKeyRing,
            modules: deps.modules ?? [],
          },
          operation,
          body,
          (runner) => deps.run({ oldNodeNeutralised: body.oldNodeNeutralised === true }, runner),
        );
        return c.json(result);
      }

      // A present break-glass secret is authoritative: a wrong one is refused here, never downgraded
      // to the login path.
      if (typeof body.breakGlass === "string") {
        if (!(await verifyBreakGlass(deps.appDb, deps.nodeId, body.breakGlass))) {
          throw new AppError("promotion.break_glass_invalid", {});
        }
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
        });
      } else {
        // The same code a wrong password gets, so the response never says which field failed.
        throw new AppError("password.invalid", {});
      }

      const result = await deps.run({ oldNodeNeutralised: body.oldNodeNeutralised === true });
      return c.json(result);
    }),
  );
}

import { mountSetupCloudSignIn, setupCloudSignInAvailable } from "./setup-cloud-sign-in.js";
import { mountSetupFirstFiscalApi } from "./setup-first-fiscal-api.js";
import type { FirstSetupHold } from "@waitron/provisioning";
import type { Context, Hono } from "hono";
import { AppError, isAppError } from "@waitron/shared";
import { createErrorBoundary } from "@waitron/server-kit";
import { mountSetupSpa } from "./setup-spa.js";
import type { Logger } from "./logger.js";
import { type ActiveSetupOperation, type SetupOperationStore } from "./setup-operation.js";
import { outgoingOf, restartAfterResponse } from "./restart-after-response.js";
import "./errors.js";
import type { SetupDeps } from "./setup-api-deps.js";
import { directError } from "./setup-api-errors.js";
import { parseVenue, parseSetupAdmin } from "./setup-provision-input.js";
import { mountSetupOperationRoutes } from "./setup-operation-routes.js";

/**
 * Served when no built wizard is configured, so a browser pointed at an unprovisioned box gets a
 * clear "needs setup" page rather than a blank 404.
 */
export const SETUP_PLACEHOLDER_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Waitron — setup needed</title>
  </head>
  <body>
    <main>
      <h1>This Waitron box needs setup</h1>
      <p>No venue is bound to this box yet. Finish setup to start trading.</p>
    </main>
  </body>
</html>
`;

/** The placeholder's meaning changes the moment the box is provisioned (the setup routes stop being
 * mounted), so it must be revalidated, never pinned. */
const REVALIDATE_CACHE_CONTROL = "no-cache";

/**
 * Mount the UNAUTHENTICATED setup-mode routes — the whole surface the box exposes while no venue is
 * bound. `GET /setup-api/status`'s shape is a contract the wizard reads: `provisioned` is always
 * `false`, because a provisioned box never mounts these routes.
 *
 * Must be called after `/health` is registered: the root catch-all mounted last answers only paths
 * nothing else claimed.
 */
export function mountSetup(app: Hono, deps: SetupDeps, log: Logger): void {
  const holds = new WeakMap<Request, FirstSetupHold>();
  if (deps.firstFiscal !== undefined)
    mountSetupFirstFiscalApi(
      app,
      deps.firstFiscal,
      log,
      parseVenue,
      deps.devMode === true ? "preproduction" : "production",
      deps,
    );
  const cloudSignIn = deps.cloudSignIn;
  if (cloudSignIn && deps.environment === "preproduction") {
    mountSetupCloudSignIn(
      app,
      cloudSignIn,
      async () => {
        if (setupBusy() || (await deps.operations?.read()) != null)
          throw new AppError("setup.already_provisioning", {});
        await deps.firstSetup?.assertOtherAllowed();
      },
      (input, held) => parseSetupAdmin(input, held, true),
      log,
    );
  }
  if (deps.firstSetup !== undefined) {
    const firstSetup = deps.firstSetup;
    const boundary = createErrorBoundary(
      {
        "setup.attempt_conflict": 409,
        "setup.attempt_uncertain": 409,
        "setup.attempt_invalid": 409,
        "setup.start_again_incomplete": 409,
      },
      "setup.provision_failed",
    );
    app.use("/setup-api/*", async (c, next) => {
      if (c.req.method !== "POST" || c.req.path.startsWith("/setup-api/first-setup/"))
        return next();
      if (
        setupBusy() &&
        ["/setup-api/restore", "/setup-api/restore/preview", "/setup-api/recovery/stage"].includes(
          c.req.path,
        )
      )
        return directError(c, log, "setup.already_provisioning", 409);
      // These write nothing, so a main box that never answers them holds no other setup request
      // back.
      if (c.req.path === "/setup-api/join/start")
        return boundary(c, log, async () => {
          await firstSetup.assertOtherAllowed();
          await next();
          return c.res;
        });
      return boundary(c, log, () =>
        firstSetup.coordinator.run(async (hold) => {
          await firstSetup.assertOtherAllowed();
          holds.set(c.req.raw, hold);
          try {
            await next();
            return c.res;
          } finally {
            holds.delete(c.req.raw);
          }
        }),
      );
    });
  }
  const runOperation = async <T>(
    request: Request,
    kind: Parameters<SetupOperationStore["run"]>[0],
    hash: string,
    body: (operation: ActiveSetupOperation) => Promise<T>,
  ): Promise<T> => {
    await deps.writeClockSteps?.();
    return deps.operations!.run(kind, hash, body, holds.get(request));
  };
  const restartAfterReply = async (
    c: Context,
    requestRestart: () => void,
    handle: (mustRestart: () => void) => Promise<Response>,
  ): Promise<Response> => {
    let restart = false;
    try {
      return await handle(() => {
        restart = true;
      });
    } finally {
      if (restart) {
        const outgoing = outgoingOf(c);
        // Under `app.request` there is no Node response, so the timer lets the reply return first.
        setTimeout(() => restartAfterResponse(outgoing, requestRestart, log), 0);
      }
    }
  };
  // Once at mount, not per request: the box's mode is not otherwise visible in the request log.
  log("info", "setup.mode_active", { environment: deps.environment });

  app.get("/setup-api/status", async (c) => {
    let operation: Awaited<ReturnType<SetupOperationStore["read"]>> | undefined;
    let operationBlocked = false;
    try {
      operation = await deps.operations?.read();
    } catch (error) {
      if (!isAppError(error) || error.code !== "setup.operation_conflict") throw error;
      operationBlocked = true;
      log("error", "setup.operation_conflict", {});
    }
    return c.json(
      {
        provisioned: false,
        environment: deps.environment,
        ...(deps.installationOrigin === undefined
          ? {}
          : { installationOrigin: deps.installationOrigin }),
        ...(deps.devMode === true ? { developmentMode: true } : {}),
        needs: ["venue"],
        ...(cloudSignIn &&
          deps.environment === "preproduction" &&
          (await setupCloudSignInAvailable(c, cloudSignIn, log)) && { cloudSignInAvailable: true }),
        ...(operationBlocked ? { operationBlocked: true } : {}),
        ...(operation === undefined || operation === null
          ? {}
          : {
              operation: {
                id: operation.id,
                kind: operation.kind,
                phase: operation.phase,
                updatedAt: operation.updatedAt,
              },
            }),
      },
      200,
    );
  });

  const { setupBusy } = mountSetupOperationRoutes(
    app,
    deps,
    log,
    holds,
    runOperation,
    restartAfterReply,
    cloudSignIn,
  );

  app.all("/management-api/*", (c) => directError(c, log, "node.reset", 404, "debug"));
  app.all("/api/*", (c) => directError(c, log, "node.reset", 404, "debug"));

  if (deps.setupAppDir !== undefined) {
    mountSetupSpa(app, deps.setupAppDir, log);
  } else {
    app.get("*", (c) =>
      c.html(SETUP_PLACEHOLDER_HTML, 200, { "Cache-Control": REVALIDATE_CACHE_CONTROL }),
    );
  }
}

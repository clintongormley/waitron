import "./errors.js";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { withTransaction } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import type { ModuleRoutes } from "@waitron/module";
import { createErrorBoundary, requireManagementSession } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { retryWaitingRecords } from "./outbox.js";
import { mountConflictRecovery } from "./conflict-recovery-routes.js";

const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "fiscal.not_filing": 409,
  "fiscal.awaiting_certificate": 409,
};

const run = createErrorBoundary(STATUS, "fiscal-retry.failed");

export const FISCAL_ROUTES: ModuleRoutes = {
  mount(app, ctx, log): void {
    mountConflictRecovery(app, ctx, log);
    const drain = ctx.fiscalDrain;
    if (drain === undefined) return;
    app.post("/management-api/fiscal-outbox/retry", (c) =>
      run(c, log, async () => {
        const managementSessionId = requireManagementSession(c);
        const { personId, waiting, cleared } = await withTransaction(ctx.db, async (tx) => {
          const { authorizedBy } = await authorizeManager(tx, {
            managementSessionId,
            permission: "system.manage",
          });
          if (!drain.filing()) throw new AppError("fiscal.not_filing", {});
          if (drain.awaitingCertificate()) throw new AppError("fiscal.awaiting_certificate", {});
          return { personId: authorizedBy, ...(await retryWaitingRecords(tx, new Date())) };
        });
        // After the commit: a woken pass must see the cleared waits.
        drain.wake();
        log("info", "fiscal.retry_now", { waiting, cleared, personId });
        return c.json({ waiting }, 200);
      }),
    );
  },
};

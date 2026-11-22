import type { Context, Hono } from "hono";
import { withTransaction, type Database } from "@waitron/db";
import { resolveManagementSession } from "@waitron/identity";
import { createErrorBoundary, requireManagementSession } from "@waitron/server-kit";
import { AppError, isUuid } from "@waitron/shared";
import type { DeviceAuthDeps } from "./device-session.js";
import type { Logger } from "./logger.js";
import { SESSION_STATUS, assertRequestDevice, requireSession } from "./till-session.js";
import "./errors.js";

type Surface = "till" | "dashboard";

export interface ProblemReports {
  preview(
    device: Surface,
    sessionId: string,
  ): Promise<{ available: true; id: string; attachment: string } | { available: false }>;
  send(device: Surface, sessionId: string, id: string): Promise<"sent" | "queued">;
}

export function mountProblemReportApi(
  app: Hono,
  deps: DeviceAuthDeps & { db: Database; reports?: ProblemReports },
  log: Logger,
): void {
  const run = createErrorBoundary(
    {
      ...SESSION_STATUS,
      "device.unauthorized": 401,
      "management_session.required": 401,
      "management_session.expired": 401,
      "person.suspended": 403,
      "authorization.not_permitted": 403,
      "cloud.not_primary": 409,
      "cloud.not_configured": 409,
      "cloud.state_invalid": 409,
      "cloud.busy": 409,
      "cloud.request_invalid": 400,
    },
    "cloud.failed",
  );

  for (const [prefix, surface] of [
    ["/api/problem-reports", "till"],
    ["/management-api/problem-reports", "dashboard"],
  ] as const) {
    const session = async (c: Context, passive: boolean): Promise<string> => {
      if (surface === "dashboard") {
        const token = requireManagementSession(c);
        const who = await withTransaction(deps.db, (tx) =>
          resolveManagementSession(tx, token, { touch: !passive }),
        );
        return who.sessionRowId;
      }
      const who = await requireSession(deps, c, { passive });
      await assertRequestDevice(deps, c, who);
      return who.sessionId;
    };

    app.get(`${prefix}/preview`, (c) =>
      run(c, log, async () => {
        c.header("Cache-Control", "no-store");
        const id = await session(c, true);
        return c.json((await deps.reports?.preview(surface, id)) ?? { available: false });
      }),
    );
    app.post(`${prefix}/:id/send`, (c) =>
      run(c, log, async () => {
        const sessionId = await session(c, false);
        const id = c.req.param("id");
        if (!isUuid(id)) throw new AppError("cloud.request_invalid", {});
        if (!deps.reports) throw new AppError("cloud.not_configured", {});
        return c.json({ delivery: await deps.reports.send(surface, sessionId, id) });
      }),
    );
  }
}

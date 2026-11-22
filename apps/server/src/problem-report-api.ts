import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { withTransaction, type Database } from "@waitron/db";
import { readPersonAuthority, resolveManagementSession } from "@waitron/identity";
import {
  createErrorBoundary,
  readRawJsonBody,
  requireManagementSession,
} from "@waitron/server-kit";
import { AppError, isUuid } from "@waitron/shared";
import type { OriginAllowlist } from "./allowed-origins.js";
import { sentFromOwnPage } from "./own-page.js";
import type { DeviceAuthDeps } from "./device-session.js";
import type { Logger } from "./logger.js";
import { SESSION_STATUS, assertRequestDevice, requireSession } from "./till-session.js";
import "./errors.js";

type Surface = "till" | "dashboard";

export type ProblemDescription = { reportId: string; description: string; time: number };

export interface ProblemReports {
  preview(
    device: Surface,
    sessionId: string,
  ): Promise<{ available: true; id: string; attachment: string } | { available: false }>;
  send(
    device: Surface,
    sessionId: string,
    id: string,
    description?: { text: string; admin: boolean },
  ): Promise<"sent" | "queued">;
  descriptions(): Promise<ProblemDescription[]>;
  decideDescription(id: string, decision: "send" | "discard"): Promise<void>;
}

export function mountProblemReportApi(
  app: Hono,
  deps: DeviceAuthDeps & { db: Database; reports?: ProblemReports; allowOrigin?: OriginAllowlist },
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

  const managementSession = (c: Context, passive: boolean) => {
    const token = requireManagementSession(c);
    return withTransaction(deps.db, (tx) =>
      resolveManagementSession(tx, token, { touch: !passive }),
    );
  };
  const reports = () => {
    if (!deps.reports) throw new AppError("cloud.not_configured", {});
    return deps.reports;
  };
  async function authorizeDescriptionReview(c: Context, passive: boolean) {
    if (
      !(await sentFromOwnPage(c, deps.allowOrigin ?? (async () => false))) ||
      !(await managementSession(c, passive)).authority.admin
    )
      throw new AppError("authorization.not_permitted", {});
  }
  const review = "/management-api/problem-reports/descriptions";
  app.get(review, (c) =>
    run(c, log, async () => {
      c.header("Cache-Control", "no-store");
      await authorizeDescriptionReview(c, true);
      return c.json((await deps.reports?.descriptions()) ?? []);
    }),
  );
  for (const decision of ["send", "discard"] as const) {
    app.post(`${review}/:id/${decision}`, (c) =>
      run(c, log, async () => {
        await authorizeDescriptionReview(c, false);
        const id = c.req.param("id");
        if (!isUuid(id)) throw new AppError("cloud.request_invalid", {});
        await reports().decideDescription(id, decision);
        return c.body(null, 204);
      }),
    );
  }

  for (const [prefix, surface] of [
    ["/api/problem-reports", "till"],
    ["/management-api/problem-reports", "dashboard"],
  ] as const) {
    const session = async (c: Context, passive: boolean) => {
      if (surface === "dashboard") {
        const who = await managementSession(c, passive);
        return { id: who.sessionRowId, admin: who.authority.admin };
      }
      const who = await requireSession(deps, c, { passive });
      await assertRequestDevice(deps, c, who);
      return { id: who.sessionId, admin: (await readPersonAuthority(deps.db, who.personId)).admin };
    };

    app.get(`${prefix}/preview`, (c) =>
      run(c, log, async () => {
        c.header("Cache-Control", "no-store");
        const who = await session(c, true);
        const preview = (await deps.reports?.preview(surface, who.id)) ?? { available: false };
        return c.json(preview.available && who.admin ? { ...preview, admin: true } : preview);
      }),
    );
    app.post(
      `${prefix}/:id/send`,
      bodyLimit({
        maxSize: 16_384,
        onError: (c) => c.json({ error: { code: "cloud.request_invalid", params: {} } }, 400),
      }),
      (c) =>
        run(c, log, async () => {
          const who = await session(c, false);
          const id = c.req.param("id");
          if (!isUuid(id)) throw new AppError("cloud.request_invalid", {});
          let text: string | undefined;
          if ((await c.req.text()) !== "") {
            const body = await readRawJsonBody<{ description?: unknown }>(c);
            if (!body || typeof body.description !== "string")
              throw new AppError("cloud.request_invalid", {});
            text = body.description;
          }
          const sender = reports();
          if (text === undefined)
            return c.json({ delivery: await sender.send(surface, who.id, id) });
          const delivery = await sender.send(surface, who.id, id, { text, admin: who.admin });
          return c.json({ delivery, description: who.admin ? "queued" : "waiting" });
        }),
    );
  }
}

import type { Context, Hono } from "hono";
import { asAppUser, withTenant, type Database } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import { createErrorBoundary, requireManagementSession } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import type { MailpitClient } from "./mailpit-client.js";
import "./errors.js";

export type EmailDeliveryMode = "local_capture" | "smtp" | "unconfigured";

export interface EmailInboxApiDeps {
  db: Database;
  cfg: { tenantId: string };
  resolveMode(): Promise<EmailDeliveryMode>;
  mailpit: MailpitClient;
}

const STATUS = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "email.test_inbox_unavailable": 409,
} as const;

/** Mount the manager-only view of locally captured account email. */
export function mountEmailInboxApi(app: Hono, deps: EmailInboxApiDeps, log: Logger): void {
  const run = createErrorBoundary(STATUS, "email_inbox.failed");
  const authorize = async (c: Context): Promise<void> => {
    const sessionId = requireManagementSession(c);
    await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await authorizeManager(tx, { managementSessionId: sessionId, permission: "person.manage" });
    });
  };

  app.get("/management-api/email", (c) =>
    run(c, log, async () => {
      await authorize(c);
      const mode = await deps.resolveMode();
      if (mode !== "local_capture") return c.json({ mode, count: 0, messages: [] });
      const inbox = await deps.mailpit.list();
      return c.json({ mode, ...inbox });
    }),
  );

  app.get("/management-api/email/message/:id", (c) =>
    run(c, log, async () => {
      await authorize(c);
      if ((await deps.resolveMode()) !== "local_capture") {
        throw new AppError("email.test_inbox_unavailable", {});
      }
      return c.json(await deps.mailpit.read(c.req.param("id")));
    }),
  );
}

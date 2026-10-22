import type { Context, Hono } from "hono";
import { withTransaction, type Database } from "@waitron/db";
import { authorizeManager, roleHasPermission, type Permission } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import { createErrorBoundary, requireManagementSession } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import type { MailpitClient } from "./mailpit-client.js";
import "./errors.js";

export type EmailDeliveryMode = "local_capture" | "smtp" | "unconfigured";

export interface EmailInboxApiDeps {
  db: Database;
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

export function mountEmailInboxApi(app: Hono, deps: EmailInboxApiDeps, log: Logger): void {
  const run = createErrorBoundary(STATUS, "email_inbox.failed");
  const authorize = async (c: Context, permission: Permission = "person.manage") => {
    const sessionId = requireManagementSession(c);
    return withTransaction(deps.db, async (tx) => {
      return authorizeManager(tx, { managementSessionId: sessionId, permission });
    });
  };

  app.get("/management-api/email", (c) =>
    run(c, log, async () => {
      const actor = await authorize(c);
      const mode = await deps.resolveMode();
      if (mode !== "local_capture" || !roleHasPermission(actor.role, "person.admin"))
        return c.json({ mode, count: 0, messages: [] });
      const inbox = await deps.mailpit.list();
      return c.json({ mode, ...inbox });
    }),
  );

  app.get("/management-api/email/message/:id", (c) =>
    run(c, log, async () => {
      await authorize(c, "person.admin");
      if ((await deps.resolveMode()) !== "local_capture") {
        throw new AppError("email.test_inbox_unavailable", {});
      }
      return c.json(await deps.mailpit.read(c.req.param("id")));
    }),
  );
}

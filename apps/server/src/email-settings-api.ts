import type { Context, Hono } from "hono";
import { eq } from "drizzle-orm";
import { withTransaction, type Database, type Transaction } from "@waitron/db";
import {
  deleteCredential,
  putCredential,
  tryGetCredential,
  type KeyRing,
} from "@waitron/credentials";
import { authorizeManager, persons, roleHasPermission, type Permission } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import { createErrorBoundary, readJsonBody, requireManagementSession } from "@waitron/server-kit";
import { resolveInvoiceEmailDelivery } from "./email-delivery.js";
import { credentialField } from "./credentials.js";
import type { Logger } from "./logger.js";
import { sendSmtpTestMessage } from "./smtp-test-message.js";
import type { OnboardingIntent } from "./trading-config.js";
import { parseEmailSettings } from "@waitron/provisioning";
export { parseEmailSettings } from "@waitron/provisioning";
import "./errors.js";

interface EmailSettingsApiDeps {
  db: Database;
  ring: KeyRing;
  sendTest?: typeof sendSmtpTestMessage;
  config: { onboardingIntent: OnboardingIntent | undefined; devMode: boolean };
}

export function mountEmailSettingsApi(app: Hono, deps: EmailSettingsApiDeps, log: Logger): void {
  const run = createErrorBoundary(
    {
      "management_session.required": 401,
      "management_session.expired": 401,
      "person.suspended": 403,
      "authorization.not_permitted": 403,
      "email.settings_not_allowed": 409,
      "email.settings_invalid": 400,
    },
    "email_settings.failed",
  );
  const authorize = async (
    tx: Transaction,
    c: Context,
    permission: Permission = "system.manage",
  ) => {
    return authorizeManager(tx, {
      managementSessionId: requireManagementSession(c),
      permission,
    });
  };
  const editable = deps.config.onboardingIntent !== "demo";
  app.get("/management-api/email/settings", (c) =>
    run(c, log, async () => {
      const { actor, stored } = await withTransaction(deps.db, async (tx) => ({
        actor: await authorize(tx, c),
        stored: editable ? await tryGetCredential(tx, deps.ring, { purpose: "email.smtp" }) : null,
      }));
      const canEdit = editable && roleHasPermission(actor.role, "person.admin");
      const delivery = await resolveInvoiceEmailDelivery(deps.db, deps.ring, deps.config);
      if (stored === null)
        return c.json({ mode: delivery.mode, editable: canEdit, settings: null });
      let url: URL;
      try {
        url = new URL(credentialField(stored, "email.smtp", "url"));
        if (!["smtp:", "smtps:"].includes(url.protocol) || !url.hostname) throw new Error();
      } catch {
        throw new AppError("server.credential_unusable", { purpose: "email.smtp", field: "url" });
      }
      return c.json({
        mode: delivery.mode,
        editable: canEdit,
        settings: {
          server: url.hostname,
          port: Number(url.port || (url.protocol === "smtps:" ? 465 : 587)),
          encryption: url.protocol === "smtps:" ? "tls" : "starttls",
          from: credentialField(stored, "email.smtp", "from"),
          hasAuthentication: url.username !== "",
        },
      });
    }),
  );
  app.put("/management-api/email/settings", (c) =>
    run(c, log, async () => {
      requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      await withTransaction(deps.db, async (tx) => {
        // The relay carries account-reset links as well as invoice mail.
        await authorize(tx, c, "person.admin");
        if (!editable) throw new AppError("email.settings_not_allowed", {});
        const value = parseEmailSettings(body);
        await putCredential(tx, deps.ring, { purpose: "email.smtp", value });
      });
      return c.json({ saved: true });
    }),
  );
  app.delete("/management-api/email/settings", (c) =>
    run(c, log, async () => {
      await withTransaction(deps.db, async (tx) => {
        await authorize(tx, c, "person.admin");
        if (!editable) throw new AppError("email.settings_not_allowed", {});
        await deleteCredential(tx, { purpose: "email.smtp" });
      });
      return c.json({ removed: true });
    }),
  );
  app.post("/management-api/email/settings/test", (c) =>
    run(c, log, async () => {
      const recipient = await withTransaction(deps.db, async (tx) => {
        const session = await authorizeManager(tx, {
          managementSessionId: requireManagementSession(c),
          permission: "system.manage",
        });
        if (!editable) throw new AppError("email.settings_not_allowed", {});
        const [person] = await tx
          .select({ email: persons.email })
          .from(persons)
          .where(eq(persons.id, session.authorizedBy));
        if (person?.email === null || person?.email === undefined)
          throw new AppError("email.settings_invalid", { field: "recipient" });
        return person.email;
      });
      const value = parseEmailSettings(await readJsonBody<Record<string, unknown>>(c));
      return c.json(await (deps.sendTest ?? sendSmtpTestMessage)(value, recipient));
    }),
  );
}

import type { Context, Hono } from "hono";
import { eq } from "drizzle-orm";
import { withTransaction, type Database, type Transaction } from "@waitron/db";
import { putCredential, type KeyRing } from "@waitron/credentials";
import { authorizeManager, normalizeAndValidateEmail, persons } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import { createErrorBoundary, readJsonBody, requireManagementSession } from "@waitron/server-kit";
import { resolveInvoiceEmailDelivery } from "./email-delivery.js";
import type { Logger } from "./logger.js";
import { sendSmtpTestMessage } from "./smtp-test-message.js";
import type { OnboardingIntent } from "./trading-config.js";
import "./errors.js";

interface EmailSettingsApiDeps {
  db: Database;
  ring: KeyRing;
  sendTest?: typeof sendSmtpTestMessage;
  config: { onboardingIntent: OnboardingIntent | undefined; devMode: boolean };
}

export function parseEmailSettings(body: Record<string, unknown>): { url: string; from: string } {
  const invalid = (field: string): never => {
    throw new AppError("email.settings_invalid", { field });
  };
  if (
    typeof body.server !== "string" ||
    !body.server.trim() ||
    /[\s/@?#]/.test(body.server.trim())
  ) {
    invalid("server");
  }
  if (
    typeof body.port !== "number" ||
    !Number.isInteger(body.port) ||
    body.port < 1 ||
    body.port > 65535
  ) {
    invalid("port");
  }
  if (typeof body.encryption !== "string" || !["starttls", "tls"].includes(body.encryption)) {
    invalid("encryption");
  }
  const protocol = body.encryption === "tls" ? "smtps" : "smtp";
  let url: URL;
  try {
    url = new URL(`${protocol}://${(body.server as string).trim()}:${body.port as number}`);
    if (url.hostname !== (body.server as string).trim().toLowerCase()) invalid("server");
  } catch {
    invalid("server");
  }
  const user = body.user === undefined ? "" : body.user;
  const password = body.password === undefined ? "" : body.password;
  if (typeof user !== "string") invalid("user");
  if (typeof password !== "string") invalid("password");
  if (user === "" && password !== "") invalid("user");
  if (user !== "" && password === "") invalid("password");
  url!.username = encodeURIComponent(user as string);
  url!.password = encodeURIComponent(password as string);
  if (body.encryption === "starttls") url!.searchParams.set("requireTLS", "true");
  if (typeof body.from !== "string") invalid("from");
  let from: string;
  try {
    from = normalizeAndValidateEmail(body.from as string);
  } catch {
    invalid("from");
  }
  return { url: url!.href.replace(/\/$/, ""), from: from! };
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
  const authorize = async (tx: Transaction, c: Context): Promise<void> => {
    await authorizeManager(tx, {
      managementSessionId: requireManagementSession(c),
      permission: "system.manage",
    });
  };
  const editable =
    deps.config.onboardingIntent !== "demo" && deps.config.onboardingIntent !== "prepare";
  app.get("/management-api/email/settings", (c) =>
    run(c, log, async () => {
      await withTransaction(deps.db, (tx) => authorize(tx, c));
      const delivery = await resolveInvoiceEmailDelivery(deps.db, deps.ring, deps.config);
      if (delivery.mode !== "smtp")
        return c.json({ mode: delivery.mode, editable, settings: null });
      let url: URL;
      try {
        url = new URL(delivery.smtp.url);
        if (!["smtp:", "smtps:"].includes(url.protocol) || !url.hostname) throw new Error();
      } catch {
        throw new AppError("server.credential_unusable", { purpose: "email.smtp", field: "url" });
      }
      return c.json({
        mode: "smtp",
        editable,
        settings: {
          server: url.hostname,
          port: Number(url.port || (url.protocol === "smtps:" ? 465 : 587)),
          encryption: url.protocol === "smtps:" ? "tls" : "starttls",
          from: delivery.smtp.from,
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
        await authorize(tx, c);
        if (!editable) throw new AppError("email.settings_not_allowed", {});
        const value = parseEmailSettings(body);
        await putCredential(tx, deps.ring, { purpose: "email.smtp", value });
      });
      return c.json({ saved: true });
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

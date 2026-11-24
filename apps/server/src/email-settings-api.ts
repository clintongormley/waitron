import type { Context, Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  readSettings,
  saveSettings,
  readVenue,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { deleteCredential, type KeyRing } from "@waitron/credentials";
import {
  authorizeManager,
  persons,
  requireFreshManagementSignIn,
  holds,
  type Permission,
} from "@waitron/identity";
import { AppError, hasCode, isAppError } from "@waitron/shared";
import {
  codeOf,
  createErrorBoundary,
  readJsonBody,
  requireManagementSession,
} from "@waitron/server-kit";
import { readSavedSmtp, resolveEmailDeliveryIn } from "./email-delivery.js";
import { MAIL_SETTINGS, saveSmtpSettings } from "./mail-settings.js";
import { venueSmtpFrom } from "./email-sender-name.js";
import type { Logger } from "./logger.js";
import { sendSmtpTestMessage } from "./smtp-test-message.js";
import type { OnboardingIntent } from "./trading-config.js";
import { parseEmailSettings } from "@waitron/provisioning";
export { parseEmailSettings } from "@waitron/provisioning";
import { DAILY_REPORT_MAIL_SETTINGS } from "./daily-report-mail-settings.js";
import { readStaffEmailRecipients } from "./manager-email-recipients.js";
import "./errors.js";

interface EmailSettingsApiDeps {
  db: Database;
  ring: KeyRing;
  sendTest?: typeof sendSmtpTestMessage;
  refreshCloudMail?: () => Promise<unknown>;
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
      "email.test_recipient_missing": 409,
      "management.request_invalid": 400,
      "settings.invalid": 500,
      "settings.out_of_date": 409,
      "credentials.unusable": 500,
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
  async function dailyReportAccess(tx: Transaction, c: Context) {
    const actor = await authorize(tx, c);
    if (!holds(actor.authority, "report.view"))
      throw new AppError("authorization.not_permitted", { permission: "report.view" });
    if (!editable) throw new AppError("email.settings_not_allowed", {});
    return actor.authorizedBy;
  }
  const reportPath = "/management-api/email/settings/daily-report";
  app.get(reportPath, (c) =>
    run(c, log, () =>
      withTransaction(deps.db, async (tx) => {
        await dailyReportAccess(tx, c);
        const { doc, revision } = await readSettings(tx, DAILY_REPORT_MAIL_SETTINGS);
        const choices = await readStaffEmailRecipients(tx, "en", "report.view");
        return c.json({
          ...doc,
          revision,
          recipients: choices.map(({ personId, displayName }) => ({
            id: personId,
            name: displayName,
          })),
        });
      }),
    ),
  );
  app.put(reportPath, (c) =>
    run(c, log, async () => {
      requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      return withTransaction(deps.db, async (tx) => {
        const personId = await dailyReportAccess(tx, c);
        const parsed = DAILY_REPORT_MAIL_SETTINGS.parse(body);
        if (!parsed.ok) throw new AppError("management.request_invalid", { field: parsed.field });
        const { revision } = body;
        if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0)
          throw new AppError("management.request_invalid", { field: "revision" });
        const choices = await readStaffEmailRecipients(tx, "en", "report.view");
        const eligible = new Set(choices.map((choice) => choice.personId));
        if (parsed.doc.recipientIds.some((id) => !eligible.has(id)))
          throw new AppError("management.request_invalid", { field: "recipientIds" });
        const saved = await saveSettings(tx, DAILY_REPORT_MAIL_SETTINGS, {
          doc: parsed.doc,
          expectedRevision: revision,
          personId,
        });
        return c.json({ ...saved.doc, revision: saved.revision });
      });
    }),
  );
  app.get("/management-api/email/settings", (c) =>
    run(c, log, () =>
      withTransaction(deps.db, async (tx) => {
        const actor = await authorize(tx, c);
        const canEdit = editable && holds(actor.authority, "node.manage");
        if (!editable) return c.json({ mode: "local_capture", editable: false, settings: null });
        const saved = await readSavedSmtp(tx, deps.ring);
        const delivery = await resolveEmailDeliveryIn(tx, deps.ring, false);
        const mode = deps.config.devMode ? "local_capture" : delivery.mode;
        if (saved === null) return c.json({ mode, editable: canEdit, settings: null });
        let url: URL;
        try {
          url = new URL(saved.url);
          if (!["smtp:", "smtps:"].includes(url.protocol) || !url.hostname) throw new Error();
        } catch {
          throw new AppError("credentials.unusable", { purpose: "email.smtp", field: "url" });
        }
        return c.json({
          mode,
          editable: canEdit,
          settings: {
            server: url.hostname,
            port: Number(url.port || (url.protocol === "smtps:" ? 465 : 587)),
            encryption: url.protocol === "smtps:" ? "tls" : "starttls",
            from: saved.from,
            hasAuthentication: url.username !== "",
          },
        });
      }),
    ),
  );
  app.put("/management-api/email/settings", (c) =>
    run(c, log, async () => {
      requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      await withTransaction(deps.db, async (tx) => {
        // The relay carries account-reset links as well as invoice mail.
        const { authorizedBy } = await authorize(tx, c, "node.manage");
        if (!editable) throw new AppError("email.settings_not_allowed", {});
        await requireFreshManagementSignIn(tx, requireManagementSession(c));
        const value = parseEmailSettings(body);
        await saveSmtpSettings(tx, deps.ring, value, authorizedBy);
      });
      return c.json({ saved: true });
    }),
  );
  app.delete("/management-api/email/settings", (c) =>
    run(c, log, async () => {
      const removed = await withTransaction(deps.db, async (tx) => {
        const { authorizedBy } = await authorize(tx, c, "node.manage");
        if (!editable) throw new AppError("email.settings_not_allowed", {});
        await requireFreshManagementSignIn(tx, requireManagementSession(c));
        const credentialRemoved = await deleteCredential(tx, {
          personId: authorizedBy,
          purpose: "email.smtp",
        });
        const { revision } = await readSettings(tx, MAIL_SETTINGS);
        await saveSettings(tx, MAIL_SETTINGS, {
          doc: { from: null },
          expectedRevision: revision,
          personId: authorizedBy,
        });
        return credentialRemoved;
      });
      if (removed && deps.refreshCloudMail) {
        try {
          await deps.refreshCloudMail();
        } catch (error) {
          log("warn", "mail.delivery_unavailable", {
            rule: "cloud_relay",
            errorCode: codeOf(error),
          });
        }
      }
      return c.json({ removed: true });
    }),
  );
  app.post("/management-api/email/settings/test", (c) =>
    run(c, log, async () => {
      const { recipient, senderName } = await withTransaction(deps.db, async (tx) => {
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
          throw new AppError("email.test_recipient_missing", {});
        return { recipient: person.email, senderName: (await readVenue(tx)).name };
      });
      const value = parseEmailSettings(await readJsonBody<Record<string, unknown>>(c));
      let from;
      try {
        from = venueSmtpFrom(value.from, senderName);
      } catch (error) {
        if (
          isAppError(error) &&
          hasCode(error, "credentials.unusable") &&
          error.params.purpose === "email.smtp" &&
          error.params.field === "from"
        ) {
          throw new AppError("email.settings_invalid", { field: "from" });
        }
        throw error;
      }
      return c.json(await (deps.sendTest ?? sendSmtpTestMessage)({ ...value, from }, recipient));
    }),
  );
}

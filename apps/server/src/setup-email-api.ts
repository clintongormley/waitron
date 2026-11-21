import { validateSmtpTestFrom } from "./email-sender-name.js";
import type { Hono } from "hono";
import { normalizeAndValidateEmail } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import { createErrorBoundary, readRawJsonBody } from "@waitron/server-kit";
import { parseEmailSettings } from "./email-settings-api.js";
import { sendSmtpTestMessage } from "./smtp-test-message.js";
import type { Logger } from "./logger.js";
import "./errors.js";

export function assertSetupMailLogin(settings: { url: string }): void {
  if (new URL(settings.url).username === "") {
    throw new AppError("email.settings_invalid", { field: "user" });
  }
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError("setup.request_invalid", { field });
  }
  return value as Record<string, unknown>;
}

export function mountSetupEmailTest(
  app: Hono,
  log: Logger,
  send: typeof sendSmtpTestMessage = sendSmtpTestMessage,
  otherOperationBusy: () => boolean = () => false,
): () => boolean {
  const run = createErrorBoundary({ "setup.already_provisioning": 409 }, "setup.email_test_failed");
  let testing = false;
  app.post("/setup-api/email-test", (c) =>
    run(c, log, async () => {
      if (testing || otherOperationBusy()) throw new AppError("setup.already_provisioning", {});
      testing = true;
      try {
        const body = object(await readRawJsonBody<unknown>(c), "body");
        if (body.mode !== "live" && body.mode !== "prepare")
          throw new AppError("setup.request_invalid", { field: "mode" });
        const settings = parseEmailSettings(object(body.email, "email"));
        validateSmtpTestFrom(settings.from);
        const admin = object(object(body.venue, "admin.email").admin, "admin.email");
        if (typeof admin.email !== "string") {
          throw new AppError("setup.request_invalid", { field: "admin.email" });
        }
        const recipient = normalizeAndValidateEmail(admin.email);
        assertSetupMailLogin(settings);
        return c.json(await send(settings, recipient, { requireLogin: true }));
      } finally {
        testing = false;
      }
    }),
  );
  return () => testing;
}

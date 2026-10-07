import type { Hono } from "hono";
import { normalizeAndValidateEmail } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import { createErrorBoundary, readRawJsonBody } from "@waitron/server-kit";
import { parseEmailSettings } from "./email-settings-api.js";
import { sendSmtpTestMessage } from "./smtp-test-message.js";
import type { Logger } from "./logger.js";
import "./errors.js";

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
        if (body.mode !== "live") throw new AppError("setup.request_invalid", { field: "mode" });
        const settings = parseEmailSettings(object(body.email, "email"));
        const admin = object(object(body.venue, "admin.email").admin, "admin.email");
        if (typeof admin.email !== "string") {
          throw new AppError("setup.request_invalid", { field: "admin.email" });
        }
        const recipient = normalizeAndValidateEmail(admin.email);
        return c.json(await send(settings, recipient));
      } finally {
        testing = false;
      }
    }),
  );
  return () => testing;
}

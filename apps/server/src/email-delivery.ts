import { readVenue, withTransaction, type Database, type Transaction } from "@waitron/db";
import { tryGetCredential, type KeyRing } from "@waitron/credentials";
import { credentialField } from "./credentials.js";
import { hasCode, isAppError } from "@waitron/shared";
import { venueSmtpFrom } from "./email-sender-name.js";
import type { SmtpConnection } from "./smtp-send.js";
import type { OnboardingIntent } from "./trading-config.js";

export type EmailDelivery =
  { mode: "smtp" | "local_capture"; smtp: SmtpConnection } | { mode: "unconfigured" };

const LOCAL_CAPTURE_SMTP = {
  url: "smtp://127.0.0.1:1025",
  from: "Waitron <no-reply@waitron.test>",
} as const;

/** Resolve outbound email immediately before use so credential changes do not require a restart. */
export async function resolveEmailDelivery(
  db: Database,
  ring: KeyRing,
  practiceMode: boolean,
  captureOnly = false,
): Promise<EmailDelivery> {
  return withTransaction(db, (tx) => resolveEmailDeliveryIn(tx, ring, practiceMode, captureOnly));
}

export async function resolveEmailDeliveryIn(
  tx: Transaction,
  ring: KeyRing,
  practiceMode: boolean,
  captureOnly = false,
): Promise<EmailDelivery> {
  return resolveMailDeliveryIn(
    tx,
    ring,
    {
      devMode: practiceMode && !captureOnly,
      onboardingIntent: captureOnly ? "demo" : undefined,
    },
    "notice",
  );
}

export type MailDeliveryRule = "notice" | "invoice";

export async function resolveMailDeliveryIn(
  tx: Transaction,
  ring: KeyRing,
  config: { onboardingIntent: OnboardingIntent | undefined; devMode: boolean },
  rule: MailDeliveryRule,
): Promise<EmailDelivery> {
  if (
    (config.onboardingIntent === "demo" && !config.devMode) ||
    (rule === "invoice" && (config.devMode || config.onboardingIntent === "demo"))
  ) {
    return { mode: "local_capture", smtp: LOCAL_CAPTURE_SMTP };
  }
  const configured = await readSavedSmtp(tx, ring);
  if (configured !== null) {
    const name = (await readVenue(tx)).name;
    try {
      return {
        mode: "smtp",
        smtp: { url: configured.url, from: venueSmtpFrom(configured.from, name) },
      };
    } catch (error) {
      if (
        isAppError(error) &&
        hasCode(error, "server.credential_unusable") &&
        error.params.purpose === "email.smtp" &&
        error.params.field === "from"
      ) {
        return { mode: "unconfigured" };
      }
      throw error;
    }
  }
  if (config.devMode) return { mode: "local_capture", smtp: LOCAL_CAPTURE_SMTP };
  return { mode: "unconfigured" };
}

export async function readSavedSmtp(
  tx: Transaction,
  ring: KeyRing,
): Promise<{ url: string; from: string } | null> {
  const configured = await tryGetCredential(tx, ring, { purpose: "email.smtp" });
  return configured === null
    ? null
    : {
        url: credentialField(configured, "email.smtp", "url"),
        from: credentialField(configured, "email.smtp", "from"),
      };
}

export async function resolveInvoiceEmailDelivery(
  db: Database,
  ring: KeyRing,
  config: { onboardingIntent: OnboardingIntent | undefined; devMode: boolean },
): Promise<EmailDelivery> {
  return withTransaction(db, (tx) => resolveMailDeliveryIn(tx, ring, config, "invoice"));
}
